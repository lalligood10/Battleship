import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../game/config';
import { generateJoinCode, normaliseJoinCode } from './joinCode';

describe('join codes', () => {
  it('generates 6-character codes from the safe alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(GAME_CONFIG.JOIN_CODE_ALPHABET).toContain(ch);
    }
  });

  it('normalises user input', () => {
    expect(normaliseJoinCode('abc-234')).toBe('ABC234');
    expect(normaliseJoinCode(' ab c2 34 ')).toBe('ABC234');
    expect(normaliseJoinCode('ABC23')).toBeNull(); // too short
    expect(normaliseJoinCode('ABC0OI')).toBeNull(); // look-alike chars not in alphabet
    expect(normaliseJoinCode(123456)).toBeNull();
  });
});
