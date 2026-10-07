import { useCallback, useEffect, useRef, useState } from 'react';
import { SHIP_LENGTHS } from '@shared/config';
import type { Coordinate, ShipPlacement } from '@shared/engine';
import { useFeelCue } from '../feel/FeelProvider';
import type { Side } from '../feel/cues';
import { StrikeOverlay, type StrikePhase } from '../components/art/StrikeOverlay';
import { Particles } from './Particles';
import type { ParticleKind } from './particles';
import { impactPhase, strikeHoldMs } from './strike';

/** Carrier debris waits for its bomb burst (see .carrier-burst in index.css). */
const CARRIER_BURST_DELAY_MS = 1050;

interface ParticleBurst {
  id: string;
  kind: ParticleKind;
  x: number;
  y: number;
  delayMs: number;
}

interface ActiveStrike {
  shotKey: string;
  target: Coordinate;
  phase: StrikePhase;
  sunkPlacement?: ShipPlacement;
  bursts: ParticleBurst[];
}

const cellCentre = (c: Coordinate) => ({ x: (c.col + 0.5) * 10, y: (c.row + 0.5) * 10 });

function shipCentre(p: ShipPlacement) {
  const len = SHIP_LENGTHS[p.type];
  return {
    x: (p.col + (p.horizontal ? len / 2 : 0.5)) * 10,
    y: (p.row + (p.horizontal ? 0.5 : len / 2)) * 10,
  };
}

export function FxLayer({ side }: { side: Side }) {
  const [strike, setStrike] = useState<ActiveStrike | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const holdFor = useCallback(
    (shotKey: string, ms: number) => {
      clearTimer();
      timer.current = setTimeout(() => {
        setStrike((current) => (current?.shotKey === shotKey ? null : current));
        timer.current = null;
      }, ms);
    },
    [clearTimer],
  );

  useFeelCue((cue) => {
    if (cue.type === 'gameOver' || cue.side !== side) return;
    if (cue.type === 'windup') {
      clearTimer();
      setStrike({ shotKey: cue.shotKey, target: cue.target, phase: 'inbound', bursts: [] });
      return;
    }
    if (cue.type === 'cancel') {
      clearTimer();
      setStrike(null);
      return;
    }
    if (cue.type === 'impact') {
      const phase = impactPhase(cue);
      const bursts: ParticleBurst[] =
        cue.result === 'hit' && phase !== 'sunk' ? [{ id: `${cue.shotKey}:hit`, kind: 'hit', ...cellCentre(cue.target), delayMs: 0 }] : [];
      setStrike({
        shotKey: cue.shotKey,
        target: cue.target,
        phase,
        ...(phase === 'sunk' && cue.sunk ? { sunkPlacement: cue.sunk.placement } : {}),
        bursts,
      });
      holdFor(cue.shotKey, strikeHoldMs(cue));
      return;
    }
    // sink
    const carrier = cue.sunk.shipId === 'carrier';
    const burst: ParticleBurst = {
      id: `${cue.shotKey}:sink`,
      kind: 'sink',
      ...shipCentre(cue.sunk.placement),
      delayMs: carrier ? Math.max(0, CARRIER_BURST_DELAY_MS - 250) : 0,
    };
    setStrike((current) => ({
      shotKey: cue.shotKey,
      target: cue.target,
      phase: 'sunk',
      sunkPlacement: cue.sunk.placement,
      bursts: [...(current?.shotKey === cue.shotKey ? current.bursts : []), burst],
    }));
    holdFor(cue.shotKey, strikeHoldMs(cue));
  });

  const carrierActive = strike?.phase === 'sunk' && strike.sunkPlacement?.type === 'carrier';
  useEffect(() => {
    if (!carrierActive) return;
    const skip = () => {
      clearTimer();
      setStrike(null);
    };
    document.addEventListener('pointerdown', skip);
    return () => document.removeEventListener('pointerdown', skip);
  }, [carrierActive, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  if (!strike) return null;
  return (
    <>
      <StrikeOverlay
        key={strike.shotKey}
        target={strike.target}
        phase={strike.phase}
        from={side === 'own' ? 'right' : 'left'}
        sunkPlacement={strike.sunkPlacement}
      />
      {strike.bursts.map((b) => (
        <Particles key={b.id} kind={b.kind} seedKey={b.id} x={b.x} y={b.y} delayMs={b.delayMs} />
      ))}
    </>
  );
}
