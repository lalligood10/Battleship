import { useCallback, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Board, type CellMark } from '../../components/Board';
import { Alert, Spinner, TopBar } from '../../components/ui';
import {
  cellKey,
  cellsOf,
  defaultFleet,
  dragTo,
  fleetIsValid,
  placeAt,
  randomFleet,
  SHIP_LENGTHS,
  SHIP_NAMES,
  SHIP_TYPES,
  shipAt,
  startDrag,
  type Coordinate,
  type DragState,
  type ShipPlacement,
  type ShipType,
} from '../../game/placement';
import { coordLabel } from '../../game/marks';
import { describeIssue, fleetIssues, placementIssue } from '../../game/placementIssues';
import { placementGridKey, rotateSelected, type Carry, type PlacementKeyResult } from '../../game/placementKeys';
import { placeShips } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isBotGame, opponentUid, type Game, type PrivateBoard } from '../../lib/types';
import { AbandonControls } from './AbandonControls';
import { MuteToggle } from '../../audio/MuteToggle';
import { ModeBadge } from '../../components/ModeBadge';

export function PlacementView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const ready = game.players[uid]?.ready === true;
  const opp = opponentUid(game, uid);
  const opponentName = opp ? game.players[opp]?.username ?? 'Opponent' : 'Opponent';

  if (ready) {
    return (
      <div className="page">
        <TopBar title={`vs ${opponentName}`} back="/" right={<ModeBadge mode={game.mode} />} />
        <Alert kind="info">
          {isBotGame(game)
            ? 'Your fleet is locked in — starting the battle…'
            : `Your fleet is locked in. Waiting for ${opponentName} to place their ships…`}
        </Alert>
        {board ? <FleetPreview fleet={board.fleet} /> : <Spinner />}
        <AbandonControls game={game} uid={uid} />
      </div>
    );
  }
  return <PlacementEditor game={game} />;
}

function FleetPreview({ fleet }: { fleet: ShipPlacement[] }) {
  const occupied = useMemo(() => new Set(fleet.flatMap((s) => cellsOf(s).map((c) => cellKey(c.row, c.col)))), [fleet]);
  return (
    <Board
      ariaLabel="Your fleet"
      disabled
      markOf={(c) => (occupied.has(cellKey(c.row, c.col)) ? 'ship' : 'water')}
    />
  );
}

function PlacementEditor({ game }: { game: Game }) {
  const [fleet, setFleet] = useState<ShipPlacement[]>(defaultFleet);
  const [selected, setSelected] = useState<ShipType>('carrier');
  const drag = useRef<DragState | null>(null);
  const [carrying, setCarrying] = useState<Carry | null>(null);
  const [dragging, setDragging] = useState<ShipType | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusRequest, setFocusRequest] = useState<{ cell: Coordinate; id: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issues = useMemo(() => fleetIssues(fleet), [fleet]);
  const issuesByType = useMemo(() => new Map(issues.map(({ type, issue }) => [type, issue])), [issues]);
  const valid = fleetIsValid(fleet);

  const cellOwner = useMemo(() => {
    const map = new Map<string, ShipType>();
    for (const s of fleet) for (const c of cellsOf(s)) map.set(cellKey(c.row, c.col), s.type);
    return map;
  }, [fleet]);
  const invalidTypes = useMemo(() => new Set(issues.map(({ type }) => type)), [issues]);

  const markOf = useCallback(
    (c: Coordinate): CellMark => {
      const type = cellOwner.get(cellKey(c.row, c.col));
      if (!type) return 'water';
      return invalidTypes.has(type) ? 'ship-invalid' : 'ship';
    },
    [cellOwner, invalidTypes],
  );
  const isSelected = useCallback(
    (c: Coordinate) => cellOwner.get(cellKey(c.row, c.col)) === selected,
    [cellOwner, selected],
  );

  const onCellTap = (c: Coordinate) => {
    const ship = shipAt(fleet, c);
    if (ship) {
      setSelected(ship.type);
      const result = rotateSelected({ fleet, selected: ship.type, carrying });
      applyResult(result);
      return;
    }
    const next = placeAt(fleet, selected, c);
    setFleet(next);
    setAnnouncement(placedAnnouncement(next, selected));
  };

  const onDragStart = (c: Coordinate) => {
    const d = startDrag(fleet, c);
    if (!d) return false;
    drag.current = d;
    setSelected(d.type);
    setDragging(d.type);
    return true;
  };
  const onDragMove = (c: Coordinate) => {
    const d = drag.current;
    if (d) setFleet((current) => dragTo(current, d, c));
  };
  const onDragEnd = () => {
    if (drag.current) setAnnouncement(placedAnnouncement(fleet, drag.current.type));
    drag.current = null;
    setDragging(null);
  };

  const applyResult = (result: PlacementKeyResult) => {
    setFleet(result.fleet);
    setSelected(result.selected);
    setCarrying(result.carrying);
    setAnnouncement(result.announcement);
  };

  const onGridKey = (key: string, at: Coordinate) => {
    const result = placementGridKey({ fleet, selected, carrying }, key, at);
    if (!result) return false;
    applyResult(result);
    return { focus: result.focus };
  };

  const rotate = (requestFocus: boolean) => {
    const result = rotateSelected({ fleet, selected, carrying });
    applyResult(result);
    if (requestFocus && result.focus) setFocusRequest({ cell: result.focus, id: Date.now() });
  };

  const onEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      event.key.toLowerCase() !== 'r' ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      target.closest('input, textarea')
    ) {
      return;
    }
    event.preventDefault();
    rotate(true);
  };

  const cellClassName = (c: Coordinate) => {
    const type = cellOwner.get(cellKey(c.row, c.col));
    return type && (type === carrying?.drag.type || type === dragging) ? 'cell--carry' : undefined;
  };

  const randomized = () => {
    setFleet(randomFleet());
    setCarrying(null);
    setDragging(null);
    drag.current = null;
    setAnnouncement('Fleet randomized');
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await placeShips(game.id, fleet);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" onKeyDown={onEditorKeyDown}>
      <TopBar
        title="Place your fleet"
        back="/"
        right={
          <div className="row placement-topbar-actions">
            <ModeBadge mode={game.mode} />
            <MuteToggle />
          </div>
        }
      />
      <p className="muted small center placement-hint">
        Drag to move · Tap a ship to rotate · Keys: Enter pick up, arrows move, R rotate, Enter place
      </p>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <Board
        ariaLabel="Your board"
        markOf={markOf}
        selected={isSelected}
        cellClassName={cellClassName}
        onCellTap={onCellTap}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onGridKey={onGridKey}
        focusRequest={focusRequest}
      />

      <p className={`placement-issues${valid ? ' placement-issues--ready' : ''}`} id="placement-issues" aria-live="polite">
        {valid
          ? '✓ Fleet ready'
          : issues.map(({ type, issue }) => `⚠ ${SHIP_NAMES[type]}: ${describeIssue(issue)}`).map((line) => (
              <span key={line}>{line}</span>
            ))}
      </p>
      <span className="placement-live" aria-live="polite">
        {announcement}
      </span>

      <div className="fleet-legend" role="radiogroup" aria-label="Ships">
        {SHIP_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={selected === t}
            className={`fleet-chip${selected === t ? ' active' : ''}${invalidTypes.has(t) ? ' invalid' : ''}`}
            onClick={() => setSelected(t)}
          >
            <span className="fleet-chip__head">
              <span>{SHIP_NAMES[t]}</span>
              <span className="pips" aria-hidden>
                {Array.from({ length: SHIP_LENGTHS[t] }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
            </span>
            {issuesByType.has(t) && <span className="fleet-chip__issue">{describeIssue(issuesByType.get(t)!)}</span>}
          </button>
        ))}
      </div>

      <div className="row">
        <button className="btn btn--secondary grow" onClick={() => rotate(true)}>
          Rotate {SHIP_NAMES[selected]}
        </button>
        <button className="btn btn--secondary grow" aria-label="Randomize: shuffle all ships" onClick={randomized}>
          Randomize
        </button>
      </div>
      <button
        className="btn btn--primary btn--block"
        aria-describedby="placement-issues"
        disabled={!valid || busy}
        onClick={confirm}
      >
        {busy ? <span className="spinner" /> : 'Lock in fleet'}
      </button>
    </div>
  );
}

function placedAnnouncement(fleet: ShipPlacement[], type: ShipType): string {
  const ship = fleet.find((candidate) => candidate.type === type);
  if (!ship) return `${SHIP_NAMES[type]} placed`;
  const issue = placementIssue(fleet, type);
  return `${SHIP_NAMES[type]} placed at ${coordLabel(ship)}${issue ? ` — ${describeIssue(issue)}` : ''}`;
}
