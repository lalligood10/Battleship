import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyPlayerStats } from '@shared/analytics/stats';
import { ModeStats } from './ModeStats';

const render = (props: Parameters<typeof ModeStats>[0]) => renderToStaticMarkup(createElement(ModeStats, props));

describe('ModeStats markup', () => {
  it('labels the section and the no-backfill note', () => {
    const html = render({ stats: null });
    expect(html).toContain('Service record by mode');
    expect(html).toContain('Tracked since Phase 5');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-checked="true"');
  });

  it('shows an empty state when nothing is tracked', () => {
    expect(render({ stats: null })).toContain('No games vs players tracked yet');
    expect(render({ stats: emptyPlayerStats('u') })).toContain('No games vs players tracked yet');
    expect(render({ stats: null, initialBucket: 'bot' })).toContain('No games vs the computer tracked yet');
  });

  it('renders one row per mode with every column', () => {
    const stats = emptyPlayerStats('u');
    stats.pvp.salvo = { ...stats.pvp.salvo, gamesPlayed: 5, wins: 3, losses: 2, hits: 20, shotsFired: 50, sinkWins: 2, sinkWinTurns: 61, shipsLost: 7 };
    const html = render({ stats });
    for (const mode of ['Classic', 'Salvo', 'Abilities']) expect(html).toContain(`>${mode}</h3>`);
    for (const label of ['Games', 'W–L', 'Win rate', 'Accuracy', 'Avg turns to win', 'Ships lost']) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain('<dd>3–2</dd>');
    expect(html).toContain('<dd>60%</dd>');
    expect(html).toContain('<dd>40%</dd>');
    expect(html).toContain('<dd>30.5</dd>');
    expect(html).toContain('<dd>7</dd>');
  });

  it('shows the vs-computer bucket when selected', () => {
    const stats = emptyPlayerStats('u');
    stats.bot.classic = { ...stats.bot.classic, gamesPlayed: 1, wins: 1 };
    expect(render({ stats, initialBucket: 'bot' })).toContain('<dd>1–0</dd>');
    expect(render({ stats })).toContain('No games vs players tracked yet');
  });

  it('shows a loading state before the read resolves', () => {
    expect(render({ stats: undefined })).toContain('Loading service record');
  });
});
