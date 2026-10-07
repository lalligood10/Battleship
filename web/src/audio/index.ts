import { FEEL } from '../feel/config';
import type { FeelCue } from '../feel/cues';
import { vibrate } from './haptics';
import { audioManager, type AudioManager } from './manager';
import { isMuted } from './mute';
import type { Voice } from './synth';

export interface AudioEngine {
  unlock(): void;
  handle(cue: FeelCue): void;
  dispose(): void;
}

export interface AudioEngineDeps {
  manager?: AudioManager;
  vibrate?: (pattern: readonly number[]) => void;
  isMuted?: () => boolean;
}

export function createAudioEngine(deps: AudioEngineDeps = {}): AudioEngine {
  const manager = deps.manager ?? audioManager;
  const buzz = deps.vibrate ?? vibrate;
  const muted = deps.isMuted ?? isMuted;
  let windupVoice: Voice | null = null;

  return {
    unlock() {
      manager.unlock();
    },

    handle(cue: FeelCue) {
      try {
        if (!manager.isUnlocked() || muted()) return;
        switch (cue.type) {
          case 'windup':
            windupVoice?.stop();
            windupVoice = manager.play('launch');
            break;
          case 'cancel':
            windupVoice?.stop();
            windupVoice = null;
            break;
          case 'impact': {
            windupVoice = null;
            if (cue.result === 'miss') {
              manager.play('splash');
            } else {
              manager.play(cue.sunk?.shipId === 'carrier' ? 'bomb' : 'explosion');
              if (cue.side === 'target') buzz(FEEL.haptics.hit);
            }
            break;
          }
          case 'sink':
            if (cue.side === 'own') {
              manager.play('sinkRumbleHeavy');
              buzz(FEEL.haptics.ownSink);
            } else {
              manager.play('sinkRumble');
              buzz(FEEL.haptics.sink);
            }
            break;
          case 'gameOver':
            manager.play(cue.won ? 'win' : 'lose');
            break;
        }
      } catch {
        // Audio is best-effort; never let it break the game.
      }
    },

    dispose() {
      try {
        windupVoice?.stop();
      } catch {
        // Best-effort.
      } finally {
        windupVoice = null;
      }
    },
  };
}
