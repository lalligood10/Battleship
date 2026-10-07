import { ABILITY_DEFINITIONS } from '@shared/core/modes/types';
import type { GameMode } from '@shared/core/schema';
import type { AbilityId } from '@shared/core/modes/types';
import type { ModeSummary, PlaytestRecord } from './types';

const GAME_MODES: GameMode[] = ['classic', 'salvo', 'abilities'];

export function summarizeByMode(records: PlaytestRecord[]): Record<GameMode, ModeSummary> {
  return Object.fromEntries(
    GAME_MODES.map((mode) => {
      const modeRecords = records.filter((record) => record.mode === mode);
      const games = modeRecords.length;
      const average = (values: number[]): number | null =>
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
      const abilities = Object.fromEntries(
        ABILITY_DEFINITIONS.map(({ id }) => {
          const uses = modeRecords.flatMap((record) => record.abilities).filter((use) => use.abilityId === id);
          return [id, { uses: uses.length, avgTurn: average(uses.map((use) => use.turnNumber)) }];
        }),
      ) as Record<AbilityId, ModeSummary['abilities'][AbilityId]>;

      return [
        mode,
        {
          games,
          avgTurns: average(modeRecords.map((record) => record.turns)),
          avgDurationMs: average(modeRecords.map((record) => record.durationMs)),
          avgWinnerShipsRemaining: average(modeRecords.map((record) => record.winnerShipsRemaining)),
          abilities,
        },
      ];
    }),
  ) as Record<GameMode, ModeSummary>;
}
