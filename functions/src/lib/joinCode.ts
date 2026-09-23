import { randomInt } from 'node:crypto';
import { GAME_CONFIG } from '../game/config';

/** Cryptographically random join code from an alphabet without look-alike characters. */
export function generateJoinCode(): string {
  const alphabet = GAME_CONFIG.JOIN_CODE_ALPHABET;
  let code = '';
  for (let i = 0; i < GAME_CONFIG.JOIN_CODE_LENGTH; i++) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

/** Normalises user input ("ab-c 123" -> "ABC123") and checks it is a plausible code. */
export function normaliseJoinCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== GAME_CONFIG.JOIN_CODE_LENGTH) return null;
  for (const ch of code) {
    if (!GAME_CONFIG.JOIN_CODE_ALPHABET.includes(ch)) return null;
  }
  return code;
}
