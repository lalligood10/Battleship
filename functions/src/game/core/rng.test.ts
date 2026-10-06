import { describe, expect, it } from 'vitest';
import { deriveRng, mulberry32 } from './rng';

describe('seeded RNG', () => {
  it('is repeatable and produces values in [0,1)', () => {
    const first = mulberry32(99);
    const second = mulberry32(99);
    const values = Array.from({ length: 8 }, () => first());
    expect(values).toEqual(Array.from({ length: 8 }, () => second()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it('derives independent repeatable streams from parts', () => {
    const a = deriveRng(2, 'shot', 4);
    const b = deriveRng(2, 'shot', 4);
    const different = deriveRng(2, 'shot', 5);
    expect(a()).toBe(b());
    expect(deriveRng(2, 'shot', 4)()).not.toBe(different());
  });
});
