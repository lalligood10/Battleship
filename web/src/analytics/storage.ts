import type { PlaytestRecord } from './types';

const RECORDS_KEY = 'broadside.playtest.v1';
const ENABLED_KEY = 'broadside.playtest.enabled';

type PlaytestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function safeLocalStorage(): PlaytestStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function loadPlaytestRecords(storage: PlaytestStorage | null = safeLocalStorage()): PlaytestRecord[] {
  try {
    if (!storage) return [];
    const records: unknown = JSON.parse(storage.getItem(RECORDS_KEY) ?? 'null');
    if (!Array.isArray(records)) return [];
    return records.filter(
      (record): record is PlaytestRecord =>
        typeof record === 'object' &&
        record !== null &&
        typeof record.gameId === 'string' &&
        (record.mode === 'classic' || record.mode === 'salvo' || record.mode === 'abilities'),
    );
  } catch {
    return [];
  }
}

export function savePlaytestRecord(
  record: PlaytestRecord,
  storage: PlaytestStorage | null = safeLocalStorage(),
): void {
  try {
    if (!storage) return;
    const records = loadPlaytestRecords(storage).filter((existing) => existing.gameId !== record.gameId);
    records.push(record);
    storage.setItem(RECORDS_KEY, JSON.stringify(records.slice(-500)));
  } catch {
    // Storage is best-effort for playtest analytics.
  }
}

export function clearPlaytestRecords(storage: PlaytestStorage | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(RECORDS_KEY);
  } catch {
    // Storage is best-effort for playtest analytics.
  }
}

export function isPlaytestEnabled(storage: PlaytestStorage | null = safeLocalStorage()): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return storage?.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}
