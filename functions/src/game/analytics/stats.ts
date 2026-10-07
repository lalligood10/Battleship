/**
 * Phase 5 Session A: pure reducers for per-mode stats (`playerStats/{uid}`) and head-to-head
 * (`headToHead/{pair}`). Counting rules: docs/PHASE-5-CONTRACT.md. Inputs are never mutated.
 */
import type { EndReason, GameMode } from '../core/schema';
import {
  EMPTY_MODE_STATS,
  GAME_MODES,
  type GameEndRecord,
  type HeadToHeadDoc,
  type ModeStats,
  type PlayerGameLine,
  type PlayerStatsDoc,
} from './contract';

export type StatsBucket = 'pvp' | 'bot';

const END_REASONS: readonly EndReason[] = ['all_sunk', 'resign', 'timeout'];

const COUNTERS = ['gamesPlayed', 'wins', 'losses', 'shotsFired', 'hits', 'shipsLost', 'shipsSunk', 'sinkWins', 'sinkWinTurns'] as const;

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function reasons(value: unknown): Record<EndReason, number> {
  const source = (value ?? {}) as Partial<Record<EndReason, unknown>>;
  return Object.fromEntries(END_REASONS.map((r) => [r, count(source[r])])) as Record<EndReason, number>;
}

/** A fresh, deep copy of `EMPTY_MODE_STATS`. */
export function emptyModeStats(): ModeStats {
  return { ...EMPTY_MODE_STATS, winsByReason: { ...EMPTY_MODE_STATS.winsByReason }, lossesByReason: { ...EMPTY_MODE_STATS.lossesByReason } };
}

/** Fills missing or malformed fields with zeros, so stored docs can be read safely. Always returns a new object. */
export function normalizeModeStats(value: Partial<ModeStats> | undefined | null): ModeStats {
  const out = emptyModeStats();
  if (!value) return out;
  for (const key of COUNTERS) out[key] = count(value[key]);
  out.winsByReason = reasons(value.winsByReason);
  out.lossesByReason = reasons(value.lossesByReason);
  return out;
}

function emptyBucket(): Record<GameMode, ModeStats> {
  return Object.fromEntries(GAME_MODES.map((m) => [m, emptyModeStats()])) as Record<GameMode, ModeStats>;
}

export function emptyPlayerStats(uid: string, nowMs = 0): PlayerStatsDoc {
  return { uid, pvp: emptyBucket(), bot: emptyBucket(), updatedAtMs: nowMs };
}

export function normalizePlayerStats(uid: string, value: Partial<PlayerStatsDoc> | undefined | null): PlayerStatsDoc {
  const bucket = (b: Partial<Record<GameMode, Partial<ModeStats>>> | undefined): Record<GameMode, ModeStats> =>
    Object.fromEntries(GAME_MODES.map((m) => [m, normalizeModeStats(b?.[m])])) as Record<GameMode, ModeStats>;
  return { uid, pvp: bucket(value?.pvp), bot: bucket(value?.bot), updatedAtMs: count(value?.updatedAtMs) };
}

/** Games against the computer go to `bot`; every human-vs-human game (rated, unrated, guest) goes to `pvp`. */
export function statsBucket(record: GameEndRecord): StatsBucket {
  return record.isBotGame || record.lines.some((l) => l.isBot) ? 'bot' : 'pvp';
}

export function applyRecordToModeStats(stats: ModeStats, line: PlayerGameLine, record: GameEndRecord): ModeStats {
  const next = normalizeModeStats(stats);
  const reason = record.endReason;
  next.gamesPlayed += 1;
  next.shotsFired += line.shotsFired;
  next.hits += line.hits;
  next.shipsLost += line.shipsLost;
  next.shipsSunk += line.shipsSunk;
  if (line.won) {
    next.wins += 1;
    next.winsByReason[reason] += 1;
    if (reason === 'all_sunk') {
      next.sinkWins += 1;
      next.sinkWinTurns += line.turns;
    }
  } else {
    next.losses += 1;
    next.lossesByReason[reason] += 1;
  }
  return next;
}

/** Applies one game to a player's whole stats doc (bucket picked by `statsBucket`, mode by `record.mode`). */
export function applyRecordToPlayerStats(
  doc: PlayerStatsDoc | undefined,
  line: PlayerGameLine,
  record: GameEndRecord,
  nowMs: number,
): PlayerStatsDoc {
  const next = normalizePlayerStats(line.uid, doc);
  const bucket = statsBucket(record);
  next[bucket][record.mode] = applyRecordToModeStats(next[bucket][record.mode], line, record);
  next.updatedAtMs = nowMs;
  return next;
}

function emptyWins(uids: readonly string[]): Record<string, number> {
  return Object.fromEntries(uids.map((u) => [u, 0]));
}

export function applyRecordToHeadToHead(doc: HeadToHeadDoc | undefined, record: GameEndRecord): HeadToHeadDoc {
  const playerUids = [...record.playerUids].sort() as [string, string];
  const wins = { ...emptyWins(playerUids), ...doc?.wins };
  const winsByMode = Object.fromEntries(
    GAME_MODES.map((m) => [m, { ...emptyWins(playerUids), ...doc?.winsByMode?.[m] }]),
  ) as Record<GameMode, Record<string, number>>;
  const usernames = { ...doc?.usernames };
  for (const line of record.lines) if (line.username) usernames[line.uid] = line.username;

  wins[record.winner] = count(wins[record.winner]) + 1;
  winsByMode[record.mode][record.winner] = count(winsByMode[record.mode][record.winner]) + 1;
  return {
    playerUids,
    usernames,
    gamesPlayed: count(doc?.gamesPlayed) + 1,
    wins,
    winsByMode,
    lastGameId: record.gameId,
    lastWinnerUid: record.winner,
    lastPlayedAtMs: record.endedAt,
  };
}
