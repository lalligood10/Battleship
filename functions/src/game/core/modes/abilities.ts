import type { ModeRules } from './types';

export const abilitiesRules: ModeRules = {
  shotsAllowed: () => 1,
  validateAction(_state, action) {
    if (action.type !== 'ability' && action.type !== 'fire') {
      return { code: 'wrong_mode', message: 'Use a shot or ship ability in Abilities mode' };
    }
    return { code: 'invalid_ability', message: 'Abilities mode is not implemented yet' };
  },
  applyAction() {
    throw new Error('Abilities mode is not implemented yet');
  },
};
