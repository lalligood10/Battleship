import { GAME_CONFIG, SHIP_LENGTHS, SHIP_TYPES, type ShipType } from '../config';
import type { Coordinate, ShipPlacement, Shot } from '../engine';
import type { AbilityLogEntry } from './modes/types';

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
export type GameMode = 'classic' | 'salvo' | 'abilities';

export interface GameModeOption {
  mode: GameMode;
  label: string;
  description: string;
  howToPlay: string;
}

export const GAME_MODE_OPTIONS: readonly GameModeOption[] = [
  {
    mode: 'classic',
    label: 'Classic',
    description: 'One shot per turn. Sink all five enemy ships to win.',
    howToPlay: 'Tap a cell on the enemy board to fire. Hits stay marked; find and finish every ship before they find yours.',
  },
  {
    mode: 'salvo',
    label: 'Salvo',
    description: 'Fire one shot for each ship you still have afloat. Lose ships, lose firepower.',
    howToPlay: 'Tap cells to queue your volley, tap again to remove one, then press Fire when the count is full. All shots land together.',
  },
  {
    mode: 'abilities',
    label: 'Abilities',
    description: 'Use one ship power instead of a normal shot. Each power works once per game.',
    howToPlay: 'Carrier airstrike hits 3 cells in a line, submarine sonar scans a 3×3 area, destroyer relocates once if undamaged. A power is lost if its ship sinks.',
  },
] as const;

export function parseGameModeInput(value: unknown): GameMode | null {
  if (value === undefined) return 'classic';
  return value === 'classic' || value === 'salvo' || value === 'abilities' ? value : null;
}

export function gameModeOption(mode: GameMode): GameModeOption {
  const option = GAME_MODE_OPTIONS.find((item) => item.mode === mode);
  if (!option) throw new Error(`No game mode option is defined for "${mode}"`);
  return option;
}
export type EndReason = 'all_sunk' | 'resign' | 'timeout';

export interface GameSettings {
  mode: GameMode;
  boardSize: number;
  fleet: ShipDefinition[];
  abandonTimeoutMs: number;
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
  lastProgressAt: number;
  boards: Record<string, PlayerBoard>;
  shots: Record<string, Shot[]>;
  winner: string | null;
  endReason: EndReason | null;
  /** Public ability uses, in order. Empty outside Abilities games. */
  abilityLog: AbilityLogEntry[];
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
    abandonTimeoutMs: GAME_CONFIG.ABANDON_TIMEOUT_MS,
  };
}

export type { Coordinate, ShipPlacement, ShipType, Shot };
