import { describe, expect, it } from 'vitest';
import { SHIP_LENGTHS, SHIP_TYPES, TOTAL_SHIP_CELLS } from './config';
import {
  cellKey,
  cellsOf,
  coordinateLabel,
  isFleetDestroyed,
  isOnBoard,
  placementProblem,
  randomFleet,
  resolveShot,
  shotsToKeySet,
  validateFleet,
  type ShipPlacement,
} from './engine';

/** A legal, well-spread fleet used across tests. */
const FLEET: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true }, // A1–E1
  { type: 'battleship', row: 2, col: 0, horizontal: true }, // A3–D3
  { type: 'cruiser', row: 4, col: 0, horizontal: true }, // A5–C5
  { type: 'submarine', row: 6, col: 0, horizontal: true }, // A7–C7
  { type: 'destroyer', row: 8, col: 0, horizontal: true }, // A9–B9
];

describe('board geometry', () => {
  it('knows which cells are on the board', () => {
    expect(isOnBoard(0, 0)).toBe(true);
    expect(isOnBoard(9, 9)).toBe(true);
    expect(isOnBoard(-1, 0)).toBe(false);
    expect(isOnBoard(0, 10)).toBe(false);
    expect(isOnBoard(1.5, 0)).toBe(false);
  });

  it('expands a placement into its cells', () => {
    expect(cellsOf({ type: 'destroyer', row: 3, col: 4, horizontal: true })).toEqual([
      { row: 3, col: 4 },
      { row: 3, col: 5 },
    ]);
    expect(cellsOf({ type: 'cruiser', row: 3, col: 4, horizontal: false })).toEqual([
      { row: 3, col: 4 },
      { row: 4, col: 4 },
      { row: 5, col: 4 },
    ]);
  });

  it('labels coordinates as letter+number', () => {
    expect(coordinateLabel(0, 0)).toBe('A1');
    expect(coordinateLabel(9, 9)).toBe('J10');
    expect(coordinateLabel(4, 2)).toBe('C5');
  });

  it('fleet totals 17 cells', () => {
    expect(TOTAL_SHIP_CELLS).toBe(17);
    expect(SHIP_TYPES.map((t) => SHIP_LENGTHS[t])).toEqual([5, 4, 3, 3, 2]);
  });
});

describe('placementProblem', () => {
  it('accepts a ship fully on the board with no neighbours', () => {
    expect(placementProblem({ type: 'carrier', row: 0, col: 5, horizontal: true }, [])).toBeNull();
    expect(placementProblem({ type: 'carrier', row: 5, col: 9, horizontal: false }, [])).toBeNull();
  });

  it('rejects ships hanging off the edge', () => {
    expect(placementProblem({ type: 'carrier', row: 0, col: 6, horizontal: true }, [])).toBe('off_board');
    expect(placementProblem({ type: 'destroyer', row: 9, col: 0, horizontal: false }, [])).toBe('off_board');
    expect(placementProblem({ type: 'destroyer', row: -1, col: 0, horizontal: false }, [])).toBe('off_board');
  });

  it('rejects overlaps', () => {
    const others: ShipPlacement[] = [{ type: 'carrier', row: 0, col: 0, horizontal: true }];
    expect(placementProblem({ type: 'destroyer', row: 0, col: 4, horizontal: false }, others)).toBe('overlap');
  });

  it('allows touching ships (ALLOW_TOUCHING_SHIPS = true)', () => {
    const others: ShipPlacement[] = [{ type: 'carrier', row: 0, col: 0, horizontal: true }];
    expect(placementProblem({ type: 'destroyer', row: 1, col: 0, horizontal: true }, others)).toBeNull();
  });

  it('ignores the previous position of the same ship so it can be moved', () => {
    const others: ShipPlacement[] = [{ type: 'carrier', row: 0, col: 0, horizontal: true }];
    expect(placementProblem({ type: 'carrier', row: 0, col: 1, horizontal: true }, others)).toBeNull();
  });
});

describe('validateFleet', () => {
  it('accepts a legal fleet', () => {
    const result = validateFleet(FLEET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fleet).toHaveLength(5);
  });

  it('rejects non-arrays and wrong counts', () => {
    expect(validateFleet(null).ok).toBe(false);
    expect(validateFleet(FLEET.slice(0, 4)).ok).toBe(false);
    expect(validateFleet([...FLEET, FLEET[0]]).ok).toBe(false);
  });

  it('rejects duplicate ship types', () => {
    const dup = [...FLEET.slice(0, 4), { type: 'carrier', row: 9, col: 0, horizontal: true }];
    const result = validateFleet(dup);
    expect(result).toEqual({ ok: false, reason: 'Duplicate ship: carrier' });
  });

  it('rejects malformed input', () => {
    const bad = [...FLEET.slice(0, 4), { type: 'dinghy', row: 9, col: 0, horizontal: true }];
    expect(validateFleet(bad).ok).toBe(false);
    const bad2 = [...FLEET.slice(0, 4), { type: 'destroyer', row: '9', col: 0, horizontal: true }];
    expect(validateFleet(bad2).ok).toBe(false);
  });

  it('rejects overlapping and off-board ships with a readable reason', () => {
    const overlap = [...FLEET.slice(0, 4), { type: 'destroyer', row: 0, col: 0, horizontal: false }];
    expect(validateFleet(overlap)).toEqual({ ok: false, reason: 'destroyer overlaps another ship' });
    const off = [...FLEET.slice(0, 4), { type: 'destroyer', row: 9, col: 9, horizontal: true }];
    expect(validateFleet(off)).toEqual({ ok: false, reason: 'destroyer is off the board' });
  });

  it('strips unknown fields from the stored fleet', () => {
    const withExtra = FLEET.map((s) => ({ ...s, secret: 'x' }));
    const result = validateFleet(withExtra);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.fleet[0]!)).toEqual(['type', 'row', 'col', 'horizontal']);
  });
});

describe('resolveShot', () => {
  it('reports a miss on empty water', () => {
    expect(resolveShot(FLEET, new Set(), { row: 9, col: 9 })).toEqual({ result: 'miss' });
  });

  it('reports a hit on a ship that still has cells left', () => {
    expect(resolveShot(FLEET, new Set(), { row: 8, col: 0 })).toEqual({ result: 'hit' });
  });

  it('reports sunk when the last cell of a ship is hit', () => {
    const prior = new Set([cellKey(8, 0)]);
    expect(resolveShot(FLEET, prior, { row: 8, col: 1 })).toEqual({ result: 'sunk', sunkShip: 'destroyer' });
  });

  it('sinks the carrier only after all five cells are hit', () => {
    const prior = new Set([0, 1, 2, 3].map((c) => cellKey(0, c)));
    expect(resolveShot(FLEET, prior, { row: 0, col: 4 })).toEqual({ result: 'sunk', sunkShip: 'carrier' });
    expect(resolveShot(FLEET, new Set([0, 1, 2].map((c) => cellKey(0, c))), { row: 0, col: 4 })).toEqual({ result: 'hit' });
  });
});

describe('isFleetDestroyed', () => {
  it('is false until every ship cell is hit, then true', () => {
    const hits = new Set<string>();
    for (const ship of FLEET) {
      for (const c of cellsOf(ship)) {
        expect(isFleetDestroyed(FLEET, hits)).toBe(false);
        hits.add(cellKey(c.row, c.col));
      }
    }
    expect(hits.size).toBe(TOTAL_SHIP_CELLS);
    expect(isFleetDestroyed(FLEET, hits)).toBe(true);
  });

  it('ignores misses in the hit set', () => {
    const hits = new Set<string>(['9,9']);
    expect(isFleetDestroyed(FLEET, hits)).toBe(false);
  });
});

describe('helpers', () => {
  it('shotsToKeySet builds a lookup of fired cells', () => {
    const set = shotsToKeySet([
      { row: 1, col: 2 },
      { row: 3, col: 4 },
    ]);
    expect(set.has('1,2')).toBe(true);
    expect(set.has('2,1')).toBe(false);
  });

  it('randomFleet always produces a valid fleet', () => {
    // Deterministic LCG so the test is reproducible.
    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 50; i++) {
      expect(validateFleet(randomFleet(rng)).ok).toBe(true);
    }
  });
});
