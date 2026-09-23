/**
 * Placement-phase logic, kept free of React so it can be unit tested. The server re-validates the
 * fleet in `placeShips`, so this only exists to give instant feedback while the player arranges ships.
 */
import { GAME_CONFIG, SHIP_LENGTHS, SHIP_TYPES, type ShipType } from '@shared/config';
import {
  cellKey,
  cellsOf,
  placementProblem,
  randomFleet,
  type Coordinate,
  type PlacementProblem,
  type ShipPlacement,
  type Shot,
} from '@shared/engine';

export const BOARD_SIZE = GAME_CONFIG.BOARD_SIZE;
export { SHIP_LENGTHS, SHIP_TYPES, cellKey, cellsOf, randomFleet };
export type { Coordinate, PlacementProblem, ShipPlacement, ShipType, Shot };

export const SHIP_NAMES: Record<ShipType, string> = {
  carrier: 'Carrier',
  battleship: 'Battleship',
  cruiser: 'Cruiser',
  submarine: 'Submarine',
  destroyer: 'Destroyer',
};

export const COLUMN_LABELS = Array.from({ length: BOARD_SIZE }, (_, i) => String.fromCharCode(65 + i));
export const ROW_LABELS = Array.from({ length: BOARD_SIZE }, (_, i) => String(i + 1));

/** A tidy starting layout: ships stacked horizontally down the left side. */
export function defaultFleet(): ShipPlacement[] {
  return SHIP_TYPES.map((type, i) => ({ type, row: i * 2, col: 0, horizontal: true }));
}

/** Moves a ship the minimum amount needed to sit fully on the board. */
export function clampToBoard(ship: ShipPlacement): ShipPlacement {
  const length = SHIP_LENGTHS[ship.type];
  const maxRow = ship.horizontal ? BOARD_SIZE - 1 : BOARD_SIZE - length;
  const maxCol = ship.horizontal ? BOARD_SIZE - length : BOARD_SIZE - 1;
  return {
    ...ship,
    row: Math.min(Math.max(ship.row, 0), maxRow),
    col: Math.min(Math.max(ship.col, 0), maxCol),
  };
}

export function shipAt(fleet: ShipPlacement[], c: Coordinate): ShipPlacement | undefined {
  return fleet.find((s) => cellsOf(s).some((x) => x.row === c.row && x.col === c.col));
}

export function problemFor(fleet: ShipPlacement[], type: ShipType): PlacementProblem | null {
  const ship = fleet.find((s) => s.type === type);
  return ship ? placementProblem(ship, fleet) : null;
}

export function fleetIsValid(fleet: ShipPlacement[]): boolean {
  return fleet.length === SHIP_TYPES.length && SHIP_TYPES.every((t) => problemFor(fleet, t) === null);
}

export function describeProblem(type: ShipType, problem: PlacementProblem): string {
  const name = SHIP_NAMES[type];
  switch (problem) {
    case 'off_board':
      return `${name} is off the board`;
    case 'overlap':
      return `${name} overlaps another ship`;
    case 'touching':
      return `${name} is touching another ship`;
  }
}

export function replaceShip(fleet: ShipPlacement[], ship: ShipPlacement): ShipPlacement[] {
  return fleet.map((s) => (s.type === ship.type ? ship : s));
}

/** Rotates around the ship's first cell, then nudges it back on the board if needed. */
export function rotateShip(fleet: ShipPlacement[], type: ShipType): ShipPlacement[] {
  const ship = fleet.find((s) => s.type === type);
  if (!ship) return fleet;
  return replaceShip(fleet, clampToBoard({ ...ship, horizontal: !ship.horizontal }));
}

/**
 * Drag state: remembers which cell of the ship was grabbed so the ship doesn't jump to the pointer.
 * `move` returns the fleet with the ship following the pointer; the caller decides when to commit.
 */
export interface DragState {
  type: ShipType;
  /** Offset (in cells) from the ship's origin to the grabbed cell. */
  offsetRow: number;
  offsetCol: number;
}

export function startDrag(fleet: ShipPlacement[], at: Coordinate): DragState | null {
  const ship = shipAt(fleet, at);
  if (!ship) return null;
  return { type: ship.type, offsetRow: at.row - ship.row, offsetCol: at.col - ship.col };
}

export function dragTo(fleet: ShipPlacement[], drag: DragState, at: Coordinate): ShipPlacement[] {
  const ship = fleet.find((s) => s.type === drag.type);
  if (!ship) return fleet;
  const moved = clampToBoard({ ...ship, row: at.row - drag.offsetRow, col: at.col - drag.offsetCol });
  return replaceShip(fleet, moved);
}

/** Tap-to-place for touch screens: moves the selected ship so its first cell is at `at`. */
export function placeAt(fleet: ShipPlacement[], type: ShipType, at: Coordinate): ShipPlacement[] {
  const ship = fleet.find((s) => s.type === type);
  if (!ship) return fleet;
  return replaceShip(fleet, clampToBoard({ ...ship, row: at.row, col: at.col }));
}

export function occupiedCellKeys(fleet: ShipPlacement[]): Set<string> {
  return new Set(fleet.flatMap((s) => cellsOf(s).map((c) => cellKey(c.row, c.col))));
}
