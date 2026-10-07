import { useCallback, useEffect, useMemo, useState } from 'react';
import { Board } from '../../components/Board';
import { Alert, Spinner, Toast, TopBar } from '../../components/ui';
import { alreadyShot, buildMarks, coordLabel, markAt } from '../../game/marks';
import { cellKey, BOARD_SIZE, SHIP_LENGTHS, SHIP_NAMES, SHIP_TYPES, type Coordinate } from '../../game/placement';
import { salvoQueueNumber, salvoQueueReady, toggleSalvoTarget } from '../../game/salvoQueue';
import { salvoShotsAllowed as getSalvoShotsAllowed } from '@shared/core/reducer';
import { fireSalvo, fireShot } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isMyTurn, opponentUid, shotsBy, type Game, type PrivateBoard, type ShipType } from '../../lib/types';
import { AbandonControls } from './AbandonControls';
import { MuteToggle } from '../../audio/MuteToggle';
import { useAmbientOcean } from '../../audio/useAmbientOcean';
import { useFeelCue, useFeelDirector, useRevealed } from '../../feel/FeelProvider';
import { FxLayer } from '../../fx/FxLayer';
import { FxStage } from '../../fx/FxStage';
import { ModeBadge } from '../../components/ModeBadge';

export function ActiveGameView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const opp = opponentUid(game, uid) ?? '';
  const opponentName = game.players[opp]?.username ?? 'Opponent';
  const myTurn = isMyTurn(game, uid);
  const salvoMode = game.mode === 'salvo';
  const myShots = shotsBy(game, uid);
  const theirShots = shotsBy(game, opp);
  const mySunk = game.players[uid]?.sunkShips ?? [];
  const theirSunk = game.players[opp]?.sunkShips ?? [];
  const allowanceState = {
    playerIds: game.playerUids,
    settings: { boardSize: BOARD_SIZE, fleet: SHIP_TYPES },
    shots: game.shots,
  };
  const salvoShotsAllowed = getSalvoShotsAllowed(allowanceState, uid);
  const opponentSalvoShotsAllowed = getSalvoShotsAllowed(allowanceState, opp);

  const [target, setTarget] = useState<Coordinate | null>(null);
  const [queuedTargets, setQueuedTargets] = useState<Coordinate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const director = useFeelDirector();
  useAmbientOcean();
  const revealed = useRevealed();
  const visibleMyShots = useMemo(() => myShots.slice(0, revealed.target), [myShots, revealed.target]);
  const visibleTheirShots = useMemo(() => theirShots.slice(0, revealed.own), [theirShots, revealed.own]);
  const pendingIncoming = theirShots.length > revealed.own;
  const firedCells = useMemo(() => new Set(myShots.map((shot) => cellKey(shot.row, shot.col))), [myShots]);
  const targetMarks = useMemo(() => buildMarks(visibleMyShots), [visibleMyShots]);
  const ownMarks = useMemo(() => buildMarks(visibleTheirShots, board?.fleet), [visibleTheirShots, board]);
  useFeelCue((cue) => {
    if (cue.type !== 'impact' || cue.sunk) return;
    if (cue.side === 'target') {
      setToast(
        cue.result === 'hit'
          ? `Hit at ${coordLabel(cue.target)}!`
          : `Miss at ${coordLabel(cue.target)}.`,
      );
    } else {
      setToast(
        `${opponentName} fired at ${coordLabel(cue.target)} — ${cue.result === 'hit' ? 'hit' : 'miss'}`,
      );
    }
  });

  useEffect(() => {
    if (!myTurn) {
      setTarget(null);
      setQueuedTargets([]);
    }
  }, [myTurn]);

  const onTargetTap = useCallback(
    (c: Coordinate) => {
      if (!myTurn || game.status !== 'active' || busy || pendingIncoming || alreadyShot(myShots, c)) return;
      if (salvoMode) {
        setQueuedTargets((queue) => toggleSalvoTarget(queue, c, salvoShotsAllowed, firedCells));
      } else {
        setTarget((t) => (t && t.row === c.row && t.col === c.col ? null : c));
      }
    },
    [myTurn, game.status, busy, pendingIncoming, myShots, salvoMode, salvoShotsAllowed, firedCells],
  );

  const fire = async () => {
    const targets = salvoMode ? queuedTargets : target ? [target] : [];
    if (targets.length === 0 || game.status !== 'active') return;
    setBusy(true);
    setError(null);
    director.fireRequested(salvoMode ? targets : targets[0]!);
    try {
      if (salvoMode) {
        await fireSalvo(game.id, targets);
        setQueuedTargets([]);
      } else {
        await fireShot(game.id, targets[0]!);
        setTarget(null);
      }
    } catch (err) {
      director.fireFailed();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const finished = game.status === 'finished';

  return (
    <FxStage>
      <div className="page page--wide">
        <TopBar
          title={`vs ${opponentName}`}
          back="/"
          right={
            <div className="row" style={{ gap: 8 }}>
              <ModeBadge mode={game.mode} />
              <MuteToggle />
            </div>
          }
        />

        <div
          className={`alert ${!finished && myTurn && !pendingIncoming ? 'alert--success' : 'alert--info'}`}
          role="status"
          style={{ justifyContent: 'center', fontWeight: 800 }}
        >
          {finished ? 'Game over' : pendingIncoming ? 'Incoming fire…' : myTurn ? 'Your turn — pick a target' : `Waiting for ${opponentName} to fire…`}
        </div>
        {salvoMode && !finished && (
          <p className="muted small salvo-status">
            {myTurn ? `You fire ${salvoShotsAllowed}` : `${opponentName} fires ${opponentSalvoShotsAllowed} next turn`}
          </p>
        )}
        {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

        <section className="stack">
          <div className="row row--between">
            <h2 style={{ fontSize: 16 }}>{opponentName}'s waters</h2>
            <FleetStatus sunk={theirSunk} />
          </div>
          <Board
            ariaLabel="Opponent's board"
            targeting
            fog
            disabled={finished || !myTurn || busy || pendingIncoming}
            markOf={(c) => markAt(targetMarks, c)}
            selected={(c) => !salvoMode && target?.row === c.row && target?.col === c.col}
            queueNumber={salvoMode ? (c) => salvoQueueNumber(queuedTargets, c) : undefined}
            lastShot={targetMarks.lastShot}
            overlay={<FxLayer side="target" />}
            onCellTap={onTargetTap}
          />
          {!finished && myTurn && !pendingIncoming && (
            salvoMode ? (
              <div className="salvo-action-bar">
                <span>Queued {queuedTargets.length} / {salvoShotsAllowed}</span>
                <button
                  className="btn btn--primary"
                  disabled={!salvoQueueReady(queuedTargets, salvoShotsAllowed) || busy}
                  onClick={fire}
                >
                  {busy ? <span className="spinner" /> : 'Fire Salvo'}
                </button>
              </div>
            ) : (
              <button className="btn btn--primary btn--block" disabled={!target || busy} onClick={fire}>
                {busy ? <span className="spinner" /> : target ? `Fire at ${coordLabel(target)}` : 'Tap a square to aim'}
              </button>
            )
          )}
        </section>

        <section className="stack">
          <div className="row row--between">
            <h2 style={{ fontSize: 16 }}>Your fleet</h2>
            <FleetStatus sunk={mySunk} />
          </div>
          {board ? (
            <Board
              ariaLabel="Your board"
              small
              disabled
              markOf={(c) => markAt(ownMarks, c)}
              lastShot={ownMarks.lastShot}
              overlay={<FxLayer side="own" />}
            />
          ) : (
            <Spinner />
          )}
        </section>

        {game.status === 'active' && <AbandonControls game={game} uid={uid} />}
        <Toast message={toast} onDone={() => setToast(null)} />
      </div>
    </FxStage>
  );
}

function FleetStatus({ sunk }: { sunk: ShipType[] }) {
  return (
    <div className="fleet-legend" aria-label={`${sunk.length} of ${SHIP_TYPES.length} ships sunk`}>
      {SHIP_TYPES.map((t) => (
        <span key={t} className={`fleet-chip${sunk.includes(t) ? ' sunk' : ''}`} style={{ padding: '2px 6px', fontSize: 11 }} title={SHIP_NAMES[t]}>
          <span className="pips" aria-hidden>
            {Array.from({ length: SHIP_LENGTHS[t] }, (_, i) => (
              <i key={i} style={{ width: 5, height: 5 }} />
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}
