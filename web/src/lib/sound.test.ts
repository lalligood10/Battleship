import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setSpeechVolume, speechVolume } from './sound';

describe('commentary speech volume', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it('defaults to audible volume for a fresh browser', () => {
    expect(speechVolume()).toBe(0.8);
  });

  it('persists and clamps the selected volume', () => {
    setSpeechVolume(0.5);
    expect(speechVolume()).toBe(0.5);
    setSpeechVolume(2);
    expect(speechVolume()).toBe(1);
  });
});
