export const REACTIONS = [
  { id: 'nice_shot', label: 'Nice shot!' },
  { id: 'close_one', label: 'Close one' },
  { id: 'good_luck', label: 'Good luck!' },
  { id: 'well_played', label: 'Well played' },
  { id: 'oops', label: 'Oops' },
  { id: 'gg', label: 'GG' },
  { id: 'fire', label: '🔥' },
  { id: 'grimace', label: '😬' },
] as const;

export type ReactionId = (typeof REACTIONS)[number]['id'];

export const REACTION_IDS: readonly ReactionId[] = REACTIONS.map((reaction) => reaction.id);

export const REACTION_LABELS: Record<ReactionId, string> = {
  nice_shot: 'Nice shot!',
  close_one: 'Close one',
  good_luck: 'Good luck!',
  well_played: 'Well played',
  oops: 'Oops',
  gg: 'GG',
  fire: '🔥',
  grimace: '😬',
};

/** One reaction per player per game every 10 s. */
export const REACTION_COOLDOWN_MS = 10_000;

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === 'string' && REACTION_IDS.includes(value as ReactionId);
}
