import type { ShipType } from '@shared/config';
import type { Coordinate, ShipPlacement } from '@shared/engine';
import type { EndReason } from '@shared/core/schema';
import type { AbilityId, AbilityResult } from '@shared/core/modes/types';

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
  | { type: 'abilityUsed'; side: Side; player: string; abilityId: AbilityId; result: AbilityResult }
  | { type: 'gameOver'; won: boolean; reason: EndReason };
