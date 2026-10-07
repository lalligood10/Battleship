import { describe, expect, it } from 'vitest';
import { defaultFleet } from './placement';
import { placementGridKey, rotateSelected, type PlacementKeyState } from './placementKeys';

const state = (overrides: Partial<PlacementKeyState> = {}): PlacementKeyState => ({
  fleet: defaultFleet(),
  selected: 'carrier',
  carrying: null,
  ...overrides,
});

describe('placementGridKey', () => {
  it('picks up the ship under the focused cell', () => {
    const result = placementGridKey(state(), 'Enter', { row: 0, col: 0 });
    expect(result?.selected).toBe('carrier');
    expect(result?.carrying?.original).toMatchObject({ type: 'carrier', row: 0, col: 0 });
    expect(result?.announcement).toBe('Carrier picked up. Arrow keys move, R rotates, Enter places, Escape cancels.');
  });

  it('moves a carried ship and follows the grabbed offset with focus', () => {
    const pickedUp = placementGridKey(state(), 'Enter', { row: 0, col: 3 })!;
    const moved = placementGridKey(pickedUp, 'ArrowRight', { row: 0, col: 3 })!;
    expect(moved.fleet.find((ship) => ship.type === 'carrier')).toMatchObject({ row: 0, col: 1 });
    expect(moved.focus).toEqual({ row: 0, col: 4 });
  });

  it('clamps carried movement at the board edge', () => {
    const pickedUp = placementGridKey(state(), 'Enter', { row: 0, col: 0 })!;
    const moved = placementGridKey(pickedUp, 'ArrowLeft', { row: 0, col: 0 })!;
    expect(moved.fleet.find((ship) => ship.type === 'carrier')).toMatchObject({ row: 0, col: 0 });
    expect(moved.focus).toEqual({ row: 0, col: 0 });
  });

  it('rotates a carried ship from its new origin', () => {
    const pickedUp = placementGridKey(state(), 'Enter', { row: 0, col: 3 })!;
    const rotated = rotateSelected(pickedUp);
    expect(rotated.fleet.find((ship) => ship.type === 'carrier')).toMatchObject({ horizontal: false });
    expect(rotated.carrying?.drag).toMatchObject({ offsetRow: 0, offsetCol: 0 });
    expect(rotated.focus).toEqual({ row: 0, col: 0 });
    expect(rotated.announcement).toContain('Carrier vertical');
  });

  it('drops a valid carried placement', () => {
    let pickedUp = placementGridKey(state(), 'Enter', { row: 0, col: 0 })!;
    let focus = { row: 0, col: 0 };
    for (let step = 0; step < 5; step++) {
      const moved = placementGridKey(pickedUp, 'ArrowRight', focus)!;
      pickedUp = moved;
      focus = moved.focus!;
    }
    const dropped = placementGridKey(pickedUp, 'Enter', focus)!;
    expect(dropped.carrying).toBeNull();
    expect(dropped.fleet.find((ship) => ship.type === 'carrier')).toMatchObject({ row: 0, col: 5 });
    expect(dropped.announcement).toBe('Carrier placed at F1');
  });

  it('drops an invalid carried placement and announces the overlap', () => {
    let pickedUp = placementGridKey(state(), 'Enter', { row: 0, col: 0 })!;
    pickedUp = rotateSelected(pickedUp);
    let focus = { row: 0, col: 0 };
    for (let step = 0; step < 2; step++) {
      const moved = placementGridKey(pickedUp, 'ArrowDown', focus)!;
      pickedUp = moved;
      focus = moved.focus!;
    }
    const dropped = placementGridKey(pickedUp, 'Enter', focus)!;
    expect(dropped.carrying).toBeNull();
    expect(dropped.announcement).toContain('Overlaps Battleship');
  });

  it('restores the original placement on Escape', () => {
    let pickedUp = placementGridKey(state(), 'Enter', { row: 0, col: 1 })!;
    pickedUp = placementGridKey(pickedUp, 'ArrowDown', { row: 0, col: 1 })!;
    const cancelled = placementGridKey(pickedUp, 'Escape', pickedUp.focus!)!;
    expect(cancelled.fleet).toEqual(defaultFleet());
    expect(cancelled.carrying).toBeNull();
    expect(cancelled.focus).toEqual({ row: 0, col: 0 });
    expect(cancelled.announcement).toBe('Carrier returned to A1');
  });

  it('places the selected ship on water and focuses its origin', () => {
    const result = placementGridKey(state(), ' ', { row: 0, col: 5 });
    expect(result?.fleet.find((ship) => ship.type === 'carrier')).toMatchObject({ row: 0, col: 5 });
    expect(result?.focus).toEqual({ row: 0, col: 5 });
    expect(result?.announcement).toBe('Carrier placed at F1');
  });

  it('leaves arrows unhandled when no ship is carried', () => {
    expect(placementGridKey(state(), 'ArrowRight', { row: 0, col: 0 })).toBeNull();
  });
});
