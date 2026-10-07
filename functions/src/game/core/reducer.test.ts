import { describe, expect, it } from 'vitest';
import { BOT_PROFILES } from '../bots';
import { createCoreState, reduce } from './reducer';
import { createEventBus, type CoreEvent } from './events';
import type { CoreState } from './schema';

const fleet = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 1, col: 0, horizontal: true },
  { type: 'cruiser', row: 2, col: 0, horizontal: true },
  { type: 'submarine', row: 3, col: 0, horizontal: true },
  { type: 'destroyer', row: 4, col: 0, horizontal: true },
] as const;

function placed(seed = 5): CoreState {
  let state = createCoreState({ playerIds: ['one', 'two'], seed });
  const first = reduce(state, { type: 'placeFleet', player: 'one', fleet, at: 1 });
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(first.error.message);
  state = first.state;
  const second = reduce(state, { type: 'placeFleet', player: 'two', fleet, at: 2 });
  expect(second.ok).toBe(true);
  if (!second.ok) throw new Error(second.error.message);
  return second.state;
}

function fire(state: CoreState, player: string, row: number, col: number) {
  return reduce(state, { type: 'fire', player, target: { row, col }, at: 10 });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fireAt(
  state: CoreState,
  player: string,
  row: number,
  col: number,
  events?: (events: CoreEvent[]) => void,
): CoreState {
  const result = fire(state, player, row, col);
  if (!result.ok) throw new Error(result.error.message);
  events?.(result.events);
  return result.state;
}

describe('core reducer', () => {
  it('places valid fleets and starts once both players are ready', () => {
    const initial = createCoreState({ playerIds: ['one', 'two'], seed: 12 });
    const first = reduce(initial, { type: 'placeFleet', player: 'one', fleet });
    expect(first.ok && first.state.phase).toBe('placement');
    const second = reduce(first.ok ? first.state : initial, { type: 'placeFleet', player: 'two', fleet });
    expect(second.ok && second.state.phase).toBe('playing');
    expect(second.ok && second.state.turnNumber).toBe(1);
    if (!second.ok) throw new Error(second.error.message);
    expect(['one', 'two']).toContain(second.state.currentTurn);
  });

  it('always starts with the human when exactly one player is a bot', () => {
    const botUid = BOT_PROFILES.easy.uid;
    const playerOrders: [string, string][] = [
      ['human', botUid],
      [botUid, 'human'],
    ];
    for (const seed of [0, 1, 2, 42, 12345, 0xffffffff]) {
      for (const playerIds of playerOrders) {
        let state = createCoreState({ playerIds, seed });
        for (const player of playerIds) {
          const result = reduce(state, { type: 'placeFleet', player, fleet });
          if (!result.ok) throw new Error(result.error.message);
          state = result.state;
        }
        expect(state.currentTurn).toBe('human');
      }
    }
  });

  it.each([
    ['overlap', [...fleet.slice(0, 1), { ...fleet[1], row: 0, col: 3 }, ...fleet.slice(2)]],
    ['off board', [...fleet.slice(0, 4), { ...fleet[4], col: 9 }]],
    ['wrong ship count', fleet.slice(0, 4)],
  ])('rejects a fleet with %s and preserves input', (_caseName, invalidFleet) => {
    const state = deepFreeze(createCoreState({ playerIds: ['one', 'two'], seed: 1 }));
    const result = reduce(state, { type: 'placeFleet', player: 'one', fleet: invalidFleet });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_fleet');
    expect(state.boards.one!.fleet).toBeNull();
  });

  it('rejects placing twice and placing after play starts', () => {
    let state = createCoreState({ playerIds: ['one', 'two'], seed: 1 });
    const first = reduce(state, { type: 'placeFleet', player: 'one', fleet });
    if (!first.ok) throw new Error(first.error.message);
    state = first.state;
    const duplicate = reduce(state, { type: 'placeFleet', player: 'one', fleet });
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'wrong_phase' } });
    const second = reduce(state, { type: 'placeFleet', player: 'two', fleet });
    if (!second.ok) throw new Error(second.error.message);
    const afterStart = reduce(second.state, { type: 'placeFleet', player: 'one', fleet });
    expect(afterStart).toMatchObject({ ok: false, error: { code: 'wrong_phase' } });
  });

  it('emits hit and miss shot objects and ordered turn events', () => {
    const state = placed();
    const player = state.currentTurn!;
    const result = fire(state, player, 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.shots[player]).toEqual([{ row: 0, col: 0, result: 'hit', at: 10 }]);
    expect(result.events.map((event) => event.type)).toEqual(['shotFired', 'shotResolved', 'turnChanged']);
    expect(result.events[1]).toMatchObject({ result: 'hit' });
    const miss = fire(result.state, result.state.currentTurn!, 9, 9);
    if (miss.ok) {
      const firstEvent = miss.events[0];
      if (firstEvent?.type !== 'shotFired') throw new Error('Expected shotFired event');
      const missedShot = miss.state.shots[firstEvent.shooter];
      expect(missedShot?.[0]).toEqual({ row: 9, col: 9, result: 'miss', at: 10 });
      expect(miss.events.map((event) => event.type)).toEqual(['shotFired', 'shotResolved', 'turnChanged']);
      expect(miss.events[1]).toMatchObject({ result: 'miss' });
    }
  });

  it('emits shipSunk with the placement and final event ordering', () => {
    let state = placed();
    const shooter = state.currentTurn!;
    state = fireAt(state, shooter, 4, 0);
    state = fireAt(state, state.currentTurn!, 4, 0);
    const result = fire(state, shooter, 4, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.shots[shooter]![1]).toEqual({
      row: 4,
      col: 1,
      result: 'sunk',
      sunkShip: 'destroyer',
      sunkPlacement: fleet[4],
      at: 10,
    });
    expect(result.events.map((event) => event.type)).toEqual([
      'shotFired',
      'shotResolved',
      'shipSunk',
      'turnChanged',
    ]);
    expect(result.events[2]).toMatchObject({ shipId: 'destroyer', placement: fleet[4] });
  });

  it('ends a game with winner, loser and no turnChanged after the final shot', () => {
    let state = placed(18);
    let finalEvents: { type: string }[] = [];
    let last: ReturnType<typeof fire> | null = null;
    while (state.phase === 'playing') {
      const shooter = state.currentTurn!;
      const owner = state.playerIds.find((uid) => uid !== shooter)!;
      const target = fleet.flatMap((ship) =>
        Array.from({ length: ship.type === 'carrier' ? 5 : ship.type === 'battleship' ? 4 : ship.type === 'destroyer' ? 2 : 3 }, (_, i) => ({
          row: ship.row + (ship.horizontal ? 0 : i),
          col: ship.col + (ship.horizontal ? i : 0),
        })),
      ).find(({ row, col }) => !state.shots[shooter]!.some((shot) => shot.row === row && shot.col === col))!;
      last = fire(state, shooter, target.row, target.col);
      if (!last.ok) throw new Error(last.error.message);
      state = last.state;
      expect(state.boards[owner]!.hitCells.length).toBeLessThanOrEqual(17);
    }
    finalEvents = last!.ok ? last!.events : [];
    expect(state.phase).toBe('gameOver');
    expect(state.winner).toBeDefined();
    expect(state.playerIds).toContain(state.winner);
    expect(state.endReason).toBe('all_sunk');
    const loser = state.playerIds.find((uid) => uid !== state.winner)!;
    expect(state.boards[loser]!.hitCells).toHaveLength(17);
    expect(state.boards[state.winner!]!.hitCells.length).toBeLessThan(17);
    expect(finalEvents.map((event) => event.type)).toEqual([
      'shotFired',
      'shotResolved',
      'shipSunk',
      'gameOver',
    ]);
  });

  it('supports resign and a valid timeout claim after the opponent stalls', () => {
    const state = placed();
    const resign = reduce(state, { type: 'resign', player: state.currentTurn! });
    expect(resign).toMatchObject({
      ok: true,
      state: { phase: 'gameOver', endReason: 'resign' },
      events: [{ type: 'gameOver', reason: 'resign' }],
    });
    const claimant = state.playerIds.find((uid) => uid !== state.currentTurn)!;
    const timeout = reduce(state, {
      type: 'claimTimeout',
      claimant,
      now: state.lastProgressAt + state.settings.abandonTimeoutMs,
    });
    expect(timeout).toMatchObject({
      ok: true,
      state: { phase: 'gameOver', winner: claimant, endReason: 'timeout' },
      events: [{ type: 'gameOver', winner: claimant, reason: 'timeout' }],
    });
  });

  it('tracks progress timestamps from creation, placements, and shots', () => {
    const state = createCoreState({ playerIds: ['one', 'two'], seed: 1, createdAt: 100 });
    expect(state.lastProgressAt).toBe(100);
    const first = reduce(state, { type: 'placeFleet', player: 'one', fleet, at: 200 });
    if (!first.ok) throw new Error(first.error.message);
    expect(first.state.lastProgressAt).toBe(200);
    const second = reduce(first.state, { type: 'placeFleet', player: 'two', fleet, at: 300 });
    if (!second.ok) throw new Error(second.error.message);
    expect(second.state.lastProgressAt).toBe(300);
    const shot = reduce(second.state, {
      type: 'fire',
      player: second.state.currentTurn!,
      target: { row: 9, col: 9 },
      at: 400,
    });
    if (!shot.ok) throw new Error(shot.error.message);
    expect(shot.state.lastProgressAt).toBe(400);
  });

  it('rejects premature timeout claims after checking who is waiting', () => {
    const state = placed();
    const claimant = state.playerIds.find((uid) => uid !== state.currentTurn)!;
    const premature = reduce(state, {
      type: 'claimTimeout',
      claimant,
      now: state.lastProgressAt + state.settings.abandonTimeoutMs - 1,
    });
    expect(premature).toMatchObject({ ok: false, error: { code: 'too_early' } });

    const ownTurn = reduce(state, {
      type: 'claimTimeout',
      claimant: state.currentTurn!,
      now: state.lastProgressAt + state.settings.abandonTimeoutMs,
    });
    expect(ownTurn).toMatchObject({ ok: false, error: { code: 'not_waiting' } });
  });

  it('rejects a placement claim before the claimant has placed a fleet', () => {
    const state = createCoreState({ playerIds: ['one', 'two'], seed: 1 });
    const result = reduce(state, {
      type: 'claimTimeout',
      claimant: 'one',
      now: state.settings.abandonTimeoutMs,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'not_waiting' } });
  });

  it('rejects timeout claims against a bot opponent', () => {
    const state = createCoreState({ playerIds: ['human', BOT_PROFILES.easy.uid], seed: 1 });
    const result = reduce(state, {
      type: 'claimTimeout',
      claimant: 'human',
      now: state.settings.abandonTimeoutMs,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'not_waiting' } });
  });

  it('allows a placement timeout claim when only the claimant has placed', () => {
    const initial = createCoreState({ playerIds: ['one', 'two'], seed: 1, createdAt: 10 });
    const placedOnce = reduce(initial, { type: 'placeFleet', player: 'one', fleet, at: 20 });
    if (!placedOnce.ok) throw new Error(placedOnce.error.message);
    const result = reduce(placedOnce.state, {
      type: 'claimTimeout',
      claimant: 'one',
      now: 20 + placedOnce.state.settings.abandonTimeoutMs,
    });
    expect(result).toMatchObject({ ok: true, state: { phase: 'gameOver', winner: 'one', endReason: 'timeout' } });
  });

  it('rejects illegal moves without mutating deep-frozen state', () => {
    const state = deepFreeze(placed());
    const turn = state.currentTurn!;
    const wrongTurn = state.playerIds.find((uid) => uid !== turn)!;
    const wrongTurnAction = { type: 'fire', player: wrongTurn, target: { row: 1, col: 1 }, at: 1 } as const;
    const outsiderAction = { type: 'fire', player: 'intruder', target: { row: 1, col: 1 }, at: 1 } as const;
    const offBoardAction = { type: 'fire', player: turn, target: { row: 10, col: 0 }, at: 1 } as const;
    const beforePlaying = deepFreeze(createCoreState({ playerIds: ['one', 'two'], seed: 2 }));
    const beforePlayingAction = {
      type: 'fire',
      player: 'one',
      target: { row: 0, col: 0 },
      at: 1,
    } as const;
    const scenarios = [
      [state, wrongTurnAction, 'not_your_turn'],
      [state, outsiderAction, 'not_player'],
      [state, offBoardAction, 'off_board'],
      [beforePlaying, beforePlayingAction, 'wrong_phase'],
    ] as const;
    for (const [frozenState, action, code] of scenarios) {
      const snapshot = structuredClone(frozenState);
      const result = reduce(frozenState, action);
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(frozenState).toEqual(snapshot);
    }

    let repeatState = reduce(state, { type: 'fire', player: turn, target: { row: 9, col: 9 }, at: 1 });
    if (!repeatState.ok) throw new Error(repeatState.error.message);
    repeatState = reduce(repeatState.state, {
      type: 'fire',
      player: wrongTurn,
      target: { row: 9, col: 8 },
      at: 2,
    });
    if (!repeatState.ok) throw new Error(repeatState.error.message);
    const duplicateState = deepFreeze(repeatState.state);
    const duplicateSnapshot = structuredClone(duplicateState);
    const duplicate = fire(duplicateState, turn, 9, 9);
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'already_fired' } });
    expect(duplicateState).toEqual(duplicateSnapshot);

    const finished = reduce(state, { type: 'resign', player: turn });
    if (!finished.ok) throw new Error(finished.error.message);
    const frozenFinished = deepFreeze(finished.state);
    const finishedSnapshot = structuredClone(frozenFinished);
    const afterGameOver = fire(frozenFinished, turn, 0, 0);
    expect(afterGameOver).toMatchObject({ ok: false, error: { code: 'wrong_phase' } });
    expect(frozenFinished).toEqual(finishedSnapshot);
    expect(state.shots[turn]).toHaveLength(0);
  });

  it('allows a shipSunk listener to observe all sinks without changing game logic', () => {
    const simulate = (listener?: (event: { type: 'shipSunk'; owner: string; shipId: string }) => void) => {
      const bus = createEventBus();
      if (listener) {
        bus.subscribe((event) => {
          if (event.type === 'shipSunk') listener(event);
        }, ['shipSunk']);
      }
      bus.subscribe(() => {
        throw new Error('ignored');
      });
      let state = placed(18);
      while (state.phase === 'playing') {
        const shooter = state.currentTurn!;
        const target = fleet.flatMap((ship) => {
          const length = ship.type === 'carrier' ? 5 : ship.type === 'battleship' ? 4 : ship.type === 'destroyer' ? 2 : 3;
          return Array.from({ length }, (_, i) => ({
            row: ship.row + (ship.horizontal ? 0 : i),
            col: ship.col + (ship.horizontal ? i : 0),
          }));
        }).find(({ row, col }) => !state.shots[shooter]!.some((shot) => shot.row === row && shot.col === col))!;
        const result = fire(state, shooter, target.row, target.col);
        if (!result.ok) throw new Error(result.error.message);
        bus.emit(result.events);
        state = result.state;
      }
      return state;
    };
    const observed: { owner: string; shipId: string }[] = [];
    const withoutListener = simulate();
    const withListener = simulate((event) => observed.push({ owner: event.owner, shipId: event.shipId }));
    const loser = withListener.playerIds.find((uid) => uid !== withListener.winner)!;
    expect(observed.filter((event) => event.owner === loser)).toHaveLength(5);
    expect(new Set(observed.filter((event) => event.owner === loser).map((event) => event.shipId)).size).toBe(5);
    expect(withListener).toEqual(withoutListener);
  });
});
