import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../game/placement';
import { Board, type CellMark } from './Board';
import { Modal, Toast } from './ui';

const count = (html: string, needle: string) => html.split(needle).length - 1;
const cell = (html: string, row: number, col: number) =>
  html.match(new RegExp(`<div[^>]*data-row="${row}" data-col="${col}"[^>]*>`))?.[0] ?? '';

describe('Board accessibility markup', () => {
  const marks: Record<string, CellMark> = { '0,0': 'hit', '0,1': 'miss', '2,3': 'sunk' };
  const markOf = (c: Coordinate): CellMark => marks[`${c.row},${c.col}`] ?? 'water';

  it('exposes a labelled grid of 100 cells with a single tab stop', () => {
    const html = renderToStaticMarkup(createElement(Board, { ariaLabel: "Opponent's board", markOf, targeting: true }));
    expect(html).toContain('role="grid" aria-label="Opponent&#x27;s board"');
    expect(count(html, 'role="gridcell"')).toBe(100);
    expect(count(html, 'tabindex="0"')).toBe(1);
    expect(cell(html, 0, 0)).toContain('tabindex="0"');
  });

  it('starts the roving tab stop on the last shot', () => {
    const html = renderToStaticMarkup(
      createElement(Board, { ariaLabel: 'Board', markOf, targeting: true, lastShot: { row: 2, col: 3 } }),
    );
    expect(cell(html, 2, 3)).toContain('tabindex="0"');
    expect(cell(html, 0, 0)).toContain('tabindex="-1"');
  });

  it('names each cell by coordinate and state, and disables already-shot cells while targeting', () => {
    const html = renderToStaticMarkup(createElement(Board, { ariaLabel: 'Board', markOf, targeting: true }));
    expect(cell(html, 0, 0)).toContain('aria-label="A1 hit"');
    expect(cell(html, 0, 0)).toContain('aria-disabled="true"');
    expect(cell(html, 0, 1)).toContain('aria-label="B1 miss"');
    expect(cell(html, 9, 9)).toContain('aria-label="J10 water"');
    expect(cell(html, 9, 9)).not.toContain('aria-disabled');
  });

  it('announces queued salvo shots in the cell name', () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        ariaLabel: 'Board',
        markOf,
        targeting: true,
        queueNumber: (c: Coordinate) => (c.row === 4 && c.col === 4 ? 2 : undefined),
      }),
    );
    expect(cell(html, 4, 4)).toContain('aria-label="E5 water, queued shot 2"');
  });

  it('marks a disabled board read-only with every cell disabled', () => {
    const html = renderToStaticMarkup(createElement(Board, { ariaLabel: 'Your board', markOf, disabled: true }));
    expect(html).toContain('aria-readonly="true"');
    expect(count(html, 'aria-disabled="true"')).toBe(100);
  });

  it('hides decorative sea and FX layers from assistive technology', () => {
    const html = renderToStaticMarkup(
      createElement(Board, { ariaLabel: 'Board', markOf, overlay: createElement('span', { className: 'probe' }) }),
    );
    expect(html).toMatch(/class="board-sea fx" aria-hidden="true"/);
    expect(html).toMatch(/class="board-water" aria-hidden="true"/);
    expect(html).toMatch(/class="board-fx fx"[^>]*aria-hidden="true"><span class="probe">/);
  });
});

describe('Toast', () => {
  it('is a polite status region so screen readers hear it', () => {
    const html = renderToStaticMarkup(createElement(Toast, { message: 'Cadet Bot fired at B3 — hit', onDone: () => undefined }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
  });

  it('renders nothing without a message', () => {
    expect(renderToStaticMarkup(createElement(Toast, { message: null, onDone: () => undefined }))).toBe('');
  });
});

describe('Modal', () => {
  it('is a labelled modal dialog', () => {
    const props = { title: 'Resign this game?', onClose: () => undefined, children: createElement('button', null, 'Yes') };
    const html = renderToStaticMarkup(createElement(Modal, props));
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Resign this game?"');
  });
});
