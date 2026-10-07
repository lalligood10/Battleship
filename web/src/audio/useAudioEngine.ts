import { useEffect } from 'react';
import { useFeelDirector } from '../feel/FeelProvider';
import { createAudioEngine } from './index';

export function useAudioEngine(): void {
  const director = useFeelDirector();

  useEffect(() => {
    const engine = createAudioEngine();
    const unsubscribe = director.subscribe((cue) => engine.handle(cue));
    return () => {
      unsubscribe();
      engine.dispose();
    };
  }, [director]);
}
