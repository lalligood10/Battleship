import { useCallback, useMemo, useRef, useState } from 'react';
import { Board, type CellMark } from '../../components/Board';
import { Alert, Spinner, TopBar } from '../../components/ui';
import {
  cellKey,
  cellsOf,
  defaultFleet,
  describeProblem,
  dragTo,
  fleetIsValid,
  placeAt,
  problemFor,
  randomFleet,
  rotateShip,
  SHIP_LENGTHS,
  SHIP_NAMES,
  SHIP_TYPES,
  shipAt,
  startDrag,
  type Coordinate,
  type DragState,
  type PlacementProblem,
  type ShipPlacement,
  type ShipType,
} from '../../game/placement';
import { placeShips } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { opponentUid, type Game, type PrivateBoard } from '../../lib/types';
import { AbandonControls } from './AbandonControls';

export function PlacementView({ game, uid, board }: { game: Game; uid: string; board: PrivateBoard | null }) {
  const ready = game.players[uid]?.ready === true;
  const opp = opponentUid(game, uid);
  const opponentName = opp ? game.players[opp]?.username ?? 'Opponent' : 'Opponent';

  if (ready) {
    return (
      <div className="page">
        <TopBar title={`vs ${opponentName}`} back="/" />
        <Alert kind="info">Your fleet is locked in. Waiting for {opponentName} to place their ships…</Alert>
        {board ? <FleetPreview fleet={board.fleet} /> : <Spinner />}
        <AbandonControls game={game} uid={uid} />
      </div>
    );
  }
  return <PlacementEditor game={game} opponentName={opponentName} />;
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

function PlacementEditor({ game, opponentName }: { game: Game; opponentName: string }) {
  const [fleet, setFleet] = useState<ShipPlacement[]>(defaultFleet);
  const [selected, setSelected] = useState<ShipType>('carrier');
  const drag = useRef<DragState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = useMemo(() => {
    const out: Array<[ShipType, PlacementProblem]> = [];
    for (const t of SHIP_TYPES) {
      const p = problemFor(fleet, t);
      if (p) out.push([t, p]);
    }
    return out;
  }, [fleet]);
  const valid = fleetIsValid(fleet);

  const cellOwner = useMemo(() => {
    const map = new Map<string, ShipType>();
    for (const s of fleet) for (const c of cellsOf(s)) map.set(cellKey(c.row, c.col), s.type);
    return map;
  }, [fleet]);
  const invalidTypes = useMemo(() => new Set(problems.map(([t]) => t)), [problems]);

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

  // Tap: tapping a ship selects it; tapping water moves the selected ship there (touch-friendly path).
  const onCellTap = (c: Coordinate) => {
    const ship = shipAt(fleet, c);
    if (ship) setSelected(ship.type);
    else setFleet((f) => placeAt(f, selected, c));
  };

  const onDragStart = (c: Coordinate) => {
    const d = startDrag(fleet, c);
    if (!d) return false;
    drag.current = d;
    setSelected(d.type);
    return true;
  };
  const onDragMove = (c: Coordinate) => {
    const d = drag.current;
    if (d) setFleet((f) => dragTo(f, d, c));
  };
  const onDragEnd = () => {
    drag.current = null;
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
    <div className="page">
      <TopBar title="Place your fleet" back="/" />
      <p className="muted small center">
        vs {opponentName} · Drag ships, or tap a ship then tap where it should go. Rotate with the button below.
      </p>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}

      <Board
        ariaLabel="Your board"
        markOf={markOf}
        selected={isSelected}
        onCellTap={onCellTap}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />

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
            {SHIP_NAMES[t]}
            <span className="pips" aria-hidden>
              {Array.from({ length: SHIP_LENGTHS[t] }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          </button>
        ))}
      </div>

      {problems.length > 0 && (
        <p className="small" style={{ color: 'var(--danger)' }} role="alert">
          {problems.map(([t, p]) => describeProblem(t, p)).join(' · ')}
        </p>
      )}

      <div className="row">
        <button className="btn btn--secondary grow" onClick={() => setFleet((f) => rotateShip(f, selected))}>
          Rotate {SHIP_NAMES[selected]}
        </button>
        <button className="btn btn--secondary grow" onClick={() => setFleet(randomFleet())}>
          Shuffle
        </button>
      </div>
      <button className="btn btn--primary btn--block" disabled={!valid || busy} onClick={confirm}>
        {busy ? <span className="spinner" /> : 'Lock in fleet'}
      </button>
    </div>
  );
}
