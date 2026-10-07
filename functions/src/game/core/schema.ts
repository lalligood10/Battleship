import { GAME_CONFIG, SHIP_LENGTHS, SHIP_TYPES, type ShipType } from '../config';
import type { Coordinate, ShipPlacement, Shot } from '../engine';

export interface ShipDefinition {
  id: ShipType;
  name: string;
  length: number;
}

export const FLEET_DEFINITION: ShipDefinition[] = SHIP_TYPES.map((id) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  length: SHIP_LENGTHS[id],
}));

export type CellState = 'unknown' | 'miss' | 'hit' | 'sunk';
export type CorePhase = 'lobby' | 'placement' | 'playing' | 'gameOver';
export type GameMode = 'classic'; // Salvo and ship abilities are reserved.
export type EndReason = 'all_sunk' | 'resign' | 'timeout';

export interface GameSettings {
  mode: GameMode;
  boardSize: number;
  fleet: ShipDefinition[];
}

export interface ShipMeta {
  abilityCharges?: number;
}

export interface PlayerBoard {
  fleet: ShipPlacement[] | null;
  hitCells: string[];
  shipMeta: Partial<Record<ShipType, ShipMeta>>;
}

export interface CoreState {
  settings: GameSettings;
  seed: number;
  phase: CorePhase;
  playerIds: [string, string];
  currentTurn: string | null;
  turnNumber: number;
  boards: Record<string, PlayerBoard>;
  shots: Record<string, Shot[]>;
  winner: string | null;
  endReason: EndReason | null;
}

export function phaseFromStatus(status: string): CorePhase {
  if (status === 'waiting') return 'lobby';
  if (status === 'placing') return 'placement';
  if (status === 'active') return 'playing';
  return 'gameOver';
}

export function cellStates(state: CoreState, ownerUid: string): CellState[][] {
  const size = state.settings.boardSize;
  const cells: CellState[][] = Array.from({ length: size }, () => Array<CellState>(size).fill('unknown'));
  const opponent = state.playerIds.find((uid) => uid !== ownerUid);
  if (!opponent) return cells;

  for (const shot of state.shots[opponent] ?? []) {
    if (shot.result === 'miss') {
      cells[shot.row]![shot.col] = 'miss';
    } else if (shot.result === 'sunk' && shot.sunkPlacement) {
      const { row, col, horizontal, type } = shot.sunkPlacement;
      const ship = state.settings.fleet.find((definition) => definition.id === type);
      for (let i = 0; i < (ship?.length ?? 0); i++) {
        cells[horizontal ? row : row + i]![horizontal ? col + i : col] = 'sunk';
      }
    } else {
      cells[shot.row]![shot.col] = 'hit';
    }
  }
  return cells;
}

export function defaultSettings(mode: GameMode = 'classic'): GameSettings {
  return {
    mode,
    boardSize: GAME_CONFIG.BOARD_SIZE,
    fleet: FLEET_DEFINITION.map((ship) => ({ ...ship })),
  };
}

export type { Coordinate, ShipPlacement, ShipType, Shot };
