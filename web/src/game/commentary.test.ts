import { describe, expect, it } from 'vitest';
import { commentaryForGame } from './commentary';
import type { Game } from '../lib/types';

function game(): Game {
  return {
    id: 'game-1',
    code: 'ABC234',
    status: 'active',
    hostUid: 'human',
    playerUids: ['human', 'bot-officer'],
    players: {},
    shots: {
      human: [
        { row: 0, col: 0, result: 'miss', at: 1 },
        { row: 0, col: 1, result: 'hit', at: 3 },
      ],
      'bot-officer': [{ row: 2, col: 2, result: 'sunk', sunkShip: 'destroyer', at: 2 }],
    },
    currentTurnUid: 'human',
    turnNumber: 3,
    winnerUid: null,
    endReason: null,
    ratingChanges: null,
    revealedFleets: null,
    isQuickMatch: false,
    isBotGame: true,
    botDifficulty: 'easy',
    abandonTimeoutMs: 1,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    lastMoveAt: null,
  };
}

describe('commentaryForGame', () => {
  it('builds chronological, context-aware bot commentary for both players shots', () => {
    const lines = commentaryForGame(game(), 'human');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.at)).toEqual([1, 2, 3]);
    expect(lines[0]!.text).toContain('mark');
    expect(lines[1]!.text.toLowerCase()).toContain('destroyer');
    expect(lines[2]!.text).toContain('steel');
  });

  it('returns no commentary for human games', () => {
    expect(commentaryForGame({ ...game(), isBotGame: false }, 'human')).toEqual([]);
  });
});
