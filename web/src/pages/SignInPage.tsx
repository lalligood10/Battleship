import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { useState, type FormEvent } from 'react';
import { Alert } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { auth } from '../lib/firebase';

type Mode = 'signin' | 'signup';

export function SignInPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      mode === 'signin'
        ? signInWithEmailAndPassword(auth(), email.trim(), password)
        : createUserWithEmailAndPassword(auth(), email.trim(), password),
    );
  };

  const google = () =>
    run(async () => {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth(), provider);
    });

  const reset = () => {
    if (!email.trim()) {
      setError('Enter your email above first, then tap "Forgot password".');
      return;
    }
    void run(async () => {
      await sendPasswordResetEmail(auth(), email.trim());
      setNotice(`Password reset email sent to ${email.trim()}.`);
    });
  };

  return (
    <div className="page page--center">
      <div className="center stack" style={{ gap: 4, marginBottom: 8 }}>
        <div className="brand">Broadside</div>
        <p className="muted">Sink your friends' fleets. Climb the leaderboard.</p>
      </div>

      <form className="card stack" onSubmit={submit}>
        <div className="segmented" role="tablist">
          <button type="button" role="tab" className={mode === 'signin' ? 'active' : ''} onClick={() => setMode('signin')}>
            Sign in
          </button>
          <button type="button" role="tab" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
            Create account
          </button>
        </div>

        {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}

        <label className="field">
          Email
          <input
            className="input"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Password
          <input
            className="input"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        {mode === 'signin' && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={busy}>
            Forgot password?
          </button>
        )}

        <div className="row" style={{ gap: 8 }}>
          <hr className="grow" style={{ border: 0, borderTop: '1px solid var(--border)' }} />
          <span className="muted small">or</span>
          <hr className="grow" style={{ border: 0, borderTop: '1px solid var(--border)' }} />
        </div>

        <button type="button" className="btn btn--secondary btn--block" onClick={google} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
            <path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z" />
            <path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6C6.5 42.6 14.6 48 24 48z" />
          </svg>
          Continue with Google
        </button>
      </form>
    </div>
  );
}
