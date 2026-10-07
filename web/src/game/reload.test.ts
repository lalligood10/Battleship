import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '@shared/core/events';
import type { Game } from '../lib/types';
import { gameFromSnapshot } from '../lib/firestore';
import { createFeelDirector } from '../feel/director';
import type { FeelCue } from '../feel/cues';
import { diffGameEvents } from './events';

function snapshot(data: DocumentData | undefined, id = 'game-1'): DocumentSnapshot<DocumentData> {
  return { id, data: () => data } as unknown as DocumentSnapshot<DocumentData>;
}

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    code: 'ABC234',
    status: 'active',
    mode: 'salvo',
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
    rematch: null,
    rematchOf: null,
    invitedUid: null,
    abandonTimeoutMs: 1,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    lastMoveAt: null,
    ...overrides,
  };
}

describe('game reload', () => {
  it('preserves every mid-game field and the last-move timestamp object', () => {
    const lastMoveAt = { toMillis: () => 1_700_000_000_000 };
    const data = {
      code: 'ABCD23',
      status: 'active',
      mode: 'salvo',
      hostUid: 'alice',
      playerUids: ['alice', 'bob'],
      players: {
        alice: { username: 'Alice', rating: 1000, ready: true, sunkShips: [], shotsFired: 3, hits: 2 },
        bob: { username: 'Bob', rating: 1000, ready: true, sunkShips: [], shotsFired: 2, hits: 1 },
      },
      shots: {
        alice: [
          { row: 0, col: 0, result: 'hit', at: 10 },
          { row: 0, col: 1, result: 'miss', at: 11 },
        ],
        bob: [{ row: 9, col: 9, result: 'hit', at: 12 }],
      },
      currentTurnUid: 'alice',
      turnNumber: 3,
      winnerUid: null,
      endReason: null,
      ratingChanges: null,
      revealedFleets: null,
      isQuickMatch: false,
      isBotGame: false,
      botDifficulty: null,
      rematch: { gameId: 'rematch-1', requestedBy: 'alice' },
      rematchOf: 'old-game',
      invitedUid: 'bob',
      abandonTimeoutMs: 86_400_000,
      createdAt: null,
      updatedAt: null,
      startedAt: null,
      finishedAt: null,
      lastMoveAt,
    };

    expect(gameFromSnapshot(snapshot(data))).toEqual({ id: 'game-1', ...data });
    expect(gameFromSnapshot(snapshot(data))!.lastMoveAt).toBe(lastMoveAt);
  });

  it('defaults missing legacy fields and returns null for a missing document', () => {
    const legacy = gameFromSnapshot(snapshot({ status: 'active' }));
    expect(legacy).toMatchObject({
      mode: 'classic',
      isBotGame: false,
      botDifficulty: null,
      rematch: null,
      rematchOf: null,
      invitedUid: null,
      lastMoveAt: null,
    });
    expect(gameFromSnapshot(snapshot(undefined))).toBeNull();
  });
});

describe('diffGameEvents after reload', () => {
  it('does not replay shot history and emits only the next shot and turn change', () => {
    const reloaded = game({
      currentTurnUid: 'two',
      turnNumber: 5,
      shots: {
        one: [
          { row: 0, col: 0, result: 'hit', at: 10 },
          { row: 0, col: 1, result: 'miss', at: 11 },
          { row: 2, col: 2, result: 'hit', at: 20 },
        ],
        two: [
          { row: 9, col: 9, result: 'miss', at: 15 },
          { row: 8, col: 8, result: 'hit', at: 25 },
        ],
      },
    });
    const next = game({
      currentTurnUid: 'one',
      turnNumber: 6,
      shots: {
        ...reloaded.shots,
        two: [...reloaded.shots.two!, { row: 7, col: 7, result: 'miss', at: 30 }],
      },
    });

    expect(diffGameEvents(null, reloaded)).toEqual([]);
    expect(diffGameEvents(reloaded, next)).toEqual([
      { type: 'shotFired', shooter: 'two', target: { row: 7, col: 7 }, turnNumber: 5 },
      { type: 'shotResolved', shooter: 'two', target: { row: 7, col: 7 }, result: 'miss', turnNumber: 5 },
      { type: 'turnChanged', currentTurn: 'one', turnNumber: 6 },
    ]);
  });
});

describe('feel director after reload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats existing shots as already revealed and cues only a new opponent shot', () => {
    const director = createFeelDirector({
      myUid: 'me',
      botGame: false,
      initialShots: { target: 3, own: 2 },
      clock: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
    const cues: FeelCue[] = [];
    director.subscribe((cue) => cues.push(cue));

    expect(director.revealed()).toEqual({ target: 3, own: 2 });
    expect(director.settled()).toBe(true);
    expect(cues).toEqual([]);

    const newShot: Extract<CoreEvent, { type: 'shotResolved' }> = {
      type: 'shotResolved',
      shooter: 'opponent',
      target: { row: 2, col: 3 },
      result: 'miss',
      turnNumber: 3,
    };
    director.handle([newShot]);
    vi.advanceTimersByTime(400);

    expect(director.revealed()).toEqual({ target: 3, own: 3 });
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(1);
    director.dispose();
  });
});
