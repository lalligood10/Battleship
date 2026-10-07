import { FEEL } from '../feel/config';
import { hashSeed, seededRandom } from './random';

export type ParticleKind = 'hit' | 'sink';

/** One debris/spray chip. Distances and size are in board-cell units. */
export interface Particle {
  dx: number;
  dy: number;
  size: number;
  rotate: number;
  delayMs: number;
  durationMs: number;
  /** 0 = ember, 1 = debris, 2 = spray. */
  tone: 0 | 1 | 2;
}

type ParticleConfig = { hit: number; sink: number; max: number; durationMs: number };

export function particleCount(kind: ParticleKind, reducedMotion: boolean, config: ParticleConfig = FEEL.fx.particles): number {
  if (reducedMotion) return 0;
  return Math.max(0, Math.min(config[kind], config.max));
}

export function particleVectors(
  kind: ParticleKind,
  seedKey: string,
  reducedMotion: boolean,
  config: ParticleConfig = FEEL.fx.particles,
): Particle[] {
  const count = particleCount(kind, reducedMotion, config);
  const rand = seededRandom(hashSeed(`${kind}:${seedKey}`));
  const [minDist, maxDist] = kind === 'sink' ? [0.8, 2.2] : [0.5, 1.3];
  const maxDelay = kind === 'sink' ? 120 : 60;
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ((i + rand() * 0.7) / count) * Math.PI * 2;
    const dist = minDist + rand() * (maxDist - minDist);
    const toneRoll = rand();
    const tone: Particle['tone'] = kind === 'sink' ? (toneRoll < 0.45 ? 2 : toneRoll < 0.75 ? 1 : 0) : toneRoll < 0.5 ? 0 : toneRoll < 0.85 ? 1 : 2;
    particles.push({
      dx: round(Math.cos(angle) * dist),
      dy: round(Math.sin(angle) * dist),
      size: round(0.12 + rand() * 0.12),
      rotate: Math.round(rand() * 540 - 270),
      delayMs: Math.round(rand() * maxDelay),
      durationMs: Math.round(config.durationMs * (0.65 + rand() * 0.35)),
      tone,
    });
  }
  return particles;
}

/** When the last particle finishes, so the burst can be removed from the DOM. */
export function particlesLifetimeMs(particles: readonly Particle[], extraDelayMs = 0): number {
  return particles.reduce((max, p) => Math.max(max, p.delayMs + p.durationMs), 0) + extraDelayMs;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
