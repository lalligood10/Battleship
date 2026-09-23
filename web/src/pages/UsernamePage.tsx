import { useEffect, useState, type FormEvent } from 'react';
import { Alert } from '../components/ui';
import { checkUsername, setUsername } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useSession } from '../state/SessionProvider';

type Check = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'bad'; reason: string };

export function UsernamePage() {
  const { signOut } = useSession();
  const [name, setName] = useState('');
  const [check, setCheck] = useState<Check>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced availability check as the user types.
  useEffect(() => {
    const value = name.trim();
    if (value.length < 3) {
      setCheck({ kind: 'idle' });
      return;
    }
    setCheck({ kind: 'checking' });
    const t = setTimeout(async () => {
      try {
        const res = await checkUsername(value);
        setCheck(res.available ? { kind: 'ok' } : { kind: 'bad', reason: res.reason ?? 'Not available' });
      } catch (err) {
        setCheck({ kind: 'bad', reason: errorMessage(err) });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await setUsername(name.trim());
      // SessionProvider's users/{uid} listener flips the app to "ready" automatically.
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--center">
      <form className="card stack" onSubmit={submit}>
        <h1 className="title">Pick a username</h1>
        <p className="muted">This is how friends and the leaderboard will see you. 3–16 letters, numbers or _.</p>
        {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
        <label className="field">
          Username
          <input
            className="input"
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={16}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby="username-status"
          />
        </label>
        <p id="username-status" className="small" style={{ minHeight: 18 }}>
          {check.kind === 'checking' && <span className="muted">Checking…</span>}
          {check.kind === 'ok' && <span style={{ color: 'var(--success)' }}>Available</span>}
          {check.kind === 'bad' && <span style={{ color: 'var(--danger)' }}>{check.reason}</span>}
        </p>
        <button className="btn btn--primary btn--block" type="submit" disabled={busy || check.kind !== 'ok'}>
          {busy ? <span className="spinner" /> : 'Continue'}
        </button>
        <button className="btn btn--ghost btn--sm" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </form>
    </div>
  );
}
