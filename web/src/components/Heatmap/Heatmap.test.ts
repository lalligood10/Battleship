import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildHeatmap } from '../../game/heatmap';
import type { Game, Shot } from '../../lib/types';
import { Heatmap, HeatmapLegend } from './Heatmap';

const shot = (row: number, col: number, result: Shot['result'], at: number, volley?: number): Shot => ({
  row,
  col,
  result,
  at,
  ...(volley === undefined ? {} : { volley }),
});

const classic = {
  mode: 'classic',
  abilityLog: [],
  shots: {
    me: [shot(0, 0, 'miss', 1), shot(1, 1, 'miss', 2), shot(3, 2, 'hit', 3), shot(4, 2, 'sunk', 4)],
    them: [],
  },
} as unknown as Pick<Game, 'shots' | 'abilityLog' | 'mode'>;

describe('Heatmap markup', () => {
  const html = renderToStaticMarkup(
    createElement(Heatmap, {
      heatmap: buildHeatmap(classic, 'me'),
      label: 'Your shots heatmap',
    }),
  );

  it('names every one of the 100 cells', () => {
    expect(html).toContain('role="grid" aria-label="Your shots heatmap"');
    expect(html.match(/role="gridcell"/g)).toHaveLength(100);
    expect(html.match(/role="row"/g)).toHaveLength(10);
  });

  it('labels fired cells with coordinate, order and result', () => {
    expect(html).toContain('aria-label="C4: 3rd shot, hit"');
    expect(html).toContain('aria-label="A1: 1st shot, miss"');
    expect(html).toContain('aria-label="C5: 4th shot, sunk"');
    expect(html).toContain('aria-label="J10: not fired"');
  });

  it('shows the order as a number, not colour alone', () => {
    expect(html).toMatch(
      /heat-cell--b4 heat-cell--hit" aria-label="C4: 3rd shot, hit"><span class="heat-order" aria-hidden="true">3<\/span>/,
    );
  });

  it('labels Salvo cells by volley', () => {
    const salvo = {
      mode: 'salvo',
      abilityLog: [],
      shots: {
        me: [shot(0, 0, 'miss', 5, 1), shot(0, 1, 'hit', 5, 1), shot(2, 3, 'miss', 9, 2)],
      },
    } as unknown as Pick<Game, 'shots' | 'abilityLog' | 'mode'>;
    const salvoHtml = renderToStaticMarkup(
      createElement(Heatmap, {
        heatmap: buildHeatmap(salvo, 'me'),
        label: 'Salvo',
      }),
    );
    expect(salvoHtml).toContain('aria-label="B1: 1st volley, hit"');
    expect(salvoHtml).toContain('aria-label="D3: 2nd volley, miss"');
  });

  it('renders a numbered, ranged legend', () => {
    const legend = renderToStaticMarkup(createElement(HeatmapLegend, { heatmap: buildHeatmap(classic, 'me') }));
    expect(legend).toContain('Number = firing order (shot 1 to 4)');
    expect(legend).toContain('aria-label="Firing order scale"');
    // 4 shots over 5 bins: the 1st shot lands in bin 2, the 4th in bin 5.
    expect(legend).toMatch(/heat-cell--b2" aria-hidden="true">2<\/span><span class="heatmap-scale-range">1st<\/span>/);
    expect(legend).toMatch(/heat-cell--b5" aria-hidden="true">5<\/span><span class="heatmap-scale-range">4th<\/span>/);
    expect(legend).toContain('Sunk (corner mark and outline)');
  });

  it('renders no legend without shots', () => {
    const empty = buildHeatmap(
      { mode: 'classic', abilityLog: [], shots: {} } as unknown as Pick<Game, 'shots' | 'abilityLog' | 'mode'>,
      'me',
    );
    expect(renderToStaticMarkup(createElement(HeatmapLegend, { heatmap: empty }))).toBe('');
  });
});
