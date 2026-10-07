import type { ShipType } from '@shared/config';
import type { Coordinate, ShipPlacement } from '@shared/engine';
import type { EndReason } from '@shared/core/schema';

export type Side = 'target' | 'own';

export interface SunkInfo {
  shipId: ShipType;
  placement: ShipPlacement;
}

export type FeelCue =
  | { type: 'windup'; side: Side; shotKey: string; target: Coordinate; targets?: Coordinate[] }
  | { type: 'cancel'; side: Side; shotKey: string }
  | { type: 'impact'; side: Side; shotKey: string; target: Coordinate; result: 'miss' | 'hit'; sunk?: SunkInfo }
  | { type: 'sink'; side: Side; shotKey: string; target: Coordinate; sunk: SunkInfo }
  | { type: 'gameOver'; won: boolean; reason: EndReason };
