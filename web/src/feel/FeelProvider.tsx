import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { FeelCue } from './cues';
import type { FeelDirector } from './director';

const FeelContext = createContext<FeelDirector | null>(null);

export function FeelProvider({ director, children }: { director: FeelDirector; children: ReactNode }) {
  return <FeelContext.Provider value={director}>{children}</FeelContext.Provider>;
}

export function useFeelDirector(): FeelDirector {
  const director = useContext(FeelContext);
  if (!director) throw new Error('Feel hooks must be used inside FeelProvider');
  return director;
}

export function useFeelCue(listener: (cue: FeelCue) => void): void {
  const director = useFeelDirector();
  const listenerRef = useRef(listener);

  useEffect(() => {
    listenerRef.current = listener;
  }, [listener]);
  useEffect(() => director.subscribe((cue) => listenerRef.current(cue)), [director]);
}

export function useRevealed(): { target: number; own: number } {
  const director = useFeelDirector();
  const subscribe = useCallback((onStoreChange: () => void) => director.onChange(onStoreChange), [director]);
  const getSnapshot = useCallback(() => director.revealed(), [director]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFeelSettled(): boolean {
  const director = useFeelDirector();
  const subscribe = useCallback((onStoreChange: () => void) => director.onChange(onStoreChange), [director]);
  const getSnapshot = useCallback(() => director.settled(), [director]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
