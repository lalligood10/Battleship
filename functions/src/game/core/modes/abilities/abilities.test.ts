import { describe, expect, it } from 'vitest';
import { cellKey, cellsOf, type ShipPlacement, type Shot } from '../../../engine';
import { createCoreState, reduce } from '../../reducer';
import type { CoreEvent } from '../../events';
import type { CoreState } from '../../schema';
import {
  abilityStatuses,
  airstrikeCells,
  abilitiesRules,
  isLegalRelocation,
  sonarCells,
} from '../abilities';

const fleet: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];

function placed(mode: 'classic' | 'abilities' = 'abilities', seed = 5): CoreState {
  let state = createCoreState({ playerIds: ['one', 'two'], seed, mode });
  for (const player of state.playerIds) {
    const result = reduce(state, { type: 'placeFleet', player, fleet, at: 1 });
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
  return state;
}

function otherPlayer(state: CoreState, player: string): string {
  return state.playerIds.find((uid) => uid !== player)!;
}

function withTurn(state: CoreState, player: string): CoreState {
  const next = structuredClone(state);
  next.currentTurn = player;
  return next;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function frozenReduce(state: CoreState, action: Parameters<typeof reduce>[1]) {
  return reduce(deepFreeze(state), action);
}

function shot(row: number, col: number, result: Shot['result'] = 'miss'): Shot {
  return { row, col, result, at: 2 };
}

function abilityAction(
  player: string,
  abilityId: string,
  target: unknown,
  at = 10,
) {
  return {
    type: 'ability' as const,
    player,
    abilityId,
    target,
    at,
  } as unknown as Parameters<typeof reduce>[1];
}

function typeSequence(events: CoreEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('Abilities mode helpers', () => {
  it('generates raw airstrike cells and clipped row-major sonar cells', () => {
    expect(airstrikeCells({ row: 2, col: 3, horizontal: true }, 10)).toEqual([
      { row: 2, col: 3 },
      { row: 2, col: 4 },
      { row: 2, col: 5 },
    ]);
    expect(airstrikeCells({ row: 2, col: 3, horizontal: false }, 10)).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 3 },
      { row: 4, col: 3 },
    ]);
    expect(airstrikeCells({ row: 0, col: 9, horizontal: true }, 10)).toHaveLength(3);
    expect(sonarCells({ row: 0, col: 0 }, 10)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ]);
    expect(sonarCells({ row: 0, col: 5 }, 10)).toHaveLength(6);
    expect(sonarCells({ row: 5, col: 5 }, 10)).toHaveLength(9);
  });

  it('derives all ability statuses without consulting ship metadata', () => {
    const state = placed();
    const player = state.currentTurn!;
    state.boards[player]!.shipMeta = {
      carrier: { abilityCharges: 0 },
      submarine: { abilityCharges: 0 },
      destroyer: { abilityCharges: 0 },
    };
    expect(abilityStatuses(state, player)).toEqual({
      'carrier-airstrike': 'ready',
      'submarine-sonar': 'ready',
      'destroyer-relocate': 'ready',
    });

    const carrierCells = cellsOf(fleet[0]!);
    const submarineCells = cellsOf(fleet[3]!);
    const destroyerCells = cellsOf(fleet[4]!);
    const sunkShips = structuredClone(state);
    sunkShips.boards[player]!.hitCells = [
      ...carrierCells,
      ...submarineCells,
      ...destroyerCells.slice(0, 1),
    ].map(({ row, col }) => cellKey(row, col));
    expect(abilityStatuses(sunkShips, player)).toEqual({
      'carrier-airstrike': 'lost',
      'submarine-sonar': 'lost',
      'destroyer-relocate': 'lost',
    });

    sunkShips.abilityLog.push({
      player,
      turnNumber: 1,
      result: { abilityId: 'carrier-airstrike', cells: [] },
    });
    expect(abilityStatuses(sunkShips, player)['carrier-airstrike']).toBe('used');

    const noFleet = structuredClone(sunkShips);
    noFleet.boards[player]!.fleet = null;
    expect(abilityStatuses(noFleet, player)).toEqual({
      'carrier-airstrike': 'ready',
      'submarine-sonar': 'ready',
      'destroyer-relocate': 'ready',
    });
  });

  it('accepts only legal, undamaged destroyer placements', () => {
    const state = placed();
    const player = state.currentTurn!;
    expect(isLegalRelocation(state, player, { row: 9, col: 8, horizontal: true })).toBe(true);
    expect(isLegalRelocation(state, player, { row: 8, col: 0, horizontal: true })).toBe(false);
    expect(isLegalRelocation(state, player, { row: 9, col: 9, horizontal: true })).toBe(false);
    expect(isLegalRelocation(state, player, { row: 0, col: 0, horizontal: false })).toBe(false);
    expect(isLegalRelocation(state, player, { row: 9.5, col: 8, horizontal: true })).toBe(false);

    const opponent = otherPlayer(state, player);
    state.shots[opponent]!.push(shot(9, 8));
    expect(isLegalRelocation(state, player, { row: 9, col: 8, horizontal: true })).toBe(false);
  });
});

describe('Abilities mode rules', () => {
  it('keeps Classic fire behavior, rejects Salvo, and checks turns in the reducer', () => {
    const abilitiesState = placed('abilities', 42);
    const classicState = placed('classic', 42);
    const player = abilitiesState.currentTurn!;
    expect(classicState.currentTurn).toBe(player);

    const abilitiesFire = frozenReduce(abilitiesState, {
      type: 'fire',
      player,
      target: { row: 0, col: 0 },
      at: 10,
    });
    const classicFire = frozenReduce(classicState, {
      type: 'fire',
      player,
      target: { row: 0, col: 0 },
      at: 10,
    });
    expect(abilitiesFire.ok).toBe(true);
    expect(classicFire.ok).toBe(true);
    if (abilitiesFire.ok && classicFire.ok) {
      expect(abilitiesFire.events).toEqual(classicFire.events);
      expect(abilitiesFire.state.shots[player]).toEqual(classicFire.state.shots[player]);
    }

    const salvo = frozenReduce(abilitiesState, { type: 'salvo', player, targets: [], at: 10 });
    expect(salvo).toMatchObject({ ok: false, error: { code: 'wrong_mode' } });
    const notTurn = frozenReduce(abilitiesState, {
      type: 'fire',
      player: otherPlayer(abilitiesState, player),
      target: { row: 0, col: 0 },
      at: 10,
    });
    expect(notTurn).toMatchObject({ ok: false, error: { code: 'not_your_turn' } });
    expect(abilitiesRules.shotsAllowed(abilitiesState, player)).toBe(1);
  });

  it('rejects unknown, reused, lost, and malformed abilities in the specified validation order', () => {
    const state = placed();
    const player = state.currentTurn!;
    const unknown = frozenReduce(state, abilityAction(player, 'unknown', { row: 0, col: 0, horizontal: true }));
    expect(unknown).toMatchObject({ ok: false, error: { code: 'invalid_ability' } });

    const used = frozenReduce(state, abilityAction(player, 'submarine-sonar', { row: 0, col: 0 }));
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    expect(abilityStatuses(used.state, player)['submarine-sonar']).toBe('used');
    const repeatState = withTurn(used.state, player);
    const repeated = frozenReduce(repeatState, abilityAction(player, 'submarine-sonar', { row: 0, col: 0 }));
    expect(repeated).toMatchObject({ ok: false, error: { code: 'ability_used' } });

    const lostState = withTurn(state, player);
    lostState.boards[player]!.hitCells = cellsOf(fleet[0]!).map(({ row, col }) => cellKey(row, col));
    const lost = frozenReduce(lostState, abilityAction(player, 'carrier-airstrike', { row: 0, col: 0, horizontal: true }));
    expect(lost).toMatchObject({ ok: false, error: { code: 'invalid_ability' } });

    const malformed = frozenReduce(state, abilityAction(player, 'submarine-sonar', null));
    expect(malformed).toMatchObject({
      ok: false,
      error: { code: 'invalid_ability', message: 'Malformed ability target' },
    });
    const malformedHorizontal = frozenReduce(
      state,
      abilityAction(player, 'carrier-airstrike', { row: 0, col: 0, horizontal: 'yes' }),
    );
    expect(malformedHorizontal).toMatchObject({ ok: false, error: { code: 'invalid_ability' } });
  });

  it('validates the complete airstrike line and skips tried cells', () => {
    const state = placed();
    const player = state.currentTurn!;
    const badTargets = [
      { row: 0, col: 8, horizontal: true },
      { row: 8, col: 0, horizontal: false },
      { row: -1, col: 0, horizontal: true },
      { row: 0, col: -1, horizontal: true },
    ];
    for (const target of badTargets) {
      const offBoard = frozenReduce(state, abilityAction(player, 'carrier-airstrike', target));
      expect(offBoard).toMatchObject({ ok: false, error: { code: 'off_board' } });
    }

    const allTried = structuredClone(state);
    allTried.shots[player] = [shot(5, 3), shot(5, 4), shot(5, 5)];
    const alreadyFired = frozenReduce(
      allTried,
      abilityAction(player, 'carrier-airstrike', { row: 5, col: 3, horizontal: true }),
    );
    expect(alreadyFired).toMatchObject({ ok: false, error: { code: 'already_fired' } });

    const partiallyTried = structuredClone(state);
    partiallyTried.shots[player] = [shot(5, 3)];
    const partial = frozenReduce(
      partiallyTried,
      abilityAction(player, 'carrier-airstrike', { row: 5, col: 3, horizontal: true }),
    );
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.state.shots[player]).toHaveLength(3);
    expect(partial.state.shots[player]!.slice(1).map(({ row, col, volley }) => ({ row, col, volley }))).toEqual([
      { row: 5, col: 4, volley: state.turnNumber },
      { row: 5, col: 5, volley: state.turnNumber },
    ]);
    expect(partial.state.abilityLog).toEqual([{
      player,
      turnNumber: state.turnNumber,
      result: {
        abilityId: 'carrier-airstrike',
        cells: [
          { row: 5, col: 4, result: 'miss' },
          { row: 5, col: 5, result: 'miss' },
        ],
      },
    }]);
  });

  it('records sinking airstrike cells last and emits ability and turn events in order', () => {
    const state = placed();
    const player = state.currentTurn!;
    const owner = otherPlayer(state, player);
    const result = frozenReduce(
      state,
      abilityAction(player, 'carrier-airstrike', { row: 8, col: 0, horizontal: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.shots[player]!.map(({ row, col, result: shotResult }) => ({ row, col, result: shotResult }))).toEqual([
      { row: 8, col: 0, result: 'hit' },
      { row: 8, col: 2, result: 'miss' },
      { row: 8, col: 1, result: 'sunk' },
    ]);
    expect(result.state.shots[player]!.map(({ volley }) => volley)).toEqual([
      state.turnNumber,
      state.turnNumber,
      state.turnNumber,
    ]);
    expect(typeSequence(result.events)).toEqual([
      'shotFired',
      'shotResolved',
      'shotFired',
      'shotResolved',
      'shotFired',
      'shotResolved',
      'shipSunk',
      'abilityUsed',
      'turnChanged',
    ]);
    expect(result.events[6]).toMatchObject({ type: 'shipSunk', owner, shipId: 'destroyer' });
    expect(result.events[7]).toMatchObject({
      type: 'abilityUsed',
      player,
      abilityId: 'carrier-airstrike',
      result: {
        abilityId: 'carrier-airstrike',
        cells: [
          { row: 8, col: 0, result: 'hit' },
          { row: 8, col: 2, result: 'miss' },
          { row: 8, col: 1, result: 'sunk' },
        ],
      },
    });
  });

  it('ends the game after an airstrike sinks the final ship without a turnChanged event', () => {
    const state = placed();
    const player = state.currentTurn!;
    const owner = otherPlayer(state, player);
    const enemyFleet = state.boards[owner]!.fleet!;
    state.boards[owner]!.hitCells = enemyFleet
      .filter((ship) => ship.type !== 'destroyer')
      .flatMap((ship) => cellsOf(ship))
      .map(({ row, col }) => cellKey(row, col));
    const result = frozenReduce(
      state,
      abilityAction(player, 'carrier-airstrike', { row: 8, col: 0, horizontal: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe('gameOver');
    expect(result.state.winner).toBe(player);
    expect(result.events.at(-1)).toEqual({ type: 'gameOver', winner: player, reason: 'all_sunk' });
    expect(result.events.some((event) => event.type === 'turnChanged')).toBe(false);
  });

  it('scans clipped sonar regions, including previously hit ship cells, without changing shots or hits', () => {
    const presentState = placed();
    const player = presentState.currentTurn!;
    const owner = otherPlayer(presentState, player);
    presentState.boards[owner]!.hitCells.push(cellKey(0, 0));
    const shotsBefore = structuredClone(presentState.shots);
    const hitsBefore = Object.fromEntries(presentState.playerIds.map((uid) => [
      uid,
      [...presentState.boards[uid]!.hitCells],
    ]));
    const present = frozenReduce(presentState, abilityAction(player, 'submarine-sonar', { row: 0, col: 0 }));
    expect(present.ok).toBe(true);
    if (present.ok) {
      expect(present.state.abilityLog[0]!.result).toEqual({
        abilityId: 'submarine-sonar',
        center: { row: 0, col: 0 },
        shipPresent: true,
      });
      expect(present.events).toHaveLength(2);
      expect(typeSequence(present.events)).toEqual(['abilityUsed', 'turnChanged']);
      expect(present.state.shots).toEqual(shotsBefore);
      expect(Object.fromEntries(present.state.playerIds.map((uid) => [
        uid,
        present.state.boards[uid]!.hitCells,
      ]))).toEqual(hitsBefore);
    }

    const absentState = placed();
    const absent = frozenReduce(absentState, abilityAction(
      absentState.currentTurn!,
      'submarine-sonar',
      { row: 9, col: 9 },
    ));
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.state.abilityLog[0]!.result).toMatchObject({ shipPresent: false });

    const offBoard = frozenReduce(
      presentState,
      abilityAction(player, 'submarine-sonar', { row: -1, col: 0 }),
    );
    expect(offBoard).toMatchObject({ ok: false, error: { code: 'off_board' } });
    expect(sonarCells({ row: 0, col: 0 }, 10)).toHaveLength(4);
    expect(sonarCells({ row: 0, col: 5 }, 10)).toHaveLength(6);
    expect(sonarCells({ row: 5, col: 5 }, 10)).toHaveLength(9);
  });

  it('relocates only the actor destroyer, hides its location, and preserves frozen input', () => {
    const state = placed();
    const player = state.currentTurn!;
    const opponent = otherPlayer(state, player);
    const otherShipsBefore = state.boards[player]!.fleet!.filter((ship) => ship.type !== 'destroyer');
    const opponentBoardBefore = structuredClone(state.boards[opponent]);
    const result = frozenReduce(
      state,
      abilityAction(player, 'destroyer-relocate', { row: 9, col: 8, horizontal: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.boards[player]!.fleet!.filter((ship) => ship.type !== 'destroyer')).toEqual(otherShipsBefore);
    expect(result.state.boards[player]!.fleet!.find((ship) => ship.type === 'destroyer')).toEqual({
      type: 'destroyer',
      row: 9,
      col: 8,
      horizontal: true,
    });
    expect(result.state.boards[opponent]).toEqual(opponentBoardBefore);
    expect(result.events.map((event) => event.type)).toEqual(['abilityUsed', 'turnChanged']);
    expect(JSON.stringify(result.events)).not.toContain('"row":9');
    expect(JSON.stringify(result.events)).not.toContain('"col":8');
    expect(JSON.stringify(result.state.abilityLog)).not.toContain('"row":9');
    expect(JSON.stringify(result.state.abilityLog)).not.toContain('"col":8');
    expect(result.state.abilityLog[0]!.result).toEqual({ abilityId: 'destroyer-relocate' });
  });

  it('rejects illegal relocation, damaged destroyers, and relocations across opponent misses', () => {
    const state = placed();
    const player = state.currentTurn!;
    const illegalTargets = [
      { row: 8, col: 0, horizontal: true },
      { row: 9, col: 9, horizontal: true },
      { row: 0, col: 0, horizontal: false },
    ];
    for (const target of illegalTargets) {
      const rejected = frozenReduce(state, abilityAction(player, 'destroyer-relocate', target));
      expect(rejected).toMatchObject({ ok: false, error: { code: 'illegal_relocation' } });
    }

    const opponent = otherPlayer(state, player);
    const firedAt = structuredClone(state);
    firedAt.shots[opponent]!.push(shot(9, 8));
    const missedCell = frozenReduce(
      firedAt,
      abilityAction(player, 'destroyer-relocate', { row: 9, col: 8, horizontal: true }),
    );
    expect(missedCell).toMatchObject({ ok: false, error: { code: 'illegal_relocation' } });

    const damaged = withTurn(state, player);
    damaged.boards[player]!.hitCells.push(cellKey(8, 0));
    const damagedResult = frozenReduce(
      damaged,
      abilityAction(player, 'destroyer-relocate', { row: 9, col: 8, horizontal: true }),
    );
    expect(damagedResult).toMatchObject({ ok: false, error: { code: 'invalid_ability' } });
  });

  it('lets the opponent miss at the old destroyer placement and hit the relocated one', () => {
    const state = placed();
    const player = state.currentTurn!;
    const opponent = otherPlayer(state, player);
    const relocated = frozenReduce(
      state,
      abilityAction(player, 'destroyer-relocate', { row: 9, col: 8, horizontal: true }),
    );
    expect(relocated.ok).toBe(true);
    if (!relocated.ok) return;

    const oldPosition = frozenReduce(relocated.state, {
      type: 'fire',
      player: opponent,
      target: { row: 8, col: 0 },
      at: 11,
    });
    expect(oldPosition.ok).toBe(true);
    if (!oldPosition.ok) return;
    expect(oldPosition.state.shots[opponent]!.at(-1)?.result).toBe('miss');

    const opponentTurn = frozenReduce(oldPosition.state, {
      type: 'fire',
      player,
      target: { row: 9, col: 9 },
      at: 12,
    });
    expect(opponentTurn.ok).toBe(true);
    if (!opponentTurn.ok) return;
    const newPosition = frozenReduce(opponentTurn.state, {
      type: 'fire',
      player: opponent,
      target: { row: 9, col: 8 },
      at: 13,
    });
    expect(newPosition.ok).toBe(true);
    if (newPosition.ok) expect(newPosition.state.shots[opponent]!.at(-1)?.result).toBe('hit');
  });
});
