/**
 * Daily challenge callables. Everyone plays the same hidden fleet each UTC day; the fleet and seed
 * live in `dailyChallengesPrivate/{dateKey}` and are never returned or logged.
 */
import { randomInt } from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { GAME_CONFIG } from '../game/config';
import { cellKey, isFleetDestroyed, resolveShot, type Shot } from '../game/engine';
import {
  DAILY_SHIP_TYPES,
  RETENTION_PATHS,
  dailyDateKey,
  dailyFleet,
  type AchievementDoc,
  type DailyChallengeDoc,
  type DailyChallengePrivateDoc,
  type DailyFireRequest,
  type DailyRunDoc,
  type DailyScoreDoc,
  type DailyView,
} from '../game/analytics/contract';
import { db, refs } from '../lib/firestore';

const doc = <T>(path: string) => db.doc(path) as DocumentReference<T>;

function emptyRun(dateKey: string, nowMs: number): DailyRunDoc {
  return { dateKey, shots: [], sunkShips: [], startedAtMs: nowMs, completedAtMs: null };
}

function viewOf(challenge: DailyChallengeDoc, run: DailyRunDoc | undefined): DailyView {
  return {
    dateKey: challenge.dateKey,
    shipTypes: challenge.shipTypes,
    shots: run?.shots ?? [],
    sunkShips: run?.sunkShips ?? [],
    completedAtMs: run?.completedAtMs ?? null,
  };
}

/** Creates today's private fleet and public definition once; concurrent first calls retry and read the winner. */
export async function ensureDailyChallenge(dateKey: string, nowMs: number): Promise<DailyChallengeDoc> {
  const publicRef = doc<DailyChallengeDoc>(RETENTION_PATHS.dailyChallenge(dateKey));
  const privateRef = doc<DailyChallengePrivateDoc>(RETENTION_PATHS.dailyChallengePrivate(dateKey));
  return db.runTransaction(async (tx) => {
    const [priv, pub] = await Promise.all([tx.get(privateRef), tx.get(publicRef)]);
    const challenge: DailyChallengeDoc = pub.data() ?? { dateKey, shipTypes: [...DAILY_SHIP_TYPES], createdAtMs: nowMs };
    if (!priv.exists) {
      const seed = randomInt(0, 2 ** 31);
      tx.create(privateRef, { dateKey, seed, fleet: dailyFleet(seed, dateKey) });
    }
    if (!pub.exists) tx.create(publicRef, challenge);
    return challenge;
  });
}

export async function getDailyChallenge(uid: string, _data: unknown, nowMs: number = Date.now()): Promise<DailyView> {
  const dateKey = dailyDateKey(nowMs);
  const challenge = await ensureDailyChallenge(dateKey, nowMs);
  const run = (await doc<DailyRunDoc>(RETENTION_PATHS.dailyRun(uid, dateKey)).get()).data();
  return viewOf(challenge, run);
}

function parseFire(data: unknown): DailyFireRequest {
  const d = (data ?? {}) as Partial<DailyFireRequest>;
  if (typeof d.dateKey !== 'string' || !d.dateKey) throw new HttpsError('invalid-argument', 'dateKey is required');
  if (!Number.isInteger(d.row) || !Number.isInteger(d.col)) throw new HttpsError('invalid-argument', 'target is required');
  return { dateKey: d.dateKey, row: d.row!, col: d.col! };
}

export async function fireDailyShot(uid: string, data: unknown, nowMs: number = Date.now()): Promise<DailyView> {
  const { dateKey, row, col } = parseFire(data);
  if (dateKey !== dailyDateKey(nowMs)) {
    throw new HttpsError('failed-precondition', "That daily challenge has ended. Load today's board.");
  }
  const size = GAME_CONFIG.BOARD_SIZE;
  if (row < 0 || col < 0 || row >= size || col >= size) throw new HttpsError('invalid-argument', 'Target is off the board');

  const challenge = await ensureDailyChallenge(dateKey, nowMs);
  const privateRef = doc<DailyChallengePrivateDoc>(RETENTION_PATHS.dailyChallengePrivate(dateKey));
  const runRef = doc<DailyRunDoc>(RETENTION_PATHS.dailyRun(uid, dateKey));
  const achievementRef = doc<AchievementDoc>(RETENTION_PATHS.achievement(uid, 'daily-clear'));
  const scoreRef = doc<DailyScoreDoc>(RETENTION_PATHS.dailyScore(dateKey, uid));

  return db.runTransaction(async (tx) => {
    const [privSnap, runSnap, profileSnap, achievementSnap] = await Promise.all([
      tx.get(privateRef),
      tx.get(runRef),
      tx.get(refs.user(uid)),
      tx.get(achievementRef),
    ]);
    const fleet = privSnap.data()?.fleet;
    if (!fleet) throw new HttpsError('unavailable', "Today's challenge isn't ready yet. Please try again.");
    const run = runSnap.data() ?? emptyRun(dateKey, nowMs);
    if (run.completedAtMs !== null) throw new HttpsError('failed-precondition', "You've already cleared today's challenge");
    const key = cellKey(row, col);
    if (run.shots.some((s) => cellKey(s.row, s.col) === key)) {
      throw new HttpsError('failed-precondition', 'You already fired at that cell');
    }

    const hits = new Set(run.shots.filter((s) => s.result !== 'miss').map((s) => cellKey(s.row, s.col)));
    const { result, sunkShip } = resolveShot(fleet, hits, { row, col });
    const shot: Shot = { row, col, result, at: nowMs };
    if (sunkShip) {
      shot.sunkShip = sunkShip;
      shot.sunkPlacement = fleet.find((ship) => ship.type === sunkShip)!;
    }
    if (result !== 'miss') hits.add(key);
    const next: DailyRunDoc = {
      ...run,
      shots: [...run.shots, shot],
      sunkShips: sunkShip ? [...run.sunkShips, sunkShip] : run.sunkShips,
    };

    if (isFleetDestroyed(fleet, hits)) {
      next.completedAtMs = nowMs;
      const profile = profileSnap.data();
      if (profile && profile.isGuest !== true && !profile.suspended) {
        tx.create(scoreRef, { username: profile.username, shots: next.shots.length, completedAtMs: nowMs });
      }
      if (!achievementSnap.exists) {
        tx.create(achievementRef, { id: 'daily-clear', unlockedAtMs: nowMs, gameId: null, dailyDateKey: dateKey });
      }
    }
    tx.set(runRef, next);
    return viewOf(challenge, next);
  });
}
