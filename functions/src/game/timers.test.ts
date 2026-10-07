import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { isTurnExpired, parseTurnTimerInput, turnDeadlineFor } from './timers';

describe('parseTurnTimerInput', () => {
  it.each([
    [undefined, null],
    [null, null],
    [60_000, 60_000],
    [120_000, 120_000],
  ])('accepts %s as %s', (input, value) => {
    expect(parseTurnTimerInput(input)).toEqual({ ok: true, value });
  });

  it.each([0, 5000, '60000'])('rejects %s', (input) => {
    expect(parseTurnTimerInput(input)).toEqual({ ok: false });
  });
});

describe('turnDeadlineFor', () => {
  const now = Timestamp.fromMillis(123_000);

  it('returns null when the timer is off', () => {
    expect(turnDeadlineFor(null, now)).toBeNull();
    expect(turnDeadlineFor(undefined, now)).toBeNull();
  });

  it('adds the configured timer duration to now', () => {
    expect(turnDeadlineFor(60_000, now)?.toMillis()).toBe(183_000);
  });
});

describe('isTurnExpired', () => {
  const deadline = Timestamp.fromMillis(100_000);
  const game = { status: 'active', turnDeadline: deadline } as const;

  it('waits through the grace period, then expires at the boundary', () => {
    expect(isTurnExpired(game, 101_999)).toBe(false);
    expect(isTurnExpired(game, 102_000)).toBe(true);
  });

  it('does not expire a game without an active deadline', () => {
    expect(isTurnExpired({ status: 'placing', turnDeadline: deadline }, 200_000)).toBe(false);
    expect(isTurnExpired({ status: 'active', turnDeadline: null }, 200_000)).toBe(false);
    expect(isTurnExpired({ status: 'active' }, 200_000)).toBe(false);
  });
});
