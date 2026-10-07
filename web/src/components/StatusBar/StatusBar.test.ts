import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { fleetSummary } from './fleetSummary';
import { StatusBar } from './StatusBar';

const makeStatusBar = (props: Partial<Parameters<typeof StatusBar>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(StatusBar, {
      turnText: 'Your turn — pick a target',
      tone: 'mine',
      enemyName: 'Opponent',
      enemySunk: [],
      ownSunk: [],
      ...props,
    }),
  );

describe('StatusBar markup', () => {
  it('places the turn text in a status region', () => {
    const html = makeStatusBar();
    expect(html).toContain('<p class="status-bar__turn" role="status">');
    expect(html).toContain('Your turn — pick a target');
  });

  it('shows afloat counts for both fleets', () => {
    const html = makeStatusBar({ enemySunk: ['carrier', 'battleship'], ownSunk: ['cruiser', 'submarine'] });
    expect(html).toContain('3/5 afloat');
    expect(html).toContain('<b>3/5</b> afloat');
  });

  it('marks sunk enemy ships and includes hidden sunk text', () => {
    const html = makeStatusBar({ enemySunk: ['carrier'] });
    expect(html).toContain('class="status-ship status-ship--sunk"');
    expect(html).toContain('Carrier<span class="status-bar__sr-only"> — sunk</span>');
  });

  it('renders all five enemy ship names', () => {
    const html = makeStatusBar();
    for (const name of ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer']) {
      expect(html).toContain(name);
    }
  });

  it('renders both salvo variants and omits the line in classic mode', () => {
    expect(makeStatusBar({ salvo: { mine: true, shots: 3 } })).toMatch(/Shots this volley: <span>3<\/span>/);
    expect(makeStatusBar({ salvo: { mine: false, shots: 2 } })).toMatch(/Opponent fires <span>2<\/span> next volley/);
    expect(makeStatusBar()).not.toContain('Shots this volley');
  });
});

describe('fleetSummary', () => {
  it('summarizes ship names, lengths, and sunk state', () => {
    const summary = fleetSummary(['carrier', 'submarine']);
    expect(summary).toMatchObject({ afloat: 3, total: 5 });
    expect(summary.ships).toHaveLength(5);
    expect(summary.ships.find((ship) => ship.type === 'carrier')).toMatchObject({
      name: 'Carrier',
      length: 5,
      sunk: true,
    });
    expect(summary.ships.find((ship) => ship.type === 'battleship')).toMatchObject({
      name: 'Battleship',
      length: 4,
      sunk: false,
    });
  });

  it('counts an empty and a complete sunk fleet', () => {
    expect(fleetSummary([])).toMatchObject({ afloat: 5, total: 5 });
    expect(fleetSummary(['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'])).toMatchObject({
      afloat: 0,
      total: 5,
    });
  });
});
