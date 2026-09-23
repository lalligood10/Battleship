import { deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Empty, Modal, Spinner } from '../components/ui';
import * as api from '../lib/api';
import { errorMessage } from '../lib/errors';
import { db } from '../lib/firebase';
import { needsMyAction, opponentUid, type Game } from '../lib/types';
import { useActiveGames } from '../state/ActiveGamesProvider';
import { useSession, useUid } from '../state/SessionProvider';
import { GAME_CONFIG } from '@shared/config';

export function HomePage() {
  const uid = useUid();
  const { profile } = useSession();
  const navigate = useNavigate();
  const { games, loaded, error: listError } = useActiveGames();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'quick' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickMatching, setQuickMatching] = useState(false);

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const { gameId } = await api.createGame();
      navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('join');
    setError(null);
    try {
      const { gameId } = await api.joinGame(code.trim().toUpperCase());
      navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const quickMatch = async () => {
    setBusy('quick');
    setError(null);
    try {
      const { gameId } = await api.joinQuickMatch();
      if (gameId) navigate(`/game/${gameId}`);
      else setQuickMatching(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const waiting = games.filter((g) => needsMyAction(g, uid));
  const others = games.filter((g) => !needsMyAction(g, uid));

  return (
    <div className="page">
      <header className="topbar">
        <div className="grow">
          <p className="muted small">Welcome back</p>
          <h1>{profile?.username}</h1>
        </div>
        <Link to="/profile" className="badge" aria-label="Your rating">
          ★ {profile?.rating}
        </Link>
      </header>

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <section className="card stack">
        <button className="btn btn--primary btn--block" onClick={create} disabled={busy !== null}>
          {busy === 'create' ? <span className="spinner" /> : 'Start a game with a friend'}
        </button>
        <form className="row" onSubmit={join}>
          <input
            className="input input--code grow"
            style={{ fontSize: 20, minHeight: 48, letterSpacing: '0.2em' }}
            placeholder="CODE"
            aria-label="Join code"
            autoCapitalize="characters"
            autoCorrect="off"
            maxLength={GAME_CONFIG.JOIN_CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            className="btn btn--secondary"
            type="submit"
            disabled={busy !== null || code.trim().length !== GAME_CONFIG.JOIN_CODE_LENGTH}
          >
            {busy === 'join' ? <span className="spinner" /> : 'Join'}
          </button>
        </form>
        <button className="btn btn--ghost btn--sm" onClick={quickMatch} disabled={busy !== null}>
          {busy === 'quick' ? <span className="spinner" /> : 'Quick Match with a random player'}
        </button>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 18 }}>Your games</h2>
        {listError && <Alert>{listError}</Alert>}
        {!loaded ? (
          <Spinner />
        ) : games.length === 0 ? (
          <Empty title="No games yet" message="Start a game and send the code to a friend, or join theirs." />
        ) : (
          <div className="list">
            {waiting.map((g) => (
              <GameRow key={g.id} game={g} uid={uid} />
            ))}
            {others.map((g) => (
              <GameRow key={g.id} game={g} uid={uid} />
            ))}
          </div>
        )}
      </section>

      {quickMatching && <QuickMatchModal uid={uid} onClose={() => setQuickMatching(false)} />}
    </div>
  );
}

function GameRow({ game, uid }: { game: Game; uid: string }) {
  const oppUid = opponentUid(game, uid);
  const opponent = oppUid ? game.players[oppUid]?.username : null;
  const attention = needsMyAction(game, uid);
  let status: string;
  if (game.status === 'waiting') status = `Waiting for a friend · code ${game.code}`;
  else if (game.status === 'placing') status = attention ? 'Place your ships' : 'Waiting for opponent to place ships';
  else status = attention ? 'Your turn' : "Opponent's turn";
  return (
    <Link to={`/game/${game.id}`} className={`list-item${attention ? ' list-item--attention' : ''}`}>
      <div className="avatar">{(opponent ?? '?').slice(0, 1).toUpperCase()}</div>
      <div className="grow">
        <b>{opponent ? `vs ${opponent}` : 'New game'}</b>
        <p className="muted small">{status}</p>
      </div>
      {attention && <span className="badge badge--turn badge--dot">{game.status === 'placing' ? 'Setup' : 'Go'}</span>}
    </Link>
  );
}

/** Waits on quickMatch/{uid} until another player's joinQuickMatch fills in our gameId. */
function QuickMatchModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ref = doc(db(), 'quickMatch', uid);
    return onSnapshot(
      ref,
      (snap) => {
        const gameId = snap.data()?.gameId as string | null | undefined;
        if (gameId) {
          void deleteDoc(ref).catch(() => undefined);
          navigate(`/game/${gameId}`);
        }
      },
      (err) => setError(errorMessage(err)),
    );
  }, [uid, navigate]);

  const cancel = async () => {
    try {
      await api.cancelQuickMatch();
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    onClose();
  };

  return (
    <Modal title="Looking for an opponent…" onClose={() => undefined}>
      {error && <Alert>{error}</Alert>}
      <Spinner label="You'll be matched with the next player who taps Quick Match." />
      <p className="muted small center">
        Your request stays open for {GAME_CONFIG.QUICK_MATCH_TICKET_TTL_MS / 60000} minutes.
      </p>
      <button className="btn btn--secondary btn--block" onClick={cancel}>
        Cancel
      </button>
    </Modal>
  );
}
