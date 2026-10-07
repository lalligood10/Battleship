import { FEEL } from '../feel/config';
import type { FeelCue } from '../feel/cues';
import { hashSeed, seededRandom } from './random';

export interface ShakeSpec {
  amplitudePx: number;
  durationMs: number;
}

type ShakeConfig = { hitPx: number; sinkPx: number; ownSinkPx: number; durationMs: number; sinkDurationMs: number };

/** Hits shake lightly, sinks harder, losing your own ship hardest. Misses and reduced motion: none. */
export function shakeFor(cue: FeelCue, reducedMotion: boolean, config: ShakeConfig = FEEL.fx.shake): ShakeSpec | null {
  if (reducedMotion) return null;
  if (cue.type === 'impact' && cue.result === 'hit') return { amplitudePx: config.hitPx, durationMs: config.durationMs };
  if (cue.type === 'sink') {
    return { amplitudePx: cue.side === 'own' ? config.ownSinkPx : config.sinkPx, durationMs: config.sinkDurationMs };
  }
  return null;
}

/** Decaying jitter keyframes (transform only) for the Web Animations API. */
export function shakeKeyframes(amplitudePx: number, seedKey: string, steps = 8): Keyframe[] {
  const rand = seededRandom(hashSeed(`shake:${seedKey}`));
  const frames: Keyframe[] = [{ transform: 'translate3d(0, 0, 0)' }];
  for (let i = 1; i < steps; i++) {
    const decay = 1 - i / steps;
    const sign = i % 2 === 0 ? 1 : -1;
    const x = sign * amplitudePx * decay * (0.6 + rand() * 0.4);
    const y = (rand() * 2 - 1) * amplitudePx * decay * 0.6;
    frames.push({ transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)` });
  }
  frames.push({ transform: 'translate3d(0, 0, 0)' });
  return frames;
}
