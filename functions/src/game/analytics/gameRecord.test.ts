import { describe, expect, it } from 'vitest';
import type { GameDoc } from '../../types';
import type { Coordinate, Shot } from '../engine';
import { createCoreState, reduce, salvoShotsAllowed, type CoreAction } from '../core/reducer';
import type { CoreState, GameMode } from '../core/schema';
import type { AbilityLogEntry } from '../core/modes/types';
import { gameAnalyticsRecord, turnsTaken, type FinishedGameSource } from './gameRecord';

const fleet = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 1, col: 0, horizontal: true },
  { type: 'cruiser', row: 2, col: 0, horizontal: true },
  { type: 'submarine', row: 3, col: 0, horizontal: true },
  { type: 'destroyer', row: 4, col: 0, horizontal: true },
] as const;

const boardCells: Coordinate[] = Array.from({ length: 100 }, (_, index) => ({
  row: Math.floor(index / 10),
  col: index % 10,
}));

function apply(state: CoreState, action: CoreAction): CoreState {
  const result = reduce(state, action);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function placed(mode: GameMode = 'classic', seed = 5): CoreState {
  let state = createCoreState({ playerIds: ['one', 'two'], seed, mode });
  for (const [index, player] of state.playerIds.entries()) {
    state = apply(state, { type: 'placeFleet', player, fleet, at: index + 1 });
  }
  return state;
}

function scanOrder(player: string): Coordinate[] {
  return player === 'one' ? boardCells : [...boardCells].reverse();
}

function nextUntriedTargets(state: CoreState, player: string, count: number): Coordinate[] {
  const tried = new Set((state.shots[player] ?? []).map((shot) => `${shot.row},${shot.col}`));
  return scanOrder(player)
    .filter(({ row, col }) => !tried.has(`${row},${col}`))
    .slice(0, count);
}

function playToGameOver(mode: 'classic' | 'salvo', seed = 5): CoreState {
  let state = placed(mode, seed);
  for (let actionCount = 0; state.phase === 'playing'; actionCount++) {
    if (actionCount >= 200) throw new Error('Game did not finish');
    const player = state.currentTurn;
    if (!player) throw new Error('Expected a player turn');

    if (mode === 'salvo') {
      const targets = nextUntriedTargets(state, player, salvoShotsAllowed(state, player));
      state = apply(state, { type: 'salvo', player, targets, at: actionCount + 10 });
    } else {
      const [target] = nextUntriedTargets(state, player, 1);
      if (!target) throw new Error('No untried target remains');
      state = apply(state, { type: 'fire', player, target, at: actionCount + 10 });
    }
  }
  return state;
}

function finishedDoc(
  state: CoreState,
  overrides: Partial<FinishedGameSource> = {},
): FinishedGameSource {
  const players = Object.fromEntries(state.playerIds.map((uid) => {
    const opponent = state.playerIds.find((player) => player !== uid)!;
    const sunkShips = (state.shots[opponent] ?? [])
      .flatMap((shot) => shot.sunkShip ? [shot.sunkShip] : []);
    return [uid, { sunkShips }];
  }));

  return {
    status: 'finished',
    mode: state.settings.mode,
    playerUids: state.playerIds,
    players,
    shots: state.shots,
    abilityLog: state.abilityLog,
    winnerUid: state.winner,
    endReason: state.endReason,
    isBotGame: false,
    startedAt: { toMillis: () => 1_000 },
    finishedAt: { toMillis: () => 3_000 },
    ...overrides,
  };
}

function classicShot(row: number, col: number): Shot {
  return { row, col, result: 'miss', at: 1 };
}

describe('game analytics record', () => {
  it('derives classic-game analytics from reducer-produced shots', () => {
    const state = playToGameOver('classic');
    expect(state.phase).toBe('gameOver');
    expect(state.endReason).toBe('all_sunk');
    const doc = finishedDoc(state);
    const record = gameAnalyticsRecord('classic-game', doc);
    if (!record) throw new Error('Expected a finished game record');

    const winner = state.winner!;
    const loser = state.playerIds.find((uid) => uid !== winner)!;
    const winnerShipsSunk = new Set(
      (state.shots[loser] ?? []).flatMap((shot) => shot.sunkShip ? [shot.sunkShip] : []),
    );
    expect(state.winner).toBe(winner);
    expect(record.turns).toBe(state.turnNumber - 1);
    expect(record.turns).toBe(state.playerIds.reduce((count, uid) => count + state.shots[uid]!.length, 0));
    expect(record.shotsByPlayer).toEqual({
      one: state.shots.one!.length,
      two: state.shots.two!.length,
    });
    expect(record).toMatchObject({
      winner,
      endReason: 'all_sunk',
      winnerShipsRemaining: 5 - winnerShipsSunk.size,
      abilities: [],
      mode: 'classic',
      durationMs: 2_000,
    });
  });

  it('counts Salvo turns by distinct reducer-produced shooter volleys', () => {
    const state = playToGameOver('salvo');
    const record = gameAnalyticsRecord('salvo-game', finishedDoc(state));
    if (!record) throw new Error('Expected a finished game record');
    const volleyKeys = new Set(
      state.playerIds.flatMap((uid) =>
        (state.shots[uid] ?? []).flatMap((shot) => shot.volley === undefined ? [] : [`${uid}|${shot.volley}`]),
      ),
    );
    const shotCount = state.playerIds.reduce((count, uid) => count + state.shots[uid]!.length, 0);

    expect(record.turns).toBe(state.turnNumber - 1);
    expect(record.turns).toBe(volleyKeys.size);
    expect(shotCount).toBeGreaterThan(record.turns);
  });

  it('deduplicates ability shots with their log entries and preserves ability order', () => {
    const abilityLog: AbilityLogEntry[] = [
      {
        player: 'one',
        turnNumber: 7,
        result: {
          abilityId: 'carrier-airstrike',
          cells: [
            { row: 0, col: 1, result: 'miss' },
            { row: 0, col: 2, result: 'hit' },
            { row: 0, col: 3, result: 'miss' },
          ],
        },
      },
      {
        player: 'two',
        turnNumber: 8,
        result: { abilityId: 'submarine-sonar', center: { row: 4, col: 4 }, shipPresent: true },
      },
      {
        player: 'one',
        turnNumber: 9,
        result: { abilityId: 'destroyer-relocate' },
      },
    ];
    const game: FinishedGameSource = {
      mode: 'abilities',
      status: 'finished',
      playerUids: ['one', 'two'],
      players: { one: { sunkShips: [] }, two: { sunkShips: [] } },
      shots: {
        one: [
          classicShot(9, 9),
          classicShot(9, 8),
          { row: 0, col: 1, result: 'miss', at: 7, volley: 7 },
          { row: 0, col: 2, result: 'hit', at: 7, volley: 7 },
          { row: 0, col: 3, result: 'miss', at: 7, volley: 7 },
        ],
        two: [classicShot(0, 0)],
      },
      abilityLog,
      winnerUid: 'one',
      endReason: 'resign',
      startedAt: { toMillis: () => 100 },
      finishedAt: { toMillis: () => 200 },
    };

    expect(turnsTaken(game)).toBe(3 + 3);
    expect(gameAnalyticsRecord('abilities-game', game)?.abilities).toEqual([
      { player: 'one', abilityId: 'carrier-airstrike', turnNumber: 7 },
      { player: 'two', abilityId: 'submarine-sonar', turnNumber: 8 },
      { player: 'one', abilityId: 'destroyer-relocate', turnNumber: 9 },
    ]);
  });

  it('records reducer-driven resignations with shots as turns and intact winner ships', () => {
    let state = placed('classic');
    for (let index = 0; index < 4; index++) {
      const player = state.currentTurn!;
      const [target] = nextUntriedTargets(state, player, 1);
      if (!target) throw new Error('No untried target remains');
      state = apply(state, { type: 'fire', player, target, at: index + 10 });
    }
    state = apply(state, { type: 'resign', player: 'two' });
    const record = gameAnalyticsRecord('resigned-game', finishedDoc(state));

    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      winner: 'one',
      endReason: 'resign',
      turns: state.playerIds.reduce((count, uid) => count + state.shots[uid]!.length, 0),
      winnerShipsRemaining: 5,
    });
  });

  it.each([
    ['active status', { status: 'active' }],
    ['missing winner', { winnerUid: null }],
    ['missing start time', { startedAt: null }],
    ['missing finish time', { finishedAt: null }],
    ['missing end reason', { endReason: null }],
  ])('returns null for %s', (_caseName, overrides) => {
    const state = playToGameOver('classic');
    expect(gameAnalyticsRecord('incomplete-game', finishedDoc(state, overrides))).toBeNull();
  });

  it('defaults legacy records without mode or ability log', () => {
    const game = finishedDoc(playToGameOver('classic'));
    delete game.mode;
    delete game.abilityLog;

    expect(gameAnalyticsRecord('legacy-game', game)).toMatchObject({
      mode: 'classic',
      abilities: [],
    });
  });

  it('clamps negative durations to zero', () => {
    const game = finishedDoc(playToGameOver('classic'), {
      startedAt: { toMillis: () => 2_000 },
      finishedAt: { toMillis: () => 1_000 },
    });

    expect(gameAnalyticsRecord('clock-skew-game', game)?.durationMs).toBe(0);
  });

  it('does not mutate the source game', () => {
    const game = finishedDoc(playToGameOver('classic'));
    const before = JSON.stringify({
      shots: game.shots,
      players: game.players,
      abilityLog: game.abilityLog,
    });

    gameAnalyticsRecord('immutable-game', game);

    expect(JSON.stringify({
      shots: game.shots,
      players: game.players,
      abilityLog: game.abilityLog,
    })).toBe(before);
  });

  it('does not over-count duplicate sunk ship types', () => {
    const game = finishedDoc(playToGameOver('classic'), {
      players: {
        one: { sunkShips: ['carrier', 'carrier'] },
        two: { sunkShips: [] },
      },
    });

    expect(gameAnalyticsRecord('duplicate-sinks-game', game)?.winnerShipsRemaining).toBe(4);
  });
});

const _doc: FinishedGameSource = {} as GameDoc;
void _doc;
