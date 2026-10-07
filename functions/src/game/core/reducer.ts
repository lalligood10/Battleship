import { validateFleet } from '../engine';
import { isBotUid } from '../bots';
import { createEventBus, type CoreEvent } from './events';
import { modeRules, type CoreErrorCode, type ModeAction } from './modes';
import { salvoShotsAllowed } from './modes/salvo';
import { copyState, otherPlayer } from './modes/shared';
import { deriveRng } from './rng';
import { defaultSettings, type CoreState, type EndReason, type GameMode, type PlayerBoard } from './schema';

export type CoreAction =
  | { type: 'placeFleet'; player: string; fleet: unknown; at?: number }
  | ModeAction
  | { type: 'resign'; player: string }
  | { type: 'claimTimeout'; claimant: string; now: number };

export type { CoreErrorCode } from './modes';

export type CoreResult =
  | { ok: true; state: CoreState; events: CoreEvent[] }
  | { ok: false; error: { code: CoreErrorCode; message: string } };

export function createCoreState(input: {
  playerIds: [string, string];
  seed: number;
  mode?: GameMode;
  createdAt?: number;
}): CoreState {
  const [first, second] = input.playerIds;
  return {
    settings: defaultSettings(input.mode),
    seed: input.seed >>> 0,
    phase: 'placement',
    playerIds: [...input.playerIds],
    currentTurn: null,
    turnNumber: 0,
    lastProgressAt: input.createdAt ?? 0,
    boards: { [first]: emptyBoard(), [second]: emptyBoard() },
    shots: { [first]: [], [second]: [] },
    winner: null,
    endReason: null,
  };
}

function emptyBoard(): PlayerBoard {
  return { fleet: null, hitCells: [], shipMeta: {} };
}

function fail(code: CoreErrorCode, message: string): CoreResult {
  return { ok: false, error: { code, message } };
}

function isModeAction(action: CoreAction): action is ModeAction {
  return action.type === 'fire' || action.type === 'salvo' || action.type === 'ability';
}

export function shotsAllowed(state: CoreState, player: string): number {
  return modeRules(state.settings.mode).shotsAllowed(state, player);
}

export { salvoShotsAllowed };

export function reduce(state: CoreState, action: CoreAction): CoreResult {
  const actor = action.type === 'claimTimeout' ? action.claimant : action.player;
  if (!state.playerIds.includes(actor)) return fail('not_player', 'Player is not in this game');

  if (action.type === 'placeFleet') {
    if (state.phase !== 'placement') return fail('wrong_phase', 'Ships can only be placed during placement');
    if (state.boards[action.player]!.fleet) return fail('wrong_phase', 'Fleet is already placed');
    const validation = validateFleet(action.fleet);
    if (!validation.ok) return fail('invalid_fleet', validation.reason);

    const next = copyState(state);
    next.boards[action.player]!.fleet = validation.fleet;
    if (action.at !== undefined) next.lastProgressAt = action.at;
    const [first, second] = next.playerIds;
    if (next.boards[first]!.fleet && next.boards[second]!.fleet) {
      next.phase = 'playing';
      const firstIsBot = isBotUid(first);
      const secondIsBot = isBotUid(second);
      next.currentTurn = firstIsBot !== secondIsBot
        ? firstIsBot ? second : first
        : deriveRng(next.seed, 'starting-player')() < 0.5 ? first : second;
      next.turnNumber = 1;
    }
    return { ok: true, state: next, events: [] };
  }

  if (isModeAction(action)) {
    if (state.phase !== 'playing') return fail('wrong_phase', 'Actions can only be taken during play');
    if (state.currentTurn !== action.player) return fail('not_your_turn', "It's not your turn");
    const rules = modeRules(state.settings.mode);
    const error = rules.validateAction(state, action);
    if (error) return { ok: false, error };
    return { ok: true, ...rules.applyAction(state, action) };
  }

  if (action.type === 'claimTimeout') {
    if (state.phase !== 'placement' && state.phase !== 'playing') return fail('wrong_phase', 'This game is not in progress');
    const opponent = otherPlayer(state, action.claimant);
    if (isBotUid(opponent)) return fail('not_waiting', 'The computer never times out');
    const opponentIsStalling = state.phase === 'playing'
      ? state.currentTurn === opponent
      : Boolean(state.boards[action.claimant]!.fleet && !state.boards[opponent]!.fleet);
    if (!opponentIsStalling) return fail('not_waiting', 'You can only claim while waiting on your opponent');
    if (action.now - state.lastProgressAt < state.settings.abandonTimeoutMs) return fail('too_early', 'Your opponent still has time to move');

    const next = copyState(state);
    next.phase = 'gameOver';
    next.currentTurn = null;
    next.winner = action.claimant;
    next.endReason = 'timeout';
    return { ok: true, state: next, events: [{ type: 'gameOver', winner: action.claimant, reason: 'timeout' }] };
  }

  if (state.phase === 'gameOver') return fail('wrong_phase', 'This game is already over');
  const next = copyState(state);
  const winner = otherPlayer(state, action.player);
  const reason: EndReason = 'resign';
  next.phase = 'gameOver';
  next.currentTurn = null;
  next.winner = winner;
  next.endReason = reason;
  return { ok: true, state: next, events: [{ type: 'gameOver', winner, reason }] };
}

export { createEventBus };
