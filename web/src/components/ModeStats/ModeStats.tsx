import { useState } from 'react';
import { GAME_MODES } from '@shared/analytics/contract';
import { GAME_MODE_OPTIONS } from '@shared/core/schema';
import { Alert, Empty, Spinner } from '../ui';
import {
  bucketHasGames,
  formatAccuracy,
  formatAvgTurnsToWin,
  formatWinLoss,
  formatWinRate,
  type PlayerStatsDoc,
} from '../../lib/stats';
import './ModeStats.css';

export type ModeStatsBucket = 'pvp' | 'bot';

export interface ModeStatsProps {
  /** `null` once loaded means no Phase 5 games yet; `undefined` means still loading. */
  stats: PlayerStatsDoc | null | undefined;
  error?: string | null;
  initialBucket?: ModeStatsBucket;
}

const BUCKETS: { id: ModeStatsBucket; label: string }[] = [
  { id: 'pvp', label: 'vs players' },
  { id: 'bot', label: 'vs computer' },
];

export function ModeStats({ stats, error, initialBucket = 'pvp' }: ModeStatsProps) {
  const [bucket, setBucket] = useState<ModeStatsBucket>(initialBucket);
  const modes = stats?.[bucket];

  return (
    <section className="card stack mode-stats" aria-labelledby="mode-stats-title">
      <div className="mode-stats__head">
        <h2 id="mode-stats-title" className="mode-stats__title">
          Service record by mode
        </h2>
        <span className="badge mode-stats__since">Tracked since Phase 5</span>
      </div>
      <div className="segmented" role="radiogroup" aria-label="Opponent type">
        {BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            role="radio"
            aria-checked={bucket === b.id}
            className={bucket === b.id ? 'active' : ''}
            onClick={() => setBucket(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error && <Alert>{error}</Alert>}
      {stats === undefined && !error && <Spinner label="Loading service record…" />}
      {stats !== undefined && !error && !bucketHasGames(modes) && (
        <Empty
          title={bucket === 'pvp' ? 'No games vs players tracked yet' : 'No games vs the computer tracked yet'}
          message="Finish a game and your per-mode record will appear here."
        />
      )}
      {modes && bucketHasGames(modes) && (
        <div className="mode-stats__list">
          {GAME_MODES.map((mode) => {
            const s = modes[mode];
            const label = GAME_MODE_OPTIONS.find((o) => o.mode === mode)?.label ?? mode;
            return (
              <article key={mode} className={`mode-stats__mode mode-stats__mode--${mode}`} aria-labelledby={`mode-stats-${mode}`}>
                <h3 id={`mode-stats-${mode}`} className="mode-stats__mode-name">
                  {label}
                </h3>
                <dl className="mode-stats__grid">
                  <Cell label="Games" value={String(s.gamesPlayed)} />
                  <Cell label="W–L" value={formatWinLoss(s)} />
                  <Cell label="Win rate" value={formatWinRate(s)} />
                  <Cell label="Accuracy" value={formatAccuracy(s)} />
                  <Cell label="Avg turns to win" value={formatAvgTurnsToWin(s)} />
                  <Cell label="Ships lost" value={String(s.shipsLost)} />
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="mode-stats__cell">
      <dt>{label}</dt>
      <dd>{value === '—' ? <span aria-label="none">—</span> : value}</dd>
    </div>
  );
}
