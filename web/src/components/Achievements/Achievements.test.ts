import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shelfItems, unlocksForGame, type AchievementDoc } from '../../lib/achievements';
import { AchievementShelfView, AchievementUnlocksView } from '.';

const docs: AchievementDoc[] = [
  { id: 'flawless', unlockedAtMs: Date.UTC(2026, 9, 7, 12), gameId: 'g1', dailyDateKey: null },
  { id: 'first-victory', unlockedAtMs: Date.UTC(2026, 9, 1), gameId: 'g0', dailyDateKey: null },
];

describe('AchievementShelfView', () => {
  const html = renderToStaticMarkup(createElement(AchievementShelfView, { items: shelfItems(docs) }));

  it('shows all seven with a text state, so locked is not colour-only', () => {
    expect(html.match(/<li /g)).toHaveLength(7);
    expect(html.match(/>Locked</g)).toHaveLength(5);
    expect(html.match(/Unlocked <time/g)).toHaveLength(2);
    expect(html).toContain('dateTime="2026-10-07T12:00:00.000Z">7 Oct 2026</time>');
    expect(html.match(/ach-item--locked/g)).toHaveLength(5);
    expect(html).toContain('2 / 7<span class="gm-sr-only"> unlocked</span>');
  });

  it('keeps icons decorative', () => {
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(7);
  });
});

describe('AchievementUnlocksView', () => {
  it('lists only this game and renders nothing when empty', () => {
    const html = renderToStaticMarkup(createElement(AchievementUnlocksView, { items: unlocksForGame(docs, 'g1') }));
    expect(html).toContain('Achievement unlocked');
    expect(html).toContain('<b>Flawless</b>');
    expect(html).not.toContain('First Blood');
    expect(renderToStaticMarkup(createElement(AchievementUnlocksView, { items: unlocksForGame(docs, 'none') }))).toBe('');
  });
});
