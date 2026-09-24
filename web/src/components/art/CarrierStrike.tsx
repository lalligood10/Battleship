/**
 * Dedicated destruction sequence for the carrier (the 5-cell ship): a jet runs along the
 * carrier's axis, drops a bomb amidships, then the hull sinks. Pure CSS timeline driven by
 * animation-delay (~1.9s total), transform/opacity only, decorative inside a `.fx` layer.
 */
import { SHIP_LENGTHS } from '@shared/config';
import type { ShipPlacement } from '../../lib/types';
import { Bomb } from './Bomb';
import { Burst } from './Burst';
import { Jet } from './Jet';
import { SinkingShip } from './StrikeOverlay';

export function CarrierStrike({ placement, from }: { placement: ShipPlacement; from: 'left' | 'right' }) {
  const len = SHIP_LENGTHS[placement.type];
  // Centre of the carrier in board-percent.
  const cx = (placement.col + (placement.horizontal ? len / 2 : 0.5)) * 10;
  const cy = (placement.row + (placement.horizontal ? 0.5 : len / 2)) * 10;

  // Horizontal carriers: track sits on the carrier's row and the jet reaches cx at ~45%.
  // Vertical carriers: the same rig inside a 90°-rotated wrapper — top maps to the carrier's
  // column and travel maps to down the column.
  const axisTop = placement.horizontal ? cy : cx;
  const centre = placement.horizontal ? cx : cy;
  const run = (
    <div
      className={`carrier-run ${from === 'right' ? 'carrier-run--r' : ''}`}
      style={{ top: `${axisTop}%`, ['--cx' as string]: `${centre}%` }}
    >
      <div className="carrier-run-jet">
        <Jet />
      </div>
    </div>
  );

  return (
    <>
      {placement.horizontal ? run : <div className="carrier-run--v">{run}</div>}
      <div className="strike-result carrier-bomb" style={{ left: `${cx}%`, top: `${cy}%` }}>
        <Bomb />
      </div>
      <div className="strike-result" style={{ left: `${cx}%`, top: `${cy}%` }}>
        <Burst className="strike-burst carrier-burst" />
      </div>
      <SinkingShip placement={placement} late />
    </>
  );
}
