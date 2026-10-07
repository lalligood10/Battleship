/** Handles shareable links like /join/ABC123. Works before sign-in: the URL survives the auth flow. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { signInAnonymously } from 'firebase/auth';
import { Alert, Spinner } from '../components/ui';
import { auth } from '../lib/firebase';
import { joinGame } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useSession } from '../state/SessionProvider';
import { SignInPage } from './SignInPage';

export function JoinPage() {
  const { code = '' } = useParams();
  const { state } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const attempted = useRef(false);

  const ready = state.kind === 'ready';

  const playAsGuest = async () => {
    setGuestBusy(true);
    setError(null);
    try {
      await signInAnonymously(auth());
    } catch (err) {
      setError(errorMessage(err));
      setGuestBusy(false);
    }
  };

  useEffect(() => {
    if (!ready || attempted.current) return;
    attempted.current = true;
    joinGame(code.toUpperCase())
      .then(({ gameId }) => navigate(`/game/${gameId}`, { replace: true }))
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [ready, code, navigate]);

  if (!ready) {
    return (
      <>
        <div className="page" style={{ paddingBottom: 0, flex: 0 }}>
          <Alert kind="info">
            You've been invited to a game (code <b className="mono">{code.toUpperCase()}</b>). Sign in, create an
            account, or play as a guest to join.
          </Alert>
          <section className="card stack" style={{ marginTop: 12 }}>
            <h2 style={{ fontSize: 18 }}>Play as guest</h2>
            <p className="muted" style={{ margin: 0 }}>
              No account needed — pick a name and play. You can save your account later.
            </p>
            {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
            <button className="btn btn--primary btn--block" onClick={() => void playAsGuest()} disabled={guestBusy}>
              {guestBusy ? <span className="spinner" /> : 'Play as guest'}
            </button>
          </section>
        </div>
        <SignInPage />
      </>
    );
  }

  return (
    <div className="page page--center">
      {error ? (
        <div className="card stack">
          <Alert>{error}</Alert>
          <button className="btn btn--primary" onClick={() => navigate('/', { replace: true })}>
            Back to home
          </button>
        </div>
      ) : (
        <Spinner label={`Joining game ${code.toUpperCase()}…`} />
      )}
    </div>
  );
}
