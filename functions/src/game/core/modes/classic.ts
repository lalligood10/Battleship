import { cellKey, isOnBoard, shotsToKeySet } from '../../engine';
import { finishTurn, resolveTargets, shotEvents } from './shared';
import type { FireAction, ModeRules } from './types';

export const classicRules: ModeRules = {
  shotsAllowed: () => 1,
  validateAction(state, action) {
    if (action.type !== 'fire') return { code: 'wrong_mode', message: 'Fire one shot in Classic mode' };
    if (!isOnBoard(action.target.row, action.target.col)) return { code: 'off_board', message: 'Target is off the board' };
    if (shotsToKeySet(state.shots[action.player] ?? []).has(cellKey(action.target.row, action.target.col))) {
      return { code: 'already_fired', message: 'You already fired at that cell' };
    }
    const owner = state.playerIds.find((uid) => uid !== action.player)!;
    if (!state.boards[owner]!.fleet) return { code: 'wrong_phase', message: 'Opponent fleet is not placed' };
    return null;
  },
  applyAction(state, rawAction) {
    const action = rawAction as FireAction;
    const { state: next, owner, shots } = resolveTargets(state, action.player, [action.target], action.at);
    next.shots[action.player]!.push(shots[0]!);
    const events = shotEvents(state, action.player, owner, shots);
    finishTurn(next, action.player, owner, events);
    return { state: next, events };
  },
};

