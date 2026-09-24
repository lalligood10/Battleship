/**
 * Animated strike sequence rendered inside a Board's `.fx` overlay: an inbound jet streaks to the
 * target row, then the cell shows a splash (miss), a burst (hit), or a burst plus a sinking ship
 * (sunk, when the server revealed the placement). Decorative only – no input, no timing logic.
 */
import { useEffect, useState } from 'react';
import { SHIP_LENGTHS } from '@shared/config';
import type { Coordinate, ShipPlacement } from '../../lib/types';
import { Burst } from './Burst';
import { CarrierStrike } from './CarrierStrike';
import { Jet } from './Jet';
import { Ship } from './Ship';
import { Splash } from './Splash';

export type StrikePhase = 'inbound' | 'miss' | 'hit' | 'sunk' | 'carrier';

export function StrikeOverlay({
  target,
  phase,
  from,
  sunkPlacement,
}: {
  target: Coordinate;
  phase: StrikePhase;
  from: 'left' | 'right';
  sunkPlacement?: ShipPlacement | null;
}) {
  // The jet flies once per overlay mount (keyed on the target by the caller) and is removed
  // after its 1.1s run even though the result phase keeps the overlay alive.
  const [jetGone, setJetGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setJetGone(true), 1100);
    return () => clearTimeout(t);
  }, []);

  const tx = `${(target.col + 0.5) * 10}%`;
  const ty = `${(target.row + 0.5) * 10}%`;

  // The carrier gets its own bomb-run sequence (which includes the jet pass), so the generic
  // inbound jet and burst are skipped for it.
  if (phase === 'sunk' && sunkPlacement?.type === 'carrier') {
    return <CarrierStrike placement={sunkPlacement} from={from} />;
  }

  return (
    <>
      {!jetGone && (
        <div
          className={`strike-jet-path ${from === 'right' ? 'strike-jet-path--r' : ''}`}
          style={{ ['--tx' as string]: tx, ['--ty' as string]: ty }}
          key={`${target.row},${target.col}`}
        >
          <div className={`strike-jet ${from === 'right' ? 'strike-jet--r' : ''}`}>
            <Jet />
          </div>
        </div>
      )}
      {phase === 'miss' && (
        <div className="strike-result" style={{ left: tx, top: ty }}>
          <Splash className="strike-splash" />
        </div>
      )}
      {(phase === 'hit' || phase === 'sunk') && (
        <div className="strike-result" style={{ left: tx, top: ty }}>
          <Burst className="strike-burst" />
        </div>
      )}
      {phase === 'sunk' && sunkPlacement && <SinkingShip placement={sunkPlacement} />}
    </>
  );
}

export function SinkingShip({ placement, late }: { placement: ShipPlacement; late?: boolean }) {
  const len = SHIP_LENGTHS[placement.type];
  const cx = (placement.col + (placement.horizontal ? len / 2 : 0.5)) * 10;
  const cy = (placement.row + (placement.horizontal ? 0.5 : len / 2)) * 10;
  return (
    <div
      className="sink-ship"
      style={{
        left: `${cx}%`,
        top: `${cy}%`,
        width: `${len * 10}%`,
        transform: `translate(-50%, -50%)${placement.horizontal ? '' : ' rotate(90deg)'}`,
      }}
    >
      <div className={`sink-anim${late ? ' sink-anim--late' : ''}`}>
        <Ship />
      </div>
    </div>
  );
}
