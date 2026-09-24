/**
 * Bot opponents for "Play vs Computer". Pure data/helpers – no Firebase imports.
 * Bot uids use a `bot-` prefix so they are safe in document ids and URLs.
 */
export type BotDifficulty = 'easy' | 'medium' | 'hard';

export const BOT_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export interface BotProfile {
  uid: string;
  username: string;
  usernameLower: string;
  rating: number;
}

export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: { uid: 'bot-cadet', username: 'Cadet Bot', usernameLower: 'cadet bot', rating: 800 },
  medium: { uid: 'bot-officer', username: 'Officer Bot', usernameLower: 'officer bot', rating: 1000 },
  hard: { uid: 'bot-admiral', username: 'Admiral Bot', usernameLower: 'admiral bot', rating: 1200 },
};

export const isBotUid = (uid: string): boolean => uid.startsWith('bot-');

export function parseDifficulty(value: unknown): BotDifficulty | null {
  return typeof value === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(value)
    ? (value as BotDifficulty)
    : null;
}
