import { afterEach, describe, expect, it, vi } from 'vitest';
import { gameEvents } from '../game/events';
import { clearPlaytestRecords, isPlaytestEnabled, loadPlaytestRecords, savePlaytestRecord } from './storage';
import { startGameAnalytics } from './index';
import type { PlaytestRecord } from './types';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function record(gameId: string, overrides: Partial<PlaytestRecord> = {}): PlaytestRecord {
  return {
    version: 1,
    gameId,
    mode: 'classic',
    myUid: 'one',
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
    turns: 1,
    winner: 'one',
    endReason: 'all_sunk',
    winnerShipsRemaining: 5,
    shotsByPlayer: {},
    abilities: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('playtest storage', () => {
  it('replaces records with the same gameId', () => {
    const storage = new MemoryStorage();
    savePlaytestRecord(record('same', { turns: 1 }), storage);
    savePlaytestRecord(record('other'), storage);
    savePlaytestRecord(record('same', { turns: 3 }), storage);

    expect(loadPlaytestRecords(storage).map(({ gameId, turns }) => [gameId, turns])).toEqual([
      ['other', 1],
      ['same', 3],
    ]);
  });

  it('keeps only the newest 500 records', () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 501; index++) savePlaytestRecord(record(`game-${index}`), storage);

    const records = loadPlaytestRecords(storage);
    expect(records).toHaveLength(500);
    expect(records[0]?.gameId).toBe('game-1');
    expect(records.at(-1)?.gameId).toBe('game-500');
  });

  it('returns an empty list for corrupt or non-array JSON and filters malformed entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('broadside.playtest.v1', '{');
    expect(loadPlaytestRecords(storage)).toEqual([]);

    storage.setItem('broadside.playtest.v1', JSON.stringify([
      record('valid'),
      { gameId: 3, mode: 'classic' },
      { gameId: 'unsupported-mode', mode: 'other' },
      null,
    ]));
    expect(loadPlaytestRecords(storage)).toEqual([record('valid')]);

    storage.setItem('broadside.playtest.v1', JSON.stringify({ gameId: 'not-an-array' }));
    expect(loadPlaytestRecords(storage)).toEqual([]);
  });

  it('swallows storage errors and handles null storage', () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('storage unavailable');
      },
    };
    expect(() => savePlaytestRecord(record('game'), throwingStorage)).not.toThrow();
    expect(() => clearPlaytestRecords(throwingStorage)).not.toThrow();
    expect(loadPlaytestRecords(null)).toEqual([]);
    expect(() => savePlaytestRecord(record('game'), null)).not.toThrow();
    expect(() => clearPlaytestRecords(null)).not.toThrow();
  });

  it('clears stored records', () => {
    const storage = new MemoryStorage();
    savePlaytestRecord(record('game'), storage);
    clearPlaytestRecords(storage);
    expect(loadPlaytestRecords(storage)).toEqual([]);
  });

  it('enables playtest analytics from the explicit storage flag', () => {
    vi.stubEnv('DEV', false);
    const storage = new MemoryStorage();
    expect(import.meta.env.DEV).toBe(false);
    expect(isPlaytestEnabled(storage)).toBe(false);
    storage.setItem('broadside.playtest.enabled', '1');
    expect(isPlaytestEnabled(storage)).toBe(true);
  });

  it('gates game analytics in production unless the flag is enabled', () => {
    vi.stubEnv('DEV', false);
    expect(import.meta.env.DEV).toBe(false);
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    startGameAnalytics({ gameId: 'disabled', mode: 'classic', myUid: 'one', startedAt: 1 });
    gameEvents.emit([{ type: 'gameOver', winner: 'one', reason: 'resign' }]);
    expect(loadPlaytestRecords(storage)).toEqual([]);

    storage.setItem('broadside.playtest.enabled', '1');
    startGameAnalytics({ gameId: 'enabled', mode: 'classic', myUid: 'one', startedAt: 1 });
    gameEvents.emit([
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 0 }, turnNumber: 1 },
      { type: 'gameOver', winner: 'one', reason: 'all_sunk' },
    ]);
    expect(loadPlaytestRecords(storage).map(({ gameId }) => gameId)).toEqual(['enabled']);
  });
});
