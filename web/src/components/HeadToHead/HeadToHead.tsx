import type { GameMode } from '@shared/core/schema';
import { GAME_MODE_OPTIONS } from '@shared/core/schema';
import { headToHeadScore, headToHeadStanding, type HeadToHeadDoc, type HeadToHeadScore } from '../../lib/stats';
import './HeadToHead.css';

const STANDING_TEXT = { lead: 'You lead', trail: 'You trail', level: 'All square' } as const;
const STANDING_GLYPH = { lead: '▲', trail: '▼', level: '=' } as const;

function scoreText(s: HeadToHeadScore): string {
  return `You ${s.mine}–${s.theirs}`;
}

/** Compact "You 3–2" chip for list rows. No record yet renders an explicit "No H2H yet". */
export function HeadToHeadChip({ h2h, myUid, opponentName }: { h2h: HeadToHeadDoc | null; myUid: string; opponentName: string }) {
  if (!h2h || h2h.gamesPlayed === 0) {
    return <span className="h2h-chip h2h-chip--none">No H2H yet</span>;
  }
  const score = headToHeadScore(h2h, myUid);
  const standing = headToHeadStanding(score);
  return (
    <span
      className={`h2h-chip h2h-chip--${standing}`}
      aria-label={`Head-to-head vs ${opponentName}: you ${score.mine}, ${opponentName} ${score.theirs}. ${STANDING_TEXT[standing]}.`}
    >
      <span className="h2h-chip__glyph" aria-hidden="true">
        {STANDING_GLYPH[standing]}
      </span>
      <span aria-hidden="true">{scoreText(score)}</span>
    </span>
  );
}

/** Head-to-head panel for the waiting / rematch screen: overall record plus this mode's wins. */
export function HeadToHeadCard({
  h2h,
  myUid,
  opponentName,
  mode,
}: {
  h2h: HeadToHeadDoc | null;
  myUid: string;
  opponentName: string;
  mode: GameMode;
}) {
  const modeLabel = GAME_MODE_OPTIONS.find((o) => o.mode === mode)?.label ?? 'Classic';
  const overall = headToHeadScore(h2h, myUid);
  const inMode = headToHeadScore(h2h, myUid, mode);
  const standing = headToHeadStanding(overall);
  const played = h2h?.gamesPlayed ?? 0;

  return (
    <section className="card h2h-card" aria-labelledby="h2h-title">
      <div className="h2h-card__head">
        <h2 id="h2h-title" className="h2h-card__title">
          Head-to-head
        </h2>
        <span className="panel-title">vs {opponentName}</span>
      </div>
      {played === 0 ? (
        <p className="muted small h2h-card__empty">First engagement on record — no games tracked between you yet.</p>
      ) : (
        <>
          <dl className="h2h-card__grid">
            <div className="h2h-card__cell">
              <dt>Overall</dt>
              <dd className="h2h-card__score">{scoreText(overall)}</dd>
            </div>
            <div className="h2h-card__cell">
              <dt>{modeLabel} wins</dt>
              <dd className="h2h-card__score">{scoreText(inMode)}</dd>
            </div>
            <div className="h2h-card__cell">
              <dt>Games</dt>
              <dd className="h2h-card__score">{played}</dd>
            </div>
          </dl>
          <p className={`h2h-card__standing h2h-card__standing--${standing}`}>
            <span aria-hidden="true">{STANDING_GLYPH[standing]} </span>
            {STANDING_TEXT[standing]}
          </p>
        </>
      )}
      <p className="muted small h2h-card__since">Tracked since Phase 5</p>
    </section>
  );
}
