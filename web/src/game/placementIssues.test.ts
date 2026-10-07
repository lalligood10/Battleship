import { describe, expect, it, vi } from 'vitest';
import { validateFleet } from '@shared/engine';
import * as placement from './placement';
import { defaultFleet, fleetIsValid, placeAt, randomFleet, SHIP_TYPES, type ShipPlacement } from './placement';
import { describeIssue, fleetIssues, placementIssue } from './placementIssues';

describe('placement issues', () => {
  it('describes overlaps with the other ship name', () => {
    const fleet = placeAt(defaultFleet(), 'carrier', { row: 2, col: 1 });
    expect(describeIssue(placementIssue(fleet, 'carrier')!)).toBe('Overlaps Battleship');
  });

  it('describes diagonal 8-neighbour touching with the other ship name', () => {
    const fleet = placeAt(defaultFleet(), 'battleship', { row: 1, col: 5 });
    vi.spyOn(placement, 'problemFor').mockImplementation((_fleet, type) => type === 'carrier' ? 'touching' : null);
    try {
      expect(describeIssue(placementIssue(fleet, 'carrier')!)).toBe('Touching Battleship');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('describes off-board placements', () => {
    const fleet = defaultFleet().map((ship) =>
      ship.type === 'carrier' ? { ...ship, col: 8 } : ship,
    );
    expect(describeIssue(placementIssue(fleet, 'carrier')!)).toBe('Off the board');
  });

  it('returns no issues for the default fleet', () => {
    expect(fleetIssues(defaultFleet())).toEqual([]);
  });

  it('keeps seeded random fleets valid under both client and server rules', () => {
    let seed = 0x6d2b79f5;
    const rng = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };

    for (let run = 0; run < 200; run++) {
      const fleet = randomFleet(rng);
      expect(SHIP_TYPES.every((type) => fleet.some((ship: ShipPlacement) => ship.type === type))).toBe(true);
      expect(fleetIsValid(fleet)).toBe(true);
      expect(validateFleet(fleet).ok).toBe(true);
    }
  });
});
