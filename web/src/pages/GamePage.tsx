import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { GameChat } from '../components/GameChat';
import { errorMessage } from '../lib/errors';
import { listenGame, listenPrivateBoard } from '../lib/firestore';
import type { Game, PrivateBoard } from '../lib/types';
import { diffGameEvents, gameEvents } from '../game/events';
import { useUid } from '../state/SessionProvider';
import { createFeelDirector, type FeelDirector } from '../feel/director';
import { FeelProvider, useFeelSettled } from '../feel/FeelProvider';
import { useAudioEngine } from '../audio/useAudioEngine';
import { isBotGame, opponentUid, shotsBy } from '../lib/types';
import { ActiveGameView } from './game/ActiveGameView';
import { PlacementView } from './game/PlacementView';
import { ResultsView } from './game/ResultsView';
import { ReplayView } from './game/ReplayView';
import { WaitingView } from './game/WaitingView';

export function GamePage() {
  const { gameId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const uid = useUid();
  const navigate = useNavigate();
  const [game, setGame] = useState<Game | null | undefined>(undefined);
  const previousGame = useRef<Game | null>(null);
  const [feelDirector, setFeelDirector] = useState<FeelDirector | null>(null);
  const feelDirectorRef = useRef<{
    gameId: string;
    director: FeelDirector;
    unsubscribe: () => void;
  } | null>(null);
  const [board, setBoard] = useState<PrivateBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previousGame.current = null;
    setGame(undefined);
    setBoard(null);
    setError(null);
    setFeelDirector(null);
    const disposeDirector = () => {
      const current = feelDirectorRef.current;
      if (!current) return;
      current.unsubscribe();
      current.director.dispose();
      feelDirectorRef.current = null;
    };
    const unsubscribeGame = listenGame(
      gameId,
      (next) => {
        if (next) {
          if (feelDirectorRef.current?.gameId !== next.id) {
            disposeDirector();
            const opponent = opponentUid(next, uid);
            const director = createFeelDirector({
              myUid: uid,
              botGame: isBotGame(next),
              initialShots: {
                target: shotsBy(next, uid).length,
                own: opponent ? shotsBy(next, opponent).length : 0,
              },
            });
            const unsubscribe = gameEvents.subscribe((event) => director.handle([event]));
            feelDirectorRef.current = { gameId: next.id, director, unsubscribe };
            setFeelDirector(director);
          }
          gameEvents.emit(diffGameEvents(previousGame.current, next));
          previousGame.current = next;
        } else {
          previousGame.current = null;
          disposeDirector();
          setFeelDirector(null);
        }
        setGame(next);
      },
      (e) => setError(errorMessage(e)),
    );
    return () => {
      unsubscribeGame();
      previousGame.current = null;
      disposeDirector();
    };
  }, [gameId, uid]);

  useEffect(() => {
    if (!(import.meta.env.DEV || searchParams.has('debugEvents'))) return;
    return gameEvents.subscribe(
      (event) => {
        if (event.type === 'shipSunk') console.info(event);
      },
      ['shipSunk'],
    );
  }, [searchParams]);

  const needsBoard = game !== undefined && game !== null && game.status !== 'waiting';
  useEffect(() => {
    if (!needsBoard) return;
    return listenPrivateBoard(gameId, uid, setBoard, (e) => setError(errorMessage(e)));
  }, [gameId, uid, needsBoard]);

  if (error) {
    return (
      <div className="page">
        <TopBar title="Game" back="/" />
        <Alert>{error}</Alert>
      </div>
    );
  }
  if (game === undefined) {
    return (
      <div className="page">
        <TopBar title="Game" back="/" />
        <Spinner label="Loading game…" />
      </div>
    );
  }
  if (game === null || !game.playerUids.includes(uid)) {
    return (
      <div className="page">
        <TopBar title="Game" back="/" />
        <Empty title="Game not found" message="It may have been cancelled, or the link is wrong.">
          <button className="btn btn--primary" onClick={() => navigate('/')}>
            Back to home
          </button>
        </Empty>
      </div>
    );
  }

  if (!feelDirector) {
    return (
      <div className="page">
        <TopBar title="Game" back="/" />
        <Spinner label="Loading game…" />
      </div>
    );
  }

  return (
    <FeelProvider director={feelDirector}>
      <GamePageContent game={game} uid={uid} board={board} replay={searchParams.get('replay') === '1'} />
    </FeelProvider>
  );
}

function GamePageContent({
  game,
  uid,
  board,
  replay,
}: {
  game: Game;
  uid: string;
  board: PrivateBoard | null;
  replay: boolean;
}) {
  const navigate = useNavigate();
  const settled = useFeelSettled();
  useAudioEngine();

  switch (game.status) {
    case 'waiting':
      return <WaitingView game={game} uid={uid} />;
    case 'cancelled':
      return (
        <div className="page">
          <TopBar title="Game cancelled" back="/" />
          <Empty title="This game was cancelled" message="Nobody joined before the host closed it.">
            <button className="btn btn--primary" onClick={() => navigate('/')}>
              Back to home
            </button>
          </Empty>
        </div>
      );
    case 'placing':
      return <PlacementView game={game} uid={uid} board={board} />;
    case 'active':
      return (
        <>
          <ActiveGameView game={game} uid={uid} board={board} />
          <GameChat key={game.id} game={game} uid={uid} />
        </>
      );
    case 'finished':
      return replay ? (
        <ReplayView game={game} uid={uid} board={board} />
      ) : !settled ? (
        <>
          <ActiveGameView game={game} uid={uid} board={board} />
          <GameChat key={game.id} game={game} uid={uid} />
        </>
      ) : (
        <>
          <ResultsView game={game} uid={uid} board={board} />
          {game.isBotGame && <GameChat key={game.id} game={game} uid={uid} />}
        </>
      );
  }
}
