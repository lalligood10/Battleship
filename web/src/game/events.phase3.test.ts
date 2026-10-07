import { describe, expect, it } from 'vitest';
import type { Game } from '../lib/types';
import { diffGameEvents } from './events';

const deadline = (ms: number) => ({ toMillis: () => ms }) as unknown as NonNullable<Game['turnDeadline']>;

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    code: 'ABC234',
    status: 'active',
    mode: 'classic',
    hostUid: 'one',
    playerUids: ['one', 'two'],
    players: {},
    shots: { one: [{ row: 0, col: 0, result: 'miss', at: 10 }], two: [{ row: 9, col: 9, result: 'hit', at: 11 }] },
    abilityLog: [],
    isRated: true,
    turnTimerMs: 60_000,
    turnDeadline: deadline(1_000_000),
    timeoutStreak: { one: 0, two: 0 },
    remindedTurn: null,
    currentTurnUid: 'one',
    turnNumber: 3,
    winnerUid: null,
    endReason: null,
    ratingChanges: null,
    revealedFleets: null,
    isQuickMatch: false,
    isBotGame: false,
    botDifficulty: null,
    rematch: null,
    rematchOf: null,
    invitedUid: null,
    abandonTimeoutMs: 259_200_000,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    lastMoveAt: null,
    ...overrides,
  };
}

describe('Phase 3 events', () => {
  it.each(['classic', 'salvo', 'abilities'] as const)('a skipped %s turn emits only a turn change, never shot FX', (mode) => {
    const before = game({ mode });
    const after = game({
      mode,
      currentTurnUid: 'two',
      turnNumber: 4,
      turnDeadline: deadline(1_060_000),
      timeoutStreak: { one: 1, two: 0 },
    });
    expect(diffGameEvents(before, after)).toEqual([{ type: 'turnChanged', currentTurn: 'two', turnNumber: 4 }]);
  });

  it('timer bookkeeping alone (deadline, streak, reminder) emits nothing', () => {
    const before = game();
    const after = game({ turnDeadline: deadline(2_000_000), timeoutStreak: { one: 0, two: 1 }, remindedTurn: 3 });
    expect(diffGameEvents(before, after)).toEqual([]);
  });

  it('a timeout forfeit emits a single timeout gameOver and no shot events', () => {
    const before = game({ timeoutStreak: { one: 2, two: 0 } });
    const after = game({
      status: 'finished',
      currentTurnUid: null,
      turnDeadline: null,
      winnerUid: 'two',
      endReason: 'timeout',
      timeoutStreak: { one: 3, two: 0 },
    });
    expect(diffGameEvents(before, after)).toEqual([{ type: 'gameOver', winner: 'two', reason: 'timeout' }]);
  });

  it('reconnecting to a timed game mid-match replays nothing', () => {
    expect(diffGameEvents(null, game({ timeoutStreak: { one: 2, two: 1 } }))).toEqual([]);
  });

  it('re-delivering an identical snapshot after reconnect emits nothing', () => {
    expect(diffGameEvents(game(), game())).toEqual([]);
  });
});
