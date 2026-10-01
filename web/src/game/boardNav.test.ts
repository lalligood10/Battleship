import { describe, expect, it } from 'vitest';
import { isInteractive, moveFocus } from './boardNav';

describe('moveFocus', () => {
  it('moves one cell in each direction', () => {
    const c = { row: 4, col: 5 };
    expect(moveFocus(c, 'ArrowUp', false)).toEqual({ row: 3, col: 5 });
    expect(moveFocus(c, 'ArrowDown', false)).toEqual({ row: 5, col: 5 });
    expect(moveFocus(c, 'ArrowLeft', false)).toEqual({ row: 4, col: 4 });
    expect(moveFocus(c, 'ArrowRight', false)).toEqual({ row: 4, col: 6 });
  });

  it('clamps movement at every edge', () => {
    expect(moveFocus({ row: 0, col: 0 }, 'ArrowUp', false)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 0, col: 0 }, 'ArrowLeft', false)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 9, col: 9 }, 'ArrowDown', false)).toEqual({ row: 9, col: 9 });
    expect(moveFocus({ row: 9, col: 9 }, 'ArrowRight', false)).toEqual({ row: 9, col: 9 });
  });

  it('moves Home and End within the row', () => {
    expect(moveFocus({ row: 4, col: 5 }, 'Home', false)).toEqual({ row: 4, col: 0 });
    expect(moveFocus({ row: 4, col: 5 }, 'End', false)).toEqual({ row: 4, col: 9 });
  });

  it('moves Ctrl+Home and Ctrl+End to opposite board corners', () => {
    expect(moveFocus({ row: 4, col: 5 }, 'Home', true)).toEqual({ row: 0, col: 0 });
    expect(moveFocus({ row: 4, col: 5 }, 'End', true)).toEqual({ row: 9, col: 9 });
  });

  it('returns null for keys unrelated to navigation', () => {
    expect(moveFocus({ row: 4, col: 5 }, 'Enter', false)).toBeNull();
    expect(moveFocus({ row: 4, col: 5 }, 'x', false)).toBeNull();
  });
});

describe('isInteractive', () => {
  it('allows every mark outside targeting mode', () => {
    expect(isInteractive('water', {})).toBe(true);
    expect(isInteractive('miss', {})).toBe(true);
    expect(isInteractive('hit', {})).toBe(true);
  });

  it('allows only water while targeting', () => {
    expect(isInteractive('water', { targeting: true })).toBe(true);
    expect(isInteractive('miss', { targeting: true })).toBe(false);
    expect(isInteractive('hit', { targeting: true })).toBe(false);
  });

  it('rejects every mark when the board is disabled', () => {
    expect(isInteractive('water', { disabled: true })).toBe(false);
    expect(isInteractive('water', { targeting: true, disabled: true })).toBe(false);
    expect(isInteractive('miss', { disabled: true })).toBe(false);
  });
});
