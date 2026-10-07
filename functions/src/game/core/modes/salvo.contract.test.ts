/** Contract tests for Salvo mode, written from RULES.md ("Salvo" and "Decisions for review"). */
import { describe, expect, it } from 'vitest';
import { cellKey, cellsOf, resolveShot, type Coordinate, type ShipPlacement } from '../../engine';
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
  let state = createCoreState({ playerIds: [ONE, TWO], seed: 7, mode: 'salvo' });
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

const cellsOfShip = (type: ShipPlacement['type']): [number, number][] =>
  cellsOf(FLEET.find((ship) => ship.type === type)!).map(({ row, col }) => [row, col]);
const at = (cells: [number, number][]): Coordinate[] => cells.map(([row, col]) => ({ row, col }));
const salvo = (player: string, cells: [number, number][]): CoreAction => ({ type: 'salvo', player, targets: at(cells), at: 40 });
const WATER: [number, number][] = [[9, 9], [9, 8], [9, 7], [9, 6], [9, 5]];

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

describe('Salvo mode contract', () => {
  describe('shots per turn', () => {
    it('equals the firing player\'s surviving ships', () => {
      let state = started();
      expect(shotsAllowed(state, ONE)).toBe(5);
      expect(modeRules('salvo').shotsAllowed(state, ONE)).toBe(5);
      state = seedShots(state, TWO, cellsOfShip('destroyer'));
      expect(shotsAllowed(state, ONE)).toBe(4);
      expect(shotsAllowed(state, TWO)).toBe(5);
      state = seedShots(state, TWO, [...cellsOfShip('carrier'), ...cellsOfShip('cruiser')]);
      expect(shotsAllowed(state, ONE)).toBe(2);
    });

    it('counts damaged but afloat ships as surviving', () => {
      const state = seedShots(started(), TWO, [[0, 0], [2, 0], [4, 0], [6, 0], [8, 0]]);
      expect(shotsAllowed(state, ONE)).toBe(5);
    });

    it('uses the smaller number of untried cells near board exhaustion', () => {
      const open = new Set(['9,8', '9,9']);
      const all: [number, number][] = [];
      for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) if (!open.has(cellKey(row, col))) all.push([row, col]);
      const state = seedShots(started(), ONE, all);
      state.phase = 'playing';
      state.winner = null;
      expect(shotsAllowed(state, ONE)).toBe(2);
      expectRejected(state, salvo(ONE, [[9, 8], [9, 9], [9, 9]]), 'wrong_shot_count');
      expect(ok(reduce(state, salvo(ONE, [[9, 8], [9, 9]]))).state.shots[ONE]).toHaveLength(100);
    });
  });

  describe('validation', () => {
    it('requires exactly the allowed number of targets (wrong_shot_count)', () => {
      const state = started();
      expectRejected(state, salvo(ONE, WATER.slice(0, 4)), 'wrong_shot_count');
      expectRejected(state, salvo(ONE, [...WATER, [9, 4]]), 'wrong_shot_count');
      expectRejected(state, salvo(ONE, []), 'wrong_shot_count');
      const reduced = seedShots(state, TWO, cellsOfShip('destroyer'));
      expectRejected(reduced, salvo(ONE, WATER), 'wrong_shot_count');
      expect(reduce(reduced, salvo(ONE, WATER.slice(0, 4))).ok).toBe(true);
    });

    it('requires distinct targets (duplicate_target)', () => {
      expectRejected(started(), salvo(ONE, [[9, 9], [9, 9], [9, 7], [9, 6], [9, 5]]), 'duplicate_target');
    });

    it('requires on-board targets (off_board)', () => {
      const state = started();
      expectRejected(state, salvo(ONE, [[10, 0], ...WATER.slice(1)]), 'off_board');
      expectRejected(state, salvo(ONE, [...WATER.slice(0, 4), [0, -1]]), 'off_board');
    });

    it('requires previously untried targets (already_fired)', () => {
      const state = seedShots(started(), ONE, [[9, 5]]);
      expectRejected(state, salvo(ONE, WATER), 'already_fired');
      expect(reduce(state, salvo(ONE, [...WATER.slice(0, 4), [9, 4]])).ok).toBe(true);
    });

    it('rejects single shots and abilities (wrong_mode)', () => {
      const state = started();
      expectRejected(state, { type: 'fire', player: ONE, target: { row: 9, col: 9 }, at: 1 }, 'wrong_mode');
      expectRejected(
        state,
        { type: 'ability', player: ONE, abilityId: 'carrier-airstrike', target: { row: 9, col: 0, horizontal: true }, at: 1 },
        'wrong_mode',
      );
    });

    it('rejects volleys out of turn and from non-players', () => {
      const state = started();
      expectRejected(state, salvo(TWO, WATER), 'not_your_turn');
      expectRejected(state, salvo('stranger', WATER), 'not_player');
    });
  });

  describe('resolution', () => {
    it('resolves all shots together as one turn tagged with the turn number', () => {
      const state = started();
      const result = ok(reduce(state, salvo(ONE, [[9, 9], [0, 0], [9, 8], [2, 1], [9, 7]])));
      const shots = result.state.shots[ONE]!;
      expect(shots).toHaveLength(5);
      expect(shots.every((shot) => shot.volley === state.turnNumber)).toBe(true);
      expect([...result.state.boards[TWO]!.hitCells].sort()).toEqual(['0,0', '2,1']);
      expect(result.state.turnNumber).toBe(state.turnNumber + 1);
      expect(result.state.currentTurn).toBe(TWO);
      expect(result.events.filter((event) => event.type === 'turnChanged')).toHaveLength(1);
      expect(result.events.at(-1)).toEqual({ type: 'turnChanged', currentTurn: TWO, turnNumber: state.turnNumber + 1 });
    });

    it('emits one salvoResolved event matching the recorded order, before the turn change', () => {
      const state = started();
      const result = ok(reduce(state, salvo(ONE, [[9, 9], [0, 0], [9, 8], [2, 1], [9, 7]])));
      expect(types(result.events)).toEqual([
        ...Array<string[]>(5).fill(['shotFired', 'shotResolved']).flat(),
        'salvoResolved',
        'turnChanged',
      ]);
      const salvoEvents = result.events.filter((event) => event.type === 'salvoResolved');
      expect(salvoEvents).toEqual([{
        type: 'salvoResolved',
        shooter: ONE,
        targets: result.state.shots[ONE]!.map(({ row, col }) => ({ row, col })),
        results: result.state.shots[ONE]!.map((shot) => shot.result),
        turnNumber: state.turnNumber,
      }]);
    });

    it('can sink a ship with two shots in the same volley', () => {
      const result = ok(reduce(started(), salvo(ONE, [[8, 0], [8, 1], [9, 9], [9, 8], [9, 7]])));
      expect(result.state.shots[ONE]!.map(({ row, col, result: r }) => [row, col, r])).toEqual([
        [8, 0, 'hit'],
        [9, 9, 'miss'],
        [9, 8, 'miss'],
        [9, 7, 'miss'],
        [8, 1, 'sunk'],
      ]);
    });

    it('records sinking shots last, preserving order within each group, and emits shot events in that order', () => {
      const state = seedShots(started(), ONE, [[6, 0], [6, 1], [8, 0]]);
      const result = ok(reduce(state, salvo(ONE, [[8, 1], [9, 9], [6, 2], [0, 0], [9, 8]])));
      const added = result.state.shots[ONE]!.slice(3);
      expect(added.map(({ row, col, result: r }) => [row, col, r])).toEqual([
        [9, 9, 'miss'],
        [0, 0, 'hit'],
        [9, 8, 'miss'],
        [8, 1, 'sunk'],
        [6, 2, 'sunk'],
      ]);
      expect(result.events.filter((event) => event.type === 'shotFired').map((event) => event.target)).toEqual(
        added.map(({ row, col }) => ({ row, col })),
      );
      expect(result.events.filter((event) => event.type === 'shipSunk').map((event) => event.shipId)).toEqual([
        'destroyer',
        'submarine',
      ]);
    });

    it('reduces only the next turn\'s count for ships sunk during the volley', () => {
      let state = started();
      const result = ok(reduce(state, salvo(ONE, [[8, 0], [8, 1], [9, 9], [9, 8], [9, 7]])));
      expect(result.state.shots[ONE]!.slice(-5)).toHaveLength(5);
      state = result.state;
      expect(shotsAllowed(state, TWO)).toBe(4);
      expectRejected(state, salvo(TWO, WATER), 'wrong_shot_count');
      const reply = ok(reduce(state, salvo(TWO, [[8, 0], [8, 1], [9, 9], [9, 8]])));
      expect(reply.state.shots[TWO]).toHaveLength(4);
      expect(shotsAllowed(reply.state, ONE)).toBe(4);
    });

    it('a volley by the player whose own ship sinks in the reply keeps its start-of-turn size', () => {
      // TWO sinks ONE's destroyer; ONE's next volley drops to 4, and TWO still fires 5 afterwards.
      let state = ok(reduce(started(), salvo(ONE, WATER))).state;
      state = ok(reduce(state, salvo(TWO, [[8, 0], [8, 1], [9, 9], [9, 8], [9, 7]]))).state;
      expect(shotsAllowed(state, ONE)).toBe(4);
      state = ok(reduce(state, salvo(ONE, [[0, 0], [0, 1], [0, 2], [0, 3]]))).state;
      expect(shotsAllowed(state, TWO)).toBe(5);
    });

    it('resolves every queued shot even after the final ship sinks, then emits gameOver', () => {
      const all = FLEET.flatMap((ship) => cellsOf(ship).map(({ row, col }): [number, number] => [row, col]));
      const state = seedShots(started(), ONE, all.slice(0, -1));
      const last = all.at(-1)!;
      const result = ok(reduce(state, salvo(ONE, [last, [9, 9], [9, 8], [9, 7], [9, 6]])));
      const added = result.state.shots[ONE]!.slice(all.length - 1);
      expect(added.map(({ row, col, result: r }) => [row, col, r])).toEqual([
        [9, 9, 'miss'],
        [9, 8, 'miss'],
        [9, 7, 'miss'],
        [9, 6, 'miss'],
        [...last, 'sunk'],
      ]);
      expect(result.state).toMatchObject({ phase: 'gameOver', winner: ONE, endReason: 'all_sunk', currentTurn: null });
      expect(types(result.events).slice(-2)).toEqual(['salvoResolved', 'gameOver']);
      expect(result.events.some((event) => event.type === 'turnChanged')).toBe(false);
      expect(result.events.filter((event) => event.type === 'gameOver')).toHaveLength(1);
    });

    it('increments the turn number once per volley', () => {
      let state = started();
      const start = state.turnNumber;
      for (let index = 0; index < 4; index++) {
        const shooter = state.currentTurn!;
        const row = index < 2 ? 9 : 7;
        const cells: [number, number][] = [5, 6, 7, 8, 9].map((col) => [row, col]);
        state = ok(reduce(state, salvo(shooter, cells))).state;
        expect(state.turnNumber).toBe(start + index + 1);
      }
    });
  });
});
