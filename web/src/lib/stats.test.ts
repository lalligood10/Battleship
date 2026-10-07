import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_MODE_STATS, type HeadToHeadDoc } from '@shared/analytics/contract';

const getDocMock = vi.hoisted(() => vi.fn());
const docMock = vi.hoisted(() => vi.fn((_db: unknown, path: string) => ({ path })));
vi.mock('firebase/firestore', () => ({ doc: docMock, getDoc: getDocMock }));
vi.mock('./firebase', () => ({ db: () => ({}) }));

const {
  bucketHasGames,
  formatAccuracy,
  formatAvgTurnsToWin,
  formatHeadToHead,
  formatWinLoss,
  formatWinRate,
  getHeadToHead,
  getPlayerStats,
  headToHeadScore,
  headToHeadStanding,
} = await import('./stats');

const h2h: HeadToHeadDoc = {
  playerUids: ['alice', 'bob'],
  usernames: { alice: 'Alice', bob: 'Bob' },
  gamesPlayed: 5,
  wins: { alice: 3, bob: 2 },
  winsByMode: { classic: { alice: 2, bob: 0 }, salvo: { alice: 1, bob: 2 }, abilities: { alice: 0, bob: 0 } },
  lastGameId: 'g5',
  lastWinnerUid: 'alice',
  lastPlayedAtMs: 1,
};

beforeEach(() => {
  getDocMock.mockReset();
  docMock.mockClear();
});

describe('formatters', () => {
  it('formats win rate and accuracy, with a dash when there is nothing to divide', () => {
    expect(formatWinRate({ wins: 2, gamesPlayed: 3 })).toBe('67%');
    expect(formatWinRate({ wins: 0, gamesPlayed: 0 })).toBe('—');
    expect(formatAccuracy({ hits: 17, shotsFired: 40 })).toBe('43%');
    expect(formatAccuracy({ hits: 0, shotsFired: 0 })).toBe('—');
  });

  it('averages turns over fleet-sinking wins only', () => {
    expect(formatAvgTurnsToWin({ sinkWins: 0, sinkWinTurns: 0 })).toBe('—');
    expect(formatAvgTurnsToWin({ sinkWins: 2, sinkWinTurns: 85 })).toBe('42.5');
    expect(formatAvgTurnsToWin({ sinkWins: 3, sinkWinTurns: 120 })).toBe('40');
  });

  it('formats W–L', () => {
    expect(formatWinLoss({ wins: 3, losses: 2 })).toBe('3–2');
  });

  it('formats head-to-head from my point of view', () => {
    expect(formatHeadToHead(h2h, 'alice')).toBe('You 3–2');
    expect(formatHeadToHead(h2h, 'bob')).toBe('You 2–3');
    expect(formatHeadToHead(h2h, 'bob', 'salvo')).toBe('You 2–1');
    expect(formatHeadToHead(null, 'alice')).toBe('You 0–0');
    expect(headToHeadScore(h2h, 'alice', 'abilities')).toEqual({ mine: 0, theirs: 0 });
  });

  it('spells out the standing', () => {
    expect(headToHeadStanding({ mine: 3, theirs: 2 })).toBe('lead');
    expect(headToHeadStanding({ mine: 1, theirs: 2 })).toBe('trail');
    expect(headToHeadStanding({ mine: 2, theirs: 2 })).toBe('level');
  });

  it('detects an empty bucket', () => {
    const empty = { classic: EMPTY_MODE_STATS, salvo: EMPTY_MODE_STATS, abilities: EMPTY_MODE_STATS };
    expect(bucketHasGames(empty)).toBe(false);
    expect(bucketHasGames(undefined)).toBe(false);
    expect(bucketHasGames({ ...empty, salvo: { ...EMPTY_MODE_STATS, gamesPlayed: 1 } })).toBe(true);
  });
});

describe('Firestore reads', () => {
  it('reads playerStats/{uid} and fills missing modes', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ pvp: { salvo: { wins: 2, gamesPlayed: 2 } } }) });
    const doc = await getPlayerStats('alice');
    expect(docMock).toHaveBeenCalledWith(expect.anything(), 'playerStats/alice');
    expect(doc?.pvp.salvo).toMatchObject({ wins: 2, gamesPlayed: 2, losses: 0 });
    expect(doc?.bot.classic).toEqual(EMPTY_MODE_STATS);
  });

  it('returns null when there is no stats doc', async () => {
    getDocMock.mockResolvedValue({ exists: () => false, data: () => undefined });
    expect(await getPlayerStats('alice')).toBeNull();
  });

  it('reads the sorted head-to-head path', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => h2h });
    expect(await getHeadToHead('bob', 'alice')).toEqual(h2h);
    expect(docMock).toHaveBeenCalledWith(expect.anything(), 'headToHead/alice__bob');
  });

  it('treats a rules denial (no doc yet) as no record, and rethrows other errors', async () => {
    getDocMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(await getHeadToHead('alice', 'bob')).toBeNull();
    getDocMock.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(getHeadToHead('alice', 'bob')).rejects.toThrow('offline');
  });
});
