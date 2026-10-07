/**
 * Read-only Phase 5 analytics contract, not wired into production; `{ ...record, myUid }` matches the client PlaytestRecord.
 */
import { SHIP_TYPES, type ShipType } from '../config';
import type { Shot } from '../engine';
import type { AbilityId, AbilityLogEntry } from '../core/modes/types';
import type { EndReason, GameMode } from '../core/schema';

export interface TimestampLike {
  toMillis(): number;
}

/** Structural subset of GameDoc (functions) and Game (web) needed for analytics. */
export interface FinishedGameSource {
  mode?: GameMode;
  status: string;
  playerUids: string[];
  players: Record<string, { sunkShips: ShipType[] } | undefined>;
  shots: Record<string, Shot[] | undefined>;
  abilityLog?: AbilityLogEntry[];
  winnerUid: string | null;
  endReason: EndReason | null;
  isBotGame?: boolean;
  startedAt: TimestampLike | null;
  finishedAt: TimestampLike | null;
}

export interface AbilityUse {
  player: string;
  abilityId: AbilityId;
  turnNumber: number;
}

export interface GameAnalyticsRecord {
  version: 1;
  gameId: string;
  mode: GameMode;
  isBotGame: boolean;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  turns: number;
  winner: string;
  endReason: EndReason;
  winnerShipsRemaining: number;
  shotsByPlayer: Record<string, number>;
  abilities: AbilityUse[];
}

export function turnsTaken(
  game: Pick<FinishedGameSource, 'playerUids' | 'shots' | 'abilityLog'>,
): number {
  let classicShotCount = 0;
  const turnKeys = new Set<string>();

  for (const uid of game.playerUids) {
    for (const shot of game.shots[uid] ?? []) {
      if (shot.volley === undefined) {
        classicShotCount += 1;
      } else {
        turnKeys.add(`${uid}|${shot.volley}`);
      }
    }
  }

  for (const entry of game.abilityLog ?? []) {
    turnKeys.add(`${entry.player}|${entry.turnNumber}`);
  }

  return classicShotCount + turnKeys.size;
}

export function gameAnalyticsRecord(gameId: string, game: FinishedGameSource): GameAnalyticsRecord | null {
  if (
    game.status !== 'finished'
    || game.winnerUid === null
    || game.endReason === null
    || game.startedAt === null
    || game.finishedAt === null
  ) {
    return null;
  }

  const startedAt = game.startedAt.toMillis();
  const endedAt = game.finishedAt.toMillis();
  const winnerShipsSunk = new Set(game.players[game.winnerUid]?.sunkShips ?? []);

  return {
    version: 1,
    gameId,
    mode: game.mode ?? 'classic',
    isBotGame: game.isBotGame === true,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    turns: turnsTaken(game),
    winner: game.winnerUid,
    endReason: game.endReason,
    winnerShipsRemaining: Math.max(0, SHIP_TYPES.length - winnerShipsSunk.size),
    shotsByPlayer: Object.fromEntries(game.playerUids.map((uid) => [uid, game.shots[uid]?.length ?? 0])),
    abilities: (game.abilityLog ?? []).map((entry) => ({
      player: entry.player,
      abilityId: entry.result.abilityId,
      turnNumber: entry.turnNumber,
    })),
  };
}
