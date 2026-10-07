import { useEffect, useState, type FormEvent } from 'react';
import { EmailAuthProvider, GoogleAuthProvider, linkWithCredential, linkWithPopup } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { accuracyPercentage, winPercentage } from '@shared/scoring';
import { ChallengeButton } from '../components/ChallengeButton';
import { ModeStats } from '../components/ModeStats';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { adminStatus, checkUsername, completeGuestUpgrade, setUsername } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { auth } from '../lib/firebase';
import { fetchHistory } from '../lib/firestore';
import { getPlayerStats, type PlayerStatsDoc } from '../lib/stats';
import { disablePush, enablePush, pushAvailable, pushState, type PushState } from '../lib/push';
import { hasReplay } from '../game/replay';
import { isBotGame, opponentUid, type Game } from '../lib/types';
import { useSession } from '../state/SessionProvider';
import { GUEST_SIGN_OUT_WARNING, guestUpgradeErrorMessage } from '../state/guest';
import { useTheme, type ThemePreference } from '../state/theme';

export function ProfilePage() {
  const { profile, uid, signOut } = useSession();
  const [theme, setTheme] = useTheme();
  const [history, setHistory] = useState<Game[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [upgradeNotice, setUpgradeNotice] = useState<string | null>(null);
  const [modeStats, setModeStats] = useState<PlayerStatsDoc | null | undefined>(undefined);
  const [modeStatsError, setModeStatsError] = useState<string | null>(null);

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
    if (!uid) return;
    let cancelled = false;
    getPlayerStats(uid)
      .then((doc) => !cancelled && setModeStats(doc))
      .catch((e: unknown) => !cancelled && setModeStatsError(errorMessage(e)));
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
      <section className="card profile-id" aria-label="Your profile">
        <div className="avatar profile-id__avatar" aria-hidden="true">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="grow">
          <p className="profile-id__name">{profile.username}</p>
          <p className="profile-id__rating">
            <span className="panel-title">Rating</span> <b className="mono">{profile.rating}</b>
          </p>
        </div>
        {profile.isGuest && <span className="badge profile-id__guest">Guest</span>}
      </section>

      {profile.isGuest && <GuestUpgradeCard onSuccess={() => setUpgradeNotice('Account saved.')} />}
      {upgradeNotice && <Alert kind="success">{upgradeNotice}</Alert>}

      <UsernameSettings current={profile.username} />

      <div className="stat-grid profile-stats" role="group" aria-label="Your stats">
        <Stat label="Wins" value={s.wins} />
        <Stat label="Losses" value={s.losses} />
        <Stat label="Played" value={s.gamesPlayed} />
        <Stat label="Win %" value={`${winPercentage(s)}%`} />
        <Stat label="Accuracy" value={`${accuracyPercentage(s)}%`} />
        <Stat label="Best streak" value={s.longestStreak} />
      </div>

      <ModeStats stats={modeStats} error={modeStatsError} />

      {/* Phase 5: achievement shelf mounts here */}

      <section className="card stack" aria-labelledby="profile-appearance">
        <h2 id="profile-appearance" className="panel-title">
          Appearance
        </h2>
        <div className="segmented theme-toggle" role="radiogroup" aria-labelledby="profile-appearance">
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

      <section className="stack" aria-labelledby="profile-history">
        <h2 id="profile-history" className="panel-title">
          Game history
        </h2>
        {error && <Alert>{error}</Alert>}
        {history === null && !error && <Spinner />}
        {history && history.length === 0 && <Empty title="No finished games yet" message="Your results will appear here." />}
        {history && history.length > 0 && (
          <div className="list">
            {history.map((g) => {
              const opp = opponentUid(g, uid);
              const name = opp ? g.players[opp]?.username ?? 'Opponent' : 'Opponent';
              const won = g.winnerUid === uid;
              const delta = g.ratingChanges?.[uid]?.delta;
              return (
                <div key={g.id} className="row history-row">
                  <Link to={`/game/${g.id}`} className="list-item grow history-row__link">
                    <span className={`badge ${won ? 'badge--win' : 'badge--loss'}`}>{won ? 'W' : 'L'}</span>
                    <span className="grow">
                      <div className="history-row__name">vs {name}</div>
                      <div className="muted history-row__meta">
                        {g.endReason === 'resign' ? 'By resignation' : g.endReason === 'timeout' ? 'By timeout' : 'Fleet destroyed'}
                        {g.finishedAt ? ` · ${g.finishedAt.toDate().toLocaleDateString()}` : ''}
                      </div>
                    </span>
                    {delta !== undefined && <b className={delta >= 0 ? 'delta-up' : 'delta-down'}>{delta >= 0 ? `+${delta}` : delta}</b>}
                  </Link>
                  {hasReplay(g) && (
                    <Link to={`/game/${g.id}?replay=1`} className="btn btn--ghost btn--sm" aria-label={`Watch replay vs ${name}`}>
                      Replay
                    </Link>
                  )}
                  {opp && !isBotGame(g) && <ChallengeButton opponentUid={opp} opponentName={name} />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <button
        className="btn btn--secondary btn--block"
        onClick={() => {
          if (!profile.isGuest || window.confirm(GUEST_SIGN_OUT_WARNING)) void signOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}

function GuestUpgradeCard({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finishUpgrade = async () => {
    await completeGuestUpgrade();
    onSuccess();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('email');
    setError(null);
    try {
      await linkWithCredential(auth().currentUser!, EmailAuthProvider.credential(email.trim(), password));
      await finishUpgrade();
    } catch (err) {
      setError(guestUpgradeErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      await linkWithPopup(auth().currentUser!, new GoogleAuthProvider());
      await finishUpgrade();
    } catch (err) {
      setError(guestUpgradeErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card stack guest-save" aria-labelledby="guest-save-title">
      <div className="row row--between">
        <h2 id="guest-save-title" className="screen-heading">
          Save your account
        </h2>
        <span className="badge guest-save__badge">Unsaved</span>
      </div>
      <p className="muted">Keep your name, stats and games by linking an email or Google account.</p>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <button className="btn btn--primary btn--block" type="submit" disabled={busy !== null}>
          {busy === 'email' ? <span className="spinner" /> : 'Link email'}
        </button>
      </form>
      <button className="btn btn--secondary btn--block" onClick={() => void google()} disabled={busy !== null}>
        {busy === 'google' ? <span className="spinner" /> : 'Continue with Google'}
      </button>
    </section>
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
    <form className="card stack" onSubmit={submit} aria-labelledby="profile-username">
      <h2 id="profile-username" className="panel-title">
        Username
      </h2>
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
      <div className="small field-status" aria-live="polite">
        {check.kind === 'checking' && <span className="muted">Checking…</span>}
        {check.kind === 'ok' && <span className="field-status--ok">Available</span>}
        {check.kind === 'bad' && <span className="field-status--bad">{check.reason}</span>}
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
    <section className="card stack" aria-labelledby="profile-push">
      <h2 id="profile-push" className="panel-title">
        Notifications
      </h2>
      <p className="muted small">
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
