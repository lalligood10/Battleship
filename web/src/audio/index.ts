import { play } from '../lib/sound';
import type { FeelCue } from '../feel/cues';

export interface AudioEngine {
  unlock(): void;
  handle(cue: FeelCue): void;
  dispose(): void;
}

export function createAudioEngine(): AudioEngine {
  return {
    unlock: () => undefined,
    handle(cue) {
      if (cue.type === 'impact') {
        if (cue.sunk) play(cue.sunk.shipId === 'carrier' ? 'bomb' : 'sunk');
        else play(cue.result);
      } else if (cue.type === 'gameOver') {
        play(cue.won ? 'win' : 'lose');
      }
    },
    dispose: () => undefined,
  };
}
