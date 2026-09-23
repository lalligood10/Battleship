/**
 * The web app displays ratings/stats computed by the shared scoring module (functions/src/game/scoring.ts).
 * These tests pin the behaviour the UI relies on, run in the browser bundle's module resolution.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATS,
  SCORING_CONFIG,
  accuracyPercentage,
  applyElo,
  applyGameToStats,
  expectedScore,
  weekId,
  winPercentage,
} from '@shared/scoring';

describe('Elo', () => {
  it('starts everyone at 1000 with K=32', () => {
    expect(SCORING_CONFIG.INITIAL_RATING).toBe(1000);
    expect(SCORING_CONFIG.K_FACTOR).toBe(32);
  });

  it('gives equal players a 50% expectation and +/-16 for a win/loss', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    const r = applyElo(1000, 1000);
    expect(r).toEqual({ winnerDelta: 16, loserDelta: -16, winnerNewRating: 1016, loserNewRating: 984 });
  });

  it('rewards an upset more than an expected win', () => {
    const upset = applyElo(1000, 1400);
    const expected = applyElo(1400, 1000);
    expect(upset.winnerDelta).toBeGreaterThan(expected.winnerDelta);
    expect(upset.winnerDelta + upset.loserDelta).toBe(0);
  });

  it('never drops a rating below the floor', () => {
    const r = applyElo(SCORING_CONFIG.MIN_RATING, SCORING_CONFIG.MIN_RATING + 5);
    expect(r.loserNewRating).toBe(SCORING_CONFIG.MIN_RATING);
    expect(r.loserDelta).toBe(-5);
  });
});

describe('stats', () => {
  it('tracks wins, losses, streaks and percentages', () => {
    let s = applyGameToStats(EMPTY_STATS, true, { shotsFired: 40, hits: 17 });
    s = applyGameToStats(s, true, { shotsFired: 30, hits: 17 });
    s = applyGameToStats(s, false, { shotsFired: 50, hits: 10 });
    expect(s).toMatchObject({ wins: 2, losses: 1, gamesPlayed: 3, currentStreak: 0, longestStreak: 2 });
    expect(winPercentage(s)).toBe(66.7);
    expect(accuracyPercentage(s)).toBeCloseTo(36.7);
    expect(winPercentage(EMPTY_STATS)).toBe(0);
    expect(accuracyPercentage(EMPTY_STATS)).toBe(0);
  });
});

describe('weekId', () => {
  it('uses ISO weeks starting Monday (UTC)', () => {
    expect(weekId(new Date('2026-09-21T00:00:00Z'))).toBe('2026-W39'); // Monday
    expect(weekId(new Date('2026-09-27T23:59:59Z'))).toBe('2026-W39'); // Sunday, same week
    expect(weekId(new Date('2026-09-28T00:00:00Z'))).toBe('2026-W40'); // next Monday
  });

  it('assigns early-January days to the previous year when ISO says so', () => {
    expect(weekId(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(weekId(new Date('2027-01-04T12:00:00Z'))).toBe('2027-W01');
  });
});
