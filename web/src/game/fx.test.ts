import { describe, expect, it } from 'vitest';
import { fxDurationMs, strikeFxKind } from './fx';

describe('strikeFxKind', () => {
  it('is carrier only for a sunk carrier', () => {
    expect(strikeFxKind('sunk', 'carrier')).toBe('carrier');
    expect(strikeFxKind('sunk', 'destroyer')).toBe('generic');
    expect(strikeFxKind('hit', 'carrier')).toBe('generic');
    expect(strikeFxKind('miss', undefined)).toBe('generic');
    expect(strikeFxKind('sunk', null)).toBe('generic');
    expect(strikeFxKind('sunk', undefined)).toBe('generic');
    expect(strikeFxKind('inbound', 'carrier')).toBe('generic');
  });
});

describe('fxDurationMs', () => {
  it('holds carrier effects for the full 2s sequence', () => {
    expect(fxDurationMs('carrier', 1400)).toBe(2000);
    expect(fxDurationMs('carrier', 900)).toBe(2000);
  });
  it('keeps the caller defaults for generic effects', () => {
    expect(fxDurationMs('generic', 1400)).toBe(1400);
    expect(fxDurationMs('generic', 900)).toBe(900);
  });
});
