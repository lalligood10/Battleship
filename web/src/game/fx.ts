/** Which decoration a resolved strike gets and how long the overlay stays mounted. */
import type { ShipType } from '@shared/config';

export type StrikeFxKind = 'generic' | 'carrier';

/** The carrier gets the dedicated bomb-run sequence; everything else uses the generic burst. */
export function strikeFxKind(phase: string | undefined, sunkShip: ShipType | null | undefined): StrikeFxKind {
  return phase === 'sunk' && sunkShip === 'carrier' ? 'carrier' : 'generic';
}

/** Overlay lifetime: the carrier sequence needs ~1.9s, so hold it for 2000ms. */
export function fxDurationMs(kind: StrikeFxKind, fallback: number): number {
  return kind === 'carrier' ? 2000 : fallback;
}
