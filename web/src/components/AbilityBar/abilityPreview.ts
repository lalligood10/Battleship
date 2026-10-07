import { SHIP_LENGTHS } from '@shared/config';
import type { Coordinate } from '@shared/engine';
import { airstrikeCells, sonarCells } from '@shared/core/modes/abilities';
import type { AbilityId } from '@shared/core/modes/types';

export interface AbilityPreview {
  cells: Coordinate[];
  board: 'enemy' | 'own';
}

/** Board-clipped cells an ability would affect if aimed at `target`. Validity is the rules module's call. */
export function abilityPreview(
  id: AbilityId,
  target: Coordinate,
  horizontal: boolean,
  boardSize: number,
): AbilityPreview {
  const onBoard = (cell: Coordinate) => cell.row >= 0 && cell.row < boardSize && cell.col >= 0 && cell.col < boardSize;
  if (id === 'carrier-airstrike') {
    return { cells: airstrikeCells({ row: target.row, col: target.col, horizontal }, boardSize).filter(onBoard), board: 'enemy' };
  }
  if (id === 'submarine-sonar') {
    return { cells: sonarCells({ row: target.row, col: target.col }, boardSize).filter(onBoard), board: 'enemy' };
  }
  const cells = Array.from({ length: SHIP_LENGTHS.destroyer }, (_, i) =>
    horizontal ? { row: target.row, col: target.col + i } : { row: target.row + i, col: target.col },
  );
  return { cells: cells.filter(onBoard), board: 'own' };
}

export const ABILITY_PREVIEW_CLASS = 'ability-preview';
export const ABILITY_PREVIEW_INVALID_CLASS = 'ability-preview--invalid';
