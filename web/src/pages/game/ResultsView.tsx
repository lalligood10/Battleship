import { useEffect, useMemo, useRef, useState } from 'react';
import { Jet } from '../../components/art/Jet';
import { Ship } from '../../components/art/Ship';
import { useNavigate } from 'react-router-dom';
import { Board } from '../../components/Board';
import { Icon, TopBar } from '../../components/ui';
import { buildMarks, markAt } from '../../game/marks';
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

      <button className="btn btn--primary btn--block" onClick={() => navigate('/')}>
        Back to home
      </button>
    </div>
  );
}
