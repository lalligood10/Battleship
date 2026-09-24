/**
 * 10×10 grid with A–J / 1–10 labels. Rendering is driven by `markOf(cell)`; interaction by optional
 * `onCellTap` (single tap/click) and `onDrag*` (pointer drag across cells, used for ship placement).
 */
import { useRef, type PointerEvent, type ReactNode } from 'react';
import { BOARD_SIZE, COLUMN_LABELS, ROW_LABELS, type Coordinate } from '../game/placement';

export type CellMark =
  | 'water'
  | 'ship'
  | 'ship-invalid'
  | 'miss'
  | 'hit'
  | 'sunk'
  | 'revealed';

export interface BoardProps {
  markOf: (c: Coordinate) => CellMark;
  selected?: (c: Coordinate) => boolean;
  lastShot?: Coordinate | null;
  /** When true, water cells are tappable targets (hover styling, pointer cursor). */
  targeting?: boolean;
  disabled?: boolean;
  small?: boolean;
  ariaLabel: string;
  onCellTap?: (c: Coordinate) => void;
  onDragStart?: (c: Coordinate) => boolean;
  onDragMove?: (c: Coordinate) => void;
  onDragEnd?: () => void;
  /** Decorative overlay rendered above the 10×10 cell area (labels excluded). */
  overlay?: ReactNode;
}

const DRAG_THRESHOLD_PX = 6;

export function Board(props: BoardProps) {
  const { markOf, selected, lastShot, targeting, disabled, small, ariaLabel, overlay, onCellTap, onDragStart, onDragMove, onDragEnd } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: Coordinate; startX: number; startY: number; dragging: boolean; active: boolean } | null>(null);

  const cellFromPoint = (x: number, y: number): Coordinate | null => {
    const el = document.elementFromPoint(x, y);
    const target = el?.closest<HTMLElement>('[data-row]');
    if (!target || !gridRef.current?.contains(target)) return null;
    return { row: Number(target.dataset.row), col: Number(target.dataset.col) };
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const c = cellFromPoint(e.clientX, e.clientY);
    if (!c) return;
    drag.current = { start: c, startX: e.clientX, startY: e.clientY, dragging: false, active: false };
    gridRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !onDragStart || !onDragMove) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.dragging = true;
      d.active = onDragStart(d.start);
    }
    if (!d.active) return;
    const c = cellFromPoint(e.clientX, e.clientY);
    if (c) onDragMove(c);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (gridRef.current?.hasPointerCapture(e.pointerId)) gridRef.current.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.dragging) {
      if (d.active) onDragEnd?.();
      return;
    }
    onCellTap?.(d.start);
  };

  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    cells.push(
      <div className="label" key={`r${row}`} aria-hidden>
        {ROW_LABELS[row]}
      </div>,
    );
    for (let col = 0; col < BOARD_SIZE; col++) {
      const c = { row, col };
      const mark = markOf(c);
      const isLast = lastShot?.row === row && lastShot?.col === col;
      const classes = ['cell', `cell--${mark}`];
      if (selected?.(c)) classes.push('cell--selected');
      if (isLast) classes.push('cell--last');
      if (targeting && mark === 'water' && !disabled) classes.push('cell--target');
      if (disabled || (targeting && mark !== 'water')) classes.push('cell--disabled');
      cells.push(
        <div
          key={`${row}-${col}`}
          className={classes.join(' ')}
          data-row={row}
          data-col={col}
          role="gridcell"
          aria-label={`${COLUMN_LABELS[col]}${ROW_LABELS[row]} ${mark}`}
        />,
      );
    }
  }

  return (
    <div className={`board-shell${small ? ' board-shell--sm' : ''}`}>
      {/* Decorative sea frame: swell, drifting cloud banks and burning wrecks outside the grid. */}
      <div className="board-sea fx" aria-hidden>
        <span className="sea-swell" />
        <span className="sea-clouds" />
        <span className="sea-fire sea-fire--a" />
        <span className="sea-fire sea-fire--b" />
        <span className="sea-fire sea-fire--c" />
      </div>
      <div
        ref={gridRef}
        className={`board${small ? ' board--sm' : ''}`}
        role="grid"
        aria-label={ariaLabel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="label" aria-hidden />
        {COLUMN_LABELS.map((l) => (
          <div className="label" key={l} aria-hidden>
            {l}
          </div>
        ))}
        {cells}
        <div className="board-fx fx" style={{ left: 24, top: 20 }} aria-hidden>
          {overlay}
        </div>
      </div>
    </div>
  );
}
