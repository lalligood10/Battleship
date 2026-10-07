import { describe, expect, it } from 'vitest';
import {
  dismissPrompt,
  isPromptDismissed,
  PUSH_PROMPT_KEY,
  shouldOfferPushPrompt,
  type PushPromptInput,
} from './PushOptIn.logic';

const yes: PushPromptInput = {
  gameFinished: true,
  available: true,
  permission: 'default',
  pushOn: false,
  dismissed: false,
};

describe('shouldOfferPushPrompt', () => {
  it('offers only for a finished game with push available, undecided and not dismissed', () => {
    expect(shouldOfferPushPrompt(yes)).toBe(true);
  });

  it('is false when the game is not finished', () => {
    expect(shouldOfferPushPrompt({ ...yes, gameFinished: false })).toBe(false);
  });

  it('is false when push is unavailable', () => {
    expect(shouldOfferPushPrompt({ ...yes, available: false })).toBe(false);
  });

  it('is false once the user decided either way', () => {
    expect(shouldOfferPushPrompt({ ...yes, permission: 'granted' })).toBe(false);
    expect(shouldOfferPushPrompt({ ...yes, permission: 'denied' })).toBe(false);
    expect(shouldOfferPushPrompt({ ...yes, permission: 'unsupported' })).toBe(false);
  });

  it('is false when push is already on', () => {
    expect(shouldOfferPushPrompt({ ...yes, pushOn: true })).toBe(false);
  });

  it('is false after dismissal', () => {
    expect(shouldOfferPushPrompt({ ...yes, dismissed: true })).toBe(false);
  });
});

describe('dismissal storage', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };

  it('reads and writes the dismissal flag', () => {
    const storage = memory();
    expect(isPromptDismissed(storage)).toBe(false);
    dismissPrompt(storage);
    expect(storage.getItem(PUSH_PROMPT_KEY)).toBe('1');
    expect(isPromptDismissed(storage)).toBe(true);
  });

  it('tolerates storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(isPromptDismissed(broken)).toBe(false);
    expect(() => dismissPrompt(broken)).not.toThrow();
  });
});
