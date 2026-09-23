/** Handles shareable links like /join/ABC123. Works before sign-in: the URL survives the auth flow. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Spinner } from '../components/ui';
import { joinGame } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useSession } from '../state/SessionProvider';
import { SignInPage } from './SignInPage';

export function JoinPage() {
  const { code = '' } = useParams();
  const { state } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  const ready = state.kind === 'ready';

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
            You've been invited to a game (code <b className="mono">{code.toUpperCase()}</b>). Sign in or create an
            account to join.
          </Alert>
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
