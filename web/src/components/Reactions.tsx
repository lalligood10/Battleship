import { useEffect, useState } from 'react';
import { sendReaction } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { listenReactions } from '../lib/firestore';
import {
  isBotGame,
  opponentUid,
  REACTIONS,
  REACTION_COOLDOWN_MS,
  REACTION_LABELS,
  type Game,
  type ReactionId,
} from '../lib/types';

function currentTimeMs(): number {
  return Date.now();
}

export function Reactions({ game, uid }: { game: Game; uid: string }) {
  const botGame = isBotGame(game);
  const opponent = opponentUid(game, uid);
  const opponentName = (opponent && game.players[opponent]?.username) || 'Opponent';
  const [myLatest, setMyLatest] = useState<{ gameId: string; at: number | null }>({ gameId: game.id, at: null });
  const [localSent, setLocalSent] = useState<{ gameId: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<{ gameId: string; text: string } | null>(null);
  const [error, setError] = useState<{ gameId: string; text: string } | null>(null);
  const myLatestAt = myLatest.gameId === game.id ? myLatest.at : null;
  const localSentAt = localSent?.gameId === game.id ? localSent.at : null;
  const cooldownBase = Math.max(myLatestAt ?? 0, localSentAt ?? 0);
  const cooldownUntil = cooldownBase ? cooldownBase + REACTION_COOLDOWN_MS : 0;

  useEffect(() => {
    if (botGame) return;

    let initialSnapshot = true;
    const seen = new Set<string>();
    return listenReactions(
      game.id,
      (reactions) => {
        const latestMine = reactions.find((reaction) => reaction.uid === uid);
        setMyLatest({ gameId: game.id, at: latestMine?.at?.toMillis() ?? null });
        if (initialSnapshot) {
          reactions.forEach((reaction) => seen.add(reaction.id));
          initialSnapshot = false;
          return;
        }
        const newestOpponent = reactions.find((reaction) => reaction.uid !== uid && !seen.has(reaction.id));
        reactions.forEach((reaction) => seen.add(reaction.id));
        if (newestOpponent) {
          setToast({ gameId: game.id, text: `${opponentName}: ${REACTION_LABELS[newestOpponent.reactionId]}` });
        }
      },
      () => {},
    );
  }, [game.id, uid, opponentName, botGame]);

  useEffect(() => {
    if (now >= cooldownUntil) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, cooldownUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [cooldownUntil, now]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  if (botGame) return null;

  const send = async (reactionId: ReactionId) => {
    const sentAt = currentTimeMs();
    setLocalSent({ gameId: game.id, at: sentAt });
    setNow(sentAt);
    setError(null);
    try {
      await sendReaction(game.id, reactionId);
    } catch (err) {
      setLocalSent((current) =>
        current?.gameId === game.id && current.at === sentAt ? null : current,
      );
      setError({ gameId: game.id, text: errorMessage(err) });
    }
  };

  const visibleToast = toast?.gameId === game.id ? toast.text : null;
  const visibleError = error?.gameId === game.id ? error.text : null;

  return (
    <>
      {/* Always mounted, so screen readers announce text that appears in it (audit R16). */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {visibleError ?? visibleToast ?? ''}
      </p>
      {visibleToast && (
        <div className="reaction-toast" aria-hidden="true">
          {visibleToast}
        </div>
      )}
      <div className="reaction-bar" role="group" aria-label="Send a reaction">
        {REACTIONS.map((reaction) => (
          <button
            key={reaction.id}
            type="button"
            disabled={now < cooldownUntil}
            onClick={() => void send(reaction.id)}
          >
            {reaction.label}
          </button>
        ))}
      </div>
      {visibleError && (
        <p className="reaction-error small" aria-hidden="true">
          {visibleError}
        </p>
      )}
    </>
  );
}
