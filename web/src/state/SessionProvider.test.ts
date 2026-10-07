import { describe, expect, it } from 'vitest';
import { profileFromData } from './SessionProvider';

describe('profileFromData', () => {
  it('only marks a profile as a guest when the stored value is true', () => {
    expect(profileFromData('guest', { isGuest: true }).isGuest).toBe(true);
    expect(profileFromData('legacy', {}).isGuest).toBe(false);
  });
});
