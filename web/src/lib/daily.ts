/** Daily challenge client: callables, scoreboard reads and pure status helpers. */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, type DocumentData } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  dailyDateKey,
  type DailyFireRequest,
  type DailyRunDoc,
  type DailyScoreDoc,
  type DailyView,
} from '@shared/analytics/contract';
import { db, functions } from './firebase';
import { toAppError } from './errors';

export type { DailyFireRequest, DailyScoreDoc, DailyView } from '@shared/analytics/contract';
export { dailyDateKey };

export const DAILY_TOP = 10;

async function call<TResult, TData extends object>(name: string, data: TData): Promise<TResult> {
  try {
    return (await httpsCallable<TData, TResult>(functions(), name)(data)).data;
  } catch (err) {
    throw toAppError(err);
  }
}

export const getDailyChallenge = () => call<DailyView, Record<string, never>>('getDailyChallenge', {});
export const fireDailyShot = (req: DailyFireRequest) => call<DailyView, DailyFireRequest>('fireDailyShot', req);

export interface DailyScoreRow extends DailyScoreDoc {
  uid: string;
}

export function scoreFromData(uid: string, d: DocumentData | undefined): DailyScoreRow | null {
  if (!d || typeof d.shots !== 'number' || typeof d.completedAtMs !== 'number') return null;
  return { uid, username: String(d.username ?? 'Unknown'), shots: d.shots, completedAtMs: d.completedAtMs };
}

/** Fewest shots first, then earliest clear. */
export function rankScores(rows: readonly DailyScoreRow[], max = DAILY_TOP): DailyScoreRow[] {
  return [...rows].sort((a, b) => a.shots - b.shots || a.completedAtMs - b.completedAtMs).slice(0, max);
}

export async function fetchDailyTop(dateKey: string, max = DAILY_TOP): Promise<DailyScoreRow[]> {
  const snap = await getDocs(
    query(collection(db(), 'dailyScores', dateKey, 'players'), orderBy('shots', 'asc'), orderBy('completedAtMs', 'asc'), limit(max)),
  );
  return rankScores(snap.docs.map((d) => scoreFromData(d.id, d.data())).filter((r): r is DailyScoreRow => r !== null), max);
}

export async function fetchDailyScore(dateKey: string, uid: string): Promise<DailyScoreRow | null> {
  return scoreFromData(uid, (await getDoc(doc(db(), 'dailyScores', dateKey, 'players', uid))).data());
}

/** Today's run straight from `users/{uid}/dailyRuns/{dateKey}` (owner-readable), for the Home card. */
export async function fetchTodayRun(uid: string, nowMs = Date.now()): Promise<Pick<DailyRunDoc, 'shots' | 'completedAtMs'> | null> {
  const d = (await getDoc(doc(db(), 'users', uid, 'dailyRuns', dailyDateKey(nowMs)))).data();
  if (!d) return null;
  return { shots: Array.isArray(d.shots) ? d.shots : [], completedAtMs: typeof d.completedAtMs === 'number' ? d.completedAtMs : null };
}

export type DailyStatus =
  | { kind: 'not-started' }
  | { kind: 'in-progress'; shots: number }
  | { kind: 'cleared'; shots: number };

export function dailyStatus(run: Pick<DailyRunDoc, 'shots' | 'completedAtMs'> | null): DailyStatus {
  if (!run || run.shots.length === 0) return { kind: 'not-started' };
  if (run.completedAtMs !== null) return { kind: 'cleared', shots: run.shots.length };
  return { kind: 'in-progress', shots: run.shots.length };
}

const plural = (n: number) => `${n} shot${n === 1 ? '' : 's'}`;

export function dailyStatusText(status: DailyStatus): string {
  switch (status.kind) {
    case 'not-started':
      return 'Not started';
    case 'in-progress':
      return `${plural(status.shots)} so far`;
    case 'cleared':
      return `Cleared in ${plural(status.shots)}`;
  }
}

/** "5h 12m" until the next 00:00 UTC. */
export function timeUntilReset(nowMs: number): string {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const mins = Math.max(1, Math.ceil((next - nowMs) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function msUntilNextMinute(nowMs: number): number {
  return 60_000 - (nowMs % 60_000);
}

export function dailyCounts(view: Pick<DailyView, 'shots'>): { shots: number; hits: number; accuracy: number } {
  const shots = view.shots.length;
  const hits = view.shots.filter((s) => s.result !== 'miss').length;
  return { shots, hits, accuracy: shots === 0 ? 0 : Math.round((hits / shots) * 100) };
}
