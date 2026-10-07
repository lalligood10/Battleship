import { describe, expect, it } from 'vitest';
import type { Game } from '../lib/types';
import { diffGameEvents } from './events';

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    code: 'ABC234',
    status: 'active',
    hostUid: 'one',
    playerUids: ['one', 'two'],
    players: {},
    shots: { one: [], two: [] },
    currentTurnUid: 'one',
    turnNumber: 1,
    winnerUid: null,
    endReason: null,
    ratingChanges: null,
    revealedFleets: null,
    isQuickMatch: false,
    isBotGame: false,
    botDifficulty: null,
    abandonTimeoutMs: 1,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    lastMoveAt: null,
    ...overrides,
  };
}

describe('diffGameEvents', () => {
  it('emits nothing for the initial snapshot', () => {
    expect(diffGameEvents(null, game({ status: 'finished', winnerUid: 'one', endReason: 'all_sunk' }))).toEqual([]);
  });

  it('orders shots by timestamp and emits resolved, sink, then turn events', () => {
    const prev = game({ turnNumber: 4, currentTurnUid: 'two' });
    const next = game({
      shots: {
        one: [{ row: 0, col: 1, result: 'miss', at: 40 }],
        two: [
          {
            row: 3,
            col: 2,
            result: 'sunk',
            sunkShip: 'destroyer',
            sunkPlacement: { type: 'destroyer', row: 3, col: 1, horizontal: true },
            at: 42,
          },
        ],
      },
      currentTurnUid: 'one',
      turnNumber: 6,
    });
    expect(diffGameEvents(prev, next)).toEqual([
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 1 }, turnNumber: 4 },
      { type: 'shotResolved', shooter: 'one', target: { row: 0, col: 1 }, result: 'miss', turnNumber: 4 },
      { type: 'turnChanged', currentTurn: 'two', turnNumber: 5 },
      { type: 'shotFired', shooter: 'two', target: { row: 3, col: 2 }, turnNumber: 5 },
      { type: 'shotResolved', shooter: 'two', target: { row: 3, col: 2 }, result: 'hit', turnNumber: 5 },
      {
        type: 'shipSunk',
        shooter: 'two',
        owner: 'one',
        shipId: 'destroyer',
        placement: { type: 'destroyer', row: 3, col: 1, horizontal: true },
      },
      { type: 'turnChanged', currentTurn: 'one', turnNumber: 6 },
    ]);
  });

  it('ends the stream with gameOver and no turnChanged', () => {
    const prev = game({ turnNumber: 8, currentTurnUid: 'one' });
    const next = game({
      status: 'finished',
      shots: { one: [{ row: 4, col: 5, result: 'sunk', sunkShip: 'destroyer', at: 80 }], two: [] },
      currentTurnUid: null,
      turnNumber: 8,
      winnerUid: 'one',
      endReason: 'all_sunk',
    });
    expect(diffGameEvents(prev, next).map((event) => event.type)).toEqual([
      'shotFired',
      'shotResolved',
      'gameOver',
    ]);
  });

  it('keeps the intermediate turn change in a human and bot exchange', () => {
    const prev = game({ turnNumber: 3, currentTurnUid: 'human', playerUids: ['human', 'bot'] });
    const next = game({
      playerUids: ['human', 'bot'],
      isBotGame: true,
      shots: {
        human: [{ row: 0, col: 1, result: 'miss', at: 40 }],
        bot: [{ row: 3, col: 2, result: 'hit', at: 41 }],
      },
      currentTurnUid: 'human',
      turnNumber: 5,
    });

    expect(diffGameEvents(prev, next)).toEqual([
      { type: 'shotFired', shooter: 'human', target: { row: 0, col: 1 }, turnNumber: 3 },
      { type: 'shotResolved', shooter: 'human', target: { row: 0, col: 1 }, result: 'miss', turnNumber: 3 },
      { type: 'turnChanged', currentTurn: 'bot', turnNumber: 4 },
      { type: 'shotFired', shooter: 'bot', target: { row: 3, col: 2 }, turnNumber: 4 },
      { type: 'shotResolved', shooter: 'bot', target: { row: 3, col: 2 }, result: 'hit', turnNumber: 4 },
      { type: 'turnChanged', currentTurn: 'human', turnNumber: 5 },
    ]);
  });

  it('keeps the intermediate turn change when a bot reply wins', () => {
    const prev = game({ turnNumber: 3, currentTurnUid: 'human', playerUids: ['human', 'bot'] });
    const next = game({
      status: 'finished',
      playerUids: ['human', 'bot'],
      isBotGame: true,
      shots: {
        human: [{ row: 0, col: 1, result: 'miss', at: 40 }],
        bot: [
          {
            row: 3,
            col: 2,
            result: 'sunk',
            sunkShip: 'destroyer',
            sunkPlacement: { type: 'destroyer', row: 3, col: 1, horizontal: true },
            at: 41,
          },
        ],
      },
      currentTurnUid: null,
      turnNumber: 5,
      winnerUid: 'bot',
      endReason: 'all_sunk',
    });

    expect(diffGameEvents(prev, next)).toEqual([
      { type: 'shotFired', shooter: 'human', target: { row: 0, col: 1 }, turnNumber: 3 },
      { type: 'shotResolved', shooter: 'human', target: { row: 0, col: 1 }, result: 'miss', turnNumber: 3 },
      { type: 'turnChanged', currentTurn: 'bot', turnNumber: 4 },
      { type: 'shotFired', shooter: 'bot', target: { row: 3, col: 2 }, turnNumber: 4 },
      { type: 'shotResolved', shooter: 'bot', target: { row: 3, col: 2 }, result: 'hit', turnNumber: 4 },
      {
        type: 'shipSunk',
        shooter: 'bot',
        owner: 'human',
        shipId: 'destroyer',
        placement: { type: 'destroyer', row: 3, col: 1, horizontal: true },
      },
      { type: 'gameOver', winner: 'bot', reason: 'all_sunk' },
    ]);
  });

  it('does not emit a turn change after a human shot wins', () => {
    const prev = game({ turnNumber: 3, currentTurnUid: 'human', playerUids: ['human', 'bot'] });
    const next = game({
      status: 'finished',
      playerUids: ['human', 'bot'],
      shots: {
        human: [
          {
            row: 4,
            col: 0,
            result: 'sunk',
            sunkShip: 'destroyer',
            sunkPlacement: { type: 'destroyer', row: 4, col: 0, horizontal: true },
            at: 40,
          },
        ],
        bot: [],
      },
      currentTurnUid: null,
      turnNumber: 4,
      winnerUid: 'human',
      endReason: 'all_sunk',
    });

    expect(diffGameEvents(prev, next).map((event) => event.type)).toEqual([
      'shotFired',
      'shotResolved',
      'shipSunk',
      'gameOver',
    ]);
  });

  it('groups same-shooter Salvo shots into one turn', () => {
    const prev = game({ mode: 'salvo', turnNumber: 3, currentTurnUid: 'human', playerUids: ['human', 'bot'] });
    const next = game({
      mode: 'salvo',
      playerUids: ['human', 'bot'],
      shots: {
        human: [
          { row: 0, col: 0, result: 'miss', at: 40, volley: 3 },
          { row: 0, col: 1, result: 'hit', at: 40, volley: 3 },
        ],
        bot: [
          { row: 2, col: 0, result: 'miss', at: 41, volley: 4 },
          { row: 2, col: 1, result: 'hit', at: 41, volley: 4 },
        ],
      },
      currentTurnUid: 'human',
      turnNumber: 5,
    });

    expect(diffGameEvents(prev, next)).toEqual([
      { type: 'shotFired', shooter: 'human', target: { row: 0, col: 0 }, turnNumber: 3 },
      { type: 'shotResolved', shooter: 'human', target: { row: 0, col: 0 }, result: 'miss', turnNumber: 3 },
      { type: 'shotFired', shooter: 'human', target: { row: 0, col: 1 }, turnNumber: 3 },
      { type: 'shotResolved', shooter: 'human', target: { row: 0, col: 1 }, result: 'hit', turnNumber: 3 },
      {
        type: 'salvoResolved',
        shooter: 'human',
        targets: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
        results: ['miss', 'hit'],
        turnNumber: 3,
      },
      { type: 'turnChanged', currentTurn: 'bot', turnNumber: 4 },
      { type: 'shotFired', shooter: 'bot', target: { row: 2, col: 0 }, turnNumber: 4 },
      { type: 'shotResolved', shooter: 'bot', target: { row: 2, col: 0 }, result: 'miss', turnNumber: 4 },
      { type: 'shotFired', shooter: 'bot', target: { row: 2, col: 1 }, turnNumber: 4 },
      { type: 'shotResolved', shooter: 'bot', target: { row: 2, col: 1 }, result: 'hit', turnNumber: 4 },
      {
        type: 'salvoResolved',
        shooter: 'bot',
        targets: [{ row: 2, col: 0 }, { row: 2, col: 1 }],
        results: ['miss', 'hit'],
        turnNumber: 4,
      },
      { type: 'turnChanged', currentTurn: 'human', turnNumber: 5 },
    ]);
  });

  it('emits abilityUsed after all airstrike shots and before the turn changes', () => {
    const prev = game({ mode: 'abilities', turnNumber: 3, currentTurnUid: 'human' });
    const airstrike = {
      abilityId: 'carrier-airstrike' as const,
      cells: [
        { row: 2, col: 1, result: 'miss' as const },
        { row: 2, col: 2, result: 'hit' as const },
        { row: 2, col: 3, result: 'miss' as const },
      ],
    };
    const next = game({
      mode: 'abilities',
      shots: {
        human: [
          { row: 2, col: 1, result: 'miss', at: 40 },
          { row: 2, col: 2, result: 'hit', at: 40 },
          { row: 2, col: 3, result: 'miss', at: 40 },
        ],
        two: [],
      },
      abilityLog: [{ player: 'human', turnNumber: 3, result: airstrike }],
      currentTurnUid: 'two',
      turnNumber: 4,
    });

    const events = diffGameEvents(prev, next);
    expect(events.map((event) => event.type)).toEqual([
      'shotFired',
      'shotResolved',
      'shotFired',
      'shotResolved',
      'shotFired',
      'shotResolved',
      'abilityUsed',
      'turnChanged',
    ]);
    expect(events[6]).toEqual({
      type: 'abilityUsed',
      player: 'human',
      abilityId: 'carrier-airstrike',
      result: airstrike,
      turnNumber: 3,
    });
    expect(events[7]).toEqual({ type: 'turnChanged', currentTurn: 'two', turnNumber: 4 });
  });

  it('emits no-shot ability events before the following turn transition', () => {
    const prev = game({ mode: 'abilities', turnNumber: 6, currentTurnUid: 'human' });
    const sonar = {
      abilityId: 'submarine-sonar' as const,
      center: { row: 0, col: 1 },
      shipPresent: true,
    };
    const next = game({
      mode: 'abilities',
      abilityLog: [{ player: 'human', turnNumber: 6, result: sonar }],
      currentTurnUid: 'two',
      turnNumber: 7,
    });

    expect(diffGameEvents(prev, next)).toEqual([
      { type: 'abilityUsed', player: 'human', abilityId: 'submarine-sonar', result: sonar, turnNumber: 6 },
      { type: 'turnChanged', currentTurn: 'two', turnNumber: 7 },
    ]);
  });

  it('emits every newly logged no-shot ability in turn order', () => {
    const prev = game({ mode: 'abilities', turnNumber: 6, currentTurnUid: 'human' });
    const humanSonar = {
      abilityId: 'submarine-sonar' as const,
      center: { row: 0, col: 1 },
      shipPresent: true,
    };
    const botSonar = {
      abilityId: 'submarine-sonar' as const,
      center: { row: 9, col: 9 },
      shipPresent: false,
    };
    const next = game({
      mode: 'abilities',
      abilityLog: [
        { player: 'human', turnNumber: 6, result: humanSonar },
        { player: 'two', turnNumber: 7, result: botSonar },
      ],
      currentTurnUid: 'human',
      turnNumber: 8,
    });

    expect(diffGameEvents(prev, next)).toEqual([
      { type: 'abilityUsed', player: 'human', abilityId: 'submarine-sonar', result: humanSonar, turnNumber: 6 },
      { type: 'turnChanged', currentTurn: 'two', turnNumber: 7 },
      { type: 'abilityUsed', player: 'two', abilityId: 'submarine-sonar', result: botSonar, turnNumber: 7 },
      { type: 'turnChanged', currentTurn: 'human', turnNumber: 8 },
    ]);
  });

  it('emits a turn change without a shot when the active turn changes', () => {
    const prev = game({ status: 'placing', currentTurnUid: null, turnNumber: 0 });
    const next = game({ currentTurnUid: 'two', turnNumber: 1 });
    expect(diffGameEvents(prev, next)).toEqual([{ type: 'turnChanged', currentTurn: 'two', turnNumber: 1 }]);
  });
});
