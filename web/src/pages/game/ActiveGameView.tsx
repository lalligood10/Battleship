import { useCallback, useEffect, useMemo, useState } from 'react';
import { Board } from '../../components/Board';
import { AbilityBar } from '../../components/AbilityBar/AbilityBar';
import { TurnTimer, useServerOffset } from '../../components/TurnTimer';
import { Alert, Spinner, Toast, TopBar } from '../../components/ui';
import type { AbilityId, AbilityTarget, Game, PrivateBoard, ShipType } from '../../lib/types';
import { alreadyShot, buildMarks, coordLabel, markAt } from '../../game/marks';
import { cellKey, BOARD_SIZE, SHIP_LENGTHS, SHIP_NAMES, SHIP_TYPES, type Coordinate } from '../../game/placement';
import { abilityPreview } from '../../components/AbilityBar/abilityPreview';
import { abilityStatusesForWeb, deriveSonarMarkers, isAbilityPreviewValid } from '../../game/abilities';
import { sonarPresentation } from '../../game/sonarPresentation';
import { salvoQueueNumber, salvoQueueReady, toggleSalvoTarget } from '../../game/salvoQueue';
import { salvoShotsAllowed as getSalvoShotsAllowed } from '@shared/core/reducer';
import { claimTurnTimeout, fireSalvo, fireShot, useAbility as submitAbility } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isMyTurn, opponentUid, shotsBy } from '../../lib/types';
import { AbandonControls } from './AbandonControls';
import { MuteToggle } from '../../audio/MuteToggle';
import { useAmbientOcean } from '../../audio/useAmbientOcean';
import { useFeelCue, useFeelDirector, useFeelSettled, useRevealed } from '../../feel/FeelProvider';
import { FxLayer } from '../../fx/FxLayer';
import { FxStage } from '../../fx/FxStage';
import { ModeBadge } from '../../components/ModeBadge';

export function ActiveGameView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const opp = opponentUid(game, uid) ?? '';
  const opponentName = game.players[opp]?.username ?? 'Opponent';
  const myTurn = isMyTurn(game, uid);
  const serverOffsetMs = useServerOffset(game.lastMoveAt?.toMillis() ?? null);
  const salvoMode = game.mode === 'salvo';
  const abilitiesMode = game.mode === 'abilities';
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
  const [selectedAbility, setSelectedAbility] = useState<AbilityId | null>(null);
  const [horizontal, setHorizontal] = useState(true);
  const [enemyAim, setEnemyAim] = useState<Coordinate | null>(null);
  const [ownAim, setOwnAim] = useState<Coordinate | null>(null);
  const [sonarFlashCells, setSonarFlashCells] = useState<Coordinate[]>([]);
  const director = useFeelDirector();
  useAmbientOcean();
  const revealed = useRevealed();
  const settled = useFeelSettled();
  const visibleMyShots = useMemo(() => myShots.slice(0, revealed.target), [myShots, revealed.target]);
  const visibleTheirShots = useMemo(() => theirShots.slice(0, revealed.own), [theirShots, revealed.own]);
  const pendingIncoming = theirShots.length > revealed.own;
  const firedCells = useMemo(() => new Set(myShots.map((shot) => cellKey(shot.row, shot.col))), [myShots]);
  const targetMarks = useMemo(() => buildMarks(visibleMyShots), [visibleMyShots]);
  const ownMarks = useMemo(() => buildMarks(visibleTheirShots, board?.fleet), [visibleTheirShots, board]);
  const abilityStatuses = useMemo(() => abilityStatusesForWeb(game, uid, board), [game, uid, board]);
  const sonarMarkers = useMemo(() => deriveSonarMarkers(game.abilityLog ?? [], uid), [game.abilityLog, uid]);
  const sonarCells = useMemo(
    () => new Set(sonarMarkers.flatMap((marker) => marker.cells.map((cell) => cellKey(cell.row, cell.col)))),
    [sonarMarkers],
  );
  const sonarDetectedCells = useMemo(
    () => new Set(sonarMarkers.filter((marker) => marker.shipPresent).flatMap((marker) => marker.cells.map((cell) => cellKey(cell.row, cell.col)))),
    [sonarMarkers],
  );
  const sonarLabels = useMemo(
    () => new Map(sonarMarkers.map((marker) => [
      cellKey(marker.center.row, marker.center.col),
      marker.shipPresent ? 'Ship detected' : 'Clear',
    ])),
    [sonarMarkers],
  );
  const sonarFlashKeys = useMemo(
    () => new Set(sonarFlashCells.map((cell) => cellKey(cell.row, cell.col))),
    [sonarFlashCells],
  );
  const opponentAirstrikeCells = useMemo(
    () =>
      new Set(
        (game.abilityLog ?? []).flatMap((entry) =>
          entry.player !== uid && entry.result.abilityId === 'carrier-airstrike'
            ? entry.result.cells.map((cell) => cellKey(cell.row, cell.col))
            : [],
        ),
      ),
    [game.abilityLog, uid],
  );

  useFeelCue((cue) => {
    if (cue.type === 'abilityUsed') {
      if (cue.side === 'target' && cue.abilityId === 'submarine-sonar' && cue.result.abilityId === 'submarine-sonar') {
        setToast(sonarPresentation(cue.result.center, cue.result.shipPresent).toast);
        setSonarFlashCells(
          abilityPreview('submarine-sonar', cue.result.center, horizontal, BOARD_SIZE).cells,
        );
      } else if (cue.side === 'own') {
        const messages: Record<AbilityId, string> = {
          'carrier-airstrike': 'Enemy airstrike!',
          'submarine-sonar': 'Opponent scanned your waters',
          'destroyer-relocate': 'Enemy destroyer relocated',
        };
        setToast(messages[cue.abilityId]);
      }
      return;
    }
    if (cue.type !== 'impact' || cue.sunk) return;
    if (
      cue.side === 'own' &&
      opponentAirstrikeCells.has(cellKey(cue.target.row, cue.target.col))
    ) {
      return;
    }
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
    if (sonarFlashCells.length === 0) return;
    const timer = window.setTimeout(() => setSonarFlashCells([]), 800);
    return () => window.clearTimeout(timer);
  }, [sonarFlashCells]);

  useEffect(() => {
    if (myTurn && game.status === 'active' && !pendingIncoming) return;
    setSelectedAbility(null);
    setTarget(null);
    setQueuedTargets([]);
  }, [myTurn, game.status, pendingIncoming]);

  useEffect(() => {
    if (!selectedAbility) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAbility(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedAbility]);

  useEffect(() => {
    if (!myTurn) {
      setTarget(null);
      setQueuedTargets([]);
    }
  }, [myTurn]);

  const abilityDisabled =
    game.status !== 'active' || !myTurn || busy || pendingIncoming || !settled || board === null;

  const onEnemyAim = useCallback((coordinate: Coordinate | null) => {
    setEnemyAim((current) =>
      current?.row === coordinate?.row && current?.col === coordinate?.col ? current : coordinate,
    );
  }, []);
  const onOwnAim = useCallback((coordinate: Coordinate | null) => {
    setOwnAim((current) =>
      current?.row === coordinate?.row && current?.col === coordinate?.col ? current : coordinate,
    );
  }, []);

  const runAbility = useCallback(
    async (abilityId: AbilityId, coordinate: Coordinate) => {
      if (!abilitiesMode || abilityDisabled) return;
      const targetForAbility = abilityTargetFor(abilityId, coordinate, horizontal);
      const valid = isAbilityPreviewValid({
        abilityId,
        target: targetForAbility,
        horizontal,
        game,
        uid,
        board,
      });
      if (!valid) return;

      const needsShotWindup = abilityId === 'carrier-airstrike';
      if (needsShotWindup) {
        const targets = abilityPreview(abilityId, coordinate, horizontal, BOARD_SIZE).cells.filter(
          (cell) => !alreadyShot(myShots, cell),
        );
        director.fireRequested(targets);
      }
      setBusy(true);
      setError(null);
      try {
        await submitAbility(game.id, abilityId, targetForAbility);
        setSelectedAbility(null);
        setTarget(null);
        setQueuedTargets([]);
      } catch (err) {
        if (needsShotWindup) director.fireFailed();
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [abilitiesMode, abilityDisabled, horizontal, game, uid, board, myShots, director],
  );

  const onTargetTap = useCallback(
    (c: Coordinate) => {
      if (selectedAbility) {
        if (selectedAbility !== 'destroyer-relocate') void runAbility(selectedAbility, c);
        return;
      }
      if (!myTurn || game.status !== 'active' || busy || pendingIncoming || alreadyShot(myShots, c)) return;
      if (salvoMode) {
        setQueuedTargets((queue) => toggleSalvoTarget(queue, c, salvoShotsAllowed, firedCells));
      } else {
        setTarget((t) => (t && t.row === c.row && t.col === c.col ? null : c));
      }
    },
    [selectedAbility, runAbility, myTurn, game.status, busy, pendingIncoming, myShots, salvoMode, salvoShotsAllowed, firedCells],
  );

  const onOwnTargetTap = useCallback(
    (c: Coordinate) => {
      if (selectedAbility === 'destroyer-relocate') void runAbility(selectedAbility, c);
    },
    [selectedAbility, runAbility],
  );

  const enemyPreview =
    abilitiesMode && selectedAbility && selectedAbility !== 'destroyer-relocate' && enemyAim
      ? abilityPreview(selectedAbility, enemyAim, horizontal, BOARD_SIZE)
      : undefined;
  const enemyPreviewInvalid =
    abilitiesMode && selectedAbility && selectedAbility !== 'destroyer-relocate' && enemyAim
      ? !isAbilityPreviewValid({
          abilityId: selectedAbility,
          target: abilityTargetFor(selectedAbility, enemyAim, horizontal),
          horizontal,
          game,
          uid,
          board,
        })
      : false;
  const ownPreview =
    abilitiesMode && selectedAbility === 'destroyer-relocate' && ownAim
      ? abilityPreview(selectedAbility, ownAim, horizontal, BOARD_SIZE)
      : undefined;
  const ownPreviewInvalid =
    abilitiesMode && selectedAbility === 'destroyer-relocate' && ownAim
      ? !isAbilityPreviewValid({
          abilityId: selectedAbility,
          target: abilityTargetFor(selectedAbility, ownAim, horizontal),
          horizontal,
          game,
          uid,
          board,
        })
      : false;

  const sonarCellClassName = (c: Coordinate) => {
    const key = cellKey(c.row, c.col);
    const classes = [];
    if (sonarCells.has(key)) classes.push('sonar-marker', sonarDetectedCells.has(key) ? 'sonar-marker--detected' : 'sonar-marker--clear');
    if (sonarFlashKeys.has(key)) classes.push('sonar-flash');
    return classes.join(' ') || undefined;
  };

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
          <TurnTimer
            turnDeadline={game.status === 'active' ? game.turnDeadline?.toMillis() ?? null : null}
            serverOffsetMs={serverOffsetMs}
            isMyTurn={game.currentTurnUid === uid}
            onExpire={() => void claimTurnTimeout(game.id).catch(() => {})}
          />
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
            disabled={
              finished ||
              !myTurn ||
              busy ||
              pendingIncoming ||
              selectedAbility === 'destroyer-relocate' ||
              (abilitiesMode && selectedAbility !== null && abilityDisabled)
            }
            cellInteractive={
              selectedAbility && selectedAbility !== 'destroyer-relocate'
                ? () => !abilityDisabled
                : undefined
            }
            markOf={(c) => markAt(targetMarks, c)}
            selected={(c) => !salvoMode && target?.row === c.row && target?.col === c.col}
            queueNumber={salvoMode ? (c) => salvoQueueNumber(queuedTargets, c) : undefined}
            lastShot={targetMarks.lastShot}
            preview={enemyPreview && { ...enemyPreview, invalid: enemyPreviewInvalid }}
            cellClassName={abilitiesMode ? sonarCellClassName : undefined}
            cellLabel={abilitiesMode ? (c) => sonarLabels.get(cellKey(c.row, c.col)) : undefined}
            onCellAim={abilitiesMode ? onEnemyAim : undefined}
            onEscape={abilitiesMode ? () => setSelectedAbility(null) : undefined}
            overlay={<FxLayer side="target" />}
            onCellTap={onTargetTap}
          />
          {abilitiesMode && sonarMarkers.length > 0 && (
            <div className="sonar-history" aria-label="Sonar results">
              {sonarMarkers.map((marker, index) => (
                <p
                  key={`${index}-${marker.center.row}-${marker.center.col}`}
                  className={`sonar-history__item${marker.shipPresent ? ' sonar-history__item--detected' : ''}`}
                >
                  {sonarPresentation(marker.center, marker.shipPresent).line}
                </p>
              ))}
            </div>
          )}
          {!finished && myTurn && !pendingIncoming && !selectedAbility && (
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
              targeting={selectedAbility === 'destroyer-relocate'}
              disabled={selectedAbility !== 'destroyer-relocate' || abilityDisabled}
              markOf={(c) => markAt(ownMarks, c)}
              lastShot={ownMarks.lastShot}
              preview={ownPreview && { ...ownPreview, invalid: ownPreviewInvalid }}
              cellInteractive={
                abilitiesMode
                  ? () => selectedAbility === 'destroyer-relocate' && !abilityDisabled
                  : undefined
              }
              onCellAim={abilitiesMode ? onOwnAim : undefined}
              onEscape={abilitiesMode ? () => setSelectedAbility(null) : undefined}
              onCellTap={abilitiesMode ? onOwnTargetTap : undefined}
              overlay={<FxLayer side="own" />}
            />
          ) : (
            <Spinner />
          )}
        </section>

        {abilitiesMode && (
          <AbilityBar
            statuses={abilityStatuses}
            disabled={abilityDisabled}
            selected={selectedAbility}
            onSelect={(abilityId) => {
              setSelectedAbility(abilityId);
              setTarget(null);
              setQueuedTargets([]);
            }}
            horizontal={horizontal}
            onToggleOrientation={() => setHorizontal((value) => !value)}
          />
        )}

        {game.status === 'active' && <AbandonControls game={game} uid={uid} />}
        <Toast message={toast} onDone={() => setToast(null)} />
      </div>
    </FxStage>
  );
}

function abilityTargetFor(abilityId: AbilityId, c: Coordinate, horizontal: boolean): AbilityTarget {
  if (abilityId === 'submarine-sonar') return { row: c.row, col: c.col };
  return { row: c.row, col: c.col, horizontal };
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
