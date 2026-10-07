import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vibrate } from './haptics';

const { isMuted } = vi.hoisted(() => ({ isMuted: vi.fn(() => false) }));

vi.mock('./mute', () => ({ isMuted }));

describe('vibration mute gating', () => {
  beforeEach(() => {
    isMuted.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips vibration while muted', () => {
    const nativeVibrate = vi.fn();
    isMuted.mockReturnValue(true);
    vi.stubGlobal('navigator', { vibrate: nativeVibrate });

    vibrate([10, 20]);

    expect(nativeVibrate).not.toHaveBeenCalled();
  });

  it('vibrates when unmuted', () => {
    const nativeVibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate: nativeVibrate });

    vibrate([10, 20]);

    expect(nativeVibrate).toHaveBeenCalledWith([10, 20]);
  });
});
