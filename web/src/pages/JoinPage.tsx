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
      <div className="page join">
        <header className="join__hero">
          <span className="radar-emblem radar-emblem--sm" aria-hidden="true" />
          <h1 className="brand">Broadside</h1>
        </header>
        <section className="card join__invite" aria-labelledby="join-invite-title">
          <h2 id="join-invite-title" className="panel-title">
            You've been invited to a game
          </h2>
          <p className="join__code" aria-label={`Code ${code.toUpperCase().split('').join(' ')}`}>
            {code.toUpperCase()}
          </p>
          <p className="muted small">Sign in, create an account, or play as a guest to join.</p>
        </section>
        <section className="card stack join__guest" aria-labelledby="join-guest-title">
          <h2 id="join-guest-title" className="screen-heading">
            Play as guest
          </h2>
          <p className="muted">No account needed — pick a name and play. You can save your account later.</p>
          {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
          <button className="btn btn--primary btn--block" onClick={() => void playAsGuest()} disabled={guestBusy}>
            {guestBusy ? <span className="spinner" /> : 'Play as guest'}
          </button>
        </section>
        <SignInPage embedded />
      </div>
    );
  }

  return (
    <div className="page page--center join">
      {error ? (
        <div className="card stack join__error">
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
