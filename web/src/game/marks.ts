/** Turns shot lists + fleets into per-cell marks for the Board component. Pure, unit-tested. */
import type { CellMark } from '../components/Board';
import { cellKey, cellsOf, COLUMN_LABELS, ROW_LABELS, type Coordinate, type ShipPlacement, type Shot } from './placement';

/** "B4"-style label for a cell. */
export function coordLabel(c: Coordinate): string {
  return `${COLUMN_LABELS[c.col] ?? '?'}${ROW_LABELS[c.row] ?? '?'}`;
}

export interface MarkIndex {
  marks: Map<string, CellMark>;
  lastShot: Coordinate | null;
}

/**
 * Marks for a grid being fired at (opponent's grid from my point of view, or my grid from theirs).
 * `fleet` is optional: pass it to draw un-hit ship cells (only possible for my own board, or once revealed).
 */
export function buildMarks(shots: Shot[], fleet?: ShipPlacement[], revealed = false): MarkIndex {
  const marks = new Map<string, CellMark>();
  if (fleet) {
    for (const ship of fleet) for (const c of cellsOf(ship)) marks.set(cellKey(c.row, c.col), revealed ? 'revealed' : 'ship');
  }
  for (const shot of shots) {
    marks.set(cellKey(shot.row, shot.col), shot.result === 'miss' ? 'miss' : 'hit');
  }
  // Paint whole sunk ships last so every cell of a sunk ship reads as "sunk".
  for (const shot of shots) {
    if (shot.result === 'sunk' && shot.sunkPlacement) {
      for (const c of cellsOf(shot.sunkPlacement)) marks.set(cellKey(c.row, c.col), 'sunk');
    }
  }
  const last = shots.length > 0 ? shots[shots.length - 1] : undefined;
  return { marks, lastShot: last ? { row: last.row, col: last.col } : null };
}

export function markAt(index: MarkIndex, c: Coordinate): CellMark {
  return index.marks.get(cellKey(c.row, c.col)) ?? 'water';
}

export function alreadyShot(shots: Shot[], c: Coordinate): boolean {
  return shots.some((s) => s.row === c.row && s.col === c.col);
}
