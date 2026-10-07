import type { Game } from '../lib/types';
import { coordLabel } from './marks';

export type HeatResult = 'miss' | 'hit' | 'sunk';
export type HeatSource = 'shot' | 'volley' | 'airstrike';

export interface HeatCell {
  row: number;
  col: number;
  order: number;
  bin: number;
  result: HeatResult;
  source: HeatSource;
}

export interface HeatBin {
  bin: number;
  from: number;
  to: number;
}

export type HeatUnit = 'shot' | 'volley';

export interface Heatmap {
  cells: HeatCell[];
  maxOrder: number;
  unit: HeatUnit;
  bins: HeatBin[];
}

export const HEAT_BINS = 5;

export function ordinal(n: number): string {
  const lastTwoDigits = Math.abs(n) % 100;
  const suffix =
    lastTwoDigits >= 11 && lastTwoDigits <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[Math.abs(n) % 10] ?? 'th');
  return `${n}${suffix}`;
}

export function heatBin(order: number, maxOrder: number, bins = HEAT_BINS): number {
  return Math.min(bins, Math.max(1, Math.ceil((order * bins) / maxOrder)));
}

export function buildHeatmap(game: Pick<Game, 'shots' | 'abilityLog' | 'mode'>, shooterUid: string): Heatmap {
  const sortedShots = (game.shots[shooterUid] ?? [])
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => a.shot.at - b.shot.at || a.index - b.index);
  const volleyOrders = new Map<number, number>();
  const airstrikeTurns = new Set(
    (game.abilityLog ?? [])
      .filter((entry) => entry.player === shooterUid && entry.result.abilityId === 'carrier-airstrike')
      .map((entry) => entry.turnNumber),
  );
  let maxOrder = 0;

  const orderedCells = sortedShots.map(({ shot }) => {
    let order: number;
    let source: HeatSource;

    if (shot.volley === undefined) {
      order = ++maxOrder;
      source = 'shot';
    } else {
      const existingOrder = volleyOrders.get(shot.volley);
      if (existingOrder === undefined) {
        order = ++maxOrder;
        volleyOrders.set(shot.volley, order);
      } else {
        order = existingOrder;
      }
      source = airstrikeTurns.has(shot.volley) ? 'airstrike' : 'volley';
    }

    return { shot, order, source };
  });

  const cells = orderedCells.map(({ shot, order, source }) => ({
    row: shot.row,
    col: shot.col,
    order,
    bin: heatBin(order, maxOrder),
    result: shot.result,
    source,
  }));
  const binsByNumber = new Map<number, { from: number; to: number }>();
  for (let order = 1; order <= maxOrder; order++) {
    const bin = heatBin(order, maxOrder);
    const range = binsByNumber.get(bin);
    if (range) {
      range.to = order;
    } else {
      binsByNumber.set(bin, { from: order, to: order });
    }
  }
  const bins = Array.from(binsByNumber, ([bin, range]) => ({ bin, ...range }));

  return {
    cells,
    maxOrder,
    unit: game.mode === 'salvo' ? 'volley' : 'shot',
    bins,
  };
}

export function heatCellLabel(cell: HeatCell, unit: HeatUnit): string {
  return `${coordLabel(cell)}: ${ordinal(cell.order)} ${unit}${cell.source === 'airstrike' ? ' (airstrike)' : ''}, ${cell.result}`;
}
