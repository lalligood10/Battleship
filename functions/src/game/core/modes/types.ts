import type { ShipType } from '../../config';
import type { Coordinate, ShotResult } from '../../engine';
import type { CoreEvent } from '../events';
import type { CoreState } from '../schema';

export type AbilityId = 'carrier-airstrike' | 'submarine-sonar' | 'destroyer-relocate';

export interface AbilityDefinition {
  id: AbilityId;
  ship: ShipType;
  label: string;
  description: string;
}

export const ABILITY_DEFINITIONS: readonly AbilityDefinition[] = [
  { id: 'carrier-airstrike', ship: 'carrier', label: 'Airstrike', description: 'Hit 3 cells in a row or column.' },
  { id: 'submarine-sonar', ship: 'submarine', label: 'Sonar', description: 'Scan a 3×3 area for ships. No damage.' },
  { id: 'destroyer-relocate', ship: 'destroyer', label: 'Relocate', description: 'Move your undamaged destroyer once.' },
] as const;

/** `ready` = can be used now; `used` = spent; `lost` = its ship sank (or was damaged, for relocate) before use. */
export type AbilityStatus = 'ready' | 'used' | 'lost';

/** Airstrike: start cell; the line extends 3 cells right (horizontal) or down (vertical). */
export type AirstrikeTarget = { row: number; col: number; horizontal: boolean };
/** Sonar: centre of a 3×3 area, clipped at the board edges. */
export type SonarTarget = { row: number; col: number };
/** Relocate: the destroyer's new placement on the acting player's own board. */
export type RelocateTarget = { row: number; col: number; horizontal: boolean };

export type AbilityAction =
  | { type: 'ability'; player: string; abilityId: 'carrier-airstrike'; target: AirstrikeTarget; at: number }
  | { type: 'ability'; player: string; abilityId: 'submarine-sonar'; target: SonarTarget; at: number }
  | { type: 'ability'; player: string; abilityId: 'destroyer-relocate'; target: RelocateTarget; at: number };

/** Public result of an ability. Relocation never reveals the new position. */
export type AbilityResult =
  | { abilityId: 'carrier-airstrike'; cells: { row: number; col: number; result: ShotResult }[] }
  | { abilityId: 'submarine-sonar'; center: SonarTarget; shipPresent: boolean }
  | { abilityId: 'destroyer-relocate' };

/** One public ability-log entry, persisted on the game record in Abilities games. */
export interface AbilityLogEntry {
  player: string;
  turnNumber: number;
  result: AbilityResult;
}

export type FireAction = { type: 'fire'; player: string; target: Coordinate; at: number };
export type SalvoAction = { type: 'salvo'; player: string; targets: Coordinate[]; at: number };
export type ModeAction = FireAction | SalvoAction | AbilityAction;

export type CoreErrorCode =
  | 'not_player'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'wrong_mode'
  | 'wrong_shot_count'
  | 'duplicate_target'
  | 'off_board'
  | 'already_fired'
  | 'not_waiting'
  | 'too_early'
  | 'invalid_fleet'
  | 'invalid_ability'
  | 'ability_used'
  | 'illegal_relocation';

export interface CoreError {
  code: CoreErrorCode;
  message: string;
}

export interface ModeRules {
  shotsAllowed(state: CoreState, player: string): number;
  validateAction(state: CoreState, action: ModeAction): CoreError | null;
  applyAction(state: CoreState, action: ModeAction): { state: CoreState; events: CoreEvent[] };
}
