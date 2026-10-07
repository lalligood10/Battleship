import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GameModePicker } from '../components/GameModePicker';
import { ModeBadge } from '../components/ModeBadge';
import { TurnTimerPicker } from '../components/TurnTimerPicker';
import { DifficultyButton, RatingBadge } from './HomePage';

/** Rough accessible name from content: drops aria-hidden subtrees and tags. */
const nameFromContent = (html: string) =>
  html
    .replace(/<([a-z]+)[^>]*aria-hidden="true"[^>]*>.*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('Home markup labels', () => {
  it('rating badge name starts with the visible rating (R12)', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RatingBadge, { rating: 1234 })));
    expect(html).not.toContain('aria-label');
    expect(html).toContain('href="/profile"');
    expect(nameFromContent(html)).toBe('1234 rating');
  });

  it('difficulty button name starts with the visible label (R12)', () => {
    const html = renderToStaticMarkup(
      createElement(DifficultyButton, {
        label: 'Easy — Cadet Bot',
        blurb: 'Fires at random.',
        busy: false,
        disabled: false,
        onPick: () => {},
      }),
    );
    expect(html).not.toContain('aria-label');
    expect(nameFromContent(html)).toMatch(/^Easy — Cadet Bot/);
  });

  it('mission select keeps every mode with its description and how-to-play', () => {
    const html = renderToStaticMarkup(
      createElement(GameModePicker, { value: 'salvo', onChange: () => {}, heading: 'Mission select' }),
    );
    expect(html).toMatch(/<h2 class="gm-heading" id="[^"]+">Mission select<\/h2>/);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    for (const mode of ['Classic', 'Salvo', 'Abilities']) {
      expect(html).toContain(`>${mode}</b>`);
      expect(html).toContain(`How to play<span class="gm-sr-only"> ${mode}</span>`);
    }
    expect(html.match(/class="gm-code" aria-hidden="true"/g)).toHaveLength(3);
  });

  it('compact picker (challenge modal) has no mission codes', () => {
    const html = renderToStaticMarkup(createElement(GameModePicker, { value: 'classic', onChange: () => {} }));
    expect(html).toContain('Game type');
    expect(html).not.toContain('gm-code');
  });

  it('turn timer picker is a labelled radio group', () => {
    const html = renderToStaticMarkup(createElement(TurnTimerPicker, { value: null, onChange: () => {} }));
    expect(html).toMatch(
      /<span class="home-timer-label" id="([^"]+)">Turn timer<\/span><div class="gm-options home-timer-options" role="radiogroup" aria-labelledby="\1"/,
    );
  });

  it('mode badge name starts with the visible mode', () => {
    const html = renderToStaticMarkup(createElement(ModeBadge, { mode: 'abilities' }));
    expect(html).not.toContain('aria-label');
    expect(nameFromContent(html)).toBe('Abilities game');
  });
});
