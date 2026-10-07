import { describe, expect, it } from 'vitest';
import { trapTabIndex } from './focusTrap';

describe('trapTabIndex', () => {
  it('wraps Tab from the last element to the first', () => {
    expect(trapTabIndex(3, 2, false)).toBe(0);
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    expect(trapTabIndex(3, 0, true)).toBe(2);
  });

  it('leaves moves between inner elements to the browser', () => {
    expect(trapTabIndex(3, 0, false)).toBeNull();
    expect(trapTabIndex(3, 1, false)).toBeNull();
    expect(trapTabIndex(3, 2, true)).toBeNull();
  });

  it('pulls focus back in when it is outside the dialog', () => {
    expect(trapTabIndex(3, -1, false)).toBe(0);
    expect(trapTabIndex(3, -1, true)).toBe(2);
  });

  it('keeps a single focusable element focused', () => {
    expect(trapTabIndex(1, 0, false)).toBe(0);
    expect(trapTabIndex(1, 0, true)).toBe(0);
  });

  it('does nothing when the dialog has no focusable elements', () => {
    expect(trapTabIndex(0, -1, false)).toBeNull();
  });
});
