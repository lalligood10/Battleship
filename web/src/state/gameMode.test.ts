import { describe, expect, it } from 'vitest';
import { GAME_MODE_STORAGE_KEY, parseStoredGameMode } from './gameMode';

describe('stored game mode', () => {
  it('uses the Broadside game-mode key and accepts the two supported modes', () => {
    expect(GAME_MODE_STORAGE_KEY).toBe('broadside.gameMode');
    expect(parseStoredGameMode('classic')).toBe('classic');
    expect(parseStoredGameMode('salvo')).toBe('salvo');
  });

  it('defaults invalid or missing storage values to Classic', () => {
    expect(parseStoredGameMode(null)).toBe('classic');
    expect(parseStoredGameMode('')).toBe('classic');
    expect(parseStoredGameMode('abilities')).toBe('abilities');
  });
});
