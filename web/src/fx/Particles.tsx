import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { prefersReducedMotion } from './motion';
import { particleVectors, particlesLifetimeMs, type ParticleKind } from './particles';

/**
 * Debris / spray burst centred at (x%, y%) of the board overlay. Sizes use the board's --cell,
 * and the burst removes itself once its longest particle has finished.
 */
export function Particles({ kind, seedKey, x, y, delayMs = 0 }: { kind: ParticleKind; seedKey: string; x: number; y: number; delayMs?: number }) {
  const particles = useMemo(() => particleVectors(kind, seedKey, prefersReducedMotion()), [kind, seedKey]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (particles.length === 0) return;
    const t = setTimeout(() => setDone(true), particlesLifetimeMs(particles, delayMs) + 50);
    return () => clearTimeout(t);
  }, [particles, delayMs]);

  if (done || particles.length === 0) return null;
  return (
    <div className={`fx-particles fx-particles--${kind}`} style={{ left: `${x}%`, top: `${y}%` }}>
      {particles.map((p, i) => (
        <span
          key={i}
          className={`fx-particle fx-particle--t${p.tone}`}
          style={
            {
              '--dx': p.dx,
              '--dy': p.dy,
              '--s': p.size,
              '--r': `${p.rotate}deg`,
              animationDelay: `${p.delayMs + delayMs}ms`,
              animationDuration: `${p.durationMs}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
