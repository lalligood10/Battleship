/**
 * Username rules: 3–16 characters, letters/digits/underscore, must start with a letter,
 * case-insensitively unique, and must pass a basic profanity filter.
 */

export const USERNAME_RULES = {
  MIN_LENGTH: 3,
  MAX_LENGTH: 16,
  PATTERN: /^[A-Za-z][A-Za-z0-9_]*$/,
} as const;

/**
 * Basic blocklist. Intentionally small and conservative – extend as needed. Matching is done on
 * the lower-cased name with common letter/number substitutions normalised (e.g. "sh1t" -> "shit").
 */
const BLOCKED_WORDS = [
  'anal', 'anus', 'arse', 'ass', 'bastard', 'bitch', 'blowjob', 'bollock', 'boner', 'boob',
  'chink', 'clit', 'cock', 'coon', 'cum', 'cunt', 'dick', 'dildo', 'dyke', 'fag', 'faggot',
  'fuck', 'gook', 'handjob', 'hitler', 'homo', 'jizz', 'kike', 'kkk', 'nazi', 'nigga', 'nigger',
  'paki', 'penis', 'piss', 'porn', 'pussy', 'queer', 'rape', 'rapist', 'retard', 'scrotum',
  'sex', 'shit', 'slut', 'spic', 'tit', 'tranny', 'twat', 'vagina', 'wank', 'whore', 'wetback',
];

/** Words that contain a blocked substring but are clearly innocent. */
const ALLOWED_WORDS = ['assassin', 'bass', 'class', 'classic', 'glass', 'grass', 'pass', 'password', 'sassy', 'cumberland', 'scunthorpe', 'shitake', 'titan', 'title', 'sexton', 'essex', 'sussex', 'middlesex'];

const SUBSTITUTIONS: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '_': '',
};

function normalise(name: string): string {
  return name
    .toLowerCase()
    .split('')
    .map((ch) => SUBSTITUTIONS[ch] ?? ch)
    .join('');
}

export function containsProfanity(name: string): boolean {
  const normalised = normalise(name);
  if (ALLOWED_WORDS.some((w) => normalised.includes(w))) {
    // Strip the allowed words and re-check what's left so "classfucker" is still caught.
    const stripped = ALLOWED_WORDS.reduce((acc, w) => acc.split(w).join(''), normalised);
    return BLOCKED_WORDS.some((w) => stripped.includes(w));
  }
  return BLOCKED_WORDS.some((w) => normalised.includes(w));
}

export type UsernameValidation = { ok: true; username: string; lower: string } | { ok: false; reason: string };

/** Validates format + profanity. Uniqueness is checked separately against Firestore. */
export function validateUsername(raw: unknown): UsernameValidation {
  if (typeof raw !== 'string') return { ok: false, reason: 'Username is required' };
  const username = raw.trim();
  if (username.length < USERNAME_RULES.MIN_LENGTH) {
    return { ok: false, reason: `Username must be at least ${USERNAME_RULES.MIN_LENGTH} characters` };
  }
  if (username.length > USERNAME_RULES.MAX_LENGTH) {
    return { ok: false, reason: `Username must be at most ${USERNAME_RULES.MAX_LENGTH} characters` };
  }
  if (!USERNAME_RULES.PATTERN.test(username)) {
    return { ok: false, reason: 'Use letters, numbers and underscores only, starting with a letter' };
  }
  if (containsProfanity(username)) return { ok: false, reason: 'That username is not allowed' };
  return { ok: true, username, lower: username.toLowerCase() };
}
