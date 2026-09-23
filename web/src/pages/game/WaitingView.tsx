import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Spinner, Toast, TopBar } from '../../components/ui';
import { cancelGame } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import type { Game } from '../../lib/types';

export function WaitingView({ game, uid }: { game: Game; uid: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const link = `${location.origin}/join/${game.code}`;
  const isHost = game.hostUid === uid;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${what} copied`);
    } catch {
      setError(`Couldn't copy automatically — long-press to copy: ${text}`);
    }
  };

  const share = async () => {
    const data = { title: 'Broadside', text: `Play Broadside with me! Join code ${game.code}`, url: link };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        await copy(link, 'Link');
      }
    } else {
      await copy(link, 'Link');
    }
  };

  const cancel = async () => {
    if (!confirm('Cancel this game? The code will stop working.')) return;
    setBusy(true);
    try {
      await cancelGame(game.id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar title="Invite a friend" back="/" />
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <section className="card stack center">
        <p className="muted">Your join code</p>
        <button
          type="button"
          className="mono"
          style={{ fontSize: 44, fontWeight: 800, letterSpacing: '0.25em', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}
          onClick={() => copy(game.code, 'Code')}
          aria-label={`Join code ${game.code.split('').join(' ')}. Tap to copy.`}
        >
          {game.code}
        </button>
        <p className="muted small">Tap the code to copy it, or share the link below.</p>
        <div className="stack">
          <button className="btn btn--primary btn--block" onClick={share}>
            Share invite link
          </button>
          <button className="btn btn--secondary btn--block" onClick={() => copy(link, 'Link')}>
            Copy link
          </button>
        </div>
        <p className="small mono muted" style={{ wordBreak: 'break-all' }}>
          {link}
        </p>
      </section>

      <Spinner label="Waiting for your friend to join… this page updates automatically." />

      <p className="muted small center">
        You can leave this screen — the game stays in "Your games" on the home screen until someone joins.
      </p>

      {isHost && (
        <button className="btn btn--danger btn--block" onClick={cancel} disabled={busy}>
          Cancel game
        </button>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
