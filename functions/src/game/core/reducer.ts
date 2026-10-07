import { cellKey, isFleetDestroyed, isOnBoard, resolveShot, shotsToKeySet, validateFleet } from '../engine';
import { isBotUid } from '../bots';
import type { Shot } from '../engine';
import { createEventBus, type CoreEvent } from './events';
import { deriveRng } from './rng';
import { defaultSettings, type CoreState, type EndReason, type GameMode, type PlayerBoard } from './schema';

export type CoreAction =
  | { type: 'placeFleet'; player: string; fleet: unknown; at?: number }
  | { type: 'fire'; player: string; target: { row: number; col: number }; at: number }
  | { type: 'resign'; player: string }
  | { type: 'claimTimeout'; claimant: string; now: number };

export type CoreErrorCode =
  | 'not_player'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'off_board'
  | 'already_fired'
  | 'not_waiting'
  | 'too_early'
  | 'invalid_fleet';

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
    boards: {
      [first]: emptyBoard(),
      [second]: emptyBoard(),
    },
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

function copyState(state: CoreState): CoreState {
  return {
    ...state,
    playerIds: [...state.playerIds],
    settings: { ...state.settings, fleet: state.settings.fleet.map((ship) => ({ ...ship })) },
    boards: Object.fromEntries(
      Object.entries(state.boards).map(([uid, board]) => [
        uid,
        {
          ...board,
          fleet: board.fleet?.map((ship) => ({ ...ship })) ?? null,
          hitCells: [...board.hitCells],
          shipMeta: Object.fromEntries(
            Object.entries(board.shipMeta).map(([type, meta]) => [type, meta ? { ...meta } : meta]),
          ),
        },
      ]),
    ),
    shots: Object.fromEntries(Object.entries(state.shots).map(([uid, shots]) => [uid, shots.map(copyShot)])),
  };
}

function copyShot(shot: Shot): Shot {
  return { ...shot, ...(shot.sunkPlacement ? { sunkPlacement: { ...shot.sunkPlacement } } : {}) };
}

function otherPlayer(state: CoreState, player: string): string {
  return state.playerIds.find((uid) => uid !== player)!;
}

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
      next.currentTurn =
        firstIsBot !== secondIsBot
          ? firstIsBot
            ? second
            : first
          : deriveRng(next.seed, 'starting-player')() < 0.5
            ? first
            : second;
      next.turnNumber = 1;
    }
    return { ok: true, state: next, events: [] };
  }

  if (action.type === 'fire') {
    if (state.phase !== 'playing') return fail('wrong_phase', 'Shots can only be fired during play');
    if (state.currentTurn !== action.player) return fail('not_your_turn', "It's not your turn");
    if (!isOnBoard(action.target.row, action.target.col)) return fail('off_board', 'Target is off the board');
    if (shotsToKeySet(state.shots[action.player] ?? []).has(cellKey(action.target.row, action.target.col))) {
      return fail('already_fired', 'You already fired at that cell');
    }

    const owner = otherPlayer(state, action.player);
    const ownerBoard = state.boards[owner]!;
    if (!ownerBoard.fleet) return fail('wrong_phase', 'Opponent fleet is not placed');
    const outcome = resolveShot(ownerBoard.fleet, new Set(ownerBoard.hitCells), action.target);
    const next = copyState(state);
    const targetBoard = next.boards[owner]!;
    next.lastProgressAt = action.at;
    const hit = outcome.result !== 'miss';
    if (hit) targetBoard.hitCells.push(cellKey(action.target.row, action.target.col));
    const placement = outcome.sunkShip
      ? ownerBoard.fleet.find((ship) => ship.type === outcome.sunkShip)
      : undefined;
    const shot: Shot = {
      row: action.target.row,
      col: action.target.col,
      result: outcome.result,
      at: action.at,
      ...(outcome.sunkShip ? { sunkShip: outcome.sunkShip } : {}),
      ...(placement ? { sunkPlacement: { ...placement } } : {}),
    };
    next.shots[action.player]!.push(shot);

    const events: CoreEvent[] = [
      {
        type: 'shotFired',
        shooter: action.player,
        target: { ...action.target },
        turnNumber: state.turnNumber,
      },
      {
        type: 'shotResolved',
        shooter: action.player,
        target: { ...action.target },
        result: hit ? 'hit' : 'miss',
        turnNumber: state.turnNumber,
      },
    ];
    if (outcome.sunkShip && placement) {
      events.push({
        type: 'shipSunk',
        shooter: action.player,
        owner,
        shipId: outcome.sunkShip,
        placement: { ...placement },
      });
    }

    next.turnNumber += 1;
    if (hit && isFleetDestroyed(ownerBoard.fleet, new Set(targetBoard.hitCells))) {
      next.phase = 'gameOver';
      next.currentTurn = null;
      next.winner = action.player;
      next.endReason = 'all_sunk';
      events.push({ type: 'gameOver', winner: action.player, reason: 'all_sunk' });
    } else {
      next.currentTurn = owner;
      events.push({ type: 'turnChanged', currentTurn: owner, turnNumber: next.turnNumber });
    }
    return { ok: true, state: next, events };
  }

  if (action.type === 'claimTimeout') {
    if (state.phase !== 'placement' && state.phase !== 'playing') {
      return fail('wrong_phase', 'This game is not in progress');
    }
    const opponent = otherPlayer(state, action.claimant);
    if (isBotUid(opponent)) return fail('not_waiting', 'The computer never times out');
    const opponentIsStalling =
      state.phase === 'playing'
        ? state.currentTurn === opponent
        : Boolean(state.boards[action.claimant]!.fleet && !state.boards[opponent]!.fleet);
    if (!opponentIsStalling) return fail('not_waiting', 'You can only claim while waiting on your opponent');
    if (action.now - state.lastProgressAt < state.settings.abandonTimeoutMs) {
      return fail('too_early', 'Your opponent still has time to move');
    }

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
