import { useCallback, useState } from 'react';
import { parseGameModeInput, type GameMode } from '@shared/core/schema';

export const GAME_MODE_STORAGE_KEY = 'broadside.gameMode';

export function parseStoredGameMode(value: string | null): GameMode {
  return parseGameModeInput(value) ?? 'classic';
}

function storedGameMode(): GameMode {
  try {
    return typeof localStorage === 'undefined' ? 'classic' : parseStoredGameMode(localStorage.getItem(GAME_MODE_STORAGE_KEY));
  } catch {
    return 'classic';
  }
}

export function useGameMode(): [GameMode, (mode: GameMode) => void] {
  const [mode, setMode] = useState<GameMode>(storedGameMode);
  const selectMode = useCallback((nextMode: GameMode) => {
    setMode(nextMode);
    try {
      localStorage.setItem(GAME_MODE_STORAGE_KEY, nextMode);
    } catch {
      // The current selection remains usable when storage is unavailable.
    }
  }, []);
  return [mode, selectMode];
}
