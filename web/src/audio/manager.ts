import { FEEL } from '../feel/config';
import { isMuted, subscribeMuted } from './mute';
import { playSound, startOcean, type OceanVoice, type SoundName, type Voice } from './synth';

export interface AudioManagerDeps {
  createContext?: () => AudioContext;
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  muteStore?: { isMuted(): boolean; subscribe(listener: () => void): () => void };
}

export interface AudioManager {
  unlock(): void;
  isUnlocked(): boolean;
  play(name: SoundName): Voice | null;
  setAmbientWanted(wanted: boolean): void;
  dispose(): void;
}

export function createAudioManager(deps: AudioManagerDeps = {}): AudioManager {
  const createContext =
    deps.createContext ??
    (() => {
      const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('AudioContext unavailable');
      return new Ctor();
    });
  const doc = deps.doc === undefined ? (globalThis.document ?? null) : deps.doc;
  const muteStore = deps.muteStore ?? { isMuted, subscribe: subscribeMuted };

  let ctx: AudioContext | null = null;
  let failed = false;
  let master: GainNode | null = null;
  let wanted = false;
  let ocean: OceanVoice | null = null;
  let visibilityBound = false;
  let disposed = false;

  const onVisibility = () => updateAmbient();
  const unsubscribeMute = muteStore.subscribe(() => {
    try {
      if (muteStore.isMuted()) {
        if (master && ctx) {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setValueAtTime(0, ctx.currentTime);
        }
        stopAmbient(0);
      } else {
        if (master && ctx) {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setValueAtTime(FEEL.audio.masterVolume, ctx.currentTime);
        }
        updateAmbient();
      }
    } catch {
      // Never let mute propagation throw.
    }
  });

  function bindVisibility(): void {
    if (visibilityBound || !doc) return;
    visibilityBound = true;
    doc.addEventListener('visibilitychange', onVisibility);
  }

  function stopAmbient(fadeMs: number): void {
    const current = ocean;
    ocean = null;
    current?.stop(fadeMs);
  }

  function updateAmbient(): void {
    try {
      const shouldPlay = wanted && ctx !== null && !muteStore.isMuted() && !(doc?.hidden ?? false);
      if (shouldPlay && !ocean && ctx && master) {
        ocean = startOcean(ctx, master, FEEL.audio.ambientVolume);
      } else if (!shouldPlay && ocean) {
        stopAmbient(muteStore.isMuted() || ctx === null ? 0 : 300);
      }
    } catch {
      ocean = null;
    }
  }

  return {
    unlock() {
      try {
        if (disposed || failed) return;
        if (!ctx) {
          ctx = createContext();
          if (!ctx) {
            failed = true;
            return;
          }
          master = ctx.createGain();
          master.gain.value = muteStore.isMuted() ? 0 : FEEL.audio.masterVolume;
          master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') {
          const p = ctx.resume();
          void Promise.resolve(p).then(() => updateAmbient()).catch(() => undefined);
        } else {
          updateAmbient();
        }
      } catch {
        if (!ctx) failed = true;
      }
    },

    isUnlocked() {
      return ctx !== null;
    },

    play(name: SoundName): Voice | null {
      try {
        if (!ctx || !master || muteStore.isMuted()) return null;
        return playSound(name, ctx, master, ctx.currentTime);
      } catch {
        return null;
      }
    },

    setAmbientWanted(w: boolean) {
      try {
        if (w) bindVisibility();
        wanted = w;
        updateAmbient();
      } catch {
        // Best-effort.
      }
    },

    dispose() {
      try {
        disposed = true;
        unsubscribeMute();
        if (visibilityBound && doc) doc.removeEventListener('visibilitychange', onVisibility);
        stopAmbient(0);
        if (ctx && ctx.state !== 'closed') void ctx.close?.();
      } catch {
        // Best-effort.
      } finally {
        ctx = null;
        master = null;
      }
    },
  };
}

export const audioManager: AudioManager = createAudioManager();

let unlockInstalled = false;
export function installAudioUnlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = globalThis.window ?? null): void {
  if (unlockInstalled || !target) return;
  unlockInstalled = true;
  const unlock = () => {
    audioManager.unlock();
    target.removeEventListener('pointerdown', unlock, true);
    target.removeEventListener('keydown', unlock, true);
  };
  target.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  target.addEventListener('keydown', unlock, { capture: true, passive: true });
}
