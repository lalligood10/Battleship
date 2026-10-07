import { describe, expect, it } from 'vitest';
import type { AbilityLogEntry, Game } from '../lib/types';
import { formatAccuracy, resultStats } from './resultStats';

type StatsGame = Pick<Game, 'shots' | 'abilityLog' | 'playerUids'>;

function shot(row: number, col: number, result: 'miss' | 'hit' | 'sunk', volley?: number) {
  return { row, col, result, at: row * 10 + col, ...(volley === undefined ? {} : { volley }) };
}

function ability(player: string, turnNumber: number, result: AbilityLogEntry['result']): AbilityLogEntry {
  return { player, turnNumber, result };
}

describe('result statistics', () => {
  it('counts shots, accuracy, turns, and ships for an all-sunk Classic win', () => {
    const game: StatsGame & Pick<Game, 'endReason' | 'winnerUid'> = {
      playerUids: ['me', 'opponent'],
      endReason: 'all_sunk',
      winnerUid: 'me',
      shots: {
        me: [
          shot(0, 0, 'miss'),
          shot(0, 1, 'hit'),
          shot(0, 3, 'sunk'),
          shot(0, 4, 'sunk'),
          shot(0, 5, 'sunk'),
          shot(0, 6, 'sunk'),
          shot(0, 7, 'sunk'),
        ],
        opponent: [shot(1, 0, 'hit'), shot(1, 1, 'sunk'), shot(1, 2, 'sunk')],
      },
    };

    expect(resultStats(game, 'me')).toEqual({
      shotsFired: 7,
      hits: 6,
      accuracy: 6 / 7,
      turns: 7,
      shipsLost: 2,
      shipsSunk: 5,
    });
  });

  it('counts distinct Salvo volleys rather than the game turn number', () => {
    const game: StatsGame & Pick<Game, 'turnNumber'> = {
      playerUids: ['me', 'opponent'],
      turnNumber: 99,
      shots: {
        me: [
          shot(0, 0, 'miss', 3),
          shot(0, 1, 'hit', 3),
          shot(1, 0, 'miss', 7),
        ],
        opponent: [],
      },
    };

    expect(resultStats(game, 'me').turns).toBe(2);
  });

  it('counts Classic shots and distinct ability turns once each', () => {
    const game: StatsGame = {
      playerUids: ['me', 'opponent'],
      shots: {
        me: [
          shot(0, 0, 'miss'),
          shot(0, 1, 'hit'),
          shot(0, 2, 'miss', 3),
        ],
        opponent: [],
      },
      abilityLog: [
        ability('me', 3, { abilityId: 'carrier-airstrike', cells: [] }),
        ability('me', 4, { abilityId: 'submarine-sonar', center: { row: 2, col: 3 }, shipPresent: true }),
        ability('me', 5, { abilityId: 'destroyer-relocate' }),
      ],
    };

    expect(resultStats(game, 'me').turns).toBe(5);
  });

  it('reports no ships lost in a resignation with only a few shots', () => {
    const game: StatsGame & Pick<Game, 'endReason'> = {
      playerUids: ['me', 'opponent'],
      endReason: 'resign',
      shots: {
        me: [shot(0, 0, 'miss')],
        opponent: [shot(1, 0, 'hit'), shot(1, 1, 'miss')],
      },
    };

    expect(resultStats(game, 'me').shipsLost).toBe(0);
  });

  it('ignores a timeout game turn number', () => {
    const game: StatsGame & Pick<Game, 'endReason' | 'turnNumber'> = {
      playerUids: ['me', 'opponent'],
      endReason: 'timeout',
      turnNumber: 10_000,
      shots: {
        me: [shot(0, 0, 'miss'), shot(0, 1, 'hit')],
        opponent: [],
      },
    };

    expect(resultStats(game, 'me').turns).toBe(2);
  });

  it('uses a null accuracy when no shots were fired', () => {
    const game: StatsGame = {
      playerUids: ['me', 'opponent'],
      shots: { me: [], opponent: [] },
    };

    expect(resultStats(game, 'me').accuracy).toBeNull();
    expect(formatAccuracy(null)).toBe('–');
  });

  it('rounds accuracy to a whole percentage', () => {
    expect(formatAccuracy(2 / 3)).toBe('67%');
  });
});
