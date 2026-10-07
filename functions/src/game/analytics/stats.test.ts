import { describe, expect, it } from 'vitest';
import type { Shot } from '../engine';
import { EMPTY_MODE_STATS, gameEndRecord, lineFor, type GameEndRecord, type GameEndSource } from './contract';
import {
  applyRecordToHeadToHead,
  applyRecordToModeStats,
  applyRecordToPlayerStats,
  emptyModeStats,
  emptyPlayerStats,
  normalizeModeStats,
  normalizePlayerStats,
  statsBucket,
} from './stats';

const ts = (ms: number) => ({ toMillis: () => ms });
const shot = (row: number, col: number, result: Shot['result'], volley?: number): Shot =>
  ({ row, col, result, at: 0, ...(volley === undefined ? {} : { volley }) }) as unknown as Shot;

function source(overrides: Partial<GameEndSource> = {}): GameEndSource {
  return {
    mode: 'classic',
    status: 'finished',
    playerUids: ['alice', 'bob'],
    players: {
      alice: { username: 'Alice', sunkShips: ['destroyer'], shotsFired: 3, hits: 2 },
      bob: { username: 'Bob', sunkShips: ['carrier', 'destroyer'], shotsFired: 2, hits: 1 },
    },
    shots: { alice: [shot(0, 0, 'hit'), shot(0, 1, 'sunk'), shot(5, 5, 'miss')], bob: [shot(1, 1, 'hit'), shot(2, 2, 'miss')] },
    winnerUid: 'alice',
    endReason: 'all_sunk',
    startedAt: ts(1_000),
    finishedAt: ts(61_000),
    ...overrides,
  };
}

const record = (overrides: Partial<GameEndSource> = {}, gameId = 'g1'): GameEndRecord => gameEndRecord(gameId, source(overrides))!;
const line = (r: GameEndRecord, uid: string) => lineFor(r, uid)!;
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

describe('emptyModeStats', () => {
  it('is a deep copy of EMPTY_MODE_STATS', () => {
    const a = emptyModeStats();
    expect(a).toEqual(EMPTY_MODE_STATS);
    a.winsByReason.all_sunk = 5;
    a.lossesByReason.resign = 2;
    expect(EMPTY_MODE_STATS.winsByReason.all_sunk).toBe(0);
    expect(EMPTY_MODE_STATS.lossesByReason.resign).toBe(0);
  });
});

describe('applyRecordToModeStats', () => {
  it('counts a sink win, including turns to win', () => {
    const r = record();
    const s = applyRecordToModeStats(emptyModeStats(), line(r, 'alice'), r);
    expect(s).toMatchObject({ gamesPlayed: 1, wins: 1, losses: 0, shotsFired: 3, hits: 2, shipsLost: 1, shipsSunk: 2, sinkWins: 1, sinkWinTurns: 3 });
    expect(s.winsByReason).toEqual({ all_sunk: 1, resign: 0, timeout: 0 });
    expect(s.lossesByReason).toEqual({ all_sunk: 0, resign: 0, timeout: 0 });
  });

  it('counts a sink loss without touching sinkWins', () => {
    const r = record();
    const s = applyRecordToModeStats(emptyModeStats(), line(r, 'bob'), r);
    expect(s).toMatchObject({ gamesPlayed: 1, wins: 0, losses: 1, shotsFired: 2, hits: 1, shipsLost: 2, shipsSunk: 1, sinkWins: 0, sinkWinTurns: 0 });
    expect(s.lossesByReason).toEqual({ all_sunk: 1, resign: 0, timeout: 0 });
  });

  it('counts a resignation as a win and a loss, but not as a sink win', () => {
    const r = record({ endReason: 'resign' });
    const w = applyRecordToModeStats(emptyModeStats(), line(r, 'alice'), r);
    const l = applyRecordToModeStats(emptyModeStats(), line(r, 'bob'), r);
    expect(w).toMatchObject({ wins: 1, sinkWins: 0, sinkWinTurns: 0 });
    expect(w.winsByReason.resign).toBe(1);
    expect(l).toMatchObject({ losses: 1 });
    expect(l.lossesByReason.resign).toBe(1);
  });

  it('counts a timeout as a win and a loss, but not as a sink win', () => {
    const r = record({ endReason: 'timeout', winnerUid: 'bob' });
    const w = applyRecordToModeStats(emptyModeStats(), line(r, 'bob'), r);
    const l = applyRecordToModeStats(emptyModeStats(), line(r, 'alice'), r);
    expect(w).toMatchObject({ wins: 1, sinkWins: 0, sinkWinTurns: 0 });
    expect(w.winsByReason.timeout).toBe(1);
    expect(l.lossesByReason.timeout).toBe(1);
  });

  it('counts Salvo turns per volley', () => {
    const r = record({
      mode: 'salvo',
      shots: {
        alice: [shot(0, 0, 'hit', 1), shot(0, 1, 'miss', 1), shot(0, 2, 'sunk', 2), shot(3, 3, 'miss', 2), shot(4, 4, 'hit', 3)],
        bob: [shot(1, 1, 'miss', 1), shot(1, 2, 'miss', 1)],
      },
      players: {
        alice: { username: 'Alice', sunkShips: [] },
        bob: { username: 'Bob', sunkShips: ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'] },
      },
    });
    const s = applyRecordToModeStats(emptyModeStats(), line(r, 'alice'), r);
    expect(s).toMatchObject({ sinkWins: 1, sinkWinTurns: 3, shotsFired: 5, hits: 3, shipsSunk: 5, shipsLost: 0 });
  });

  it('counts Abilities ability turns alongside shots', () => {
    const r = record({
      mode: 'abilities',
      shots: { alice: [shot(0, 0, 'hit'), shot(0, 1, 'sunk')], bob: [shot(1, 1, 'miss')] },
      abilityLog: [
        { player: 'alice', turnNumber: 5, result: { abilityId: 'sonar' } },
        { player: 'bob', turnNumber: 6, result: { abilityId: 'airstrike' } },
      ] as unknown as GameEndSource['abilityLog'],
    });
    const s = applyRecordToModeStats(emptyModeStats(), line(r, 'alice'), r);
    expect(s.sinkWinTurns).toBe(3);
    const bob = applyRecordToModeStats(emptyModeStats(), line(r, 'bob'), r);
    expect(bob.sinkWinTurns).toBe(0);
  });

  it('accumulates onto existing stats', () => {
    const r1 = record();
    const r2 = record({ endReason: 'resign' }, 'g2');
    const s = applyRecordToModeStats(applyRecordToModeStats(emptyModeStats(), line(r1, 'alice'), r1), line(r2, 'alice'), r2);
    expect(s).toMatchObject({ gamesPlayed: 2, wins: 2, sinkWins: 1, sinkWinTurns: 3, shotsFired: 6 });
    expect(s.winsByReason).toEqual({ all_sunk: 1, resign: 1, timeout: 0 });
  });

  it('never mutates its inputs', () => {
    const r = deepFreeze(record());
    const stats = deepFreeze(emptyModeStats());
    expect(() => applyRecordToModeStats(stats, line(r, 'alice'), r)).not.toThrow();
    expect(stats).toEqual(EMPTY_MODE_STATS);
  });

  it('tolerates partial stored stats', () => {
    const r = record();
    const s = applyRecordToModeStats({ wins: 2 } as never, line(r, 'alice'), r);
    expect(s).toMatchObject({ wins: 3, gamesPlayed: 1 });
    expect(s.winsByReason.all_sunk).toBe(1);
  });
});

describe('normalize', () => {
  it('fills a missing doc with zeros for every mode and bucket', () => {
    const doc = normalizePlayerStats('u', undefined);
    expect(doc).toEqual(emptyPlayerStats('u'));
    expect(doc.pvp.salvo).toEqual(EMPTY_MODE_STATS);
    expect(doc.bot.abilities).toEqual(EMPTY_MODE_STATS);
  });

  it('drops non-numeric counters', () => {
    expect(normalizeModeStats({ wins: 'x' as never, winsByReason: { resign: 2 } as never })).toMatchObject({ wins: 0, winsByReason: { all_sunk: 0, resign: 2, timeout: 0 } });
  });
});

describe('statsBucket / applyRecordToPlayerStats', () => {
  it('puts human games in pvp, including unrated and guest games', () => {
    expect(statsBucket(record())).toBe('pvp');
    expect(statsBucket(record({ isRated: false }))).toBe('pvp');
    expect(statsBucket(record({ players: { alice: { username: 'A', sunkShips: [], isGuest: true }, bob: { username: 'B', sunkShips: [] } } }))).toBe('pvp');
  });

  it('puts computer games in bot', () => {
    const r = record({ isBotGame: true, playerUids: ['alice', 'bot-hard'], players: { alice: { username: 'A', sunkShips: [] }, 'bot-hard': { username: 'Admiral', sunkShips: [] } } });
    expect(statsBucket(r)).toBe('bot');
    const doc = applyRecordToPlayerStats(undefined, line(r, 'alice'), r, 99);
    expect(doc.bot.classic.wins).toBe(1);
    expect(doc.pvp.classic.gamesPlayed).toBe(0);
  });

  it('writes the record mode only and stamps updatedAtMs', () => {
    const r = record({ mode: 'salvo' });
    const before = deepFreeze(emptyPlayerStats('alice'));
    const doc = applyRecordToPlayerStats(before, line(r, 'alice'), r, 1234);
    expect(doc.uid).toBe('alice');
    expect(doc.updatedAtMs).toBe(1234);
    expect(doc.pvp.salvo.wins).toBe(1);
    expect(doc.pvp.classic.gamesPlayed).toBe(0);
    expect(doc.pvp.abilities.gamesPlayed).toBe(0);
    expect(before.pvp.salvo.wins).toBe(0);
  });
});

describe('applyRecordToHeadToHead', () => {
  it('starts a new doc with sorted players and usernames', () => {
    const r = record({ playerUids: ['bob', 'alice'] });
    const h = applyRecordToHeadToHead(undefined, r);
    expect(h).toEqual({
      playerUids: ['alice', 'bob'],
      usernames: { alice: 'Alice', bob: 'Bob' },
      gamesPlayed: 1,
      wins: { alice: 1, bob: 0 },
      winsByMode: { classic: { alice: 1, bob: 0 }, salvo: { alice: 0, bob: 0 }, abilities: { alice: 0, bob: 0 } },
      lastGameId: 'g1',
      lastWinnerUid: 'alice',
      lastPlayedAtMs: 61_000,
    });
  });

  it('accumulates a rematch chain and refreshes usernames', () => {
    const g1 = record();
    const g2 = record({
      mode: 'salvo',
      winnerUid: 'bob',
      endReason: 'resign',
      rematchOf: 'g1',
      finishedAt: ts(99_000),
      players: { alice: { username: 'Alice2', sunkShips: [] }, bob: { username: 'Bob', sunkShips: [] } },
    }, 'g2');
    const h1 = deepFreeze(applyRecordToHeadToHead(undefined, g1));
    const h2 = applyRecordToHeadToHead(h1, g2);
    expect(h2.gamesPlayed).toBe(2);
    expect(h2.wins).toEqual({ alice: 1, bob: 1 });
    expect(h2.winsByMode.classic).toEqual({ alice: 1, bob: 0 });
    expect(h2.winsByMode.salvo).toEqual({ alice: 0, bob: 1 });
    expect(h2.usernames).toEqual({ alice: 'Alice2', bob: 'Bob' });
    expect(h2).toMatchObject({ lastGameId: 'g2', lastWinnerUid: 'bob', lastPlayedAtMs: 99_000 });
    expect(h1.gamesPlayed).toBe(1);
  });

  it('keeps a stored username when the record has none', () => {
    const r = record({ players: { alice: { sunkShips: [] }, bob: { username: 'Bob', sunkShips: [] } } });
    const h = applyRecordToHeadToHead({ ...applyRecordToHeadToHead(undefined, record()), usernames: { alice: 'Old', bob: 'Bob' } }, r);
    expect(h.usernames.alice).toBe('Old');
  });

  it('counts timeouts and resignations as wins', () => {
    const h = applyRecordToHeadToHead(applyRecordToHeadToHead(undefined, record({ endReason: 'timeout' })), record({ endReason: 'resign' }, 'g2'));
    expect(h.wins.alice).toBe(2);
  });
});
