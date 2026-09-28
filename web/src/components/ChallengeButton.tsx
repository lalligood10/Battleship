import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useActiveGames } from '../state/ActiveGamesProvider';

/** "Challenge" a past opponent. Reflects pending challenges either way and accepts theirs if they asked first. */
export function ChallengeButton({ opponentUid, opponentName }: { opponentUid: string; opponentName: string }) {
  const navigate = useNavigate();
  const { incomingChallenges, outgoingChallenges } = useActiveGames();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = outgoingChallenges.some((c) => c.toUid === opponentUid);
  const theyAsked = incomingChallenges.some((c) => c.fromUid === opponentUid);

  const challenge = async () => {
    setBusy(true);
    setError(null);
    try {
      const { gameId } = await api.createChallenge(opponentUid);
      if (gameId) navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
      <button
        type="button"
        className={`btn btn--sm ${theyAsked ? 'btn--primary' : 'btn--secondary'}`}
        aria-label={theyAsked ? `Accept ${opponentName}'s challenge` : `Challenge ${opponentName}`}
        disabled={busy || sent}
        onClick={() => void challenge()}
      >
        {busy ? <span className="spinner" /> : sent ? 'Sent' : theyAsked ? 'Accept' : 'Challenge'}
      </button>
      {error && (
        <span className="small" role="alert" style={{ color: 'var(--danger)', maxWidth: 160, textAlign: 'right' }}>
          {error}
        </span>
      )}
    </span>
  );
}
