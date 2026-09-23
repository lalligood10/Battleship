import { describe, expect, it } from 'vitest';
import { containsProfanity, validateUsername } from './username';

describe('validateUsername', () => {
  it('accepts normal names and lower-cases for uniqueness', () => {
    expect(validateUsername('Admiral_Luke7')).toEqual({ ok: true, username: 'Admiral_Luke7', lower: 'admiral_luke7' });
    expect(validateUsername('  sea_dog  ')).toMatchObject({ ok: true, username: 'sea_dog' });
  });

  it('enforces length and character rules', () => {
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('a'.repeat(17)).ok).toBe(false);
    expect(validateUsername('1abc').ok).toBe(false);
    expect(validateUsername('has space').ok).toBe(false);
    expect(validateUsername('emoji🚢').ok).toBe(false);
    expect(validateUsername(undefined).ok).toBe(false);
    expect(validateUsername(42).ok).toBe(false);
  });

  it('blocks profanity including leet-speak', () => {
    expect(validateUsername('shithead').ok).toBe(false);
    expect(validateUsername('Sh1tLord').ok).toBe(false);
    expect(validateUsername('f_u_c_k').ok).toBe(false);
    expect(containsProfanity('a55hole')).toBe(true);
  });

  it('does not flag innocent words that contain blocked substrings', () => {
    expect(containsProfanity('Classic')).toBe(false);
    expect(containsProfanity('bassmaster')).toBe(false);
    expect(containsProfanity('Titanic')).toBe(false);
    expect(containsProfanity('Assassin')).toBe(false);
    expect(validateUsername('Password1').ok).toBe(true);
  });

  it('still catches profanity next to an allowed word', () => {
    expect(containsProfanity('classfucker')).toBe(true);
  });
});
