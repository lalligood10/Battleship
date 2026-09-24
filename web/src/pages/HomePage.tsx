import { deleteDoc, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Empty, Modal, Spinner } from '../components/ui';
import { HomeBanner } from '../components/art/HomeBanner';
import * as api from '../lib/api';
import { errorMessage } from '../lib/errors';
import { db } from '../lib/firebase';
import { gameRowStatus, isBotGame, needsMyAction, opponentAvatar, opponentUid, type BotDifficulty, type Game } from '../lib/types';
import { useActiveGames } from '../state/ActiveGamesProvider';
import { useSession, useUid } from '../state/SessionProvider';
import { GAME_CONFIG } from '@shared/config';

export function HomePage() {
  const uid = useUid();
  const { profile } = useSession();
  const navigate = useNavigate();
  const { games, loaded, error: listError } = useActiveGames();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'quick' | 'bot' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickMatching, setQuickMatching] = useState(false);
  const [pickingComputer, setPickingComputer] = useState(false);

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

      <HomeBanner />

      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <section className="card stack">
        <div className="stack" style={{ gap: 4 }}>
          <button className="btn btn--primary btn--block" onClick={() => setPickingComputer(true)} disabled={busy !== null}>
            {busy === 'bot' ? <span className="spinner" /> : 'Play vs Computer'}
          </button>
          <p className="muted small center" style={{ margin: 0 }}>
            Instant game · Easy, Medium or Hard · unrated
          </p>
        </div>
        <button className="btn btn--secondary btn--block" onClick={create} disabled={busy !== null}>
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
          <Empty title="No games yet" message="No one's online right now? Play the computer instead.">
            <button className="btn btn--primary" onClick={() => setPickingComputer(true)}>
              Play vs Computer
            </button>
          </Empty>
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

      {quickMatching && (
        <QuickMatchModal uid={uid} onClose={() => setQuickMatching(false)} onPlayComputer={() => setPickingComputer(true)} />
      )}
      {pickingComputer && <DifficultyModal onClose={() => setPickingComputer(false)} />}
    </div>
  );
}

const DIFFICULTY_OPTIONS: { level: BotDifficulty; label: string; blurb: string }[] = [
  { level: 'easy', label: 'Easy — Cadet Bot', blurb: 'Cadet Bot fires at random. Good for learning the ropes.' },
  { level: 'medium', label: 'Medium — Officer Bot', blurb: 'Officer Bot hunts down ships once it lands a hit.' },
  { level: 'hard', label: 'Hard — Admiral Bot', blurb: 'Admiral Bot hunts with parity and never wastes a shot.' },
];

function DifficultyModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<BotDifficulty | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (difficulty: BotDifficulty) => {
    setBusy(difficulty);
    setError(null);
    try {
      const { gameId } = await api.createBotGame(difficulty);
      navigate(`/game/${gameId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <Modal title="Play vs Computer" onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      <div className="stack">
        {DIFFICULTY_OPTIONS.map(({ level, label, blurb }) => (
          <button
            key={level}
            className="btn btn--secondary btn--block"
            aria-label={`Play vs computer on ${level}`}
            disabled={busy !== null}
            onClick={() => pick(level)}
          >
            {busy === level ? (
              <span className="spinner" />
            ) : (
              <span className="stack" style={{ gap: 2, textAlign: 'left' }}>
                <b>{label}</b>
                <span className="muted small">{blurb}</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function GameRow({ game, uid }: { game: Game; uid: string }) {
  const oppUid = opponentUid(game, uid);
  const opponent = oppUid ? game.players[oppUid]?.username : null;
  const attention = needsMyAction(game, uid);
  const status = gameRowStatus(game, uid);
  const bot = isBotGame(game);
  return (
    <Link to={`/game/${game.id}`} className={`list-item${attention ? ' list-item--attention' : ''}`}>
      <div className="avatar">{opponentAvatar(game, uid)}</div>
      <div className="grow">
        <b>
          {opponent ? `vs ${opponent}` : 'New game'}
          {bot && (
            <span className="badge" style={{ marginLeft: 6 }}>
              Computer
            </span>
          )}
        </b>
        <p className="muted small">{status}</p>
      </div>
      {attention && <span className="badge badge--turn badge--dot">{game.status === 'placing' ? 'Setup' : 'Go'}</span>}
    </Link>
  );
}

/** Waits on quickMatch/{uid} until another player's joinQuickMatch fills in our gameId. */
/** After this long in the queue we offer Play vs Computer instead. */
const QUICK_MATCH_FALLBACK_SECONDS = 20;

function QuickMatchModal({ uid, onClose, onPlayComputer }: { uid: string; onClose: () => void; onPlayComputer: () => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

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

  const playComputer = async () => {
    try {
      await api.cancelQuickMatch();
    } catch {
      // Best effort only — an already-matched or expired ticket can fail to cancel.
    }
    onClose();
    onPlayComputer();
  };

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
      {elapsed >= QUICK_MATCH_FALLBACK_SECONDS && (
        <div className="stack">
          <p className="muted small center" style={{ margin: 0 }}>
            No one's online right now — play the computer instead
          </p>
          <button className="btn btn--ghost btn--block" onClick={playComputer}>
            Play vs Computer
          </button>
        </div>
      )}
    </Modal>
  );
}
