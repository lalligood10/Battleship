import { describe, expect, it } from 'vitest';
import { FEEL } from '../feel/config';
import type { FeelCue } from '../feel/cues';
import { sinkBannerText } from './banner';
import { particleCount, particlesLifetimeMs, particleVectors } from './particles';
import { hashSeed, seededRandom } from './random';
import { shakeFor, shakeKeyframes } from './shake';
import { impactPhase, strikeHoldMs } from './strike';

const placement = { type: 'cruiser', row: 2, col: 3, horizontal: true } as const;
const carrier = { type: 'carrier', row: 0, col: 0, horizontal: false } as const;
const target = { row: 2, col: 4 };

describe('sinkBannerText', () => {
  it('names the ship from the shooter perspective', () => {
    expect(sinkBannerText('target', 'cruiser')).toBe('You sank their Cruiser');
    expect(sinkBannerText('own', 'carrier')).toBe('They sank your Carrier');
    expect(sinkBannerText('target', 'destroyer')).toBe('You sank their Destroyer');
  });
});

describe('particles', () => {
  it('uses the configured counts and caps them', () => {
    expect(particleCount('hit', false)).toBe(FEEL.fx.particles.hit);
    expect(particleCount('sink', false)).toBe(FEEL.fx.particles.sink);
    expect(particleCount('sink', false, { hit: 8, sink: 500, max: 24, durationMs: 800 })).toBe(24);
    expect(particleVectors('sink', 'k', false, { hit: 8, sink: 500, max: 24, durationMs: 800 })).toHaveLength(24);
  });

  it('emits none under reduced motion', () => {
    expect(particleCount('hit', true)).toBe(0);
    expect(particleVectors('sink', 'k', true)).toEqual([]);
    expect(particlesLifetimeMs([])).toBe(0);
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = particleVectors('hit', 'u1:3', false);
    expect(particleVectors('hit', 'u1:3', false)).toEqual(a);
    expect(particleVectors('hit', 'u1:4', false)).not.toEqual(a);
  });

  it('keeps vectors in range and the lifetime bounded', () => {
    for (const kind of ['hit', 'sink'] as const) {
      const ps = particleVectors(kind, 'x', false);
      for (const p of ps) {
        const dist = Math.hypot(p.dx, p.dy);
        expect(dist).toBeGreaterThan(0.4);
        expect(dist).toBeLessThan(2.3);
        expect(p.durationMs).toBeLessThanOrEqual(FEEL.fx.particles.durationMs);
      }
      const life = particlesLifetimeMs(ps, 100);
      expect(life).toBeGreaterThan(100);
      expect(life).toBeLessThanOrEqual(FEEL.fx.particles.durationMs + 120 + 100);
    }
  });
});

describe('seeded random', () => {
  it('is stable and in [0, 1)', () => {
    const r1 = seededRandom(hashSeed('abc'));
    const r2 = seededRandom(hashSeed('abc'));
    for (let i = 0; i < 50; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shakeFor', () => {
  const hit: FeelCue = { type: 'impact', side: 'target', shotKey: 'k', target, result: 'hit' };
  const miss: FeelCue = { type: 'impact', side: 'target', shotKey: 'k', target, result: 'miss' };
  const sinkTarget: FeelCue = { type: 'sink', side: 'target', shotKey: 'k', target, sunk: { shipId: 'cruiser', placement } };
  const sinkOwn: FeelCue = { ...sinkTarget, side: 'own' };

  it('scales amplitude by cue and side', () => {
    expect(shakeFor(hit, false)).toEqual({ amplitudePx: FEEL.fx.shake.hitPx, durationMs: FEEL.fx.shake.durationMs });
    expect(shakeFor({ ...hit, side: 'own' }, false)?.amplitudePx).toBe(FEEL.fx.shake.hitPx);
    expect(shakeFor(sinkTarget, false)?.amplitudePx).toBe(FEEL.fx.shake.sinkPx);
    expect(shakeFor(sinkOwn, false)?.amplitudePx).toBe(FEEL.fx.shake.ownSinkPx);
    expect(shakeFor(miss, false)).toBeNull();
    expect(shakeFor({ type: 'windup', side: 'target', shotKey: 'k', target }, false)).toBeNull();
    expect(shakeFor({ type: 'gameOver', won: true, reason: 'all_sunk' }, false)).toBeNull();
  });

  it('is zero under reduced motion', () => {
    for (const cue of [hit, sinkTarget, sinkOwn]) expect(shakeFor(cue, true)?.amplitudePx ?? 0).toBe(0);
  });

  it('builds decaying keyframes that start and end at rest', () => {
    const frames = shakeKeyframes(10, 'k');
    expect(frames[0]?.transform).toBe('translate3d(0, 0, 0)');
    expect(frames.at(-1)?.transform).toBe('translate3d(0, 0, 0)');
    const xs = frames.map((f) => Math.abs(Number(/translate3d\(([-\d.]+)px/.exec(String(f.transform))?.[1] ?? 0)));
    expect(Math.max(...xs)).toBeLessThanOrEqual(10);
    expect(xs[1]).toBeGreaterThan(xs.at(-2) ?? 0);
    expect(shakeKeyframes(10, 'k')).toEqual(frames);
  });
});

describe('strike phases', () => {
  const impact = (sunk?: 'cruiser' | 'carrier'): Extract<FeelCue, { type: 'impact' }> => ({
    type: 'impact',
    side: 'target',
    shotKey: 'k',
    target,
    result: sunk ? 'hit' : 'miss',
    ...(sunk ? { sunk: { shipId: sunk, placement: sunk === 'carrier' ? carrier : placement } } : {}),
  });

  it('shows the hit first and the carrier sequence immediately', () => {
    expect(impactPhase(impact())).toBe('miss');
    expect(impactPhase(impact('cruiser'))).toBe('hit');
    expect(impactPhase(impact('carrier'))).toBe('sunk');
  });

  it('holds as long as the director does', () => {
    const t = FEEL.timing;
    expect(strikeHoldMs(impact())).toBe(t.impactHoldMs);
    expect(strikeHoldMs(impact('cruiser'))).toBe(t.sinkDelayMs + t.sinkHoldMs);
    expect(strikeHoldMs(impact('carrier'))).toBe(t.sinkDelayMs + t.carrierSinkHoldMs);
    expect(strikeHoldMs({ type: 'sink', side: 'own', shotKey: 'k', target, sunk: { shipId: 'cruiser', placement } })).toBe(t.sinkHoldMs);
    expect(strikeHoldMs({ type: 'sink', side: 'own', shotKey: 'k', target, sunk: { shipId: 'carrier', placement: carrier } })).toBe(
      t.carrierSinkHoldMs,
    );
  });
});
