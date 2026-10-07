import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameModePicker } from './GameModePicker';
import { TurnTimerPicker } from './TurnTimerPicker';
import { Modal } from './ui';
import * as api from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useActiveGames } from '../state/ActiveGamesProvider';
import { useSession } from '../state/SessionProvider';
import { useGameMode } from '../state/gameMode';

/** "Challenge" a past opponent. Reflects pending challenges either way and accepts theirs if they asked first. */
export function ChallengeButton({ opponentUid, opponentName }: { opponentUid: string; opponentName: string }) {
  const navigate = useNavigate();
  const { incomingChallenges, outgoingChallenges } = useActiveGames();
  const { profile } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosingMode, setChoosingMode] = useState(false);
  const [mode, setMode] = useGameMode();
  const [turnTimerMs, setTurnTimerMs] = useState<number | null>(null);
  const sent = outgoingChallenges.some((c) => c.toUid === opponentUid && c.mode === mode);
  const theirChallenge = incomingChallenges.find((c) => c.fromUid === opponentUid && c.mode === mode);
  const theyAsked = theirChallenge !== undefined;

  const respond = async (challengeId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { gameId } = await api.respondChallenge(challengeId, true);
      if (gameId) navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const sendChallenge = async () => {
    setBusy(true);
    setError(null);
    try {
      const { gameId } = await api.createChallenge(opponentUid, mode, undefined, turnTimerMs);
      if (gameId) navigate(`/game/${gameId}`);
      setChoosingMode(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (profile?.isGuest) return null;

  return (
    <>
      <span className="challenge-button">
        <button
          type="button"
          className={`btn btn--sm ${theyAsked ? 'btn--primary' : 'btn--secondary'}`}
          aria-label={theyAsked ? `Accept ${opponentName}'s challenge` : `Challenge ${opponentName}`}
          disabled={busy || (!theyAsked && sent)}
          onClick={() => {
            if (theirChallenge) void respond(theirChallenge.id);
            else setChoosingMode(true);
          }}
        >
          {busy ? <span className="spinner" /> : theyAsked ? 'Accept' : sent ? 'Sent' : 'Challenge'}
        </button>
        {error && (
          <span className="small challenge-error challenge-error--inline" role="alert">
            {error}
          </span>
        )}
      </span>
      {choosingMode && (
        <Modal title={`Challenge ${opponentName}`} onClose={() => setChoosingMode(false)}>
          {error && (
            <span className="small challenge-error" role="alert">
              {error}
            </span>
          )}
          <GameModePicker value={mode} onChange={setMode} />
          <TurnTimerPicker value={turnTimerMs} onChange={setTurnTimerMs} />
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={() => void sendChallenge()}
          >
            {busy ? <span className="spinner" /> : 'Send challenge'}
          </button>
        </Modal>
      )}
    </>
  );
}
