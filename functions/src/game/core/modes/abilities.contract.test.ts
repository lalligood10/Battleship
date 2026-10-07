/**
 * Contract tests for Abilities mode, written from RULES.md ("Abilities" and "Abilities contract").
 * They exercise only the public reducer API.
 */
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

function started(mode: CoreState['settings']['mode'] = 'abilities'): CoreState {
  let state = createCoreState({ playerIds: [ONE, TWO], seed: 7, mode });
  state = ok(reduce(state, { type: 'placeFleet', player: ONE, fleet: FLEET, at: 1 })).state;
  state = ok(reduce(state, { type: 'placeFleet', player: TWO, fleet: FLEET, at: 2 })).state;
  state.currentTurn = ONE;
  return state;
}

/** Records shots by `shooter` without taking turns, keeping shots and hitCells consistent. */
function seedShots(state: CoreState, shooter: string, cells: [number, number][]): CoreState {
  const next = structuredClone(state);
  const owner = shooter === ONE ? TWO : ONE;
  const board = next.boards[owner]!;
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

function shipCells(type: ShipPlacement['type']): [number, number][] {
  return cellsOf(FLEET.find((ship) => ship.type === type)!).map(({ row, col }) => [row, col]);
}

const airstrike = (player: string, row: number, col: number, horizontal: boolean): CoreAction => ({
  type: 'ability',
  player,
  abilityId: 'carrier-airstrike',
  target: { row, col, horizontal },
  at: 50,
});
const sonar = (player: string, row: number, col: number): CoreAction => ({
  type: 'ability',
  player,
  abilityId: 'submarine-sonar',
  target: { row, col },
  at: 50,
});
const relocate = (player: string, row: number, col: number, horizontal: boolean): CoreAction => ({
  type: 'ability',
  player,
  abilityId: 'destroyer-relocate',
  target: { row, col, horizontal },
  at: 50,
});
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
  const result = reduce(deepFreeze(structuredClone(state)), action);
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(state)).toBe(before);
}

function types(events: CoreEvent[]): string[] {
  return events.map((event) => event.type);
}

/** Plays a harmless miss for `player` so the turn returns to the other player. */
function passTurn(state: CoreState, player: string, row = 9, col = 9): CoreState {
  return ok(reduce(state, fire(player, row, col))).state;
}

const destroyerOf = (state: CoreState, player: string) => state.boards[player]!.fleet!.find((ship) => ship.type === 'destroyer')!;

describe('Abilities mode contract', () => {
  describe('normal shots', () => {
    it('allows one normal shot per turn that resolves like Classic and passes the turn', () => {
      const state = started();
      expect(shotsAllowed(state, ONE)).toBe(1);
      expect(modeRules('abilities').shotsAllowed(state, ONE)).toBe(1);
      const result = ok(reduce(state, fire(ONE, 0, 0)));
      expect(result.state.shots[ONE]).toEqual([expect.objectContaining({ row: 0, col: 0, result: 'hit' })]);
      expect(result.state.boards[TWO]!.hitCells).toEqual(['0,0']);
      expect(types(result.events)).toEqual(['shotFired', 'shotResolved', 'turnChanged']);
      expect(result.state.turnNumber).toBe(state.turnNumber + 1);
      expect(result.state.currentTurn).toBe(TWO);
      expect(result.state.abilityLog).toEqual([]);
    });

    it('validates normal shots: off_board and already_fired', () => {
      const state = seedShots(started(), ONE, [[5, 5]]);
      expectRejected(state, fire(ONE, 10, 0), 'off_board');
      expectRejected(state, fire(ONE, 0, -1), 'off_board');
      expectRejected(state, fire(ONE, 5, 5), 'already_fired');
    });

    it('rejects Salvo volleys with wrong_mode', () => {
      const state = started();
      expectRejected(
        state,
        { type: 'salvo', player: ONE, targets: [{ row: 9, col: 9 }], at: 10 },
        'wrong_mode',
      );
    });

    it('rejects ability actions in Classic and Salvo games with wrong_mode', () => {
      for (const mode of ['classic', 'salvo'] as const) {
        const state = started(mode);
        expectRejected(state, airstrike(ONE, 9, 0, true), 'wrong_mode');
        expectRejected(state, sonar(ONE, 5, 5), 'wrong_mode');
        expectRejected(state, relocate(ONE, 9, 5, true), 'wrong_mode');
      }
    });

    it('rejects abilities out of turn, from non-players, and outside play', () => {
      const state = started();
      expectRejected(state, airstrike(TWO, 9, 0, true), 'not_your_turn');
      expectRejected(state, sonar('stranger', 5, 5), 'not_player');
      const placement = createCoreState({ playerIds: [ONE, TWO], seed: 1, mode: 'abilities' });
      expectRejected(placement, sonar(ONE, 5, 5), 'wrong_phase');
      const over = ok(reduce(state, { type: 'resign', player: TWO })).state;
      expectRejected(over, sonar(ONE, 5, 5), 'wrong_phase');
    });
  });

  describe('carrier airstrike', () => {
    it('hits three horizontal cells starting at the target, records volley shots, and ends the turn', () => {
      const state = started();
      const result = ok(reduce(state, airstrike(ONE, 0, 1, true)));
      const shots = result.state.shots[ONE]!;
      expect(shots.map(({ row, col, result: r }) => [row, col, r])).toEqual([
        [0, 1, 'hit'],
        [0, 2, 'hit'],
        [0, 3, 'hit'],
      ]);
      expect(shots.every((shot) => shot.volley === state.turnNumber)).toBe(true);
      expect([...result.state.boards[TWO]!.hitCells].sort()).toEqual(['0,1', '0,2', '0,3']);
      expect(types(result.events)).toEqual([
        'shotFired', 'shotResolved', 'shotFired', 'shotResolved', 'shotFired', 'shotResolved', 'abilityUsed', 'turnChanged',
      ]);
      const used = result.events.find((event) => event.type === 'abilityUsed');
      expect(used).toMatchObject({ player: ONE, abilityId: 'carrier-airstrike', turnNumber: state.turnNumber });
      expect(used && used.type === 'abilityUsed' && used.result).toMatchObject({ abilityId: 'carrier-airstrike' });
      expect(result.state.turnNumber).toBe(state.turnNumber + 1);
      expect(result.state.currentTurn).toBe(TWO);
      expect(result.events.at(-1)).toEqual({ type: 'turnChanged', currentTurn: TWO, turnNumber: state.turnNumber + 1 });
    });

    it('covers three cells downward when vertical and reports each resolved cell in the public result', () => {
      const state = started();
      const result = ok(reduce(state, airstrike(ONE, 7, 0, false)));
      expect(result.state.shots[ONE]!.map(({ row, col, result: r }) => [row, col, r])).toEqual([
        [7, 0, 'miss'],
        [8, 0, 'hit'],
        [9, 0, 'miss'],
      ]);
      expect(result.state.boards[TWO]!.hitCells).toEqual(['8,0']);
      const entry = result.state.abilityLog.at(-1)!;
      expect(entry).toMatchObject({ player: ONE, turnNumber: state.turnNumber });
      expect(entry.result.abilityId).toBe('carrier-airstrike');
      if (entry.result.abilityId !== 'carrier-airstrike') throw new Error('wrong result');
      expect(entry.result.cells).toHaveLength(3);
      expect(entry.result.cells).toEqual(expect.arrayContaining([
        { row: 7, col: 0, result: 'miss' },
        { row: 8, col: 0, result: 'hit' },
        { row: 9, col: 0, result: 'miss' },
      ]));
    });

    it('requires the whole line on the board (off_board)', () => {
      const state = started();
      expectRejected(state, airstrike(ONE, 0, 8, true), 'off_board');
      expectRejected(state, airstrike(ONE, 8, 0, false), 'off_board');
      expectRejected(state, airstrike(ONE, -1, 0, false), 'off_board');
      expectRejected(state, airstrike(ONE, 0, 10, true), 'off_board');
      expect(ok(reduce(state, airstrike(ONE, 0, 7, true))).state.shots[ONE]).toHaveLength(3);
      expect(ok(reduce(state, airstrike(ONE, 7, 9, false))).state.shots[ONE]).toHaveLength(3);
    });

    it('skips cells already fired at and resolves only the untried ones', () => {
      const state = seedShots(started(), ONE, [[0, 1]]);
      const result = ok(reduce(state, airstrike(ONE, 0, 0, true)));
      const added = result.state.shots[ONE]!.slice(1);
      expect(added.map(({ row, col }) => [row, col])).toEqual([[0, 0], [0, 2]]);
      const entry = result.state.abilityLog.at(-1)!;
      if (entry.result.abilityId !== 'carrier-airstrike') throw new Error('wrong result');
      expect(entry.result.cells.map(({ row, col }) => cellKey(row, col)).sort()).toEqual(['0,0', '0,2']);
      expect(result.events.filter((event) => event.type === 'shotFired')).toHaveLength(2);
    });

    it('rejects a line whose cells were all fired at before (already_fired)', () => {
      const state = seedShots(started(), ONE, [[9, 3], [9, 4], [9, 5]]);
      expectRejected(state, airstrike(ONE, 9, 3, true), 'already_fired');
    });

    it('records sinking cells last and emits shipSunk for each sink', () => {
      const state = started();
      // Row 8: destroyer at (8,0)-(8,1); (8,2) is water. (8,1) completes the destroyer.
      const result = ok(reduce(state, airstrike(ONE, 8, 0, true)));
      expect(result.state.shots[ONE]!.map(({ row, col, result: r }) => [row, col, r])).toEqual([
        [8, 0, 'hit'],
        [8, 2, 'miss'],
        [8, 1, 'sunk'],
      ]);
      expect(result.state.shots[ONE]!.at(-1)).toMatchObject({ sunkShip: 'destroyer', sunkPlacement: FLEET[4] });
      expect(types(result.events)).toEqual([
        'shotFired', 'shotResolved', 'shotFired', 'shotResolved', 'shotFired', 'shotResolved', 'shipSunk', 'abilityUsed', 'turnChanged',
      ]);
      expect(result.events.filter((event) => event.type === 'shotFired').map((event) => event.target)).toEqual([
        { row: 8, col: 0 },
        { row: 8, col: 2 },
        { row: 8, col: 1 },
      ]);
      expect(result.events.find((event) => event.type === 'shipSunk')).toMatchObject({
        shooter: ONE,
        owner: TWO,
        shipId: 'destroyer',
        placement: FLEET[4],
      });
    });

    it('ends the game with gameOver (no turnChanged) when the strike sinks the last ship', () => {
      const allButLast = FLEET.flatMap((ship) => cellsOf(ship).map(({ row, col }): [number, number] => [row, col]))
        .filter(([row, col]) => !(row === 8 && col === 1));
      const state = seedShots(started(), ONE, allButLast);
      const result = ok(reduce(state, airstrike(ONE, 8, 1, true)));
      expect(result.state.phase).toBe('gameOver');
      expect(result.state.winner).toBe(ONE);
      expect(result.state.endReason).toBe('all_sunk');
      expect(result.state.currentTurn).toBeNull();
      expect(types(result.events).slice(-2)).toEqual(['abilityUsed', 'gameOver']);
      expect(result.events.some((event) => event.type === 'turnChanged')).toBe(false);
      expect(result.events.at(-1)).toEqual({ type: 'gameOver', winner: ONE, reason: 'all_sunk' });
    });

    it('can be used only once per game (ability_used)', () => {
      let state = ok(reduce(started(), airstrike(ONE, 9, 0, true))).state;
      state = passTurn(state, TWO);
      expectRejected(state, airstrike(ONE, 9, 5, true), 'ability_used');
    });

    it('is lost once the carrier sinks (invalid_ability)', () => {
      const state = seedShots(started(), TWO, shipCells('carrier'));
      expectRejected(state, airstrike(ONE, 9, 0, true), 'invalid_ability');
    });

    it('stays used (ability_used) rather than lost after the carrier sinks', () => {
      let state = ok(reduce(started(), airstrike(ONE, 9, 0, true))).state;
      state = seedShots(state, TWO, shipCells('carrier'));
      state = passTurn(state, TWO);
      expectRejected(state, airstrike(ONE, 9, 5, true), 'ability_used');
    });

    it('is tracked per player: the opponent can still use their own airstrike', () => {
      let state = ok(reduce(started(), airstrike(ONE, 9, 0, true))).state;
      const reply = ok(reduce(state, airstrike(TWO, 9, 0, true)));
      state = reply.state;
      expect(state.abilityLog.map((entry) => [entry.player, entry.result.abilityId])).toEqual([
        [ONE, 'carrier-airstrike'],
        [TWO, 'carrier-airstrike'],
      ]);
    });
  });

  describe('submarine sonar', () => {
    it('reports a ship present in a 3x3 area without damage, marks, or shots, and ends the turn', () => {
      const state = started();
      const result = ok(reduce(state, sonar(ONE, 1, 1)));
      expect(result.state.shots).toEqual(state.shots);
      expect(result.state.boards).toEqual(state.boards);
      expect(types(result.events)).toEqual(['abilityUsed', 'turnChanged']);
      const expected = { abilityId: 'submarine-sonar', center: { row: 1, col: 1 }, shipPresent: true };
      expect(result.events[0]).toEqual({
        type: 'abilityUsed',
        player: ONE,
        abilityId: 'submarine-sonar',
        result: expected,
        turnNumber: state.turnNumber,
      });
      expect(result.state.abilityLog).toEqual([{ player: ONE, turnNumber: state.turnNumber, result: expected }]);
      expect(result.state.turnNumber).toBe(state.turnNumber + 1);
      expect(result.state.currentTurn).toBe(TWO);
    });

    it('reports no ship when the 3x3 area is all water', () => {
      const result = ok(reduce(started(), sonar(ONE, 5, 8)));
      expect(result.state.abilityLog.at(-1)!.result).toEqual({
        abilityId: 'submarine-sonar',
        center: { row: 5, col: 8 },
        shipPresent: false,
      });
    });

    it('clips the area at board edges', () => {
      // (9,9): rows 8-9, cols 8-9 — water only.
      expect(ok(reduce(started(), sonar(ONE, 9, 9))).state.abilityLog.at(-1)!.result).toMatchObject({ shipPresent: false });
      // (0,0): rows 0-1, cols 0-1 — carrier.
      expect(ok(reduce(started(), sonar(ONE, 0, 0))).state.abilityLog.at(-1)!.result).toMatchObject({ shipPresent: true });
      // (9,2): rows 8-9, cols 1-3 — only destroyer cell (8,1).
      expect(ok(reduce(started(), sonar(ONE, 9, 2))).state.abilityLog.at(-1)!.result).toMatchObject({ shipPresent: true });
      // (3,9): rows 2-4, cols 8-9 — water (battleship ends at col 3).
      expect(ok(reduce(started(), sonar(ONE, 3, 9))).state.abilityLog.at(-1)!.result).toMatchObject({ shipPresent: false });
    });

    it('counts ship cells that were already hit or sunk', () => {
      const hit = seedShots(started(), ONE, [[8, 1]]);
      expect(ok(reduce(hit, sonar(ONE, 9, 2))).state.abilityLog.at(-1)!.result).toMatchObject({ shipPresent: true });
      const sunk = seedShots(started(), ONE, shipCells('destroyer'));
      expect(ok(reduce(sunk, sonar(ONE, 9, 2))).state.abilityLog.at(-1)!.result).toMatchObject({ shipPresent: true });
    });

    it('may be centred on a cell already fired at', () => {
      const state = seedShots(started(), ONE, [[5, 5]]);
      const result = ok(reduce(state, sonar(ONE, 5, 5)));
      expect(result.state.shots[ONE]).toHaveLength(1);
    });

    it('requires the centre on the board (off_board)', () => {
      const state = started();
      expectRejected(state, sonar(ONE, 10, 5), 'off_board');
      expectRejected(state, sonar(ONE, -1, 0), 'off_board');
      expectRejected(state, sonar(ONE, 0, 10), 'off_board');
    });

    it('can be used only once per game (ability_used)', () => {
      let state = ok(reduce(started(), sonar(ONE, 5, 5))).state;
      state = passTurn(state, TWO);
      expectRejected(state, sonar(ONE, 1, 1), 'ability_used');
    });

    it('is lost once the submarine sinks (invalid_ability)', () => {
      const state = seedShots(started(), TWO, shipCells('submarine'));
      expectRejected(state, sonar(ONE, 1, 1), 'invalid_ability');
    });

    it('is still ready while the submarine is damaged but afloat', () => {
      const state = seedShots(started(), TWO, [[6, 0]]);
      expect(reduce(state, sonar(ONE, 1, 1)).ok).toBe(true);
    });
  });

  describe('destroyer relocate', () => {
    it('moves the destroyer on the private fleet only, without revealing the position, and ends the turn', () => {
      const state = started();
      const result = ok(reduce(state, relocate(ONE, 9, 5, true)));
      expect(destroyerOf(result.state, ONE)).toEqual({ type: 'destroyer', row: 9, col: 5, horizontal: true });
      expect(result.state.boards[ONE]!.fleet!.filter((ship) => ship.type !== 'destroyer')).toEqual(FLEET.slice(0, 4));
      expect(result.state.boards[TWO]).toEqual(state.boards[TWO]);
      expect(result.state.boards[ONE]!.hitCells).toEqual(state.boards[ONE]!.hitCells);
      expect(result.state.shots).toEqual(state.shots);
      expect(types(result.events)).toEqual(['abilityUsed', 'turnChanged']);
      expect(result.events[0]).toEqual({
        type: 'abilityUsed',
        player: ONE,
        abilityId: 'destroyer-relocate',
        result: { abilityId: 'destroyer-relocate' },
        turnNumber: state.turnNumber,
      });
      expect(result.state.abilityLog).toEqual([
        { player: ONE, turnNumber: state.turnNumber, result: { abilityId: 'destroyer-relocate' } },
      ]);
      expect(result.state.turnNumber).toBe(state.turnNumber + 1);
      expect(result.state.currentTurn).toBe(TWO);
    });

    it('makes later enemy shots resolve against the new placement', () => {
      let state = ok(reduce(started(), relocate(ONE, 3, 7, false))).state;
      const miss = ok(reduce(state, fire(TWO, 8, 0)));
      expect(miss.state.shots[TWO]!.at(-1)).toMatchObject({ row: 8, col: 0, result: 'miss' });
      state = passTurn(miss.state, ONE);
      const hit = ok(reduce(state, fire(TWO, 4, 7)));
      expect(hit.state.shots[TWO]!.at(-1)).toMatchObject({ row: 4, col: 7, result: 'hit' });
    });

    it('allows vertical placements, touching other ships, and overlapping its own current cells', () => {
      expect(destroyerOf(ok(reduce(started(), relocate(ONE, 7, 9, false))).state, ONE)).toEqual({
        type: 'destroyer', row: 7, col: 9, horizontal: false,
      });
      // Row 7 touches the submarine (row 6) and the old destroyer (row 8); touching ships are legal.
      expect(reduce(started(), relocate(ONE, 7, 0, true)).ok).toBe(true);
      // Shifting by one cell overlaps only the destroyer's own current cell, not another friendly ship.
      expect(reduce(started(), relocate(ONE, 8, 1, true)).ok).toBe(true);
    });

    it('rejects the current placement, other friendly ships, enemy-fired cells, and off-board (illegal_relocation)', () => {
      const state = seedShots(started(), TWO, [[9, 5]]);
      expectRejected(state, relocate(ONE, 8, 0, true), 'illegal_relocation');
      expectRejected(state, relocate(ONE, 6, 2, true), 'illegal_relocation');
      expectRejected(state, relocate(ONE, 5, 0, false), 'illegal_relocation');
      expectRejected(state, relocate(ONE, 9, 4, true), 'illegal_relocation');
      expectRejected(state, relocate(ONE, 8, 5, false), 'illegal_relocation');
      expectRejected(state, relocate(ONE, 9, 9, true), 'illegal_relocation');
      expectRejected(state, relocate(ONE, 9, 0, false), 'illegal_relocation');
      expectRejected(state, relocate(ONE, -1, 5, true), 'illegal_relocation');
    });

    it('ignores cells the actor fired at on the opponent board', () => {
      const state = seedShots(started(), ONE, [[9, 5]]);
      expect(reduce(state, relocate(ONE, 9, 5, true)).ok).toBe(true);
    });

    it('is lost once the destroyer takes any hit, and when it sinks (invalid_ability)', () => {
      expectRejected(seedShots(started(), TWO, [[8, 0]]), relocate(ONE, 9, 5, true), 'invalid_ability');
      expectRejected(seedShots(started(), TWO, shipCells('destroyer')), relocate(ONE, 9, 5, true), 'invalid_ability');
    });

    it('can be used only once per game (ability_used)', () => {
      let state = ok(reduce(started(), relocate(ONE, 9, 5, true))).state;
      state = passTurn(state, TWO);
      expectRejected(state, relocate(ONE, 9, 7, true), 'ability_used');
    });
  });

  describe('ability log and turn flow', () => {
    it('lets each player use each ability once, logging one public entry per use with its turn number', () => {
      let state = started();
      const plays: CoreAction[] = [
        airstrike(ONE, 9, 0, true),
        airstrike(TWO, 9, 0, true),
        sonar(ONE, 5, 5),
        sonar(TWO, 5, 5),
        relocate(ONE, 5, 7, true),
        relocate(TWO, 5, 7, true),
      ];
      const start = state.turnNumber;
      for (const [index, action] of plays.entries()) {
        const result = ok(reduce(state, action));
        expect(result.state.turnNumber).toBe(start + index + 1);
        expect(result.events.filter((event) => event.type === 'turnChanged')).toHaveLength(1);
        expect(result.events.at(-1)!.type).toBe('turnChanged');
        state = result.state;
      }
      expect(state.abilityLog.map((entry) => [entry.player, entry.result.abilityId, entry.turnNumber])).toEqual([
        [ONE, 'carrier-airstrike', start],
        [TWO, 'carrier-airstrike', start + 1],
        [ONE, 'submarine-sonar', start + 2],
        [TWO, 'submarine-sonar', start + 3],
        [ONE, 'destroyer-relocate', start + 4],
        [TWO, 'destroyer-relocate', start + 5],
      ]);
      for (const action of [airstrike(ONE, 9, 5, true), sonar(ONE, 1, 1), relocate(ONE, 3, 7, true)]) {
        expectRejected(state, action, 'ability_used');
      }
    });

    it('rejects illegal ability actions without mutating deep-frozen state', () => {
      const state = deepFreeze(seedShots(seedShots(started(), ONE, [[9, 3], [9, 4], [9, 5]]), TWO, shipCells('submarine')));
      const attempts: [CoreAction, string][] = [
        [airstrike(ONE, 0, 8, true), 'off_board'],
        [airstrike(ONE, 9, 3, true), 'already_fired'],
        [sonar(ONE, 1, 1), 'invalid_ability'],
        [relocate(ONE, 6, 2, true), 'illegal_relocation'],
        [airstrike(TWO, 0, 0, true), 'not_your_turn'],
        [{ type: 'salvo', player: ONE, targets: [{ row: 0, col: 0 }], at: 1 }, 'wrong_mode'],
      ];
      for (const [action, code] of attempts) {
        expect(reduce(state, action)).toMatchObject({ ok: false, error: { code } });
      }
    });
  });
});
