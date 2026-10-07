import { describe, expect, it } from 'vitest';
import { shouldPlayResultFx } from './resultFx';

describe('shouldPlayResultFx', () => {
  it('plays when the finish time is unavailable', () => {
    expect(shouldPlayResultFx(null, 60_000)).toBe(true);
  });

  it('plays for a game that finished one second ago', () => {
    expect(shouldPlayResultFx(59_000, 60_000)).toBe(true);
  });

  it('does not replay a game that finished one minute ago', () => {
    expect(shouldPlayResultFx(0, 60_000)).toBe(false);
  });
});
