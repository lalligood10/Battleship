/** Contract tests for Classic mode, written from RULES.md ("Classic"). */
import { describe, expect, it } from 'vitest';
import { cellKey, cellsOf, resolveShot, type ShipPlacement } from '../../engine';
import type { CoreEvent } from '../events';
import { createCoreState, reduce, shotsAllowed, type CoreAction } from '../reducer';
import type { CoreState } from '../schema';
import { modeRules } from '.';

const ONE = 'one';
const TWO = 'two';

const FLEET: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];

function ok(result: ReturnType<typeof reduce>) {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

function started(): CoreState {
  let state = createCoreState({ playerIds: [ONE, TWO], seed: 7, mode: 'classic' });
  state = ok(reduce(state, { type: 'placeFleet', player: ONE, fleet: FLEET, at: 1 })).state;
  state = ok(reduce(state, { type: 'placeFleet', player: TWO, fleet: FLEET, at: 2 })).state;
  state.currentTurn = ONE;
  return state;
}

function seedShots(state: CoreState, shooter: string, cells: [number, number][]): CoreState {
  const next = structuredClone(state);
  const board = next.boards[shooter === ONE ? TWO : ONE]!;
  for (const [row, col] of cells) {
    const outcome = resolveShot(board.fleet!, new Set(board.hitCells), { row, col });
    if (outcome.result !== 'miss') board.hitCells.push(cellKey(row, col));
    const placement = outcome.sunkShip ? board.fleet!.find((ship) => ship.type === outcome.sunkShip) : undefined;
    next.shots[shooter]!.push({
      row,
      col,
      result: outcome.result,
      at: 0,
      ...(outcome.sunkShip ? { sunkShip: outcome.sunkShip } : {}),
      ...(placement ? { sunkPlacement: { ...placement } } : {}),
    });
  }
  return next;
}

const fire = (player: string, row: number, col: number): CoreAction => ({ type: 'fire', player, target: { row, col }, at: 40 });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function expectRejected(state: CoreState, action: CoreAction, code: string): void {
  const before = JSON.stringify(state);
  expect(reduce(deepFreeze(structuredClone(state)), action)).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(state)).toBe(before);
}

const types = (events: CoreEvent[]) => events.map((event) => event.type);

describe('Classic mode contract', () => {
  it('allows exactly one shot per turn regardless of fleet losses', () => {
    const state = started();
    expect(shotsAllowed(state, ONE)).toBe(1);
    expect(modeRules('classic').shotsAllowed(state, ONE)).toBe(1);
    const damaged = seedShots(state, TWO, FLEET.slice(0, 4).flatMap((ship) => cellsOf(ship).map(({ row, col }): [number, number] => [row, col])));
    expect(shotsAllowed(damaged, ONE)).toBe(1);
  });

  it('records a miss without marking the board and passes the turn once', () => {
    const state = started();
    const result = ok(reduce(state, fire(ONE, 9, 9)));
    expect(result.state.shots[ONE]).toEqual([{ row: 9, col: 9, result: 'miss', at: 40 }]);
    expect(result.state.shots[ONE]![0]).not.toHaveProperty('volley');
    expect(result.state.boards[TWO]!.hitCells).toEqual([]);
    expect(result.events).toEqual([
      { type: 'shotFired', shooter: ONE, target: { row: 9, col: 9 }, turnNumber: state.turnNumber },
      { type: 'shotResolved', shooter: ONE, target: { row: 9, col: 9 }, result: 'miss', turnNumber: state.turnNumber },
      { type: 'turnChanged', currentTurn: TWO, turnNumber: state.turnNumber + 1 },
    ]);
    expect(result.state.currentTurn).toBe(TWO);
    expect(result.state.turnNumber).toBe(state.turnNumber + 1);
  });

  it('marks a hit on the target board', () => {
    const result = ok(reduce(started(), fire(ONE, 2, 3)));
    expect(result.state.shots[ONE]!.at(-1)).toMatchObject({ row: 2, col: 3, result: 'hit' });
    expect(result.state.boards[TWO]!.hitCells).toEqual(['2,3']);
    expect(result.state.boards[ONE]!.hitCells).toEqual([]);
    expect(types(result.events)).toEqual(['shotFired', 'shotResolved', 'turnChanged']);
  });

  it('reports a sink with the ship placement', () => {
    const state = seedShots(started(), ONE, [[8, 0]]);
    const result = ok(reduce(state, fire(ONE, 8, 1)));
    expect(result.state.shots[ONE]!.at(-1)).toMatchObject({ result: 'sunk', sunkShip: 'destroyer', sunkPlacement: FLEET[4] });
    expect(types(result.events)).toEqual(['shotFired', 'shotResolved', 'shipSunk', 'turnChanged']);
    expect(result.events[2]).toEqual({ type: 'shipSunk', shooter: ONE, owner: TWO, shipId: 'destroyer', placement: FLEET[4] });
  });

  it('wins when every enemy ship is sunk: gameOver, no turnChanged', () => {
    const cells = FLEET.flatMap((ship) => cellsOf(ship).map(({ row, col }): [number, number] => [row, col]));
    const state = seedShots(started(), ONE, cells.slice(0, -1));
    const [row, col] = cells.at(-1)!;
    const result = ok(reduce(state, fire(ONE, row, col)));
    expect(result.state).toMatchObject({ phase: 'gameOver', winner: ONE, endReason: 'all_sunk', currentTurn: null });
    expect(result.state.turnNumber).toBe(state.turnNumber + 1);
    expect(types(result.events)).toEqual(['shotFired', 'shotResolved', 'shipSunk', 'gameOver']);
    expect(result.events.at(-1)).toEqual({ type: 'gameOver', winner: ONE, reason: 'all_sunk' });
    expectRejected(result.state, fire(TWO, 9, 9), 'wrong_phase');
  });

  it('rejects off-board targets (off_board)', () => {
    const state = started();
    for (const [row, col] of [[10, 0], [0, 10], [-1, 0], [0, -1], [1.5, 0]] as const) {
      expectRejected(state, fire(ONE, row, col), 'off_board');
    }
  });

  it('rejects cells fired at before (already_fired), including misses', () => {
    let state = ok(reduce(started(), fire(ONE, 9, 9))).state;
    state = ok(reduce(state, fire(TWO, 9, 9))).state;
    expectRejected(state, fire(ONE, 9, 9), 'already_fired');
    state = ok(reduce(state, fire(ONE, 0, 0))).state;
    state = ok(reduce(state, fire(TWO, 0, 0))).state;
    expectRejected(state, fire(ONE, 0, 0), 'already_fired');
  });

  it('rejects Salvo volleys and abilities (wrong_mode)', () => {
    const state = started();
    expectRejected(state, { type: 'salvo', player: ONE, targets: [{ row: 9, col: 9 }], at: 1 }, 'wrong_mode');
    expectRejected(
      state,
      { type: 'ability', player: ONE, abilityId: 'submarine-sonar', target: { row: 5, col: 5 }, at: 1 },
      'wrong_mode',
    );
  });

  it('rejects shots out of turn, from non-players, and outside play', () => {
    const state = started();
    expectRejected(state, fire(TWO, 9, 9), 'not_your_turn');
    expectRejected(state, fire('stranger', 9, 9), 'not_player');
    expectRejected(createCoreState({ playerIds: [ONE, TWO], seed: 1 }), fire(ONE, 9, 9), 'wrong_phase');
  });

  it('alternates turns and increments the turn number once per shot', () => {
    let state = started();
    const start = state.turnNumber;
    for (let index = 0; index < 6; index++) {
      const shooter = state.currentTurn!;
      const result = ok(reduce(state, fire(shooter, 9, index)));
      expect(result.state.turnNumber).toBe(start + index + 1);
      expect(result.state.currentTurn).not.toBe(shooter);
      state = result.state;
    }
  });
});
