import { describe, expect, it } from 'vitest';
import { GAME_MODE_OPTIONS } from '@shared/core/schema';
import { GAME_MODE_STORAGE_KEY, parseStoredGameMode } from './gameMode';

describe('stored game mode', () => {
  it('uses the Broadside game-mode key and accepts every supported mode', () => {
    expect(GAME_MODE_STORAGE_KEY).toBe('broadside.gameMode');
    expect(parseStoredGameMode('classic')).toBe('classic');
    expect(parseStoredGameMode('salvo')).toBe('salvo');
    expect(parseStoredGameMode('abilities')).toBe('abilities');
  });

  it('defaults invalid or missing storage values to Classic', () => {
    expect(parseStoredGameMode(null)).toBe('classic');
    expect(parseStoredGameMode('')).toBe('classic');
    expect(parseStoredGameMode('Salvo')).toBe('classic');
    expect(parseStoredGameMode('bogus')).toBe('classic');
  });
});

describe('game mode options', () => {
  it('lists Classic, Salvo and Abilities in order with description and how-to-play copy', () => {
    expect(GAME_MODE_OPTIONS.map((option) => option.mode)).toEqual(['classic', 'salvo', 'abilities']);
    for (const option of GAME_MODE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.description.length).toBeGreaterThan(0);
      expect(option.howToPlay.length).toBeGreaterThan(0);
    }
  });

  it('round-trips every option mode through storage parsing', () => {
    for (const option of GAME_MODE_OPTIONS) expect(parseStoredGameMode(option.mode)).toBe(option.mode);
  });
});
