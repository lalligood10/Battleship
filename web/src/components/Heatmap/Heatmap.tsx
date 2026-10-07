import { useMemo, useState } from 'react';
import { buildHeatmap, heatCellLabel, ordinal, type Heatmap as HeatmapData } from '../../game/heatmap';
import { COLUMN_LABELS, ROW_LABELS } from '../../game/placement';
import { formatAccuracy, resultStats } from '../../game/resultStats';
import type { Game } from '../../lib/types';
import './Heatmap.css';

const SIZE = 10;

/**
 * 10×10 firing-order map. Each fired cell shows its order as a number, a sequential fill by bin,
 * and a corner mark for hit/sunk, so neither value relies on colour alone.
 */
export function Heatmap({ heatmap, label }: { heatmap: HeatmapData; label: string }) {
  const byCell = new Map(heatmap.cells.map((cell) => [cell.row * SIZE + cell.col, cell]));
  return (
    <div className="heatmap" role="grid" aria-label={label} aria-readonly="true">
      <span className="heatmap-label" aria-hidden />
      {COLUMN_LABELS.slice(0, SIZE).map((c) => (
        <span key={c} className="heatmap-label" aria-hidden>
          {c}
        </span>
      ))}
      {ROW_LABELS.slice(0, SIZE).map((r, row) => (
        <div key={r} role="row" className="heatmap-row">
          <span className="heatmap-label" aria-hidden>
            {r}
          </span>
          {Array.from({ length: SIZE }, (_, col) => {
            const cell = byCell.get(row * SIZE + col);
            if (!cell) {
              return (
                <div
                  key={col}
                  role="gridcell"
                  className="heat-cell"
                  aria-label={`${COLUMN_LABELS[col]}${r}: not fired`}
                />
              );
            }
            return (
              <div
                key={col}
                role="gridcell"
                className={`heat-cell heat-cell--b${cell.bin} heat-cell--${cell.result}`}
                aria-label={heatCellLabel(cell, heatmap.unit)}
              >
                <span className="heat-order" aria-hidden>
                  {cell.order}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Grayscale-readable legend: each bin swatch is numbered and labelled with its order range. */
export function HeatmapLegend({ heatmap }: { heatmap: HeatmapData }) {
  if (heatmap.maxOrder === 0) return null;
  const unit = heatmap.unit;
  return (
    <div className="heatmap-legend">
      <p className="heatmap-legend-title">
        Number = firing order ({unit} 1 to {heatmap.maxOrder}). Brighter = later.
      </p>
      <ul className="heatmap-scale" aria-label="Firing order scale">
        {heatmap.bins.map((bin) => (
          <li key={bin.bin} className="heatmap-scale-item">
            <span className={`heat-swatch heat-cell--b${bin.bin}`} aria-hidden>
              {bin.bin}
            </span>
            <span className="heatmap-scale-range">
              {bin.from === bin.to ? ordinal(bin.from) : `${ordinal(bin.from)}–${ordinal(bin.to)}`}
            </span>
          </li>
        ))}
      </ul>
      <ul className="heatmap-keys">
        <li>
          <span className="heat-swatch heat-cell--b1" aria-hidden />
          Miss
        </li>
        <li>
          <span className="heat-swatch heat-cell--b1 heat-cell--hit" aria-hidden />
          Hit (corner mark)
        </li>
        <li>
          <span className="heat-swatch heat-cell--b1 heat-cell--sunk" aria-hidden />
          Sunk (corner mark and outline)
        </li>
      </ul>
    </div>
  );
}

type View = 'mine' | 'theirs';

/** Results-screen panel: a "Your shots" / "Their shots" toggle over the two players' heatmaps. */
export function ShotHeatmapPanel({
  game,
  uid,
  opponentUid,
  opponentName,
}: {
  game: Pick<Game, 'shots' | 'abilityLog' | 'mode' | 'playerUids'>;
  uid: string;
  opponentUid: string;
  opponentName: string;
}) {
  const [view, setView] = useState<View>('mine');
  const mine = useMemo(() => buildHeatmap(game, uid), [game, uid]);
  const theirs = useMemo(() => buildHeatmap(game, opponentUid), [game, opponentUid]);
  const heatmap = view === 'mine' ? mine : theirs;
  const stats = resultStats(game, view === 'mine' ? uid : opponentUid);
  const target = view === 'mine' ? `${opponentName}'s waters` : 'your waters';

  return (
    <section className="card heatmap-panel" aria-labelledby="heatmap-heading">
      <div className="heatmap-head">
        <h2 className="heatmap-heading" id="heatmap-heading">
          Shot heatmap
        </h2>
        <div className="heatmap-toggle" role="group" aria-label="Heatmap view">
          <button
            type="button"
            className="btn heatmap-toggle-btn"
            aria-pressed={view === 'mine'}
            onClick={() => setView('mine')}
          >
            Your shots
          </button>
          <button
            type="button"
            className="btn heatmap-toggle-btn"
            aria-pressed={view === 'theirs'}
            onClick={() => setView('theirs')}
          >
            Their shots
          </button>
        </div>
      </div>
      <p className="heatmap-summary" aria-live="polite">
        {view === 'mine' ? 'Your' : `${opponentName}'s`} fire on {target}: {stats.shotsFired} shots, {stats.hits} hits,{' '}
        {formatAccuracy(stats.accuracy)} accuracy.
      </p>
      {heatmap.maxOrder === 0 ? (
        <p className="muted small">No shots fired.</p>
      ) : (
        <>
          <Heatmap heatmap={heatmap} label={view === 'mine' ? 'Your shots heatmap' : 'Their shots heatmap'} />
          <HeatmapLegend heatmap={heatmap} />
        </>
      )}
    </section>
  );
}
