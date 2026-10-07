import { useCallback, useEffect, useRef, useState } from 'react';
import type { Coordinate, ShipPlacement } from '@shared/engine';
import { FEEL } from '../feel/config';
import { useFeelCue } from '../feel/FeelProvider';
import type { Side } from '../feel/cues';
import { StrikeOverlay, type StrikePhase } from '../components/art/StrikeOverlay';

interface ActiveStrike {
  shotKey: string;
  target: Coordinate;
  phase: StrikePhase;
  sunkPlacement?: ShipPlacement;
}

export function FxLayer({ side }: { side: Side }) {
  const [strike, setStrike] = useState<ActiveStrike | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useFeelCue((cue) => {
    if (cue.type === 'windup' && cue.side === side) {
      clearTimer();
      setStrike({ shotKey: cue.shotKey, target: cue.target, phase: 'inbound' });
      return;
    }
    if (cue.type === 'cancel' && cue.side === side) {
      clearTimer();
      setStrike(null);
      return;
    }
    if (cue.type !== 'impact' || cue.side !== side) return;

    clearTimer();
    const phase: StrikePhase = cue.sunk ? 'sunk' : cue.result;
    setStrike({
      shotKey: cue.shotKey,
      target: cue.target,
      phase,
      ...(cue.sunk ? { sunkPlacement: cue.sunk.placement } : {}),
    });
    const holdMs = cue.sunk
      ? cue.sunk.shipId === 'carrier'
        ? FEEL.timing.carrierSinkHoldMs
        : FEEL.timing.sinkHoldMs
      : FEEL.timing.impactHoldMs;
    timer.current = setTimeout(() => {
      setStrike((current) => (current?.shotKey === cue.shotKey ? null : current));
      timer.current = null;
    }, holdMs);
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
    <StrikeOverlay
      key={strike.shotKey}
      target={strike.target}
      phase={strike.phase}
      from={side === 'own' ? 'right' : 'left'}
      sunkPlacement={strike.sunkPlacement}
    />
  );
}
