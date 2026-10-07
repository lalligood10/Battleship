import { gameEvents } from '../game/events';
import type { GameMode } from '@shared/core/schema';
import { createGameRecorder } from './recorder';
import { clearPlaytestRecords as clearStoredRecords, isPlaytestEnabled, loadPlaytestRecords as loadStoredRecords, savePlaytestRecord } from './storage';
import { summarizeByMode as summarizeRecords } from './summary';
import type { ModeSummary, PlaytestRecord } from './types';

export type * from './types';
export { savePlaytestRecord };

const noop = () => {};

export function startGameAnalytics(input: {
  gameId: string;
  mode: GameMode;
  myUid: string;
  startedAt: number;
}): () => void {
  try {
    if (!isPlaytestEnabled()) return noop;
    return createGameRecorder(input, { bus: gameEvents, now: Date.now, onComplete: savePlaytestRecord });
  } catch {
    return noop;
  }
}

export function loadPlaytestRecords(): PlaytestRecord[] {
  return loadStoredRecords();
}

export function summarizeByMode(records: PlaytestRecord[]): Record<GameMode, ModeSummary> {
  return summarizeRecords(records);
}

export function clearPlaytestRecords(): void {
  clearStoredRecords();
}
