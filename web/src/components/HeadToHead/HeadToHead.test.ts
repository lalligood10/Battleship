import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HeadToHeadDoc } from '@shared/analytics/contract';
import { HeadToHeadCard, HeadToHeadChip } from './HeadToHead';

const h2h: HeadToHeadDoc = {
  playerUids: ['alice', 'bob'],
  usernames: { alice: 'Alice', bob: 'Bob' },
  gamesPlayed: 5,
  wins: { alice: 3, bob: 2 },
  winsByMode: { classic: { alice: 2, bob: 0 }, salvo: { alice: 1, bob: 2 }, abilities: { alice: 0, bob: 0 } },
  lastGameId: 'g5',
  lastWinnerUid: 'alice',
  lastPlayedAtMs: 1,
};

describe('HeadToHeadChip', () => {
  it('shows my record with the standing in its accessible name', () => {
    const html = renderToStaticMarkup(createElement(HeadToHeadChip, { h2h, myUid: 'alice', opponentName: 'Bob' }));
    expect(html).toContain('You 3–2');
    expect(html).toContain('aria-label="Head-to-head vs Bob: you 3, Bob 2. You lead."');
    expect(html).toContain('h2h-chip--lead');
  });

  it('says so when there is no record', () => {
    expect(renderToStaticMarkup(createElement(HeadToHeadChip, { h2h: null, myUid: 'alice', opponentName: 'Bob' }))).toContain('No H2H yet');
  });
});

describe('HeadToHeadCard', () => {
  it('shows overall and this-mode records from my side', () => {
    const html = renderToStaticMarkup(createElement(HeadToHeadCard, { h2h, myUid: 'bob', opponentName: 'Alice', mode: 'salvo' }));
    expect(html).toContain('Head-to-head');
    expect(html).toContain('vs Alice');
    expect(html).toContain('<dt>Overall</dt><dd class="h2h-card__score">You 2–3</dd>');
    expect(html).toContain('<dt>Salvo wins</dt><dd class="h2h-card__score">You 2–1</dd>');
    expect(html).toContain('You trail');
  });

  it('has a first-meeting state', () => {
    const html = renderToStaticMarkup(createElement(HeadToHeadCard, { h2h: null, myUid: 'bob', opponentName: 'Alice', mode: 'classic' }));
    expect(html).toContain('no games tracked between you yet');
  });
});
