import { describe, expect, it } from 'vitest';
import type { AbilityId } from '@shared/core/modes/types';
import { summarizeByMode } from './summary';
import type { PlaytestRecord } from './types';

function record(
  gameId: string,
  mode: PlaytestRecord['mode'],
  turns: number,
  durationMs: number,
  winnerShipsRemaining: number,
  abilities: PlaytestRecord['abilities'] = [],
): PlaytestRecord {
  return {
    version: 1,
    gameId,
    mode,
    myUid: 'one',
    startedAt: 1,
    endedAt: durationMs + 1,
    durationMs,
    turns,
    winner: 'one',
    endReason: 'all_sunk',
    winnerShipsRemaining,
    shotsByPlayer: {},
    abilities,
  };
}

function ability(player: string, abilityId: AbilityId, turnNumber: number): PlaytestRecord['abilities'][number] {
  return { player, abilityId, turnNumber };
}

describe('summarizeByMode', () => {
  it('returns all modes with null averages for an empty record list', () => {
    expect(summarizeByMode([])).toEqual({
      classic: {
        games: 0,
        avgTurns: null,
        avgDurationMs: null,
        avgWinnerShipsRemaining: null,
        abilities: {
          'carrier-airstrike': { uses: 0, avgTurn: null },
          'submarine-sonar': { uses: 0, avgTurn: null },
          'destroyer-relocate': { uses: 0, avgTurn: null },
        },
      },
      salvo: {
        games: 0,
        avgTurns: null,
        avgDurationMs: null,
        avgWinnerShipsRemaining: null,
        abilities: {
          'carrier-airstrike': { uses: 0, avgTurn: null },
          'submarine-sonar': { uses: 0, avgTurn: null },
          'destroyer-relocate': { uses: 0, avgTurn: null },
        },
      },
      abilities: {
        games: 0,
        avgTurns: null,
        avgDurationMs: null,
        avgWinnerShipsRemaining: null,
        abilities: {
          'carrier-airstrike': { uses: 0, avgTurn: null },
          'submarine-sonar': { uses: 0, avgTurn: null },
          'destroyer-relocate': { uses: 0, avgTurn: null },
        },
      },
    });
  });

  it('computes per-mode means and ability use/turn averages', () => {
    const records = [
      record('classic-1', 'classic', 2, 100, 5),
      record('classic-2', 'classic', 4, 300, 1),
      record('salvo-1', 'salvo', 6, 400, 2),
      record('salvo-2', 'salvo', 8, 600, 4),
      record('abilities-1', 'abilities', 10, 1_000, 2, [
        ability('one', 'carrier-airstrike', 2),
        ability('two', 'submarine-sonar', 4),
      ]),
      record('abilities-2', 'abilities', 20, 2_000, 4, [
        ability('two', 'carrier-airstrike', 6),
      ]),
    ];

    expect(summarizeByMode(records)).toEqual({
      classic: expect.objectContaining({
        games: 2,
        avgTurns: 3,
        avgDurationMs: 200,
        avgWinnerShipsRemaining: 3,
        abilities: {
          'carrier-airstrike': { uses: 0, avgTurn: null },
          'submarine-sonar': { uses: 0, avgTurn: null },
          'destroyer-relocate': { uses: 0, avgTurn: null },
        },
      }),
      salvo: expect.objectContaining({
        games: 2,
        avgTurns: 7,
        avgDurationMs: 500,
        avgWinnerShipsRemaining: 3,
      }),
      abilities: expect.objectContaining({
        games: 2,
        avgTurns: 15,
        avgDurationMs: 1_500,
        avgWinnerShipsRemaining: 3,
        abilities: {
          'carrier-airstrike': { uses: 2, avgTurn: 4 },
          'submarine-sonar': { uses: 1, avgTurn: 4 },
          'destroyer-relocate': { uses: 0, avgTurn: null },
        },
      }),
    });
  });
});
