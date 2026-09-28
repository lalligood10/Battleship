import { describe, expect, it } from 'vitest';
import { isReactionId, REACTIONS } from './reactions';

describe('reactions', () => {
  it('accepts every reaction id', () => {
    for (const reaction of REACTIONS) expect(isReactionId(reaction.id)).toBe(true);
  });

  it('rejects unknown strings, non-strings, and labels', () => {
    for (const value of ['hello', 'GG', 'Nice shot!', 123, null, undefined, {}]) {
      expect(isReactionId(value)).toBe(false);
    }
  });

  it('has unique ids', () => {
    expect(new Set(REACTIONS.map((reaction) => reaction.id)).size).toBe(REACTIONS.length);
  });
});
