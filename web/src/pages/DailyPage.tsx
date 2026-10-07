/** Daily challenge: one shared hidden fleet per UTC day, solo, fewest shots wins. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Board } from '../components/Board';
import { Alert, Spinner, TopBar } from '../components/ui';
import { alreadyShot, buildMarks, coordLabel, markAt } from '../game/marks';
import { SHIP_NAMES, type Coordinate } from '../game/placement';
import {
  dailyCounts,
  dailyDateKey,
  dailyStatus,
  dailyStatusText,
  fetchDailyScore,
  fetchDailyTop,
  fetchTodayRun,
  fireDailyShot,
  getDailyChallenge,
  msUntilNextMinute,
  timeUntilReset,
  type DailyScoreRow,
  type DailyStatus,
  type DailyView,
} from '../lib/daily';
import { errorMessage } from '../lib/errors';
import { play } from '../lib/sound';
import type { ShipType } from '../lib/types';
import { useSession, useUid } from '../state/SessionProvider';
import '../styles/daily.css';

const shipName = (type: string) => SHIP_NAMES[type as ShipType] ?? type;

export function DailyPage() {
  const uid = useUid();
  const { profile } = useSession();
  const [view, setView] = useState<DailyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<Coordinate | null>(null);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const reloadedForDate = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await getDailyChallenge());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDailyChallenge()
      .then((v) => !cancelled && setView(v))
      .catch((err: unknown) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let timer = 0;
    const updateAtNextMinute = () => {
      timer = window.setTimeout(() => {
        setNowMs(Date.now());
        updateAtNextMinute();
      }, msUntilNextMinute(Date.now()));
    };
    updateAtNextMinute();
    return () => window.clearTimeout(timer);
  }, []);

  const currentDateKey = dailyDateKey(nowMs);
  const viewDateKey = view?.dateKey;
  useEffect(() => {
    if (!viewDateKey || viewDateKey === currentDateKey) {
      reloadedForDate.current = null;
      return;
    }
    if (reloadedForDate.current === currentDateKey) return;
    reloadedForDate.current = currentDateKey;
    setTarget(null);
    void load();
  }, [currentDateKey, load, viewDateKey]);

  const marks = useMemo(() => buildMarks(view?.shots ?? []), [view]);
  const cleared = view?.completedAtMs != null;

  const onCellTap = (c: Coordinate) => {
    if (!view || cleared || busy || alreadyShot(view.shots, c)) return;
    setTarget(c);
  };

  const fire = async () => {
    if (!view || !target) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fireDailyShot({ dateKey: view.dateKey, row: target.row, col: target.col });
      const shot = next.shots.at(-1);
      if (shot) {
        play(shot.result === 'miss' ? 'miss' : shot.result === 'sunk' ? 'sunk' : 'hit');
        const name = shot.sunkShip ? shipName(shot.sunkShip) : null;
        setAnnouncement(
          `${coordLabel(shot)}: ${shot.result === 'miss' ? 'miss' : shot.result === 'sunk' ? `hit, ${name} sunk` : 'hit'}.` +
            (next.completedAtMs !== null ? ` Fleet cleared in ${next.shots.length} shots.` : ''),
        );
      }
      if (next.completedAtMs !== null) play('win');
      setView(next);
      setTarget(null);
    } catch (err) {
      setError(errorMessage(err));
      setTarget(null);
      // A stale board (past 00:00 UTC) or a repeat from another tab: resync with the server.
      void load();
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div className="page daily-page">
        <TopBar title="Daily challenge" back="/" />
        {error ? <Alert>{error}</Alert> : <Spinner label="Loading today's board…" />}
      </div>
    );
  }

  const counts = dailyCounts(view);
  return (
    <div className="page daily-page">
      <TopBar title="Daily challenge" back="/" />
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
      <p className="gm-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="daily-layout">
        <section className="stack daily-board" aria-labelledby="daily-board-heading">
          <div className="daily-head">
            <h2 className="game-section__title" id="daily-board-heading">
              Daily waters <span className="mono daily-date">{view.dateKey}</span>
            </h2>
            <p className="daily-reset muted small">
              Same board for everyone. Resets at 00:00 UTC (in {timeUntilReset(nowMs)}).
            </p>
          </div>
          <Board
            ariaLabel="Daily challenge board"
            targeting
            fog
            disabled={busy || cleared}
            markOf={(c) => markAt(marks, c)}
            selected={(c) => target?.row === c.row && target?.col === c.col}
            lastShot={marks.lastShot}
            onCellTap={onCellTap}
          />
          {!cleared && (
            <button className="btn btn--primary btn--block" data-fire-control disabled={!target || busy} onClick={() => void fire()}>
              {busy ? <span className="spinner" /> : target ? `Fire at ${coordLabel(target)}` : 'Tap a square to aim'}
            </button>
          )}
        </section>

        <div className="stack daily-side">
          <section className="card stack" aria-labelledby="daily-log-heading">
            <h2 className="panel-title" id="daily-log-heading">
              Mission log
            </h2>
            <div className="stat-grid">
              <div className="stat">
                <b>{counts.shots}</b>
                <span>Shots</span>
              </div>
              <div className="stat">
                <b>{counts.hits}</b>
                <span>Hits</span>
              </div>
              <div className="stat">
                <b>
                  {view.sunkShips.length}/{view.shipTypes.length}
                </b>
                <span>Sunk</span>
              </div>
            </div>
            <ul className="daily-ships" aria-label="Enemy fleet">
              {view.shipTypes.map((type) => {
                const sunk = view.sunkShips.includes(type);
                return (
                  <li key={type} className={`daily-ship${sunk ? ' daily-ship--sunk' : ''}`}>
                    <span className="daily-ship__glyph" aria-hidden="true">
                      {sunk ? '✕' : '◆'}
                    </span>
                    <span className="grow">{shipName(type)}</span>
                    <span className="daily-ship__state mono">{sunk ? 'Sunk' : 'Afloat'}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {cleared && <DailyCleared view={view} uid={uid} isGuest={profile?.isGuest === true} />}
        </div>
      </div>
    </div>
  );
}

function DailyCleared({ view, uid, isGuest }: { view: DailyView; uid: string; isGuest: boolean }) {
  const [top, setTop] = useState<DailyScoreRow[] | null>(null);
  const [mine, setMine] = useState<DailyScoreRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDailyTop(view.dateKey), isGuest ? Promise.resolve(null) : fetchDailyScore(view.dateKey, uid)])
      .then(([rows, own]) => {
        if (cancelled) return;
        setTop(rows);
        setMine(own);
      })
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [view.dateKey, uid, isGuest]);

  const rank = top ? top.findIndex((r) => r.uid === uid) : -1;
  return (
    <section className="card stack daily-cleared" aria-labelledby="daily-cleared-heading">
      <h2 className="daily-cleared__title" id="daily-cleared-heading">
        Fleet cleared
      </h2>
      <p className="daily-cleared__score">
        <b className="mono">{view.shots.length}</b> shots
        {rank >= 0 && <span className="muted"> · #{rank + 1} today</span>}
      </p>
      {isGuest && <p className="muted small">Guests aren't ranked. Link an account from Profile to join the scoreboard.</p>}
      {!isGuest && !mine && top && <p className="muted small">Your score is being recorded.</p>}
      <h3 className="panel-title">Today's top {10}</h3>
      {error && <Alert>{error}</Alert>}
      {!top && !error && <Spinner />}
      {top && top.length === 0 && <p className="muted small">No ranked clears yet.</p>}
      {top && top.length > 0 && (
        <ol className="list daily-top">
          {top.map((row, i) => (
            <li key={row.uid} className={`list-item daily-top__row${row.uid === uid ? ' daily-top__row--me' : ''}`}>
              <span className={`rank mono${row.uid === uid ? ' me' : ''}`}>{i + 1}</span>
              <span className="grow">
                {row.username}
                {row.uid === uid && <span className="badge daily-top__you">You</span>}
              </span>
              <span className="mono">
                {row.shots}
                <span className="gm-sr-only"> shots</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <Link to="/" className="btn btn--secondary btn--block">
        Back to base
      </Link>
    </section>
  );
}

/** Home entry card: today's status and a link to /daily. */
export function DailyCard({ uid }: { uid: string }) {
  const [status, setStatus] = useState<DailyStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTodayRun(uid)
      .then((run) => !cancelled && setStatus(dailyStatus(run)))
      .catch(() => !cancelled && setStatus({ kind: 'not-started' }));
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return <DailyCardView status={status} />;
}

export function DailyCardView({ status }: { status: DailyStatus | null }) {
  const cta = status?.kind === 'cleared' ? 'View results' : status?.kind === 'in-progress' ? 'Resume' : 'Start';
  return (
    <section className={`card home-daily${status?.kind === 'cleared' ? ' home-daily--cleared' : ''}`} aria-labelledby="daily-heading">
      <div className="home-daily__text">
        <h2 className="gm-heading" id="daily-heading">
          Daily challenge
        </h2>
        <p className="home-daily__status mono">
          <span className="home-daily__glyph" aria-hidden="true">
            {status?.kind === 'cleared' ? '✓' : status?.kind === 'in-progress' ? '◐' : '○'}
          </span>
          {status ? dailyStatusText(status) : 'Checking today…'}
        </p>
        <p className="home-hint">One shared board · fewest shots wins · resets 00:00 UTC</p>
      </div>
      <Link to="/daily" className="btn btn--primary home-daily__cta">
        {cta}
        <span className="gm-sr-only"> daily challenge</span>
      </Link>
    </section>
  );
}
