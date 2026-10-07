import { describe, expect, it } from 'vitest';
import type { AbilityLogEntry, Game } from '../lib/types';
import { buildHeatmap, heatBin, heatCellLabel, ordinal, type HeatCell } from './heatmap';

type HeatGame = Pick<Game, 'shots' | 'abilityLog' | 'mode'>;

function shot(row: number, col: number, result: 'miss' | 'hit' | 'sunk', at: number, volley?: number) {
  return { row, col, result, at, ...(volley === undefined ? {} : { volley }) };
}

function ability(player: string, turnNumber: number, result: AbilityLogEntry['result']): AbilityLogEntry {
  return { player, turnNumber, result };
}

describe('heatmap', () => {
  it('orders Classic shots by timestamp and preserves input order for ties', () => {
    const game: HeatGame = {
      mode: 'classic',
      shots: {
        me: [
          shot(0, 0, 'miss', 30),
          shot(0, 1, 'hit', 10),
          shot(0, 2, 'sunk', 10),
        ],
      },
    };

    const heatmap = buildHeatmap(game, 'me');

    expect(heatmap.cells.map(({ row, col, order, source }) => [row, col, order, source])).toEqual([
      [0, 1, 1, 'shot'],
      [0, 2, 2, 'shot'],
      [0, 0, 3, 'shot'],
    ]);
    expect(heatmap.maxOrder).toBe(3);
  });

  it('groups Salvo shots by volley and uses volley units', () => {
    const game: HeatGame = {
      mode: 'salvo',
      shots: {
        me: [
          ...Array.from({ length: 5 }, (_, i) => shot(0, i, 'miss', i, 1)),
          ...Array.from({ length: 5 }, (_, i) => shot(1, i, 'hit', i + 5, 2)),
          ...Array.from({ length: 4 }, (_, i) => shot(2, i, 'sunk', i + 10, 3)),
        ],
      },
    };

    const heatmap = buildHeatmap(game, 'me');

    expect(heatmap.cells.map(({ order }) => order)).toEqual([
      1, 1, 1, 1, 1,
      2, 2, 2, 2, 2,
      3, 3, 3, 3,
    ]);
    expect(heatmap.maxOrder).toBe(3);
    expect(heatmap.unit).toBe('volley');
  });

  it('marks airstrike volley cells and does not turn sonar log entries into cells', () => {
    const game: HeatGame = {
      mode: 'classic',
      shots: {
        me: [
          shot(0, 0, 'miss', 1),
          shot(0, 1, 'hit', 2),
          shot(4, 0, 'miss', 3, 7),
          shot(4, 1, 'hit', 4, 7),
          shot(4, 2, 'sunk', 5, 7),
        ],
      },
      abilityLog: [
        ability('me', 7, {
          abilityId: 'carrier-airstrike',
          cells: [
            { row: 4, col: 0, result: 'miss' },
            { row: 4, col: 1, result: 'hit' },
            { row: 4, col: 2, result: 'sunk' },
          ],
        }),
        ability('me', 8, {
          abilityId: 'submarine-sonar',
          center: { row: 5, col: 5 },
          shipPresent: false,
        }),
      ],
    };

    const heatmap = buildHeatmap(game, 'me');

    expect(heatmap.cells).toHaveLength(5);
    expect(heatmap.cells.map(({ order, source }) => [order, source])).toEqual([
      [1, 'shot'],
      [2, 'shot'],
      [3, 'airstrike'],
      [3, 'airstrike'],
      [3, 'airstrike'],
    ]);
  });

  it('maps order values into five heat bins', () => {
    expect(Array.from({ length: 10 }, (_, i) => heatBin(i + 1, 10))).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
    expect(Array.from({ length: 3 }, (_, i) => heatBin(i + 1, 3))).toEqual([2, 4, 5]);
    expect(heatBin(1, 1)).toBe(5);
  });

  it('reports only bins with mapped order ranges', () => {
    const tenShotGame: HeatGame = {
      mode: 'classic',
      shots: { me: Array.from({ length: 10 }, (_, i) => shot(0, i, 'miss', i)) },
    };
    const threeShotGame: HeatGame = {
      mode: 'classic',
      shots: { me: Array.from({ length: 3 }, (_, i) => shot(0, i, 'miss', i)) },
    };

    expect(buildHeatmap(tenShotGame, 'me').bins).toEqual([
      { bin: 1, from: 1, to: 2 },
      { bin: 2, from: 3, to: 4 },
      { bin: 3, from: 5, to: 6 },
      { bin: 4, from: 7, to: 8 },
      { bin: 5, from: 9, to: 10 },
    ]);
    expect(buildHeatmap(threeShotGame, 'me').bins).toEqual([
      { bin: 2, from: 1, to: 1 },
      { bin: 4, from: 2, to: 2 },
      { bin: 5, from: 3, to: 3 },
    ]);
  });

  it('formats ordinal suffixes including teen exceptions', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 113].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th', '113th',
    ]);
  });

  it('labels shot, volley, and airstrike cells', () => {
    const shotCell: HeatCell = { row: 3, col: 2, order: 3, bin: 2, result: 'hit', source: 'shot' };
    const volleyCell: HeatCell = { row: 0, col: 0, order: 2, bin: 2, result: 'miss', source: 'volley' };
    const airstrikeCell: HeatCell = { row: 4, col: 4, order: 4, bin: 3, result: 'sunk', source: 'airstrike' };

    expect(heatCellLabel(shotCell, 'shot')).toBe('C4: 3rd shot, hit');
    expect(heatCellLabel(volleyCell, 'volley')).toBe('A1: 2nd volley, miss');
    expect(heatCellLabel(airstrikeCell, 'shot')).toBe('E5: 4th shot (airstrike), sunk');
  });

  it('returns an empty map when the shooter has no shots', () => {
    const game: HeatGame = {
      mode: 'classic',
      shots: { me: [] },
    };

    expect(buildHeatmap(game, 'me')).toEqual({ cells: [], maxOrder: 0, unit: 'shot', bins: [] });
  });
});
