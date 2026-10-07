import { cellKey, type Coordinate } from './placement';

export function toggleSalvoTarget(
  queue: readonly Coordinate[],
  target: Coordinate,
  allowed: number,
  firedCells: ReadonlySet<string>,
): Coordinate[] {
  if (firedCells.has(cellKey(target.row, target.col))) return [...queue];
  const index = queue.findIndex((cell) => cell.row === target.row && cell.col === target.col);
  if (index >= 0) return queue.filter((_, queueIndex) => queueIndex !== index);
  if (queue.length >= allowed) return [...queue];
  return [...queue, { ...target }];
}

export function salvoQueueReady(queue: readonly Coordinate[], allowed: number): boolean {
  return allowed > 0 && queue.length === allowed;
}

export function salvoQueueNumber(queue: readonly Coordinate[], target: Coordinate): number | undefined {
  const index = queue.findIndex((cell) => cell.row === target.row && cell.col === target.col);
  return index < 0 ? undefined : index + 1;
}
