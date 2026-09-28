import { useEffect, useMemo, useRef, useState } from 'react';
import { Jet } from '../../components/art/Jet';
import { Ship } from '../../components/art/Ship';
import { useNavigate } from 'react-router-dom';
import { Board } from '../../components/Board';
import { Icon, TopBar } from '../../components/ui';
import { buildMarks, markAt } from '../../game/marks';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { listenRematch, type RematchState } from '../../lib/firestore';
import { play } from '../../lib/sound';
import { isBotGame, opponentUid, shotsBy, type Game, type PrivateBoard } from '../../lib/types';

export function ResultsView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const navigate = useNavigate();
  const won = game.winnerUid === uid;
  const opp = opponentUid(game, uid) ?? '';
  const opponentName = game.players[opp]?.username ?? 'Your opponent';
  const botGame = isBotGame(game);
  const change = game.ratingChanges?.[uid];
  const me = game.players[uid];
  const accuracy = me && me.shotsFired > 0 ? `${Math.round((me.hits / me.shotsFired) * 100)}%` : '–';

  const [fxDone, setFxDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFxDone(true), 2700);
    return () => clearTimeout(t);
  }, []);

  const played = useRef(false);
  useEffect(() => {
    if (played.current) return;
    played.current = true;
    play(won ? 'win' : 'lose');
  }, [won]);

  const theirBoard = useMemo(() => buildMarks(shotsBy(game, uid), game.revealedFleets?.[opp] ?? [], true), [game, uid, opp]);
  const myBoard = useMemo(
    () => buildMarks(shotsBy(game, opp), game.revealedFleets?.[uid] ?? board?.fleet ?? [], true),
    [game, opp, uid, board],
  );

  let reason = '';
  switch (game.endReason) {
    case 'all_sunk':
      reason = won ? `You sank every ship in ${opponentName}'s fleet.` : `${opponentName} sank your entire fleet.`;
      break;
    case 'resign':
      reason = won ? `${opponentName} resigned.` : 'You resigned.';
      break;
    case 'timeout':
      reason = won
        ? `${opponentName} was inactive too long, so you claimed the win.`
        : `You were inactive too long and ${opponentName} claimed the win.`;
      break;
  }

  return (
    <div className="page page--wide">
      <TopBar title="Game over" back="/" />
      <div className="card result-hero stack" role="presentation" onClick={() => setFxDone(true)}>
        {!fxDone && (
          <div className="fx" aria-hidden>
            {won ? (
              <div className="result-jet">
                <Jet />
              </div>
            ) : (
              <div className="result-ship">
                <Ship />
              </div>
            )}
          </div>
        )}
        <div className={`big ${won ? 'big--win' : 'big--lose'}`} aria-hidden>
          <Icon name={won ? 'trophy' : 'wave'} />
        </div>
        <h2 className="title">{won ? 'Victory!' : 'Defeat'}</h2>
        <p className="muted">{reason}</p>
        {botGame && <p className="muted small">Played against {opponentName} (computer) — rating unaffected.</p>}
        <div className="stat-grid" style={{ marginTop: 8 }}>
          {botGame ? (
            <div className="stat">
              <b>Unrated</b>
              <span>Rating</span>
            </div>
          ) : (
            <>
              <div className="stat">
                <b>{change?.after ?? me?.rating ?? '–'}</b>
                <span>Rating</span>
              </div>
              <div className="stat">
                <b className={change && change.delta >= 0 ? 'delta-up' : 'delta-down'}>
                  {change ? (change.delta >= 0 ? `+${change.delta}` : change.delta) : '–'}
                </b>
                <span>Change</span>
              </div>
            </>
          )}
          <div className="stat">
            <b>{accuracy}</b>
            <span>Accuracy</span>
          </div>
        </div>
      </div>

      <section className="stack">
        <h3 style={{ fontSize: 15 }} className="muted">
          {opponentName}'s fleet
        </h3>
        <Board ariaLabel="Opponent's revealed board" small disabled markOf={(c) => markAt(theirBoard, c)} />
      </section>
      <section className="stack">
        <h3 style={{ fontSize: 15 }} className="muted">
          Your fleet
        </h3>
        <Board ariaLabel="Your board" small disabled markOf={(c) => markAt(myBoard, c)} />
      </section>

      {botGame ? (
        <BotRematch game={game} />
      ) : (
        opp && <HumanRematch game={game} uid={uid} opponentUid={opp} opponentName={opponentName} />
      )}
      <button className="btn btn--secondary btn--block" onClick={() => navigate('/')}>
        Back to home
      </button>
    </div>
  );
}

function BotRematch({ game }: { game: Game }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rematch = async () => {
    setBusy(true);
    setError(null);
    try {
      const { gameId } = await api.createBotGame(game.botDifficulty ?? 'medium');
      navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void rematch()}>
        {busy ? <span className="spinner" /> : 'Rematch'}
      </button>
      {error && <RematchError message={error} />}
    </div>
  );
}

/**
 * Rematch against a human: a direct challenge tagged with this game's id. If the opponent already
 * asked, createChallenge accepts theirs and returns the new game.
 */
function HumanRematch({
  game,
  uid,
  opponentUid,
  opponentName,
}: {
  game: Game;
  uid: string;
  opponentUid: string;
  opponentName: string;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<RematchState>({ outgoing: null, incoming: null });
  // Only follow a rematch that starts while this screen is open, so old results stay viewable.
  const [follow, setFollow] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      listenRematch(
        uid,
        opponentUid,
        game.id,
        (next) => {
          setState(next);
          setFollow((prev) => prev ?? !startedGameId(next));
        },
        (e) => setError(errorMessage(e)),
      ),
    [uid, opponentUid, game.id],
  );

  const started = startedGameId(state);
  useEffect(() => {
    if (started && follow) navigate(`/game/${started}`);
  }, [started, follow, navigate]);

  const run = async (fn: () => Promise<string | null | void>) => {
    setBusy(true);
    setError(null);
    try {
      const gameId = await fn();
      if (gameId) navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const rematch = () => run(async () => (await api.createChallenge(opponentUid, game.id)).gameId);

  const { outgoing, incoming } = state;
  let note: string | null = null;
  let actions;
  if (started) {
    actions = follow ? (
      <button className="btn btn--primary btn--block" disabled>
        <span className="spinner" /> Starting rematch…
      </button>
    ) : (
      <button className="btn btn--primary btn--block" onClick={() => navigate(`/game/${started}`)}>
        Open rematch
      </button>
    );
  } else if (incoming?.status === 'pending') {
    note = `${opponentName} wants a rematch!`;
    actions = (
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn--primary" style={{ flex: 1 }} disabled={busy} onClick={() => void rematch()}>
          {busy ? <span className="spinner" /> : 'Accept rematch'}
        </button>
        <button
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => void run(async () => void (await api.respondChallenge(incoming.id, false)))}
        >
          Decline
        </button>
      </div>
    );
  } else if (outgoing?.status === 'pending') {
    note = `Rematch sent. Waiting for ${opponentName}…`;
    actions = (
      <button
        className="btn btn--secondary btn--block"
        disabled={busy}
        onClick={() => void run(async () => void (await api.cancelChallenge(outgoing.id)))}
      >
        {busy ? <span className="spinner" /> : 'Cancel rematch'}
      </button>
    );
  } else {
    if (outgoing?.status === 'declined') note = `${opponentName} declined the rematch.`;
    actions = (
      <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void rematch()}>
        {busy ? <span className="spinner" /> : 'Rematch'}
      </button>
    );
  }

  return (
    <div className="stack" style={{ gap: 6 }} aria-live="polite">
      {note && <p className="muted center small">{note}</p>}
      {actions}
      {error && <RematchError message={error} />}
    </div>
  );
}

function startedGameId({ outgoing, incoming }: RematchState): string | null {
  const accepted = [outgoing, incoming].find((c) => c?.status === 'accepted' && c.gameId);
  return accepted?.gameId ?? null;
}

function RematchError({ message }: { message: string }) {
  return (
    <p className="small center" role="alert" style={{ color: 'var(--danger)' }}>
      {message}
    </p>
  );
}
