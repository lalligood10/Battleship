import {
  cellKey,
  cellsOf,
  isOnBoard,
  placementProblem,
  shotsToKeySet,
  type Coordinate,
  type ShipPlacement,
} from '../../engine';
import type { CoreEvent } from '../events';
import type { CoreState } from '../schema';
import { classicRules } from './classic';
import { copyState, finishTurn, otherPlayer, resolveTargets, shotEvents } from './shared';
import {
  ABILITY_DEFINITIONS,
  type AbilityId,
  type AbilityResult,
  type AbilityStatus,
  type AirstrikeTarget,
  type ModeAction,
  type ModeRules,
  type RelocateTarget,
  type SonarTarget,
} from './types';

export function airstrikeCells(target: AirstrikeTarget, _boardSize: number): Coordinate[] {
  return Array.from({ length: 3 }, (_, index) => ({
    row: target.row + (target.horizontal ? 0 : index),
    col: target.col + (target.horizontal ? index : 0),
  }));
}

export function sonarCells(center: SonarTarget, boardSize: number): Coordinate[] {
  const cells: Coordinate[] = [];
  for (let row = Math.max(0, center.row - 1); row <= Math.min(boardSize - 1, center.row + 1); row++) {
    for (let col = Math.max(0, center.col - 1); col <= Math.min(boardSize - 1, center.col + 1); col++) {
      cells.push({ row, col });
    }
  }
  return cells;
}

export function isLegalRelocation(state: CoreState, player: string, target: RelocateTarget): boolean {
  const fleet = state.boards[player]?.fleet;
  if (!fleet) return false;
  if (
    !Number.isInteger(target.row) ||
    !Number.isInteger(target.col) ||
    typeof target.horizontal !== 'boolean'
  ) {
    return false;
  }

  const destroyer = fleet.find((ship) => ship.type === 'destroyer');
  if (!destroyer) return false;
  if (
    destroyer.row === target.row &&
    destroyer.col === target.col &&
    destroyer.horizontal === target.horizontal
  ) {
    return false;
  }

  const candidate: ShipPlacement = {
    type: 'destroyer',
    row: target.row,
    col: target.col,
    horizontal: target.horizontal,
  };
  if (placementProblem(candidate, fleet) !== null) return false;

  const opponent = otherPlayer(state, player);
  const tried = shotsToKeySet(state.shots[opponent] ?? []);
  return cellsOf(candidate).every((cell) => !tried.has(cellKey(cell.row, cell.col)));
}

export function abilityStatuses(state: CoreState, player: string): Record<AbilityId, AbilityStatus> {
  const statuses = {} as Record<AbilityId, AbilityStatus>;
  const fleet = state.boards[player]?.fleet;
  if (!fleet) {
    for (const definition of ABILITY_DEFINITIONS) statuses[definition.id] = 'ready';
    return statuses;
  }

  const hits = new Set(state.boards[player]!.hitCells);
  for (const definition of ABILITY_DEFINITIONS) {
    if (state.abilityLog.some((entry) => entry.player === player && entry.result.abilityId === definition.id)) {
      statuses[definition.id] = 'used';
      continue;
    }

    const ship = fleet.find((placement) => placement.type === definition.ship);
    const shipCells = ship ? cellsOf(ship) : [];
    const lost = definition.id === 'destroyer-relocate'
      ? shipCells.some((cell) => hits.has(cellKey(cell.row, cell.col)))
      : shipCells.length > 0 && shipCells.every((cell) => hits.has(cellKey(cell.row, cell.col)));
    statuses[definition.id] = lost ? 'lost' : 'ready';
  }
  return statuses;
}

function abilityIdIsValid(value: string): value is AbilityId {
  return ABILITY_DEFINITIONS.some((definition) => definition.id === value);
}

function malformedTarget(action: Extract<ModeAction, { type: 'ability' }>): boolean {
  if (typeof action.target !== 'object' || action.target === null) return true;
  if (action.abilityId !== 'submarine-sonar' && typeof action.target.horizontal !== 'boolean') return true;
  return false;
}

function invalidAbility(message: string) {
  return { code: 'invalid_ability' as const, message };
}

export const abilitiesRules: ModeRules = {
  shotsAllowed: () => 1,
  validateAction(_state, action) {
    if (action.type === 'salvo') {
      return { code: 'wrong_mode', message: 'Use a shot or ship ability in Abilities mode' };
    }
    if (action.type === 'fire') return classicRules.validateAction(_state, action);

    if (!abilityIdIsValid(action.abilityId)) return invalidAbility('Unknown ability');

    const status = abilityStatuses(_state, action.player)[action.abilityId];
    if (status === 'used') return { code: 'ability_used', message: 'This ability has already been used' };
    if (status === 'lost') return invalidAbility('The ship for this ability is lost');

    if (malformedTarget(action)) return invalidAbility('Malformed ability target');

    const owner = otherPlayer(_state, action.player);
    if (!_state.boards[owner]!.fleet) {
      return { code: 'wrong_phase', message: 'Opponent fleet is not placed' };
    }

    if (action.abilityId === 'carrier-airstrike') {
      const cells = airstrikeCells(action.target, _state.settings.boardSize);
      if (cells.some((cell) => !isOnBoard(cell.row, cell.col))) {
        return { code: 'off_board', message: 'Target is off the board' };
      }
      const tried = shotsToKeySet(_state.shots[action.player] ?? []);
      if (cells.every((cell) => tried.has(cellKey(cell.row, cell.col)))) {
        return { code: 'already_fired', message: 'You already fired at those cells' };
      }
      return null;
    }

    if (action.abilityId === 'submarine-sonar') {
      if (!isOnBoard(action.target.row, action.target.col)) {
        return { code: 'off_board', message: 'Target is off the board' };
      }
      return null;
    }

    if (!isLegalRelocation(_state, action.player, action.target)) {
      return { code: 'illegal_relocation', message: 'Destroyer cannot be relocated to that placement' };
    }
    return null;
  },
  applyAction(state, rawAction) {
    if (rawAction.type === 'fire') return classicRules.applyAction(state, rawAction);
    if (rawAction.type !== 'ability') throw new Error('Abilities mode does not support Salvo actions');

    const action = rawAction;
    const owner = otherPlayer(state, action.player);
    let next: CoreState;
    let result: AbilityResult;
    let events: CoreEvent[] = [];

    if (action.abilityId === 'carrier-airstrike') {
      const tried = shotsToKeySet(state.shots[action.player] ?? []);
      const untried = airstrikeCells(action.target, state.settings.boardSize)
        .filter((cell) => !tried.has(cellKey(cell.row, cell.col)));
      const resolved = resolveTargets(state, action.player, untried, action.at, state.turnNumber);
      const recorded = [
        ...resolved.shots.filter((shot) => shot.result !== 'sunk'),
        ...resolved.shots.filter((shot) => shot.result === 'sunk'),
      ];
      next = resolved.state;
      next.shots[action.player]!.push(...recorded);
      events = shotEvents(state, action.player, resolved.owner, recorded);
      result = {
        abilityId: 'carrier-airstrike',
        cells: recorded.map(({ row, col, result: shotResult }) => ({ row, col, result: shotResult })),
      };
    } else if (action.abilityId === 'submarine-sonar') {
      next = copyState(state);
      next.lastProgressAt = action.at;
      const scanned = new Set(sonarCells(action.target, state.settings.boardSize)
        .map((cell) => cellKey(cell.row, cell.col)));
      result = {
        abilityId: 'submarine-sonar',
        center: { row: action.target.row, col: action.target.col },
        shipPresent: state.boards[owner]!.fleet!.some((ship) =>
          cellsOf(ship).some((cell) => scanned.has(cellKey(cell.row, cell.col)))),
      };
    } else {
      next = copyState(state);
      const fleet = next.boards[action.player]!.fleet!;
      const destroyerIndex = fleet.findIndex((ship) => ship.type === 'destroyer');
      fleet[destroyerIndex] = {
        type: 'destroyer',
        row: action.target.row,
        col: action.target.col,
        horizontal: action.target.horizontal,
      };
      next.lastProgressAt = action.at;
      result = { abilityId: 'destroyer-relocate' };
    }

    next.abilityLog.push({
      player: action.player,
      turnNumber: state.turnNumber,
      result: structuredClone(result),
    });
    events.push({
      type: 'abilityUsed',
      player: action.player,
      abilityId: action.abilityId,
      result: structuredClone(result),
      turnNumber: state.turnNumber,
    });
    finishTurn(next, action.player, owner, events);
    return { state: next, events };
  },
};
