import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../../components/Board';
import { Alert, Icon, Spinner, Toast, TopBar } from '../../components/ui';
import { alreadyShot, buildMarks, coordLabel, markAt } from '../../game/marks';
import { SHIP_LENGTHS, SHIP_NAMES, SHIP_TYPES, type Coordinate } from '../../game/placement';
import { fireShot } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isMuted, play, setMuted } from '../../lib/sound';
import { isBotGame, isMyTurn, opponentUid, shotsBy, type Game, type PrivateBoard, type ShipType } from '../../lib/types';
import { AbandonControls } from './AbandonControls';

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

  // Against the computer the newest incoming shot is revealed after a beat so the exchange
  // reads like a turn: we render own-board marks only from the revealed prefix meanwhile.
  const botGame = isBotGame(game);
  const [revealedIncoming, setRevealedIncoming] = useState(theirShots.length);
  useEffect(() => {
    const count = theirShots.length;
    if (count <= revealedIncoming) {
      if (count < revealedIncoming) setRevealedIncoming(count);
      return;
    }
    if (!botGame) {
      setRevealedIncoming(count);
      return;
    }
    const t = setTimeout(() => setRevealedIncoming(count), 1000);
    return () => clearTimeout(t);
  }, [theirShots, botGame, revealedIncoming]);
  const pendingIncoming = theirShots.length > revealedIncoming;
  const visibleTheirShots = useMemo(() => theirShots.slice(0, revealedIncoming), [theirShots, revealedIncoming]);

  const targetMarks = useMemo(() => buildMarks(myShots), [myShots]);
  const ownMarks = useMemo(() => buildMarks(visibleTheirShots, board?.fleet), [visibleTheirShots, board]);

  // Sound + toast for incoming shots (my own shots are announced from the fireShot response).
  const seenIncoming = useRef<number | null>(null);
  useEffect(() => {
    const count = revealedIncoming;
    if (seenIncoming.current === null) {
      seenIncoming.current = count;
      return;
    }
    if (count > seenIncoming.current) {
      const last = theirShots[count - 1];
      if (last) {
        play(last.result);
        setToast(
          last.result === 'sunk'
            ? `${opponentName} sank your ${SHIP_NAMES[last.sunkShip ?? 'destroyer']}!`
            : `${opponentName} fired at ${coordLabel(last)} — ${last.result === 'hit' ? 'hit' : 'miss'}`,
        );
      }
    }
    seenIncoming.current = count;
  }, [revealedIncoming, theirShots, opponentName]);

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
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fireShot(game.id, target);
      play(res.result);
      if (res.result === 'sunk') setToast(`You sank their ${SHIP_NAMES[res.sunkShip ?? 'destroyer']}!`);
      else setToast(res.result === 'hit' ? `Hit at ${coordLabel(target)}!` : `Miss at ${coordLabel(target)}.`);
      setTarget(null);
    } catch (err) {
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

  return (
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

      <div className={`alert ${myTurn && !pendingIncoming ? 'alert--success' : 'alert--info'}`} role="status" style={{ justifyContent: 'center', fontWeight: 800 }}>
        {pendingIncoming ? 'Incoming fire…' : myTurn ? 'Your turn — pick a target' : `Waiting for ${opponentName} to fire…`}
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
          disabled={!myTurn || busy || pendingIncoming}
          markOf={(c) => markAt(targetMarks, c)}
          selected={(c) => target?.row === c.row && target?.col === c.col}
          lastShot={targetMarks.lastShot}
          onCellTap={onTargetTap}
        />
        {myTurn && !pendingIncoming && (
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
          <Board ariaLabel="Your board" small disabled markOf={(c) => markAt(ownMarks, c)} lastShot={ownMarks.lastShot} />
        ) : (
          <Spinner />
        )}
      </section>

      <AbandonControls game={game} uid={uid} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
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
