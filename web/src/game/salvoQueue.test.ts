import { describe, expect, it } from 'vitest';
import type { Coordinate } from './placement';
import { salvoQueueNumber, salvoQueueReady, toggleSalvoTarget } from './salvoQueue';

const a: Coordinate = { row: 1, col: 2 };
const b: Coordinate = { row: 3, col: 4 };
const c: Coordinate = { row: 5, col: 6 };

describe('Salvo target queue', () => {
  it('toggles queued targets and keeps their order', () => {
    const queue = toggleSalvoTarget(toggleSalvoTarget([], a, 2, new Set()), b, 2, new Set());
    expect(queue).toEqual([a, b]);
    expect(salvoQueueNumber(queue, a)).toBe(1);
    expect(salvoQueueNumber(queue, b)).toBe(2);
    expect(toggleSalvoTarget(queue, a, 2, new Set())).toEqual([b]);
  });

  it('caps the queue at the allowed shot count', () => {
    expect(toggleSalvoTarget([a, b], c, 2, new Set())).toEqual([a, b]);
  });

  it('rejects cells that have already been fired upon', () => {
    expect(toggleSalvoTarget([a], b, 3, new Set(['3,4']))).toEqual([a]);
  });

  it('is ready only when the queue exactly matches the allowance', () => {
    expect(salvoQueueReady([], 0)).toBe(false);
    expect(salvoQueueReady([a], 2)).toBe(false);
    expect(salvoQueueReady([a, b], 2)).toBe(true);
    expect(salvoQueueReady([a, b, c], 2)).toBe(false);
    expect(salvoQueueNumber([], a)).toBeUndefined();
  });
});
