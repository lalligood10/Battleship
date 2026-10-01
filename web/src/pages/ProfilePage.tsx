import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { accuracyPercentage, winPercentage } from '@shared/scoring';
import { ChallengeButton } from '../components/ChallengeButton';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { adminStatus, checkUsername, setUsername } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { fetchHistory } from '../lib/firestore';
import { disablePush, enablePush, pushAvailable, pushState, type PushState } from '../lib/push';
import { isBotGame, opponentUid, type Game } from '../lib/types';
import { useSession } from '../state/SessionProvider';
import { useTheme, type ThemePreference } from '../state/theme';

export function ProfilePage() {
  const { profile, uid, signOut } = useSession();
  const [theme, setTheme] = useTheme();
  const [history, setHistory] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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

  useEffect(() => {
    adminStatus()
      .then((result) => setIsAdmin(result.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

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

      <UsernameSettings current={profile.username} />

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

      {isAdmin && (
        <Link className="btn btn--secondary btn--block" to="/admin">
          Manage players
        </Link>
      )}

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
              const oppName = opp ? g.players[opp]?.username ?? 'Opponent' : 'Opponent';
              return (
                <div key={g.id} className="list-item">
                  <Link to={`/game/${g.id}`} className="row grow" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span className={`badge ${won ? 'badge--win' : 'badge--loss'}`}>{won ? 'W' : 'L'}</span>
                    <span className="grow">
                      <div style={{ fontWeight: 700 }}>vs {oppName}</div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        {g.endReason === 'resign' ? 'By resignation' : g.endReason === 'timeout' ? 'By timeout' : 'Fleet destroyed'}
                        {g.finishedAt ? ` · ${g.finishedAt.toDate().toLocaleDateString()}` : ''}
                      </div>
                    </span>
                    {delta !== undefined && <b className={delta >= 0 ? 'delta-up' : 'delta-down'}>{delta >= 0 ? `+${delta}` : delta}</b>}
                  </Link>
                  {opp && !isBotGame(g) && <ChallengeButton opponentUid={opp} opponentName={oppName} />}
                </div>
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

type UsernameCheck = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'bad'; reason: string };

function UsernameSettings({ current }: { current: string }) {
  const [name, setName] = useState(current);
  const [check, setCheck] = useState<UsernameCheck>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(current), [current]);
  useEffect(() => {
    const value = name.trim();
    if (!value || value.toLowerCase() === current.toLowerCase()) {
      setCheck({ kind: 'idle' });
      return;
    }
    if (value.length < 3) {
      setCheck({ kind: 'bad', reason: 'Use at least 3 characters' });
      return;
    }
    setCheck({ kind: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsername(value);
        setCheck(result.available ? { kind: 'ok' } : { kind: 'bad', reason: result.reason ?? 'Not available' });
      } catch (err) {
        setCheck({ kind: 'bad', reason: errorMessage(err) });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [current, name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setUsername(name.trim());
      setNotice('Username updated.');
      setCheck({ kind: 'idle' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ fontSize: 16 }}>Username</h2>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert kind="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      <label className="field">
        Display name
        <input
          className="input"
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={16}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="small" style={{ minHeight: 18 }}>
        {check.kind === 'checking' && <span className="muted">Checking…</span>}
        {check.kind === 'ok' && <span style={{ color: 'var(--success)' }}>Available</span>}
        {check.kind === 'bad' && <span style={{ color: 'var(--danger)' }}>{check.reason}</span>}
      </div>
      <button className="btn btn--primary" type="submit" disabled={busy || check.kind !== 'ok'}>
        {busy ? 'Saving…' : 'Change username'}
      </button>
    </form>
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
