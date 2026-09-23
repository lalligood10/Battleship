/**
 * Pure game-rules engine. No Firebase imports here so it can be unit tested in isolation.
 * Coordinates are zero-based internally: row 0..9 (displayed as 1–10), col 0..9 (displayed as A–J).
 */
import { GAME_CONFIG, SHIP_LENGTHS, SHIP_TYPES, type ShipType } from './config';

export interface Coordinate {
  row: number;
  col: number;
}

export interface ShipPlacement {
  type: ShipType;
  row: number;
  col: number;
  horizontal: boolean;
}

export type ShotResult = 'miss' | 'hit' | 'sunk';

export interface Shot {
  row: number;
  col: number;
  result: ShotResult;
  /** Present when result === 'sunk'. Reveals only that a ship of this type went down. */
  sunkShip?: ShipType;
  /** Millisecond timestamp when the shot was resolved. */
  at: number;
}

export const cellKey = (row: number, col: number): string => `${row},${col}`;

export function isOnBoard(row: number, col: number): boolean {
  const n = GAME_CONFIG.BOARD_SIZE;
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < n && col >= 0 && col < n;
}

/** Returns the cells a placement occupies (may include off-board cells; validate separately). */
export function cellsOf(ship: ShipPlacement): Coordinate[] {
  const length = SHIP_LENGTHS[ship.type];
  const cells: Coordinate[] = [];
  for (let i = 0; i < length; i++) {
    cells.push(ship.horizontal ? { row: ship.row, col: ship.col + i } : { row: ship.row + i, col: ship.col });
  }
  return cells;
}

export function isShipPlacement(value: unknown): value is ShipPlacement {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === 'string' &&
    (SHIP_TYPES as readonly string[]).includes(v.type) &&
    typeof v.row === 'number' &&
    typeof v.col === 'number' &&
    typeof v.horizontal === 'boolean'
  );
}

export type PlacementProblem = 'off_board' | 'overlap' | 'touching';

/**
 * Checks whether `candidate` can sit alongside `others` (ships of the same type in `others`
 * are ignored so a ship can be "moved"). Returns null when legal.
 */
export function placementProblem(candidate: ShipPlacement, others: ShipPlacement[]): PlacementProblem | null {
  const cells = cellsOf(candidate);
  if (!cells.every((c) => isOnBoard(c.row, c.col))) return 'off_board';

  const occupied = new Set<string>();
  for (const other of others) {
    if (other.type === candidate.type) continue;
    for (const c of cellsOf(other)) occupied.add(cellKey(c.row, c.col));
  }
  if (cells.some((c) => occupied.has(cellKey(c.row, c.col)))) return 'overlap';

  if (!GAME_CONFIG.ALLOW_TOUCHING_SHIPS) {
    for (const c of cells) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (occupied.has(cellKey(c.row + dr, c.col + dc))) return 'touching';
        }
      }
    }
  }
  return null;
}

export type FleetValidation = { ok: true; fleet: ShipPlacement[] } | { ok: false; reason: string };

/**
 * Validates a complete fleet sent by a client: exactly one of each ship type, every cell on the
 * board, no overlaps, and (if configured) no ships touching.
 */
export function validateFleet(ships: unknown): FleetValidation {
  if (!Array.isArray(ships)) return { ok: false, reason: 'Fleet must be a list of ships' };
  if (ships.length !== SHIP_TYPES.length) {
    return { ok: false, reason: `Fleet must contain exactly ${SHIP_TYPES.length} ships` };
  }
  const fleet: ShipPlacement[] = [];
  for (const raw of ships) {
    if (!isShipPlacement(raw)) return { ok: false, reason: 'Malformed ship placement' };
    if (fleet.some((s) => s.type === raw.type)) return { ok: false, reason: `Duplicate ship: ${raw.type}` };
    const problem = placementProblem(raw, fleet);
    if (problem === 'off_board') return { ok: false, reason: `${raw.type} is off the board` };
    if (problem === 'overlap') return { ok: false, reason: `${raw.type} overlaps another ship` };
    if (problem === 'touching') return { ok: false, reason: `${raw.type} is touching another ship` };
    fleet.push({ type: raw.type, row: raw.row, col: raw.col, horizontal: raw.horizontal });
  }
  return { ok: true, fleet };
}

/**
 * Resolves a shot against a fleet given the cells already hit before this shot.
 * Does not mutate inputs. Callers must reject repeat shots before calling this.
 */
export function resolveShot(
  fleet: ShipPlacement[],
  previousHits: ReadonlySet<string>,
  target: Coordinate,
): { result: ShotResult; sunkShip?: ShipType } {
  for (const ship of fleet) {
    const cells = cellsOf(ship);
    if (!cells.some((c) => c.row === target.row && c.col === target.col)) continue;
    const remaining = cells.filter(
      (c) => !(c.row === target.row && c.col === target.col) && !previousHits.has(cellKey(c.row, c.col)),
    );
    return remaining.length === 0 ? { result: 'sunk', sunkShip: ship.type } : { result: 'hit' };
  }
  return { result: 'miss' };
}

export function isFleetDestroyed(fleet: ShipPlacement[], hits: ReadonlySet<string>): boolean {
  return fleet.every((ship) => cellsOf(ship).every((c) => hits.has(cellKey(c.row, c.col))));
}

export function shotsToKeySet(shots: Pick<Shot, 'row' | 'col'>[]): Set<string> {
  return new Set(shots.map((s) => cellKey(s.row, s.col)));
}

/** Generates a random legal fleet (used for "auto-place" and tests). */
export function randomFleet(rng: () => number = Math.random): ShipPlacement[] {
  const n = GAME_CONFIG.BOARD_SIZE;
  for (let attempt = 0; attempt < 100; attempt++) {
    const fleet: ShipPlacement[] = [];
    for (const type of SHIP_TYPES) {
      const length = SHIP_LENGTHS[type];
      for (let tries = 0; tries < 200; tries++) {
        const horizontal = rng() < 0.5;
        const row = Math.floor(rng() * (horizontal ? n : n - length + 1));
        const col = Math.floor(rng() * (horizontal ? n - length + 1 : n));
        const candidate: ShipPlacement = { type, row, col, horizontal };
        if (placementProblem(candidate, fleet) === null) {
          fleet.push(candidate);
          break;
        }
      }
    }
    if (fleet.length === SHIP_TYPES.length) return fleet;
  }
  throw new Error('Could not generate a random fleet');
}

/** Human-readable coordinate, e.g. row 0 / col 0 -> "A1". */
export function coordinateLabel(row: number, col: number): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}
