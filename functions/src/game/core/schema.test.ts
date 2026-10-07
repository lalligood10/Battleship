import { describe, expect, it } from 'vitest';
import { createCoreState } from './reducer';
import { cellStates, defaultSettings, GAME_MODE_OPTIONS, parseGameModeInput, phaseFromStatus } from './schema';

describe('core schema helpers', () => {
  it('exposes only Classic and Salvo and defaults omitted mode input to Classic', () => {
    expect(GAME_MODE_OPTIONS).toEqual([
      {
        mode: 'classic',
        label: 'Classic',
        description: 'One shot per turn. Sink all five enemy ships to win.',
      },
      {
        mode: 'salvo',
        label: 'Salvo',
        description: 'Fire one shot for each ship you still have afloat. Lose ships, lose firepower.',
      },
    ]);
    expect(parseGameModeInput(undefined)).toBe('classic');
    expect(parseGameModeInput('classic')).toBe('classic');
    expect(parseGameModeInput('salvo')).toBe('salvo');
    expect(parseGameModeInput(null)).toBeNull();
    expect(parseGameModeInput('abilities')).toBeNull();
  });

  it('maps persisted statuses to core phases', () => {
    expect(['waiting', 'placing', 'active', 'finished', 'cancelled'].map(phaseFromStatus)).toEqual([
      'lobby',
      'placement',
      'playing',
      'gameOver',
      'gameOver',
    ]);
  });

  it('provides classic defaults and derives the owner view from opponent shots', () => {
    const state = createCoreState({ playerIds: ['one', 'two'], seed: 1 });
    expect(defaultSettings()).toMatchObject({
      mode: 'classic',
      boardSize: 10,
      fleet: expect.any(Array),
      abandonTimeoutMs: expect.any(Number),
    });
    state.shots.two = [
      { row: 0, col: 0, result: 'miss', at: 1 },
      { row: 1, col: 1, result: 'hit', at: 2 },
      {
        row: 4,
        col: 5,
        result: 'sunk',
        sunkShip: 'destroyer',
        sunkPlacement: { type: 'destroyer', row: 4, col: 4, horizontal: true },
        at: 3,
      },
      { row: 2, col: 2, result: 'sunk', at: 4 },
      {
        row: 6,
        col: 7,
        result: 'sunk',
        sunkShip: 'submarine',
        sunkPlacement: { type: 'submarine', row: 6, col: 7, horizontal: false },
        at: 5,
      },
    ];
    const cells = cellStates(state, 'one');
    expect(cells[0]![0]).toBe('miss');
    expect(cells[1]![1]).toBe('hit');
    expect(cells[4]!.slice(4, 6)).toEqual(['sunk', 'sunk']);
    expect(cells[2]![2]).toBe('hit');
    expect([cells[6]![7], cells[7]![7], cells[8]![7]]).toEqual(['sunk', 'sunk', 'sunk']);
    expect(cellStates(state, 'missing')).toHaveLength(10);
  });

  it('treats an opponent without shots as an untouched board', () => {
    const state = createCoreState({ playerIds: ['one', 'two'], seed: 1 });
    const cells = cellStates({ ...state, shots: { one: [] } }, 'one');
    expect(cells.flat().every((cell) => cell === 'unknown')).toBe(true);
  });
});
