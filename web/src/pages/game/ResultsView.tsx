import { useEffect, useMemo, useState } from 'react';
import { isBotUid } from '@shared/bots';
import { Jet } from '../../components/art/Jet';
import { Ship } from '../../components/art/Ship';
import { useNavigate } from 'react-router-dom';
import { Board } from '../../components/Board';
import { AchievementUnlocks } from '../../components/Achievements';
import { HeadToHeadCard } from '../../components/HeadToHead';
import { Alert, Icon, TopBar } from '../../components/ui';
import { buildMarks, markAt } from '../../game/marks';
import { hasReplay } from '../../game/replay';
import { shouldPlayResultFx } from '../../game/resultFx';
import { requestRematch } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isBotGame, rematchState, shotsBy, type Game, type PrivateBoard } from '../../lib/types';
import { Reactions } from '../../components/Reactions';
import { MuteToggle } from '../../audio/MuteToggle';
import { ModeBadge } from '../../components/ModeBadge';
import { PushOptIn } from '../../components/PushOptIn';
import { ShotHeatmapPanel } from '../../components/Heatmap/Heatmap';
import { formatAccuracy, resultStats } from '../../game/resultStats';
import { getHeadToHead, type HeadToHeadDoc } from '../../lib/stats';
import { pollHeadToHeadForGame, resultsRetentionVisibility } from './resultsRetention';

export function ResultsView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const navigate = useNavigate();
  const won = game.winnerUid === uid;
  const retention = resultsRetentionVisibility(game.playerUids, uid);
  const opp = retention.opponentUid ?? '';
  const opponentName = game.players[opp]?.username ?? 'Your opponent';
  const botGame = isBotGame(game);
  const change = game.ratingChanges?.[uid];
  const me = game.players[uid];
  const stats = useMemo(() => resultStats(game, uid), [game, uid]);

  const [fxDone, setFxDone] = useState(() => !shouldPlayResultFx(game.finishedAt?.toMillis() ?? null, Date.now()));
  const [rematchBusy, setRematchBusy] = useState(false);
  const [rematchError, setRematchError] = useState<string | null>(null);
  const [h2hState, setH2hState] = useState<{ gameId: string; doc: HeadToHeadDoc | null } | null>(null);
  const h2h = h2hState?.gameId === game.id ? h2hState.doc : null;
  useEffect(() => {
    if (fxDone) return;
    const t = setTimeout(() => setFxDone(true), 2700);
    return () => clearTimeout(t);
  }, [fxDone]);

  useEffect(() => {
    if (!retention.showHeadToHead || !opp || isBotUid(opp)) return;
    return pollHeadToHeadForGame(game.id, () => getHeadToHead(uid, opp), (doc) => setH2hState({ gameId: game.id, doc }));
  }, [game.id, opp, retention.showHeadToHead, uid]);

  const theirBoard = useMemo(
    () => buildMarks(shotsBy(game, uid), game.revealedFleets?.[opp] ?? [], true),
    [game, uid, opp],
  );
  const myBoard = useMemo(
    () => buildMarks(shotsBy(game, opp), game.revealedFleets?.[uid] ?? board?.fleet ?? [], true),
    [game, opp, uid, board],
  );

  const rematch = rematchState(game, uid);
  const rematchLabel = botGame
    ? 'Play again'
    : rematch === 'requested-by-me'
      ? 'Rematch sent · open'
      : rematch === 'requested-by-them'
        ? 'Accept rematch'
        : 'Rematch';

  const playRematch = async () => {
    setRematchBusy(true);
    setRematchError(null);
    try {
      const { gameId } = await requestRematch(game.id);
      navigate(`/game/${gameId}`);
    } catch (err) {
      setRematchError(errorMessage(err));
      setRematchBusy(false);
    }
  };

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
    <div className="page page--wide results-page">
      <TopBar
        title="Game over"
        back="/"
        right={
          <div className="row" style={{ gap: 8 }}>
            <ModeBadge mode={game.mode} />
            <MuteToggle />
          </div>
        }
      />
      <div
        className={`card result-hero stack ${won ? 'result-hero--win' : 'result-hero--lose'}`}
        role="presentation"
        onClick={() => setFxDone(true)}
      >
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
        <div className="result-headline" aria-label="Your results" role="group">
          <div className="stat">
            <b>{formatAccuracy(stats.accuracy)}</b>
            <span>Accuracy</span>
          </div>
          <div className="stat">
            <b>{stats.turns}</b>
            <span>Turns taken</span>
          </div>
          <div className="stat">
            <b>{stats.shotsFired}</b>
            <span>Shots fired</span>
          </div>
          <div className="stat">
            <b>{stats.shipsLost}</b>
            <span>Ships lost</span>
          </div>
        </div>
        <div className="result-rating">
          {botGame ? (
            <span className="result-rating-item">
              <span className="result-rating-label">Rating</span> <b>Unrated</b>
            </span>
          ) : (
            <>
              <span className="result-rating-item">
                <span className="result-rating-label">Rating</span> <b>{change?.after ?? me?.rating ?? '–'}</b>
              </span>
              <span className="result-rating-item">
                <span className="result-rating-label">Change</span>{' '}
                <b className={change && change.delta >= 0 ? 'delta-up' : 'delta-down'}>
                  {change ? (change.delta >= 0 ? `+${change.delta}` : change.delta) : '–'}
                </b>
              </span>
            </>
          )}
        </div>
      </div>
      {retention.showAchievementUnlocks && <AchievementUnlocks gameId={game.id} uid={uid} />}

      <div className="results-grid">
        <section className="results-fleets" aria-labelledby="fleets-heading">
          <h2 className="results-heading" id="fleets-heading">
            Fleets revealed
          </h2>
          <div className="results-boards">
            <div className="results-board">
              <h3 className="panel-title">{opponentName}'s fleet</h3>
              <Board ariaLabel="Opponent's revealed board" small disabled markOf={(c) => markAt(theirBoard, c)} />
            </div>
            <div className="results-board">
              <h3 className="panel-title">Your fleet</h3>
              <Board ariaLabel="Your board" small disabled markOf={(c) => markAt(myBoard, c)} />
            </div>
          </div>
        </section>
        <ShotHeatmapPanel game={game} uid={uid} opponentUid={opp} opponentName={opponentName} />
      </div>

      <Reactions game={game} uid={uid} />
      {retention.showHeadToHead && !isBotUid(opp) && (
        <HeadToHeadCard h2h={h2h} myUid={uid} opponentName={opponentName} mode={game.mode ?? 'classic'} />
      )}
      <div className="results-actions">
        {hasReplay(game) && (
          <button className="btn btn--secondary btn--block" onClick={() => navigate(`/game/${game.id}?replay=1`)}>
            Watch replay
          </button>
        )}
        <PushOptIn uid={uid} gameFinished={game.status === 'finished'} />
        {game.status === 'finished' && (
          <>
            {rematchError && <Alert onDismiss={() => setRematchError(null)}>{rematchError}</Alert>}
            <button className="btn btn--secondary btn--block" onClick={playRematch} disabled={rematchBusy}>
              {rematchBusy ? <span className="spinner" /> : rematchLabel}
            </button>
          </>
        )}
        <button className="btn btn--primary btn--block" onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    </div>
  );
}
