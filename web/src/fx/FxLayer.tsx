import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
  const [strikes, setStrikes] = useState<ActiveStrike[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((shotKey?: string) => {
    if (shotKey) {
      const timer = timers.current.get(shotKey);
      if (timer) clearTimeout(timer);
      timers.current.delete(shotKey);
      return;
    }
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);

  const holdFor = useCallback(
    (shotKey: string, ms: number) => {
      const existing = timers.current.get(shotKey);
      if (existing) clearTimeout(existing);
      timers.current.set(shotKey, setTimeout(() => {
        setStrikes((current) => current.filter((strike) => strike.shotKey !== shotKey));
        timers.current.delete(shotKey);
      }, ms));
    },
    [],
  );

  useFeelCue((cue) => {
    if (cue.type === 'gameOver' || cue.side !== side) return;
    if (cue.type === 'abilityUsed') return;
    if (cue.type === 'windup') {
      clearTimer();
      const targets = cue.targets ?? [cue.target];
      setStrikes(
        targets.map((target, index) => ({
          shotKey: index === 0 ? cue.shotKey : `${cue.shotKey}#${index}`,
          target,
          phase: 'inbound',
          bursts: [],
        })),
      );
      return;
    }
    if (cue.type === 'cancel') {
      clearTimer(cue.shotKey);
      setStrikes((current) =>
        current.filter((strike) => strike.shotKey !== cue.shotKey && !strike.shotKey.startsWith(`${cue.shotKey}#`)),
      );
      return;
    }
    if (cue.type === 'impact') {
      const phase = impactPhase(cue);
      const bursts: ParticleBurst[] =
        cue.result === 'hit' && phase !== 'sunk' ? [{ id: `${cue.shotKey}:hit`, kind: 'hit', ...cellCentre(cue.target), delayMs: 0 }] : [];
      setStrikes((current) => {
        const index = current.findIndex(
          (strike) =>
            strike.shotKey === cue.shotKey ||
            (strike.phase === 'inbound' && strike.target.row === cue.target.row && strike.target.col === cue.target.col),
        );
        const next = [...current];
        if (index >= 0) next.splice(index, 1);
        next.push({
          shotKey: cue.shotKey,
          target: cue.target,
          phase,
          ...(phase === 'sunk' && cue.sunk ? { sunkPlacement: cue.sunk.placement } : {}),
          bursts,
        });
        return next;
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
    setStrikes((current) => {
      const active = current.find((strike) => strike.shotKey === cue.shotKey);
      return [
        ...current.filter((strike) => strike.shotKey !== cue.shotKey),
        {
          shotKey: cue.shotKey,
          target: cue.target,
          phase: 'sunk',
          sunkPlacement: cue.sunk.placement,
          bursts: [...(active?.bursts ?? []), burst],
        },
      ];
    });
    holdFor(cue.shotKey, strikeHoldMs(cue));
  });

  const carrierActive = strikes.some((strike) => strike.phase === 'sunk' && strike.sunkPlacement?.type === 'carrier');
  useEffect(() => {
    if (!carrierActive) return;
    const skip = () => {
      for (const strike of strikes) {
        if (strike.sunkPlacement?.type === 'carrier') clearTimer(strike.shotKey);
      }
      setStrikes((current) => current.filter((strike) => strike.sunkPlacement?.type !== 'carrier'));
    };
    document.addEventListener('pointerdown', skip);
    return () => document.removeEventListener('pointerdown', skip);
  }, [carrierActive, clearTimer, strikes]);

  useEffect(() => clearTimer, [clearTimer]);

  if (strikes.length === 0) return null;
  return (
    <>
      {strikes.map((strike) => (
        <Fragment key={strike.shotKey}>
          <StrikeOverlay
            target={strike.target}
            phase={strike.phase}
            from={side === 'own' ? 'right' : 'left'}
            sunkPlacement={strike.sunkPlacement}
          />
          {strike.bursts.map((b) => (
            <Particles key={b.id} kind={b.kind} seedKey={b.id} x={b.x} y={b.y} delayMs={b.delayMs} />
          ))}
        </Fragment>
      ))}
    </>
  );
}
