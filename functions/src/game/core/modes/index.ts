import type { GameMode } from '../schema';
import { abilitiesRules } from './abilities';
import { classicRules } from './classic';
import { salvoRules } from './salvo';
import type { ModeRules } from './types';

const rulesByMode: Record<GameMode, ModeRules> = {
  classic: classicRules,
  salvo: salvoRules,
  abilities: abilitiesRules,
};

export function modeRules(mode: GameMode): ModeRules {
  return rulesByMode[mode];
}

export { ABILITY_DEFINITIONS } from './types';
export type {
  AbilityAction,
  AbilityDefinition,
  AbilityId,
  AbilityLogEntry,
  AbilityResult,
  AbilityStatus,
  AirstrikeTarget,
  CoreError,
  CoreErrorCode,
  FireAction,
  ModeAction,
  ModeRules,
  RelocateTarget,
  SalvoAction,
  SonarTarget,
} from './types';
