import { BOARD_SIZE, type Coordinate } from './placement';

export type CellMark = 'water' | 'ship' | 'ship-invalid' | 'miss' | 'hit' | 'sunk' | 'revealed';
export type FocusContext = 'none' | 'fire-control' | 'board' | 'elsewhere';

export function focusReturnTarget(context: FocusContext, fired: readonly Coordinate[]): Coordinate | null {
  if (context === 'elsewhere' || fired.length === 0) return null;
  return fired[fired.length - 1] ?? null;
}

export function moveFocus(c: Coordinate, key: string, ctrl: boolean): Coordinate | null {
  let { row, col } = c;

  switch (key) {
    case 'ArrowUp':
      row = Math.max(0, row - 1);
      break;
    case 'ArrowDown':
      row = Math.min(BOARD_SIZE - 1, row + 1);
      break;
    case 'ArrowLeft':
      col = Math.max(0, col - 1);
      break;
    case 'ArrowRight':
      col = Math.min(BOARD_SIZE - 1, col + 1);
      break;
    case 'Home':
      if (ctrl) row = 0;
      col = 0;
      break;
    case 'End':
      if (ctrl) row = BOARD_SIZE - 1;
      col = BOARD_SIZE - 1;
      break;
    default:
      return null;
  }

  return { row, col };
}

export function isInteractive(mark: CellMark, options: { targeting?: boolean; disabled?: boolean }): boolean {
  return !options.disabled && (!options.targeting || mark === 'water');
}
