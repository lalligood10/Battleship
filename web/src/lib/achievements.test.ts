import { describe, expect, it } from 'vitest';
import { achievementFromData, formatUnlockDate, shelfItems, unlockedCount, unlocksForGame, type AchievementDoc } from './achievements';

const docs: AchievementDoc[] = [
  { id: 'flawless', unlockedAtMs: Date.UTC(2026, 9, 7, 12), gameId: 'g1', dailyDateKey: null },
  { id: 'first-victory', unlockedAtMs: Date.UTC(2026, 9, 1), gameId: 'g0', dailyDateKey: null },
  { id: 'daily-clear', unlockedAtMs: Date.UTC(2026, 9, 7), gameId: null, dailyDateKey: '2026-10-07' },
];

describe('shelfItems', () => {
  it('lists all seven achievements in contract order, locked or unlocked', () => {
    const items = shelfItems(docs);
    expect(items.map((i) => i.id)).toEqual([
      'first-victory',
      'one-volley-sink',
      'last-ship-standing',
      'flawless',
      'full-arsenal',
      'admiral-slayer',
      'daily-clear',
    ]);
    expect(items.filter((i) => i.unlocked).map((i) => i.id)).toEqual(['first-victory', 'flawless', 'daily-clear']);
    expect(items.find((i) => i.id === 'admiral-slayer')).toMatchObject({ unlocked: false, unlockedAtMs: null, gameId: null });
    expect(unlockedCount(items)).toBe(3);
    expect(shelfItems([]).every((i) => !i.unlocked)).toBe(true);
  });
});

describe('unlocksForGame', () => {
  it('returns only achievements whose gameId matches', () => {
    expect(unlocksForGame(docs, 'g1').map((i) => i.id)).toEqual(['flawless']);
    expect(unlocksForGame(docs, 'other')).toEqual([]);
  });
});

describe('achievementFromData', () => {
  it('parses valid docs and rejects unknown ids or malformed data', () => {
    expect(achievementFromData('flawless', { unlockedAtMs: 5, gameId: 'g', dailyDateKey: null })).toEqual({
      id: 'flawless',
      unlockedAtMs: 5,
      gameId: 'g',
      dailyDateKey: null,
    });
    expect(achievementFromData('made-up', { unlockedAtMs: 5 })).toBeNull();
    expect(achievementFromData('flawless', { unlockedAtMs: 'soon' })).toBeNull();
    expect(achievementFromData('flawless', undefined)).toBeNull();
  });
});

describe('formatUnlockDate', () => {
  it('formats in UTC', () => {
    expect(formatUnlockDate(Date.UTC(2026, 9, 7, 23, 59))).toBe('7 Oct 2026');
  });
});
