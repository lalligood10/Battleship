import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  clampToBoard,
  defaultFleet,
  dragTo,
  fleetIsValid,
  placeAt,
  problemFor,
  randomFleet,
  rotateShip,
  SHIP_LENGTHS,
  shipAt,
  startDrag,
} from './placement';

describe('placement editor helpers', () => {
  it('starts with a valid default fleet', () => {
    expect(fleetIsValid(defaultFleet())).toBe(true);
  });

  it('shuffle produces a valid fleet every time', () => {
    for (let i = 0; i < 50; i++) expect(fleetIsValid(randomFleet())).toBe(true);
  });

  it('clamps ships back onto the board', () => {
    const carrier = clampToBoard({ type: 'carrier', row: 0, col: 8, horizontal: true });
    expect(carrier.col).toBe(BOARD_SIZE - SHIP_LENGTHS.carrier);
    const vertical = clampToBoard({ type: 'battleship', row: 9, col: -3, horizontal: false });
    expect(vertical).toMatchObject({ row: BOARD_SIZE - SHIP_LENGTHS.battleship, col: 0 });
  });

  it('finds the ship under a cell', () => {
    const fleet = defaultFleet();
    expect(shipAt(fleet, { row: 0, col: 4 })?.type).toBe('carrier');
    expect(shipAt(fleet, { row: 8, col: 1 })?.type).toBe('destroyer');
    expect(shipAt(fleet, { row: 9, col: 9 })).toBeUndefined();
  });

  it('flags overlaps after a tap-to-place and clears them after moving away', () => {
    let fleet = placeAt(defaultFleet(), 'destroyer', { row: 0, col: 1 });
    expect(problemFor(fleet, 'destroyer')).toBe('overlap');
    expect(fleetIsValid(fleet)).toBe(false);
    fleet = placeAt(fleet, 'destroyer', { row: 9, col: 5 });
    expect(problemFor(fleet, 'destroyer')).toBeNull();
    expect(fleetIsValid(fleet)).toBe(true);
  });

  it('rotates around the first cell and nudges back on board', () => {
    const fleet = placeAt(defaultFleet(), 'carrier', { row: 9, col: 0 });
    const rotated = rotateShip(fleet, 'carrier');
    const carrier = rotated.find((s) => s.type === 'carrier');
    expect(carrier).toMatchObject({ horizontal: false, col: 0, row: BOARD_SIZE - SHIP_LENGTHS.carrier });
  });

  it('drags keep the grabbed cell under the pointer', () => {
    const fleet = defaultFleet();
    const drag = startDrag(fleet, { row: 0, col: 3 });
    expect(drag).toEqual({ type: 'carrier', offsetRow: 0, offsetCol: 3 });
    const moved = dragTo(fleet, drag!, { row: 5, col: 6 });
    expect(moved.find((s) => s.type === 'carrier')).toMatchObject({ row: 5, col: 3, horizontal: true });
  });

  it('dragging water does nothing', () => {
    expect(startDrag(defaultFleet(), { row: 9, col: 9 })).toBeNull();
  });
});
