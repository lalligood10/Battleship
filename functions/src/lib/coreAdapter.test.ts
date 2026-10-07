import { describe, expect, it } from 'vitest';
import type { GameDoc } from '../types';
import { coreStateFromGame } from './coreAdapter';

function timestamp(milliseconds: number): GameDoc['createdAt'] {
  return { toMillis: () => milliseconds } as unknown as GameDoc['createdAt'];
}

function game(lastMoveAt: GameDoc['lastMoveAt']): GameDoc {
  return {
    playerUids: ['one', 'two'],
    status: 'active',
    mode: 'classic',
    currentTurnUid: 'one',
    turnNumber: 2,
    shots: { one: [], two: [] },
    winnerUid: null,
    endReason: null,
    abandonTimeoutMs: 1234,
    createdAt: timestamp(1000),
    lastMoveAt,
  } as unknown as GameDoc;
}

describe('coreStateFromGame', () => {
  it('maps the latest move time and game timeout into core settings', () => {
    const state = coreStateFromGame(game(timestamp(2500)), {});

    expect(state.lastProgressAt).toBe(2500);
    expect(state.settings.abandonTimeoutMs).toBe(1234);
  });

  it('falls back to the creation time when the game has no last move', () => {
    const state = coreStateFromGame(game(null), {});

    expect(state.lastProgressAt).toBe(1000);
  });
});
