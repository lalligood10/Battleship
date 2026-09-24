import { describe, expect, it } from 'vitest';
import { gameRowStatus, opponentAvatar, type Game } from './types';

const base: Game = {
  id: 'g1',
  code: 'ABC234',
  status: 'active',
  hostUid: 'me',
  playerUids: ['me', 'bob'],
  players: {
    me: { username: 'Me', rating: 1000, ready: true, sunkShips: [], shotsFired: 0, hits: 0 },
    bob: { username: 'Bob', rating: 1000, ready: true, sunkShips: [], shotsFired: 0, hits: 0 },
  },
  shots: {},
  currentTurnUid: 'me',
  turnNumber: 1,
  winnerUid: null,
  endReason: null,
  ratingChanges: null,
  revealedFleets: null,
  isQuickMatch: false,
  isBotGame: false,
  botDifficulty: null,
  abandonTimeoutMs: 0,
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  finishedAt: null,
  lastMoveAt: null,
};

const botGame: Game = {
  ...base,
  playerUids: ['me', 'bot-officer'],
  players: {
    me: base.players['me']!,
    'bot-officer': { username: 'Officer Bot', rating: 1000, ready: true, sunkShips: [], shotsFired: 0, hits: 0 },
  },
  isBotGame: true,
  botDifficulty: 'medium',
};

describe('game list helpers', () => {
  it('uses the AI avatar and a Computer turn label for bot games', () => {
    expect(opponentAvatar(botGame, 'me')).toBe('AI');
    expect(gameRowStatus({ ...botGame, currentTurnUid: 'bot-officer' }, 'me')).toBe("Computer's turn");
    expect(gameRowStatus(botGame, 'me')).toBe('Your turn');
  });

  it('keeps initials and opponent wording for human games', () => {
    expect(opponentAvatar(base, 'me')).toBe('B');
    expect(gameRowStatus({ ...base, currentTurnUid: 'bob' }, 'me')).toBe("Opponent's turn");
    expect(gameRowStatus(base, 'me')).toBe('Your turn');
    expect(gameRowStatus({ ...base, status: 'waiting' }, 'me')).toBe('Waiting for a friend · code ABC234');
    expect(gameRowStatus({ ...base, status: 'placing', players: { ...base.players, me: { ...base.players['me']!, ready: false } } }, 'me')).toBe(
      'Place your ships',
    );
  });
});
