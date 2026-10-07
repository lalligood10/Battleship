import { useCallback, useEffect, useMemo, useState } from 'react';
import { Board } from '../../components/Board';
import { Alert, Icon, Spinner, Toast, TopBar } from '../../components/ui';
import { alreadyShot, buildMarks, coordLabel, markAt } from '../../game/marks';
import { SHIP_LENGTHS, SHIP_NAMES, SHIP_TYPES, type Coordinate } from '../../game/placement';
import { fireShot } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isMuted, setMuted } from '../../lib/sound';
import { isMyTurn, opponentUid, shotsBy, type Game, type PrivateBoard, type ShipType } from '../../lib/types';
import { AbandonControls } from './AbandonControls';
import { useFeelCue, useFeelDirector, useRevealed } from '../../feel/FeelProvider';
import { FxLayer } from '../../fx/FxLayer';
import { FxStage } from '../../fx/FxStage';

export function ActiveGameView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const opp = opponentUid(game, uid) ?? '';
  const opponentName = game.players[opp]?.username ?? 'Opponent';
  const myTurn = isMyTurn(game, uid);
  const myShots = shotsBy(game, uid);
  const theirShots = shotsBy(game, opp);

  const [target, setTarget] = useState<Coordinate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMutedState] = useState(isMuted);
  const director = useFeelDirector();
  const revealed = useRevealed();
  const visibleMyShots = useMemo(() => myShots.slice(0, revealed.target), [myShots, revealed.target]);
  const visibleTheirShots = useMemo(() => theirShots.slice(0, revealed.own), [theirShots, revealed.own]);
  const pendingIncoming = theirShots.length > revealed.own;
  const targetMarks = useMemo(() => buildMarks(visibleMyShots), [visibleMyShots]);
  const ownMarks = useMemo(() => buildMarks(visibleTheirShots, board?.fleet), [visibleTheirShots, board]);
  useFeelCue((cue) => {
    if (cue.type !== 'impact') return;
    if (cue.side === 'target') {
      setToast(
        cue.sunk
          ? `You sank their ${SHIP_NAMES[cue.sunk.shipId]}!`
          : cue.result === 'hit'
            ? `Hit at ${coordLabel(cue.target)}!`
            : `Miss at ${coordLabel(cue.target)}.`,
      );
    } else {
      setToast(
        cue.sunk
          ? `${opponentName} sank your ${SHIP_NAMES[cue.sunk.shipId]}!`
          : `${opponentName} fired at ${coordLabel(cue.target)} — ${cue.result === 'hit' ? 'hit' : 'miss'}`,
      );
    }
  });

  useEffect(() => {
    if (!myTurn) setTarget(null);
  }, [myTurn]);

  const onTargetTap = useCallback(
    (c: Coordinate) => {
      if (!myTurn || busy || pendingIncoming || alreadyShot(myShots, c)) return;
      setTarget((t) => (t && t.row === c.row && t.col === c.col ? null : c));
    },
    [myTurn, busy, pendingIncoming, myShots],
  );

  const fire = async () => {
    if (!target || game.status !== 'active') return;
    setBusy(true);
    setError(null);
    director.fireRequested(target);
    try {
      await fireShot(game.id, target);
      setTarget(null);
    } catch (err) {
      director.fireFailed();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  const mySunk = game.players[uid]?.sunkShips ?? [];
  const theirSunk = game.players[opp]?.sunkShips ?? [];
  const finished = game.status === 'finished';

  return (
    <FxStage>
      <div className="page page--wide">
        <TopBar
          title={`vs ${opponentName}`}
          back="/"
          right={
            <button className="btn btn--ghost btn--icon" onClick={toggleMute} aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}>
              <Icon name={muted ? 'muted' : 'sound'} />
            </button>
          }
        />

        <div
          className={`alert ${!finished && myTurn && !pendingIncoming ? 'alert--success' : 'alert--info'}`}
          role="status"
          style={{ justifyContent: 'center', fontWeight: 800 }}
        >
          {finished ? 'Game over' : pendingIncoming ? 'Incoming fire…' : myTurn ? 'Your turn — pick a target' : `Waiting for ${opponentName} to fire…`}
        </div>
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
            selected={(c) => target?.row === c.row && target?.col === c.col}
            lastShot={targetMarks.lastShot}
            overlay={<FxLayer side="target" />}
            onCellTap={onTargetTap}
          />
          {!finished && myTurn && !pendingIncoming && (
            <button className="btn btn--primary btn--block" disabled={!target || busy} onClick={fire}>
              {busy ? <span className="spinner" /> : target ? `Fire at ${coordLabel(target)}` : 'Tap a square to aim'}
            </button>
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
