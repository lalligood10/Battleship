import { describe, expect, it } from 'vitest';
import { isFleetDestroyed, resolveShot, shotsToKeySet } from '@shared/engine';
import { alreadyShot, buildMarks, coordLabel, markAt } from './marks';
import type { ShipPlacement, Shot } from './placement';

const destroyer: ShipPlacement = { type: 'destroyer', row: 2, col: 3, horizontal: true };
const shot = (row: number, col: number, result: Shot['result'], extra: Partial<Shot> = {}): Shot => ({
  row,
  col,
  result,
  at: 0,
  ...extra,
});

describe('board marks', () => {
  it('labels cells like a sailor', () => {
    expect(coordLabel({ row: 0, col: 0 })).toBe('A1');
    expect(coordLabel({ row: 9, col: 9 })).toBe('J10');
    expect(coordLabel({ row: 3, col: 1 })).toBe('B4');
  });

  it('paints misses, hits and whole sunk ships', () => {
    const shots = [
      shot(0, 0, 'miss'),
      shot(2, 3, 'hit'),
      shot(2, 4, 'sunk', { sunkShip: 'destroyer', sunkPlacement: destroyer }),
    ];
    const idx = buildMarks(shots);
    expect(markAt(idx, { row: 0, col: 0 })).toBe('miss');
    expect(markAt(idx, { row: 2, col: 3 })).toBe('sunk');
    expect(markAt(idx, { row: 2, col: 4 })).toBe('sunk');
    expect(markAt(idx, { row: 5, col: 5 })).toBe('water');
    expect(idx.lastShot).toEqual({ row: 2, col: 4 });
  });

  it('draws my own un-hit ship cells but never the opponent’s (no fleet passed)', () => {
    const mine = buildMarks([shot(2, 3, 'hit')], [destroyer]);
    expect(markAt(mine, { row: 2, col: 4 })).toBe('ship');
    expect(markAt(mine, { row: 2, col: 3 })).toBe('hit');
    const theirs = buildMarks([shot(2, 3, 'hit')]);
    expect(markAt(theirs, { row: 2, col: 4 })).toBe('water');
  });

  it('knows which cells were already fired at', () => {
    const shots = [shot(1, 1, 'miss')];
    expect(alreadyShot(shots, { row: 1, col: 1 })).toBe(true);
    expect(alreadyShot(shots, { row: 1, col: 2 })).toBe(false);
  });
});

describe('shared engine (same code the server runs)', () => {
  it('reports hit, then sunk, and win when the fleet is gone', () => {
    const fleet = [destroyer];
    const first = resolveShot(fleet, new Set(), { row: 2, col: 3 });
    expect(first.result).toBe('hit');
    const hits = shotsToKeySet([shot(2, 3, 'hit')]);
    const second = resolveShot(fleet, hits, { row: 2, col: 4 });
    expect(second).toEqual({ result: 'sunk', sunkShip: 'destroyer' });
    expect(isFleetDestroyed(fleet, shotsToKeySet([shot(2, 3, 'hit'), shot(2, 4, 'sunk')]))).toBe(true);
    expect(resolveShot(fleet, new Set(), { row: 9, col: 9 }).result).toBe('miss');
  });
});
