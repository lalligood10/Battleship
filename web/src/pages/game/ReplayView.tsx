import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board } from '../../components/Board';
import { StrikeOverlay } from '../../components/art/StrikeOverlay';
import { Icon, TopBar } from '../../components/ui';
import { fxDurationMs, strikeFxKind } from '../../game/fx';
import { buildMarks, coordLabel, markAt } from '../../game/marks';
import { replayTimeline, shotsUpTo } from '../../game/replay';
import { SHIP_NAMES } from '../../game/placement';
import { isMuted, play, setMuted } from '../../lib/sound';
import { opponentUid, type Game, type PrivateBoard, type Shot } from '../../lib/types';

export function ReplayView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const opp = opponentUid(game, uid) ?? '';
  const opponentName = game.players[opp]?.username ?? 'Opponent';
  const timeline = useMemo(() => replayTimeline(game), [game]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [strike, setStrike] = useState<{ shot: Shot; shooterUid: string } | null>(null);
  const strikeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStrike = () => {
    if (strikeTimer.current) clearTimeout(strikeTimer.current);
    strikeTimer.current = null;
    setStrike(null);
  };

  const advance = useCallback(() => {
    const current = timeline[step];
    if (!current) {
      setPlaying(false);
      return;
    }
    const { shot } = current;
    play(shot.result === 'sunk' && shot.sunkShip === 'carrier' ? 'bomb' : shot.result);
    const nextStep = step + 1;
    setStep(nextStep);
    if (nextStep >= timeline.length) setPlaying(false);
    setStrike(current);
    if (strikeTimer.current) clearTimeout(strikeTimer.current);
    strikeTimer.current = setTimeout(() => {
      strikeTimer.current = null;
      setStrike(null);
    }, fxDurationMs(strikeFxKind(shot.result, shot.sunkShip), 1300));
  }, [setPlaying, step, timeline]);

  useEffect(() => {
    if (!playing) return;
    if (step >= timeline.length) return;
    const shownShot = step > 0 ? timeline[step - 1]?.shot : null;
    const delay = shownShot ? fxDurationMs(strikeFxKind(shownShot.result, shownShot.sunkShip), 1200) : 1200;
    const timer = setTimeout(advance, delay);
    return () => clearTimeout(timer);
  }, [advance, playing, step, timeline]);

  useEffect(
    () => () => {
      if (strikeTimer.current) clearTimeout(strikeTimer.current);
    },
    [],
  );

  const jumpTo = (nextStep: number) => {
    setPlaying(false);
    clearStrike();
    setStep(nextStep);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  if (game.status !== 'finished') return null;

  const oppFleet = game.revealedFleets?.[opp] ?? [];
  const myFleet = game.revealedFleets?.[uid] ?? board?.fleet ?? [];
  const shotsAtThem = shotsUpTo(timeline, uid, step);
  const shotsAtMe = shotsUpTo(timeline, opp, step);
  const theirMarks = buildMarks(shotsAtThem, oppFleet, true);
  const myMarks = buildMarks(shotsAtMe, myFleet, true);
  const current = step > 0 ? timeline[step - 1] : undefined;
  const status = current
    ? `Shot ${step} of ${timeline.length} · ${current.shooterUid === uid ? 'You' : opponentName} fired at ${coordLabel(current.shot)} — ${
        current.shot.result === 'sunk' ? `sank the ${SHIP_NAMES[current.shot.sunkShip ?? 'destroyer']}` : current.shot.result
      }`
    : 'Start of game';

  return (
    <div className="page page--wide">
      <TopBar
        title={`Replay vs ${opponentName}`}
        back={`/game/${game.id}`}
        right={
          <button className="btn btn--ghost btn--icon" onClick={toggleMute} aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}>
            <Icon name={muted ? 'muted' : 'sound'} />
          </button>
        }
      />

      <div className="alert alert--info" role="status" style={{ justifyContent: 'center', fontWeight: 800 }}>
        {status}
      </div>

      <section className="stack">
        <h2 style={{ fontSize: 16 }}>{opponentName}'s waters</h2>
        <Board
          ariaLabel="Opponent's board"
          disabled
          markOf={(c) => markAt(theirMarks, c)}
          lastShot={current?.shooterUid === uid ? theirMarks.lastShot : null}
          overlay={strike?.shooterUid === uid ? (
            <StrikeOverlay
              key={step}
              target={strike.shot}
              phase={strike.shot.result}
              sunkPlacement={strike.shot.sunkPlacement ?? null}
              from="left"
            />
          ) : undefined}
        />
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 16 }}>Your fleet</h2>
        <Board
          ariaLabel="Your board"
          small
          disabled
          markOf={(c) => markAt(myMarks, c)}
          lastShot={current?.shooterUid === opp ? myMarks.lastShot : null}
          overlay={strike?.shooterUid === opp ? (
            <StrikeOverlay
              key={step}
              target={strike.shot}
              phase={strike.shot.result}
              sunkPlacement={strike.shot.sunkPlacement ?? null}
              from="right"
            />
          ) : undefined}
        />
      </section>

      <div className="replay-controls">
        <button className="btn btn--secondary btn--sm" disabled={step === 0} onClick={() => jumpTo(0)}>
          Start
        </button>
        <button className="btn btn--secondary btn--sm" disabled={step === 0} onClick={() => jumpTo(step - 1)}>
          Back
        </button>
        <button
          className="btn btn--primary btn--sm"
          disabled={timeline.length === 0}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (step === timeline.length) jumpTo(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn btn--secondary btn--sm" disabled={step >= timeline.length} onClick={advance}>
          Next
        </button>
        <button className="btn btn--secondary btn--sm" disabled={step >= timeline.length} onClick={() => jumpTo(timeline.length)}>
          End
        </button>
        <input
          className="replay-scrubber"
          type="range"
          min={0}
          max={timeline.length}
          value={step}
          aria-label="Replay position"
          onChange={(event) => jumpTo(Number(event.target.value))}
        />
      </div>
    </div>
  );
}
