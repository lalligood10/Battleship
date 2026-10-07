import { cellKey, isFleetDestroyed, resolveShot, type Coordinate, type Shot } from '../../engine';
import type { CoreEvent } from '../events';
import type { CoreState } from '../schema';

export function copyState(state: CoreState): CoreState {
  return {
    ...state,
    playerIds: [...state.playerIds],
    settings: { ...state.settings, fleet: state.settings.fleet.map((ship) => ({ ...ship })) },
    boards: Object.fromEntries(Object.entries(state.boards).map(([uid, board]) => [uid, {
      ...board,
      fleet: board.fleet?.map((ship) => ({ ...ship })) ?? null,
      hitCells: [...board.hitCells],
      shipMeta: Object.fromEntries(Object.entries(board.shipMeta).map(([type, meta]) => [type, meta ? { ...meta } : meta])),
    }])),
    shots: Object.fromEntries(Object.entries(state.shots).map(([uid, shots]) => [uid, shots.map((shot) => ({
      ...shot,
      ...(shot.sunkPlacement ? { sunkPlacement: { ...shot.sunkPlacement } } : {}),
    }))])),
  };
}

export function otherPlayer(state: CoreState, player: string): string {
  return state.playerIds.find((uid) => uid !== player)!;
}

export function resolveTargets(
  state: CoreState,
  player: string,
  targets: readonly Coordinate[],
  at: number,
  volley?: number,
): { state: CoreState; owner: string; shots: Shot[] } {
  const owner = otherPlayer(state, player);
  const ownerBoard = state.boards[owner]!;
  if (!ownerBoard.fleet) throw new Error('Opponent fleet is not placed');
  const next = copyState(state);
  const targetBoard = next.boards[owner]!;
  const hits = new Set(ownerBoard.hitCells);
  const shots = targets.map((target): Shot => {
    const outcome = resolveShot(ownerBoard.fleet!, hits, target);
    if (outcome.result !== 'miss') {
      const key = cellKey(target.row, target.col);
      hits.add(key);
      targetBoard.hitCells.push(key);
    }
    const placement = outcome.sunkShip ? ownerBoard.fleet!.find((ship) => ship.type === outcome.sunkShip) : undefined;
    return {
      ...target,
      result: outcome.result,
      at,
      ...(volley === undefined ? {} : { volley }),
      ...(outcome.sunkShip ? { sunkShip: outcome.sunkShip } : {}),
      ...(placement ? { sunkPlacement: { ...placement } } : {}),
    };
  });
  next.lastProgressAt = at;
  return { state: next, owner, shots };
}

export function shotEvents(state: CoreState, player: string, owner: string, shots: readonly Shot[]): CoreEvent[] {
  const events: CoreEvent[] = [];
  for (const shot of shots) {
    const target = { row: shot.row, col: shot.col };
    events.push(
      { type: 'shotFired', shooter: player, target, turnNumber: state.turnNumber },
      { type: 'shotResolved', shooter: player, target, result: shot.result === 'miss' ? 'miss' : 'hit', turnNumber: state.turnNumber },
    );
    if (shot.sunkShip && shot.sunkPlacement) {
      events.push({ type: 'shipSunk', shooter: player, owner, shipId: shot.sunkShip, placement: { ...shot.sunkPlacement } });
    }
  }
  return events;
}

export function finishTurn(state: CoreState, player: string, owner: string, events: CoreEvent[]): void {
  state.turnNumber += 1;
  const fleet = state.boards[owner]!.fleet!;
  if (isFleetDestroyed(fleet, new Set(state.boards[owner]!.hitCells))) {
    state.phase = 'gameOver';
    state.currentTurn = null;
    state.winner = player;
    state.endReason = 'all_sunk';
    events.push({ type: 'gameOver', winner: player, reason: 'all_sunk' });
  } else {
    state.currentTurn = owner;
    events.push({ type: 'turnChanged', currentTurn: owner, turnNumber: state.turnNumber });
  }
}
