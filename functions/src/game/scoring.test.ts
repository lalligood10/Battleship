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
} from './scoring';

describe('Elo', () => {
  it('uses the configured starting rating and K-factor', () => {
    expect(SCORING_CONFIG.INITIAL_RATING).toBe(1000);
    expect(SCORING_CONFIG.K_FACTOR).toBe(32);
  });

  it('expected score is 0.5 for equal ratings and sums to 1', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
    expect(expectedScore(1200, 1000) + expectedScore(1000, 1200)).toBeCloseTo(1);
    // 400 points higher => ~91% expected
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 3);
  });

  it('equal players exchange exactly K/2 = 16 points', () => {
    expect(applyElo(1000, 1000)).toEqual({
      winnerDelta: 16,
      loserDelta: -16,
      winnerNewRating: 1016,
      loserNewRating: 984,
    });
  });

  it('upsets move more points than expected wins', () => {
    const upset = applyElo(1000, 1400); // underdog wins
    const expected = applyElo(1400, 1000); // favourite wins
    expect(upset.winnerDelta).toBe(29);
    expect(upset.loserDelta).toBe(-29);
    expect(expected.winnerDelta).toBe(3);
    expect(expected.loserDelta).toBe(-3);
  });

  it('matches the standard formula for an arbitrary pairing', () => {
    const r1 = 1150;
    const r2 = 1075;
    const out = applyElo(r1, r2);
    const e1 = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
    expect(out.winnerDelta).toBe(Math.round(32 * (1 - e1)));
    expect(out.winnerNewRating).toBe(r1 + out.winnerDelta);
  });

  it('never drops a loser below the floor', () => {
    const out = applyElo(SCORING_CONFIG.MIN_RATING + 5, SCORING_CONFIG.MIN_RATING + 5); // equal => -16
    expect(out.loserNewRating).toBe(SCORING_CONFIG.MIN_RATING);
    expect(out.loserDelta).toBe(-5);
  });
});

describe('stats', () => {
  it('tracks wins, streaks and shooting totals', () => {
    let s = applyGameToStats(EMPTY_STATS, true, { shotsFired: 40, hits: 17 });
    s = applyGameToStats(s, true, { shotsFired: 50, hits: 17 });
    s = applyGameToStats(s, false, { shotsFired: 30, hits: 10 });
    s = applyGameToStats(s, true, { shotsFired: 20, hits: 17 });
    expect(s).toEqual({
      wins: 3,
      losses: 1,
      gamesPlayed: 4,
      shotsFired: 140,
      hits: 61,
      currentStreak: 1,
      longestStreak: 2,
    });
    expect(winPercentage(s)).toBe(75);
    expect(accuracyPercentage(s)).toBe(43.6);
  });

  it('percentages are 0 with no games or shots', () => {
    expect(winPercentage(EMPTY_STATS)).toBe(0);
    expect(accuracyPercentage(EMPTY_STATS)).toBe(0);
  });

  it('does not mutate the input', () => {
    const before = { ...EMPTY_STATS };
    applyGameToStats(EMPTY_STATS, true, { shotsFired: 1, hits: 1 });
    expect(EMPTY_STATS).toEqual(before);
  });
});

describe('weekId', () => {
  it('uses ISO weeks starting Monday', () => {
    expect(weekId(new Date('2026-09-23T20:00:00Z'))).toBe('2026-W39'); // Wednesday
    expect(weekId(new Date('2026-09-21T00:00:00Z'))).toBe('2026-W39'); // Monday
    expect(weekId(new Date('2026-09-20T23:59:59Z'))).toBe('2026-W38'); // Sunday before
    expect(weekId(new Date('2026-09-27T23:59:59Z'))).toBe('2026-W39'); // Sunday after
  });

  it('handles year boundaries the ISO way', () => {
    expect(weekId(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    expect(weekId(new Date('2024-12-30T12:00:00Z'))).toBe('2025-W01');
  });
});
