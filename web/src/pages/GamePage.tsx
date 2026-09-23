import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { listenGame, listenPrivateBoard } from '../lib/firestore';
import type { Game, PrivateBoard } from '../lib/types';
import { useUid } from '../state/SessionProvider';
import { ActiveGameView } from './game/ActiveGameView';
import { PlacementView } from './game/PlacementView';
import { ResultsView } from './game/ResultsView';
import { WaitingView } from './game/WaitingView';

export function GamePage() {
  const { gameId = '' } = useParams();
  const uid = useUid();
  const navigate = useNavigate();
  const [game, setGame] = useState<Game | null | undefined>(undefined);
  const [board, setBoard] = useState<PrivateBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => listenGame(gameId, setGame, (e) => setError(errorMessage(e))), [gameId]);

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
      return <ActiveGameView game={game} uid={uid} board={board} />;
    case 'finished':
      return <ResultsView game={game} uid={uid} board={board} />;
  }
}
