import { useEffect, useState } from 'react';
import { errorMessage } from '../lib/errors';
import { enablePush, pushAvailable, pushState } from '../lib/push';
import { dismissPrompt, isPromptDismissed, shouldOfferPushPrompt } from './PushOptIn.logic';
import { Alert } from './ui';

/**
 * One-shot opt-in card shown on the results screen of a finished game. Renders nothing unless the
 * browser supports push and the user hasn't decided or dismissed it before.
 */
export function PushOptIn({ uid, gameFinished }: { uid: string; gameFinished: boolean }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    pushAvailable()
      .then((ok) => live && setAvailable(ok))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  if (available !== true || hidden) return null;
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const offer = shouldOfferPushPrompt({
    gameFinished,
    available,
    permission,
    pushOn: pushState() === 'on',
    dismissed: isPromptDismissed(localStorage),
  });
  if (!offer) return null;

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePush(uid);
      setHidden(true);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const notNow = () => {
    dismissPrompt(localStorage);
    setHidden(true);
  };

  return (
    <div className="card stack push-optin">
      <div className="push-optin-text">
        <b className="push-optin-title">Get notified when it's your turn?</b>
        <span className="muted small">We'll only alert you about your games.</span>
      </div>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
      <div className="push-optin-actions">
        <button className="btn btn--primary" onClick={enable} disabled={busy}>
          {busy ? <span className="spinner" /> : 'Enable'}
        </button>
        <button className="btn btn--secondary" onClick={notNow} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}
