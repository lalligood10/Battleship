/** Phase 5 per-mode stats and head-to-head: Firestore reads (written only by the game-end trigger) and pure formatters. */
import { doc, getDoc } from 'firebase/firestore';
import { GAME_MODES, RETENTION_PATHS, type HeadToHeadDoc, type ModeStats, type PlayerStatsDoc } from '@shared/analytics/contract';
import { normalizePlayerStats } from '@shared/analytics/stats';
import type { GameMode } from '@shared/core/schema';
import { db } from './firebase';

export type { HeadToHeadDoc, ModeStats, PlayerStatsDoc };

export async function getPlayerStats(uid: string): Promise<PlayerStatsDoc | null> {
  const snap = await getDoc(doc(db(), RETENTION_PATHS.playerStats(uid)));
  return snap.exists() ? normalizePlayerStats(uid, snap.data() as Partial<PlayerStatsDoc>) : null;
}

/**
 * The rules only let the two players read the doc (`uid in resource.data.playerUids`), which is a
 * denial – not an empty snapshot – when the pair hasn't played yet. Both mean "no record".
 */
export async function getHeadToHead(myUid: string, oppUid: string): Promise<HeadToHeadDoc | null> {
  try {
    const snap = await getDoc(doc(db(), RETENTION_PATHS.headToHead(myUid, oppUid)));
    return snap.exists() ? headToHeadFromData(snap.data()) : null;
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'permission-denied') return null;
    throw err;
  }
}

export function headToHeadFromData(data: Record<string, unknown>): HeadToHeadDoc {
  const d = data as Partial<HeadToHeadDoc>;
  return {
    playerUids: (d.playerUids ?? ['', '']) as [string, string],
    usernames: d.usernames ?? {},
    gamesPlayed: Number(d.gamesPlayed ?? 0),
    wins: d.wins ?? {},
    winsByMode: Object.fromEntries(GAME_MODES.map((m) => [m, d.winsByMode?.[m] ?? {}])) as HeadToHeadDoc['winsByMode'],
    lastGameId: String(d.lastGameId ?? ''),
    lastWinnerUid: String(d.lastWinnerUid ?? ''),
    lastPlayedAtMs: Number(d.lastPlayedAtMs ?? 0),
  };
}

const DASH = '—';

function pct(n: number, d: number): string {
  if (!(d > 0)) return DASH;
  return `${Math.round(Math.min(1, Math.max(0, n / d)) * 100)}%`;
}

export const formatWinRate = (s: Pick<ModeStats, 'wins' | 'gamesPlayed'>): string => pct(s.wins, s.gamesPlayed);

export const formatAccuracy = (s: Pick<ModeStats, 'hits' | 'shotsFired'>): string => pct(s.hits, s.shotsFired);

/** Turns per fleet-sinking win, one decimal; resignation and timeout wins are excluded by the contract. */
export function formatAvgTurnsToWin(s: Pick<ModeStats, 'sinkWins' | 'sinkWinTurns'>): string {
  if (!(s.sinkWins > 0)) return DASH;
  return String(Math.round((s.sinkWinTurns / s.sinkWins) * 10) / 10);
}

export const formatWinLoss = (s: Pick<ModeStats, 'wins' | 'losses'>): string => `${s.wins}–${s.losses}`;

export interface HeadToHeadScore {
  mine: number;
  theirs: number;
}

function scoreFrom(wins: Record<string, number> | undefined, myUid: string): HeadToHeadScore {
  const mine = Number(wins?.[myUid] ?? 0);
  const theirs = Object.entries(wins ?? {}).reduce((sum, [uid, n]) => (uid === myUid ? sum : sum + Number(n)), 0);
  return { mine, theirs };
}

/** My wins vs theirs, overall or for one mode. */
export function headToHeadScore(h: HeadToHeadDoc | null, myUid: string, mode?: GameMode): HeadToHeadScore {
  if (!h) return { mine: 0, theirs: 0 };
  return scoreFrom(mode ? h.winsByMode[mode] : h.wins, myUid);
}

/** "You 3–2", always from my point of view. */
export function formatHeadToHead(h: HeadToHeadDoc | null, myUid: string, mode?: GameMode): string {
  const { mine, theirs } = headToHeadScore(h, myUid, mode);
  return `You ${mine}–${theirs}`;
}

/** Text (not colour) that says who is ahead. */
export function headToHeadStanding(score: HeadToHeadScore): 'lead' | 'trail' | 'level' {
  return score.mine > score.theirs ? 'lead' : score.mine < score.theirs ? 'trail' : 'level';
}

export function bucketHasGames(bucket: Record<GameMode, ModeStats> | undefined): boolean {
  return GAME_MODES.some((m) => (bucket?.[m]?.gamesPlayed ?? 0) > 0);
}
