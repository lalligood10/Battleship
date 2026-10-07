import { useEffect } from 'react';
import { audioManager } from './manager';

/** Wants the ambient ocean loop while mounted; unmount fades it out. */
export function useAmbientOcean(): void {
  useEffect(() => {
    audioManager.setAmbientWanted(true);
    return () => audioManager.setAmbientWanted(false);
  }, []);
}
