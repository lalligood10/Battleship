import type { Coordinate } from '../../engine';
import type { CoreEvent } from '../events';
import type { CoreState } from '../schema';

export type AbilityId = 'carrier-airstrike' | 'submarine-sonar' | 'destroyer-relocate';

export type FireAction = { type: 'fire'; player: string; target: Coordinate; at: number };
export type SalvoAction = { type: 'salvo'; player: string; targets: Coordinate[]; at: number };
export type AbilityAction = { type: 'ability'; player: string; abilityId: AbilityId; target: unknown; at: number };
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
