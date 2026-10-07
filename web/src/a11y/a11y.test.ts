/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppFrame } from '../App';
import { GameChat } from '../components/GameChat';
import { Reactions } from '../components/Reactions';
import type { Game } from '../lib/types';
import { SetupPage } from '../pages/SetupPage';
import { SignInPage } from '../pages/SignInPage';
import { CHAT_INITIAL_FOCUS_ATTR, chatKeyAction } from './chatFocus';
import {
  SIMULATIONS,
  SIMULATION_NAMES,
  contrastRatio,
  feColorMatrixValues,
  filterId,
  hexToRgb,
  simulate,
  simulationSvgMarkup,
} from './colorVision';
import { KNOWN_ISSUES, isBlocking, partitionFindings, type Finding } from './findings';
import { MAIN_ID } from './landmarks';
import { classifyMark, markSignature, marksDifferByShape, type MarkComputedStyle } from './markShape';
import { INTERACTIVE_SELECTOR, MIN_TARGET_PX, undersizedTargets } from './targetSize';

// GameChat reads saved panel and speech preferences; vitest runs in node without DOM storage.
const store = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    code: 'ABC234',
    status: 'active',
    hostUid: 'me',
    playerUids: ['me', 'them'],
    players: {
      me: { username: 'Ahab', rating: 1000, ready: true },
      them: { username: 'Nemo', rating: 1000, ready: true },
    } as unknown as Game['players'],
    shots: { me: [], them: [] },
    currentTurnUid: 'me',
    turnNumber: 1,
    winnerUid: null,
    endReason: null,
    ratingChanges: null,
    revealedFleets: null,
    isQuickMatch: false,
    isBotGame: false,
    botDifficulty: null,
    abandonTimeoutMs: 1,
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null,
    lastMoveAt: null,
    ...overrides,
  };
}

describe('landmarks (R11)', () => {
  it('renders a skip link first, pointing at the main landmark', () => {
    const html = renderToStaticMarkup(createElement(AppFrame, { footer: createElement('nav') }, 'content'));
    expect(html.indexOf('class="skip-link"')).toBeLessThan(html.indexOf('<main'));
    expect(html).toContain(`href="#${MAIN_ID}"`);
    expect(html).toContain(`<main id="${MAIN_ID}" class="app-main" tabindex="-1">content</main>`);
    expect(html.indexOf('</main>')).toBeLessThan(html.indexOf('<nav'));
  });

  it('makes the sign-in brand the page h1, and drops it when embedded', () => {
    expect(renderToStaticMarkup(createElement(SignInPage, {}))).toMatch(/<h1 class="brand">Broadside<\/h1>/);
    const embedded = renderToStaticMarkup(createElement(SignInPage, { embedded: true }));
    expect(embedded).not.toContain('<h1');
    expect(embedded).toContain('role="tablist" aria-label="Account"');
  });

  it('gives the setup screen its own main landmark and heading', () => {
    const html = renderToStaticMarkup(createElement(SetupPage));
    expect(html).toMatch(/^<main /);
    expect(html).toContain('<h1 class="title">');
  });
});

describe('chat focus (R15) and announcements (R16)', () => {
  it('closes only on Escape while open', () => {
    expect(chatKeyAction('Escape', true)).toBe('close');
    expect(chatKeyAction('Esc', true)).toBe('close');
    expect(chatKeyAction('Escape', false)).toBeNull();
    expect(chatKeyAction('Enter', true)).toBeNull();
  });

  it('marks the composer as the initial focus target and keeps a closed panel inert', () => {
    const html = renderToStaticMarkup(createElement(GameChat, { game: game(), uid: 'me' }));
    expect(html).toContain('aria-controls="game-chat-panel"');
    expect(html).toMatch(/<input class="input"[^>]*aria-label="Message Nemo"[^>]*data-chat-initial-focus=""/);
    expect(html).toMatch(/<aside[^>]*aria-hidden="true"[^>]*inert=""/);
    expect(CHAT_INITIAL_FOCUS_ATTR).toBe('data-chat-initial-focus');
  });

  it('marks the speech switch as the initial focus target in bot games', () => {
    const html = renderToStaticMarkup(
      createElement(GameChat, { game: game({ isBotGame: true, botDifficulty: 'easy' }), uid: 'me' }),
    );
    expect(html).toMatch(/<input type="checkbox"[^>]*data-chat-initial-focus=""/);
  });

  it('keeps the reaction live region mounted even when empty, and labels the group', () => {
    const html = renderToStaticMarkup(createElement(Reactions, { game: game(), uid: 'me' }));
    expect(html).toContain('<p class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>');
    expect(html).toContain('class="reaction-bar" role="group" aria-label="Send a reaction"');
  });
});

describe('target size rules', () => {
  it('flags boxes under 44px on either axis, allowing sub-pixel rounding', () => {
    const failures = undersizedTargets([
      { label: 'ok', width: 44, height: 44 },
      { label: 'rounded', width: 43.6, height: 120 },
      { label: 'short', width: 200, height: 40 },
      { label: 'narrow', width: 30, height: 44 },
      { label: 'cell', width: 30, height: 30, exempt: true },
    ]);
    expect(failures.map((box) => box.label)).toEqual(['short', 'narrow']);
    expect(MIN_TARGET_PX).toBe(44);
  });

  it('covers native controls and ARIA widgets', () => {
    for (const selector of ['a[href]', 'button', 'input:not([type="hidden"])', '[role="tab"]', '[role="radio"]']) {
      expect(INTERACTIVE_SELECTOR).toContain(selector);
    }
  });
});

describe('mark shapes', () => {
  const style = (overrides: Partial<MarkComputedStyle>): MarkComputedStyle => ({
    afterContent: 'none',
    afterBorderTopWidth: '0px',
    afterBorderRadius: '0px',
    cellBackgroundImage: 'none',
    ...overrides,
  });
  const miss = classifyMark(style({ afterContent: '""', afterBorderTopWidth: '2px', afterBorderRadius: '50%' }));
  const hit = classifyMark(style({ afterContent: '"✕"' }));
  const sunk = classifyMark(
    style({ afterContent: '"✕"', cellBackgroundImage: 'repeating-linear-gradient(45deg, rgba(0, 0, 0, 0) 0px)' }),
  );

  it('reads a ring, a glyph and a hatched glyph', () => {
    expect(markSignature(miss)).toBe('ring');
    expect(markSignature(hit)).toBe('glyph:✕');
    expect(markSignature(sunk)).toBe('glyph:✕+hatch');
    expect(marksDifferByShape({ miss, hit, sunk })).toBe(true);
  });

  it('rejects marks that only differ by colour, or have no shape', () => {
    expect(marksDifferByShape({ hit, sunk: hit })).toBe(false);
    expect(marksDifferByShape({ miss: classifyMark(style({ afterContent: '""' })), hit })).toBe(false);
  });
});

describe('colour-vision simulation', () => {
  const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
  const root = tokens.slice(0, tokens.indexOf('}'));
  const token = (name: string) => {
    const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(root);
    if (!match?.[1]) throw new Error(`Missing ${name}`);
    return hexToRgb(match[1]);
  };

  it('keeps white white and builds one SVG filter per simulation', () => {
    for (const name of SIMULATION_NAMES) {
      expect(simulate([255, 255, 255], SIMULATIONS[name])).toEqual([255, 255, 255]);
      expect(feColorMatrixValues(SIMULATIONS[name]).split(' ')).toHaveLength(20);
      expect(simulationSvgMarkup()).toContain(`id="${filterId(name)}"`);
    }
    const [r, g, b] = simulate([200, 40, 30], SIMULATIONS.grayscale);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  const pairs = [
    ['--mark-miss', '--sea'],
    ['--mark-hit-glyph', '--mark-hit-fill'],
    ['--mark-sunk-glyph', '--mark-sunk-fill'],
  ] as const;

  it('meets 3:1 non-text contrast for every mark with normal vision', () => {
    for (const [fg, bg] of pairs) expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });

  // Simulated vision is a review aid, not a WCAG criterion: marks must stay clearly separable (2.5:1),
  // and they never rely on colour because each also has its own shape.
  it.each(SIMULATION_NAMES)('keeps board marks separable under %s', (name) => {
    const sim = (rgb: ReturnType<typeof token>) => simulate(rgb, SIMULATIONS[name]);
    for (const [fg, bg] of pairs) expect(contrastRatio(sim(token(fg)), sim(token(bg)))).toBeGreaterThanOrEqual(2.5);
    expect(contrastRatio(sim(token('--mark-hit-fill')), sim(token('--mark-sunk-fill')))).toBeGreaterThanOrEqual(2);
  });
});

describe('sweep findings', () => {
  const finding = (over: Partial<Finding>): Finding => ({
    kind: 'axe',
    screen: 'profile',
    rule: 'color-contrast',
    impact: 'serious',
    target: '.muted',
    detail: '',
    theme: 'dark',
    width: 375,
    ...over,
  });

  it('only serious and critical axe impacts block', () => {
    expect(['minor', 'moderate', 'serious', 'critical', null].map(isBlocking)).toEqual([false, false, true, true, false]);
  });

  it('records known issues owned elsewhere and keeps everything else unexpected', () => {
    const board = finding({ screen: 'game: active', rule: 'aria-required-children', target: '.board--fog > div[role="row"]:nth-child(1)' });
    const mine = finding({});
    const { unexpected, recorded } = partitionFindings([board, mine], KNOWN_ISSUES);
    expect(unexpected).toEqual([mine]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.owner).toMatch(/Session A/);
  });

  it('a known issue scoped to one screen does not hide the same rule elsewhere', () => {
    const elsewhere = finding({ screen: 'profile', rule: 'scrollable-region-focusable' });
    expect(partitionFindings([elsewhere], KNOWN_ISSUES).unexpected).toEqual([elsewhere]);
  });
});
