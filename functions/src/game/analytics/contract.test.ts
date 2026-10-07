import { describe, expect, it } from 'vitest';
import { validateFleet, type Shot } from '../engine';
import { dailyDateKey, dailyFleet, gameEndRecord, headToHeadId, lineFor, type GameEndSource } from './contract';

const ts = (ms: number) => ({ toMillis: () => ms });
const shot = (row: number, col: number, result: Shot['result']): Shot => ({ row, col, result, at: 0 } as unknown as Shot);

function finished(overrides: Partial<GameEndSource> = {}): GameEndSource {
  return {
    mode: 'classic',
    status: 'finished',
    playerUids: ['alice', 'bob'],
    players: {
      alice: { username: 'Alice', sunkShips: ['destroyer'], shotsFired: 3, hits: 2 },
      bob: { username: 'Bob', isGuest: true, sunkShips: ['carrier', 'destroyer'], shotsFired: 2, hits: 1 },
    },
    shots: { alice: [shot(0, 0, 'hit'), shot(0, 1, 'sunk'), shot(5, 5, 'miss')], bob: [shot(1, 1, 'hit'), shot(2, 2, 'miss')] },
    winnerUid: 'alice',
    endReason: 'resign',
    startedAt: ts(1_000),
    finishedAt: ts(61_000),
    rematchOf: 'g0',
    ...overrides,
  };
}

describe('gameEndRecord', () => {
  it('builds both player lines', () => {
    const r = gameEndRecord('g1', finished())!;
    expect(r.winner).toBe('alice');
    expect(r.loser).toBe('bob');
    expect(r.isRated).toBe(true);
    expect(r.rematchOf).toBe('g0');
    expect(lineFor(r, 'alice')).toEqual({
      uid: 'alice', username: 'Alice', isBot: false, isGuest: false, won: true,
      turns: 3, shotsFired: 3, hits: 2, shipsLost: 1, shipsSunk: 2,
    });
    expect(lineFor(r, 'bob')).toMatchObject({ isGuest: true, won: false, turns: 2, shipsLost: 2, shipsSunk: 1 });
  });

  it('is null for games that did not finish with a winner', () => {
    expect(gameEndRecord('g', finished({ status: 'cancelled' }))).toBeNull();
    expect(gameEndRecord('g', finished({ winnerUid: null }))).toBeNull();
    expect(gameEndRecord('g', finished({ startedAt: null }))).toBeNull();
  });

  it('marks bot games unrated and flags the bot line', () => {
    const r = gameEndRecord('g', finished({
      playerUids: ['alice', 'bot-hard'], isBotGame: true, botDifficulty: 'hard',
      players: { alice: { sunkShips: [] }, 'bot-hard': { sunkShips: [] } }, shots: {},
    }))!;
    expect(r.isRated).toBe(false);
    expect(r.botDifficulty).toBe('hard');
    expect(lineFor(r, 'bot-hard')!.isBot).toBe(true);
  });

  it('respects isRated false for unrated human games', () => {
    expect(gameEndRecord('g', finished({ isRated: false }))!.isRated).toBe(false);
  });
});

describe('headToHeadId', () => {
  it('is order independent', () => {
    expect(headToHeadId('b', 'a')).toBe(headToHeadId('a', 'b'));
  });
});

describe('daily challenge', () => {
  it('uses the UTC calendar day', () => {
    expect(dailyDateKey(Date.UTC(2026, 9, 7, 23, 59, 59))).toBe('2026-10-07');
    expect(dailyDateKey(Date.UTC(2026, 9, 8, 0, 0, 0))).toBe('2026-10-08');
  });

  it('gives everyone the same legal fleet for a seed and day', () => {
    const a = dailyFleet(42, '2026-10-07');
    expect(dailyFleet(42, '2026-10-07')).toEqual(a);
    expect(dailyFleet(42, '2026-10-08')).not.toEqual(a);
    expect(validateFleet(a).ok).toBe(true);
  });
});
