import type { AbilityId } from '@shared/core/modes';
import type { EndReason, GameMode } from '@shared/core/schema';

export interface AbilityUse {
  player: string;
  abilityId: AbilityId;
  turnNumber: number;
}

export interface PlaytestRecord {
  version: 1;
  gameId: string;
  mode: GameMode;
  myUid: string;
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

export interface AbilitySummary {
  uses: number;
  avgTurn: number | null;
}

export interface ModeSummary {
  games: number;
  avgTurns: number | null;
  avgDurationMs: number | null;
  avgWinnerShipsRemaining: number | null;
  abilities: Record<AbilityId, AbilitySummary>;
}
