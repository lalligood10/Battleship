import { coordLabel } from './marks';
import {
  BOARD_SIZE,
  dragTo,
  placeAt,
  replaceShip,
  rotateShip,
  SHIP_NAMES,
  shipAt,
  startDrag,
  type Coordinate,
  type DragState,
  type ShipPlacement,
  type ShipType,
} from './placement';
import { describeIssue, placementIssue } from './placementIssues';

export interface Carry {
  drag: DragState;
  original: ShipPlacement;
}

export interface PlacementKeyState {
  fleet: ShipPlacement[];
  selected: ShipType;
  carrying: Carry | null;
}

export interface PlacementKeyResult extends PlacementKeyState {
  focus?: Coordinate;
  announcement: string;
}

function name(type: ShipType): string {
  return SHIP_NAMES[type];
}

function issueSuffix(fleet: ShipPlacement[], type: ShipType, separator: string): string {
  const issue = placementIssue(fleet, type);
  return issue ? `${separator}${describeIssue(issue)}` : '';
}

function origin(fleet: ShipPlacement[], type: ShipType): Coordinate {
  const ship = fleet.find((candidate) => candidate.type === type);
  return ship ? { row: ship.row, col: ship.col } : { row: 0, col: 0 };
}

function placementResult(
  state: PlacementKeyState,
  fleet: ShipPlacement[],
  type: ShipType,
  word: 'placed' | 'at',
  focus?: Coordinate,
): PlacementKeyResult {
  const at = origin(fleet, type);
  return {
    ...state,
    fleet,
    focus,
    announcement: `${name(type)} ${word} at ${coordLabel(at)}${issueSuffix(fleet, type, word === 'placed' ? ' — ' : '. ')}`,
  };
}

export function placementGridKey(
  state: PlacementKeyState,
  key: string,
  at: Coordinate,
): PlacementKeyResult | null {
  if (key === 'Enter' || key === ' ') {
    if (state.carrying) {
      return placementResult({ ...state, carrying: null }, state.fleet, state.carrying.drag.type, 'placed');
    }

    const ship = shipAt(state.fleet, at);
    if (ship) {
      const drag = startDrag(state.fleet, at);
      if (!drag) return null;
      return {
        ...state,
        selected: ship.type,
        carrying: { drag, original: ship },
        announcement: `${name(ship.type)} picked up. Arrow keys move, R rotates, Enter places, Escape cancels.`,
      };
    }

    const fleet = placeAt(state.fleet, state.selected, at);
    return placementResult(state, fleet, state.selected, 'placed', origin(fleet, state.selected));
  }

  if (state.carrying && key.startsWith('Arrow')) {
    const deltas: Record<string, Coordinate> = {
      ArrowUp: { row: -1, col: 0 },
      ArrowDown: { row: 1, col: 0 },
      ArrowLeft: { row: 0, col: -1 },
      ArrowRight: { row: 0, col: 1 },
    };
    const delta = deltas[key];
    if (!delta) return null;
    const target = {
      row: Math.min(Math.max(at.row + delta.row, 0), BOARD_SIZE - 1),
      col: Math.min(Math.max(at.col + delta.col, 0), BOARD_SIZE - 1),
    };
    const fleet = dragTo(state.fleet, state.carrying.drag, target);
    const shipOrigin = origin(fleet, state.carrying.drag.type);
    const focus = {
      row: shipOrigin.row + state.carrying.drag.offsetRow,
      col: shipOrigin.col + state.carrying.drag.offsetCol,
    };
    return placementResult(state, fleet, state.carrying.drag.type, 'at', focus);
  }

  if (key === 'Escape' && state.carrying) {
    const { original, drag } = state.carrying;
    const fleet = replaceShip(state.fleet, original);
    return {
      ...state,
      fleet,
      carrying: null,
      focus: { row: original.row, col: original.col },
      announcement: `${name(drag.type)} returned to ${coordLabel(original)}`,
    };
  }

  return null;
}

export function rotateSelected(state: PlacementKeyState): PlacementKeyResult {
  const type = state.carrying?.drag.type ?? state.selected;
  const fleet = rotateShip(state.fleet, type);
  const shipOrigin = origin(fleet, type);
  const carrying = state.carrying
    ? { ...state.carrying, drag: startDrag(fleet, shipOrigin) ?? state.carrying.drag }
    : null;
  const ship = fleet.find((candidate) => candidate.type === type);
  return {
    ...state,
    fleet,
    selected: type,
    carrying,
    focus: shipOrigin,
    announcement: `${name(type)} ${ship?.horizontal ? 'horizontal' : 'vertical'}${issueSuffix(fleet, type, '. ')}`,
  };
}
