/** Resign + "claim win after inactivity" controls, shown while a game is in progress. */
import { useEffect, useState } from 'react';
import { Alert, Modal } from '../../components/ui';
import { claimTimeoutWin, resign } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isBotGame, opponentUid, type Game } from '../../lib/types';

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'now';
  const hours = Math.ceil(ms / 3_600_000);
  if (hours >= 48) return `in ${Math.ceil(hours / 24)} days`;
  if (hours > 1) return `in ${hours} hours`;
  return 'in under an hour';
}

export function AbandonControls({ game, uid }: { game: Game; uid: string }) {
  const [confirming, setConfirming] = useState<'resign' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const bot = isBotGame(game);
  const opp = opponentUid(game, uid);
  const waitingOnOpponent =
    game.status === 'active'
      ? game.currentTurnUid === opp
      : game.players[uid]?.ready === true && (opp ? game.players[opp]?.ready !== true : false);
  const last = game.lastMoveAt?.toMillis() ?? game.createdAt?.toMillis() ?? now;
  const remaining = last + game.abandonTimeoutMs - now;
  const canClaim = waitingOnOpponent && remaining <= 0;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setConfirming(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
      {waitingOnOpponent && !bot && (
        <div className="card card--flat small muted">
          {canClaim ? (
            <div className="stack">
              <span>Your opponent hasn't moved in {Math.round(game.abandonTimeoutMs / 86_400_000)} days.</span>
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => run(() => claimTimeoutWin(game.id))}>
                Claim the win
              </button>
            </div>
          ) : (
            <span>If your opponent doesn't move, you can claim the win {formatRemaining(remaining)}.</span>
          )}
        </div>
      )}
      <button className="btn btn--danger btn--sm" onClick={() => setConfirming('resign')} disabled={busy}>
        Resign
      </button>

      {confirming === 'resign' && (
        <Modal title="Resign this game?" onClose={() => setConfirming(null)}>
          <p className="muted">
            {bot ? 'The computer gets the win. This game is unrated.' : "Your opponent gets the win and your rating will drop as if you'd lost."}
          </p>
          <button className="btn btn--danger btn--block" disabled={busy} onClick={() => run(() => resign(game.id))}>
            {busy ? <span className="spinner" /> : 'Yes, resign'}
          </button>
          <button className="btn btn--secondary btn--block" onClick={() => setConfirming(null)}>
            Keep playing
          </button>
        </Modal>
      )}
    </div>
  );
}
