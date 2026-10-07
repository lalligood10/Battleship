import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../game/placement';
import { Board, type CellMark } from './Board';

describe('Board console accessibility markup', () => {
  const markOf = (_cell: Coordinate): CellMark => 'water';

  it('hides the column header row and exposes ten rows of ten gridcells', () => {
    const html = renderToStaticMarkup(createElement(Board, { ariaLabel: 'Board', markOf }));
    const rows = Array.from(html.matchAll(/<div role="row"([^>]*)>/g));
    const hiddenRows = rows.filter((row) => row[1]?.includes('aria-hidden="true"'));
    const visibleRows = rows.filter((row) => !row[1]?.includes('aria-hidden="true"'));

    expect(hiddenRows).toHaveLength(1);
    expect(visibleRows).toHaveLength(10);
    for (const [index, row] of visibleRows.entries()) {
      const start = (row.index ?? 0) + row[0].length;
      const end = rows[index + 2]?.index ?? html.length;
      expect(html.slice(start, end).match(/role="gridcell"/g) ?? []).toHaveLength(10);
    }
  });

  it('adds the carry marker through cellClassName', () => {
    const html = renderToStaticMarkup(
      createElement(Board, {
        ariaLabel: 'Board',
        markOf,
        cellClassName: (cell) => (cell.row === 2 && cell.col === 4 ? 'cell--carry' : undefined),
      }),
    );
    expect(html).toContain('class="cell cell--water cell--carry" data-row="2" data-col="4"');
  });

  it('renders static console overlays without the old fire effects', () => {
    const html = renderToStaticMarkup(createElement(Board, { ariaLabel: 'Board', markOf }));
    expect(html).toContain('class="board-sea fx" aria-hidden="true"');
    expect(html).toContain('class="console-scanlines"');
    expect(html).toContain('class="console-corners"');
    expect(html).not.toContain('sea-fire');
  });
});
