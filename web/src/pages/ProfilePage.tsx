import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { accuracyPercentage, winPercentage } from '@shared/scoring';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { fetchHistory } from '../lib/firestore';
import { disablePush, enablePush, pushAvailable, pushState, type PushState } from '../lib/push';
import { opponentUid, type Game } from '../lib/types';
import { useSession } from '../state/SessionProvider';
import { useTheme, type ThemePreference } from '../state/theme';

export function ProfilePage() {
  const { profile, uid, signOut } = useSession();
  const [theme, setTheme] = useTheme();
  const [history, setHistory] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchHistory(uid)
      .then((g) => !cancelled && setHistory(g))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (!profile || !uid) return <Spinner />;
  const s = profile.stats;

  return (
    <div className="page">
      <TopBar title="Profile" />
      <div className="card row" style={{ gap: 14 }}>
        <div className="avatar" style={{ width: 52, height: 52, fontSize: 22 }}>
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="grow">
          <div style={{ fontWeight: 800, fontSize: 18 }}>{profile.username}</div>
          <div className="muted">Rating {profile.rating}</div>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Wins" value={s.wins} />
        <Stat label="Losses" value={s.losses} />
        <Stat label="Played" value={s.gamesPlayed} />
        <Stat label="Win %" value={`${winPercentage(s)}%`} />
        <Stat label="Accuracy" value={`${accuracyPercentage(s)}%`} />
        <Stat label="Best streak" value={s.longestStreak} />
      </div>

      <section className="card stack">
        <h2 style={{ fontSize: 16 }}>Appearance</h2>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as ThemePreference[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
              {t === 'system' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </section>

      <PushSettings uid={uid} />

      <section className="stack">
        <h2 style={{ fontSize: 16 }}>Game history</h2>
        {error && <Alert>{error}</Alert>}
        {history === null && !error && <Spinner />}
        {history && history.length === 0 && <Empty title="No finished games yet" message="Your results will appear here." />}
        {history && history.length > 0 && (
          <div className="list">
            {history.map((g) => {
              const opp = opponentUid(g, uid);
              const won = g.winnerUid === uid;
              const delta = g.ratingChanges?.[uid]?.delta;
              return (
                <Link key={g.id} to={`/game/${g.id}`} className="list-item">
                  <span className={`badge ${won ? 'badge--win' : 'badge--loss'}`}>{won ? 'W' : 'L'}</span>
                  <span className="grow">
                    <div style={{ fontWeight: 700 }}>vs {opp ? g.players[opp]?.username ?? 'Opponent' : 'Opponent'}</div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {g.endReason === 'resign' ? 'By resignation' : g.endReason === 'timeout' ? 'By timeout' : 'Fleet destroyed'}
                      {g.finishedAt ? ` · ${g.finishedAt.toDate().toLocaleDateString()}` : ''}
                    </div>
                  </span>
                  {delta !== undefined && <b className={delta >= 0 ? 'delta-up' : 'delta-down'}>{delta >= 0 ? `+${delta}` : delta}</b>}
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <button className="btn btn--secondary btn--block" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

function PushSettings({ uid }: { uid: string }) {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pushAvailable().then((ok) => !cancelled && setAvailable(ok));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(state === 'on' ? await disablePush(uid) : await enablePush(uid));
    } catch (e: unknown) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h2 style={{ fontSize: 16 }}>Notifications</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        Get an alert on this device when it's your turn. Your active games list shows this in-app regardless.
      </p>
      {state === 'blocked' ? (
        <Alert>Notifications are blocked for this site in your browser settings.</Alert>
      ) : (
        <button className={`btn ${state === 'on' ? 'btn--secondary' : 'btn--primary'}`} disabled={busy} onClick={() => void toggle()}>
          {busy ? 'Working…' : state === 'on' ? 'Turn off on this device' : 'Turn on for this device'}
        </button>
      )}
      {error && <Alert>{error}</Alert>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
