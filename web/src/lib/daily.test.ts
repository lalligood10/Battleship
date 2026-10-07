import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Shot } from '@shared/engine';
import { DailyCardView } from '../pages/DailyPage';
import { dailyCounts, dailyStatus, dailyStatusText, msUntilNextMinute, rankScores, scoreFromData, timeUntilReset, type DailyScoreRow } from './daily';

const shot = (result: Shot['result']): Shot => ({ row: 0, col: 0, result, at: 0 });

describe('dailyStatus', () => {
  it('reports not started, in progress and cleared', () => {
    expect(dailyStatus(null)).toEqual({ kind: 'not-started' });
    expect(dailyStatus({ shots: [], completedAtMs: null })).toEqual({ kind: 'not-started' });
    expect(dailyStatus({ shots: [shot('miss'), shot('hit')], completedAtMs: null })).toEqual({ kind: 'in-progress', shots: 2 });
    expect(dailyStatus({ shots: [shot('sunk')], completedAtMs: 9 })).toEqual({ kind: 'cleared', shots: 1 });
  });

  it('has readable text', () => {
    expect(dailyStatusText({ kind: 'not-started' })).toBe('Not started');
    expect(dailyStatusText({ kind: 'in-progress', shots: 1 })).toBe('1 shot so far');
    expect(dailyStatusText({ kind: 'in-progress', shots: 12 })).toBe('12 shots so far');
    expect(dailyStatusText({ kind: 'cleared', shots: 41 })).toBe('Cleared in 41 shots');
  });
});

describe('rankScores', () => {
  it('orders by shots then completedAtMs and keeps the top 10', () => {
    const rows: DailyScoreRow[] = Array.from({ length: 12 }, (_, i) => ({
      uid: `u${i}`,
      username: `U${i}`,
      shots: 30 + (i % 4),
      completedAtMs: 1_000 - i,
    }));
    const top = rankScores(rows);
    expect(top).toHaveLength(10);
    expect(top.slice(0, 3).map((r) => r.uid)).toEqual(['u8', 'u4', 'u0']);
    for (let i = 1; i < top.length; i++) {
      const [a, b] = [top[i - 1]!, top[i]!];
      expect(a.shots < b.shots || (a.shots === b.shots && a.completedAtMs <= b.completedAtMs)).toBe(true);
    }
  });

  it('parses score docs defensively', () => {
    expect(scoreFromData('u', { username: 'Ann', shots: 20, completedAtMs: 5 })).toEqual({ uid: 'u', username: 'Ann', shots: 20, completedAtMs: 5 });
    expect(scoreFromData('u', { username: 'Ann' })).toBeNull();
  });
});

describe('timeUntilReset and counts', () => {
  it('counts down to the next 00:00 UTC', () => {
    expect(timeUntilReset(Date.UTC(2026, 9, 7, 18, 48))).toBe('5h 12m');
    expect(timeUntilReset(Date.UTC(2026, 9, 7, 23, 59, 30))).toBe('1m');
  });

  it('counts shots and hits', () => {
    expect(dailyCounts({ shots: [shot('miss'), shot('hit'), shot('sunk'), shot('miss')] })).toEqual({ shots: 4, hits: 2, accuracy: 50 });
    expect(dailyCounts({ shots: [] }).accuracy).toBe(0);
  });
});

describe('msUntilNextMinute', () => {
  it('returns the delay to the next minute boundary', () => {
    expect(msUntilNextMinute(Date.UTC(2026, 9, 7, 18, 48))).toBe(60_000);
    expect(msUntilNextMinute(Date.UTC(2026, 9, 7, 18, 48, 45, 500))).toBe(14_500);
    expect(msUntilNextMinute(Date.UTC(2026, 9, 7, 18, 48, 59, 999))).toBe(1);
  });
});

describe('DailyCardView markup', () => {
  const render = (status: Parameters<typeof DailyCardView>[0]['status']) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DailyCardView, { status })));

  it('links to /daily with a text status and a visible-first link name', () => {
    const html = render({ kind: 'in-progress', shots: 7 });
    expect(html).toContain('href="/daily"');
    expect(html).toContain('7 shots so far');
    expect(html).toContain('>Resume<span class="gm-sr-only"> daily challenge</span>');
    expect(render({ kind: 'cleared', shots: 33 })).toContain('Cleared in 33 shots');
    expect(render({ kind: 'not-started' })).toContain('>Start<');
  });
});
