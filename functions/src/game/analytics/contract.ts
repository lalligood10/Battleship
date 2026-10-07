/**
 * Phase 5 retention contract (tag `phase-5-schema`). Pure – no Firebase imports – so web can import it
 * as `@shared/analytics/contract`. Every retention feature reads the same `GameEndRecord`, built once
 * per finished game by the `onGameFinished` trigger, and writes only to its own collections.
 * Rules and decisions: docs/PHASE-5-CONTRACT.md.
 */
import { isBotUid, type BotDifficulty } from '../bots';
import { SHIP_TYPES, type ShipType } from '../config';
import { deriveRng } from '../core/rng';
import type { EndReason, GameMode } from '../core/schema';
import { randomFleet, type ShipPlacement, type Shot } from '../engine';
import { gameAnalyticsRecord, turnsTaken, type FinishedGameSource, type GameAnalyticsRecord } from './gameRecord';

export const GAME_MODES: readonly GameMode[] = ['classic', 'salvo', 'abilities'];

/** Firestore paths. Each feature owns its collections; nobody writes another feature's paths. */
export const RETENTION_PATHS = {
  /** Server-only. One record per finished game. */
  gameEnd: (gameId: string) => `gameEnds/${gameId}`,
  /** Server-only idempotency marker, created in the same transaction as a consumer's writes. */
  gameEndApplied: (gameId: string, consumer: GameEndConsumerId) => `gameEnds/${gameId}/applied/${consumer}`,
  /** Stats + head-to-head session. */
  playerStats: (uid: string) => `playerStats/${uid}`,
  headToHead: (uidA: string, uidB: string) => `headToHead/${headToHeadId(uidA, uidB)}`,
  /** Achievements + daily session. */
  achievement: (uid: string, id: AchievementId) => `users/${uid}/achievements/${id}`,
  dailyChallenge: (dateKey: string) => `dailyChallenges/${dateKey}`,
  /** Server-only: the hidden daily fleet and its seed. */
  dailyChallengePrivate: (dateKey: string) => `dailyChallengesPrivate/${dateKey}`,
  dailyRun: (uid: string, dateKey: string) => `users/${uid}/dailyRuns/${dateKey}`,
  dailyScore: (dateKey: string, uid: string) => `dailyScores/${dateKey}/players/${uid}`,
} as const;

export type GameEndConsumerId = 'stats' | 'headToHead' | 'achievements';

// ---------------------------------------------------------------------------------------------
// Game-end record
// ---------------------------------------------------------------------------------------------

export interface GameEndPlayerSource {
  sunkShips: ShipType[];
  username?: string;
  isGuest?: boolean;
  shotsFired?: number;
  hits?: number;
}

/** Extra GameDoc fields the record needs beyond the analytics source. */
export interface GameEndSource extends FinishedGameSource {
  isRated?: boolean;
  botDifficulty?: BotDifficulty | null;
  rematchOf?: string | null;
  players: Record<string, GameEndPlayerSource | undefined>;
}

export interface PlayerGameLine {
  uid: string;
  username: string;
  isBot: boolean;
  isGuest: boolean;
  won: boolean;
  /** Turns this player took (Classic shot, Salvo volley, or ability turn each count once). */
  turns: number;
  shotsFired: number;
  hits: number;
  /** Own ships sunk by the opponent. */
  shipsLost: number;
  /** Opponent ships this player sank. */
  shipsSunk: number;
}

export interface GameEndRecord extends GameAnalyticsRecord {
  playerUids: [string, string];
  loser: string;
  isRated: boolean;
  botDifficulty: BotDifficulty | null;
  rematchOf: string | null;
  /** Both players, in `playerUids` order. */
  lines: [PlayerGameLine, PlayerGameLine];
}

/** Builds the record, or null when the game didn't finish with a winner (cancelled, never started). */
export function gameEndRecord(gameId: string, game: GameEndSource): GameEndRecord | null {
  const base = gameAnalyticsRecord(gameId, game);
  if (!base || game.playerUids.length !== 2) return null;
  const [a, b] = game.playerUids as [string, string];
  const loser = base.winner === a ? b : a;
  const line = (uid: string, opp: string): PlayerGameLine => {
    const p = game.players[uid];
    const shots = game.shots[uid] ?? [];
    return {
      uid,
      username: p?.username ?? '',
      isBot: isBotUid(uid),
      isGuest: p?.isGuest === true,
      won: uid === base.winner,
      turns: turnsTaken({ playerUids: [uid], shots: game.shots, abilityLog: (game.abilityLog ?? []).filter((e) => e.player === uid) }),
      shotsFired: p?.shotsFired ?? shots.length,
      hits: p?.hits ?? shots.filter((s) => s.result !== 'miss').length,
      shipsLost: new Set(p?.sunkShips ?? []).size,
      shipsSunk: new Set(game.players[opp]?.sunkShips ?? []).size,
    };
  };
  return {
    ...base,
    playerUids: [a, b],
    loser,
    isRated: game.isRated !== false && !base.isBotGame,
    botDifficulty: game.botDifficulty ?? null,
    rematchOf: game.rematchOf ?? null,
    lines: [line(a, b), line(b, a)],
  };
}

export function lineFor(record: GameEndRecord, uid: string): PlayerGameLine | undefined {
  return record.lines.find((l) => l.uid === uid);
}

// ---------------------------------------------------------------------------------------------
// Stats + head-to-head (Session A)
// ---------------------------------------------------------------------------------------------

export interface ModeStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  shotsFired: number;
  hits: number;
  shipsLost: number;
  shipsSunk: number;
  /** Wins by sinking the whole fleet, and the turns they took – average turns to win uses only these. */
  sinkWins: number;
  sinkWinTurns: number;
  winsByReason: Record<EndReason, number>;
  lossesByReason: Record<EndReason, number>;
}

/** `playerStats/{uid}`. Human-vs-human games go to `pvp`, games against the computer to `bot`. */
export interface PlayerStatsDoc {
  uid: string;
  pvp: Record<GameMode, ModeStats>;
  bot: Record<GameMode, ModeStats>;
  updatedAtMs: number;
}

/** `headToHead/{headToHeadId}`. Human-vs-human games only (rated, unrated, and guest games all count). */
export interface HeadToHeadDoc {
  playerUids: [string, string];
  usernames: Record<string, string>;
  gamesPlayed: number;
  wins: Record<string, number>;
  winsByMode: Record<GameMode, Record<string, number>>;
  lastGameId: string;
  lastWinnerUid: string;
  lastPlayedAtMs: number;
}

export function headToHeadId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('__');
}

export const EMPTY_MODE_STATS: ModeStats = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  shotsFired: 0,
  hits: 0,
  shipsLost: 0,
  shipsSunk: 0,
  sinkWins: 0,
  sinkWinTurns: 0,
  winsByReason: { all_sunk: 0, resign: 0, timeout: 0 },
  lossesByReason: { all_sunk: 0, resign: 0, timeout: 0 },
};

// ---------------------------------------------------------------------------------------------
// Achievements + daily challenge (Session B)
// ---------------------------------------------------------------------------------------------

export type AchievementId =
  | 'first-victory'
  | 'one-volley-sink'
  | 'last-ship-standing'
  | 'flawless'
  | 'full-arsenal'
  | 'admiral-slayer'
  | 'daily-clear';

export interface AchievementDefinition {
  id: AchievementId;
  label: string;
  description: string;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: 'first-victory', label: 'First Victory', description: 'Win a game by sinking the enemy fleet.' },
  { id: 'one-volley-sink', label: 'Broadside!', description: 'In Salvo, sink a ship with every one of its hits in a single volley.' },
  { id: 'last-ship-standing', label: 'Last Ship Standing', description: 'Win with exactly one ship still afloat.' },
  { id: 'flawless', label: 'Flawless', description: 'Win without losing a single ship.' },
  { id: 'full-arsenal', label: 'Full Arsenal', description: 'Use the airstrike, sonar, and relocate in one Abilities game.' },
  { id: 'admiral-slayer', label: 'Admiral Slayer', description: 'Beat the Admiral (hard) computer opponent.' },
  { id: 'daily-clear', label: 'Daily Ops', description: 'Clear a daily challenge.' },
];

/** `users/{uid}/achievements/{id}`. Created once with `create()`; never updated. */
export interface AchievementDoc {
  id: AchievementId;
  unlockedAtMs: number;
  /** The game that earned it, or null for `daily-clear`. */
  gameId: string | null;
  dailyDateKey: string | null;
}

/** Inputs to the pure achievement rules. `game` carries the per-shot data `one-volley-sink` needs. */
export interface AchievementInput {
  record: GameEndRecord;
  game: Pick<FinishedGameSource, 'shots' | 'abilityLog'>;
}

/** UTC calendar day, e.g. "2026-10-07". The daily challenge resets at 00:00 UTC. */
export function dailyDateKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The daily fleet. The seed is drawn once per day with crypto randomness and stored server-side in
 * `dailyChallengesPrivate/{dateKey}`; everyone that day plays this same board. (A seed derived only
 * from the date would let anyone compute the fleet from this public repo.)
 */
export function dailyFleet(seed: number, dateKey: string): ShipPlacement[] {
  return randomFleet(deriveRng(seed, 'daily', dateKey));
}

/** `dailyChallenges/{dateKey}`: public, no fleet. */
export interface DailyChallengeDoc {
  dateKey: string;
  shipTypes: readonly string[];
  createdAtMs: number;
}

/** `dailyChallengesPrivate/{dateKey}`: server-only. */
export interface DailyChallengePrivateDoc {
  dateKey: string;
  seed: number;
  fleet: ShipPlacement[];
}

/** `users/{uid}/dailyRuns/{dateKey}`: owner-readable. One run per player per day. */
export interface DailyRunDoc {
  dateKey: string;
  shots: Shot[];
  sunkShips: string[];
  startedAtMs: number;
  completedAtMs: number | null;
}

/** `dailyScores/{dateKey}/players/{uid}`: public, written when a run clears. Lower `shots` is better. */
export interface DailyScoreDoc {
  username: string;
  shots: number;
  completedAtMs: number;
}

export const DAILY_SHIP_TYPES = SHIP_TYPES;

/** Callable `getDailyChallenge` (no request body) and `fireDailyShot` both return the caller's view. */
export interface DailyView {
  dateKey: string;
  shipTypes: readonly string[];
  shots: Shot[];
  sunkShips: string[];
  completedAtMs: number | null;
}

/** `fireDailyShot` request. `dateKey` must equal today's UTC key, otherwise `failed-precondition`. */
export interface DailyFireRequest {
  dateKey: string;
  row: number;
  col: number;
}
