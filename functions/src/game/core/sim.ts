import { chooseShot } from '../ai';
import { BOT_DIFFICULTIES, type BotDifficulty } from '../bots';
import {
  cellKey,
  cellsOf,
  isFleetDestroyed,
  isOnBoard,
  placementProblem,
  randomFleet,
  type Coordinate,
  type ShipPlacement,
  type Shot,
} from '../engine';
import {
  ABILITY_DEFINITIONS,
  type AbilityAction,
  type AbilityId,
  type AbilityLogEntry,
  type AbilityStatus,
  type CoreErrorCode,
  type ModeAction,
} from './modes';
import type { CoreEvent } from './events';
import { createCoreState, reduce, shotsAllowed, type CoreAction } from './reducer';
import { deriveRng } from './rng';
import type { CoreState, GameMode } from './schema';

export interface PlayerView {
  player: string;
  opponent: string;
  mode: GameMode;
  boardSize: number;
  turnNumber: number;
  ownFleet: ShipPlacement[];
  ownShots: Shot[];
  opponentShots: Shot[];
  abilityLog: AbilityLogEntry[];
}

export interface SimulationOptions {
  randomShotRate?: number;
  illegalActionRate?: number;
  abilityRate?: number;
  difficulties?: readonly BotDifficulty[];
  mode?: GameMode;
}

export interface SimulationResult {
  state: CoreState;
  moves: number;
  turns: number;
  illegalActions: number;
  abilityUses: Record<AbilityId, number>;
  rejectedByCode: Record<CoreErrorCode, number>;
}

const ABILITY_IDS: AbilityId[] = ABILITY_DEFINITIONS.map(({ id }) => id);
const ERROR_CODES: CoreErrorCode[] = [
  'not_player',
  'wrong_phase',
  'not_your_turn',
  'wrong_mode',
  'wrong_shot_count',
  'duplicate_target',
  'off_board',
  'already_fired',
  'not_waiting',
  'too_early',
  'invalid_fleet',
  'invalid_ability',
  'ability_used',
  'illegal_relocation',
];

const recordFromKeys = <T extends string>(keys: readonly T[]): Record<T, number> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;

const randomItem = <T>(items: readonly T[], rng: () => number): T => {
  if (items.length === 0) throw new Error('Cannot choose from an empty list');
  return items[Math.floor(rng() * items.length)]!;
};

export function playerView(state: CoreState, player: string): PlayerView {
  if (!state.playerIds.includes(player)) throw new Error(`${player} is not in this game`);
  const opponent = state.playerIds.find((uid) => uid !== player)!;
  const ownFleet = state.boards[player]!.fleet;
  if (!ownFleet) throw new Error(`${player} has not placed a fleet`);
  return structuredClone({
    player,
    opponent,
    mode: state.settings.mode,
    boardSize: state.settings.boardSize,
    turnNumber: state.turnNumber,
    ownFleet,
    ownShots: state.shots[player]!,
    opponentShots: state.shots[opponent]!,
    abilityLog: state.abilityLog,
  });
}

export function chooseClassicTarget(
  view: PlayerView,
  rng: () => number,
  randomShotRate: number,
  difficulty: BotDifficulty,
): Coordinate {
  if (rng() < randomShotRate) return randomUntriedTarget(view, rng);
  return chooseShot({
    shots: view.ownShots,
    boardSize: view.boardSize,
    difficulty,
    rng,
  });
}

export function chooseSalvoTargets(view: PlayerView, rng: () => number, count: number): Coordinate[] {
  const tried = new Set(view.ownShots.map(({ row, col }) => cellKey(row, col)));
  const available: Coordinate[] = [];
  for (let row = 0; row < view.boardSize; row++) {
    for (let col = 0; col < view.boardSize; col++) {
      if (!tried.has(cellKey(row, col))) available.push({ row, col });
    }
  }
  if (available.length < count) throw new Error('Not enough legal targets remain for this volley');
  const targets: Coordinate[] = [];
  for (let index = 0; index < count; index++) {
    targets.push(available.splice(Math.floor(rng() * available.length), 1)[0]!);
  }
  return targets;
}

export function chooseAbilitiesAction(
  view: PlayerView,
  rng: () => number,
  options: {
    abilityRate: number;
    randomShotRate: number;
    difficulty: BotDifficulty;
    at: number;
  },
): AbilityAction | { type: 'fire'; player: string; target: Coordinate; at: number } {
  const ready = ABILITY_IDS.filter((abilityId) => viewAbilityStatus(view, abilityId) === 'ready');
  if (ready.length > 0 && rng() < options.abilityRate) {
    const abilityId = randomItem(ready, rng);
    if (abilityId === 'carrier-airstrike') {
      const lines = airstrikeLines(view.boardSize).filter((line) =>
        line.cells.some(({ row, col }) => !hasShotAt(view.ownShots, row, col)),
      );
      if (lines.length > 0) {
        const { target } = randomItem(lines, rng);
        return { type: 'ability', player: view.player, abilityId, target, at: options.at };
      }
    } else if (abilityId === 'submarine-sonar') {
      return {
        type: 'ability',
        player: view.player,
        abilityId,
        target: {
          row: Math.floor(rng() * view.boardSize),
          col: Math.floor(rng() * view.boardSize),
        },
        at: options.at,
      };
    } else {
      const placements = legalRelocations(view);
      if (placements.length > 0) {
        return {
          type: 'ability',
          player: view.player,
          abilityId,
          target: randomItem(placements, rng),
          at: options.at,
        };
      }
    }
  }

  const target = chooseClassicTarget(view, rng, options.randomShotRate, options.difficulty);
  return { type: 'fire', player: view.player, target, at: options.at };
}

function randomUntriedTarget(view: PlayerView, rng: () => number): Coordinate {
  const tried = new Set(view.ownShots.map(({ row, col }) => cellKey(row, col)));
  const available: Coordinate[] = [];
  for (let row = 0; row < view.boardSize; row++) {
    for (let col = 0; col < view.boardSize; col++) {
      if (!tried.has(cellKey(row, col))) available.push({ row, col });
    }
  }
  if (available.length === 0) throw new Error('No legal shots remain');
  return randomItem(available, rng);
}

function hasShotAt(shots: readonly Shot[], row: number, col: number): boolean {
  return shots.some((shot) => shot.row === row && shot.col === col);
}

function viewAbilityStatus(view: PlayerView, abilityId: AbilityId): AbilityStatus {
  if (view.abilityLog.some((entry) => entry.player === view.player && entry.result.abilityId === abilityId)) {
    return 'used';
  }
  const definition = ABILITY_DEFINITIONS.find(({ id }) => id === abilityId)!;
  const ship = view.ownFleet.find(({ type }) => type === definition.ship)!;
  const shipCells = new Set(cellsOf(ship).map(({ row, col }) => cellKey(row, col)));
  if (abilityId === 'destroyer-relocate') {
    return view.opponentShots.some(
      (shot) => shot.result !== 'miss' && shipCells.has(cellKey(shot.row, shot.col)),
    ) ? 'lost' : 'ready';
  }
  return view.opponentShots.some((shot) => shot.sunkShip === definition.ship) ? 'lost' : 'ready';
}

export function abilityStatus(state: CoreState, player: string, abilityId: AbilityId): AbilityStatus {
  if (state.abilityLog.some((entry) => entry.player === player && entry.result.abilityId === abilityId)) {
    return 'used';
  }
  const definition = ABILITY_DEFINITIONS.find(({ id }) => id === abilityId)!;
  const board = state.boards[player]!;
  const fleet = board.fleet;
  if (!fleet) throw new Error(`${player} has not placed a fleet`);
  const ship = fleet.find(({ type }) => type === definition.ship)!;
  const shipCells = cellsOf(ship);
  const hits = new Set(board.hitCells);
  if (abilityId === 'destroyer-relocate') {
    return shipCells.some(({ row, col }) => hits.has(cellKey(row, col))) ? 'lost' : 'ready';
  }
  return shipCells.every(({ row, col }) => hits.has(cellKey(row, col))) ? 'lost' : 'ready';
}

function airstrikeLines(boardSize: number): { target: { row: number; col: number; horizontal: boolean }; cells: Coordinate[] }[] {
  const lines: { target: { row: number; col: number; horizontal: boolean }; cells: Coordinate[] }[] = [];
  for (const horizontal of [true, false]) {
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const cells = Array.from({ length: 3 }, (_, index) => ({
          row: row + (horizontal ? 0 : index),
          col: col + (horizontal ? index : 0),
        }));
        if (cells.every(({ row: targetRow, col: targetCol }) => isOnBoard(targetRow, targetCol))) {
          lines.push({ target: { row, col, horizontal }, cells });
        }
      }
    }
  }
  return lines;
}

function allOnBoardPlacements(type: ShipPlacement['type'], boardSize: number): ShipPlacement[] {
  const placements: ShipPlacement[] = [];
  for (const horizontal of [true, false]) {
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const placement: ShipPlacement = { type, row, col, horizontal };
        if (cellsOf(placement).every(({ row: targetRow, col: targetCol }) => isOnBoard(targetRow, targetCol))) {
          placements.push(placement);
        }
      }
    }
  }
  return placements;
}

function legalRelocations(view: PlayerView): ShipPlacement[] {
  const current = view.ownFleet.find(({ type }) => type === 'destroyer')!;
  return allOnBoardPlacements('destroyer', view.boardSize).filter((placement) =>
    JSON.stringify(placement) !== JSON.stringify(current) &&
    placementProblem(placement, view.ownFleet) === null &&
    cellsOf(placement).every(({ row, col }) => !hasShotAt(view.opponentShots, row, col)),
  );
}

type IllegalAttempt = { action: CoreAction; code: CoreErrorCode };

export function simulateGame(seed: number, opts: SimulationOptions = {}): SimulationResult {
  const randomShotRate = opts.randomShotRate ?? 0.5;
  const illegalActionRate = opts.illegalActionRate ?? 0.1;
  const abilityRate = opts.abilityRate ?? 0.3;
  const difficulties = opts.difficulties ?? BOT_DIFFICULTIES;
  const mode = opts.mode ?? 'classic';
  const random = deriveRng(seed, 'simulation');
  const playerIds: [string, string] = ['player-one', 'player-two'];
  let state = createCoreState({ playerIds, seed, createdAt: 0, mode });
  for (const [index, player] of playerIds.entries()) {
    const placement = reduce(state, {
      type: 'placeFleet',
      player,
      fleet: randomFleet(deriveRng(seed, 'fleet', index)),
      at: index + 1,
    });
    if (!placement.ok) throw new Error(`Generated fleet rejected: ${placement.error.message}`);
    state = placement.state;
  }

  let moves = 0;
  let turns = 0;
  let illegalActions = 0;
  const rejectedByCode = recordFromKeys(ERROR_CODES);
  assertInvariants(state);

  while (state.phase === 'playing') {
    const shooter = state.currentTurn;
    if (!shooter || !state.playerIds.includes(shooter)) throw new Error('A playing game must have one current player');
    const view = playerView(state, shooter);

    if (random() < illegalActionRate) {
      const attempts = illegalAttempts(state, shooter, moves);
      if (attempts.length > 0) {
        const codes = [...new Set(attempts.map(({ code }) => code))];
        const code = randomItem(codes, random);
        const attempt = randomItem(attempts.filter((candidate) => candidate.code === code), random);
        const before = structuredClone(state);
        const rejected = reduce(state, attempt.action);
        if (rejected.ok || rejected.error.code !== attempt.code) {
          throw new Error(`Injected illegal ${attempt.code} action was rejected as ${rejected.ok ? 'accepted' : rejected.error.code}`);
        }
        if (!deepEqual(state, before)) throw new Error('Illegal action changed the state');
        illegalActions++;
        rejectedByCode[attempt.code]++;
        assertInvariants(state);
      }
    }

    const pre = structuredClone(state);
    let action: ModeAction;
    if (mode === 'salvo') {
      const count = shotsAllowed(state, shooter);
      const targets = chooseSalvoTargets(view, random, count);
      action = { type: 'salvo', player: shooter, targets, at: moves + 3 };
    } else if (mode === 'abilities') {
      const difficulty = difficulties[moves % difficulties.length] ?? 'easy';
      action = chooseAbilitiesAction(view, random, {
        abilityRate,
        randomShotRate,
        difficulty,
        at: moves + 3,
      });
    } else {
      const difficulty = difficulties[moves % difficulties.length] ?? 'easy';
      action = {
        type: 'fire',
        player: shooter,
        target: chooseClassicTarget(view, random, randomShotRate, difficulty),
        at: moves + 3,
      };
    }

    const result = reduce(state, action);
    if (!result.ok) throw new Error(`Legal ${mode} action rejected: ${result.error.message}`);
    assertAcceptedAction(pre, result.state, result.events, action);
    const appendedShots = result.state.shots[shooter]!.slice(pre.shots[shooter]!.length);
    moves += appendedShots.length;
    turns++;
    state = result.state;
    assertInvariants(state);
  }

  const abilityUses = recordFromKeys(ABILITY_IDS);
  for (const entry of state.abilityLog) abilityUses[entry.result.abilityId]++;
  return { state, moves, turns, illegalActions, abilityUses, rejectedByCode };
}

function illegalAttempts(state: CoreState, shooter: string, at: number): IllegalAttempt[] {
  const attempts: IllegalAttempt[] = [];
  const opponent = state.playerIds.find((uid) => uid !== shooter)!;
  const view = playerView(state, shooter);
  const mode = state.settings.mode;

  attempts.push({
    action: {
      type: mode === 'salvo' ? 'salvo' : 'fire',
      player: opponent,
      ...(mode === 'salvo' ? { targets: [] } : { target: { row: 0, col: 0 } }),
      at,
    } as CoreAction,
    code: 'not_your_turn',
  });

  if (mode === 'classic') {
    attempts.push({ action: { type: 'salvo', player: shooter, targets: [], at }, code: 'wrong_mode' });
    attempts.push({
      action: {
        type: 'ability',
        player: shooter,
        abilityId: 'submarine-sonar',
        target: { row: 0, col: 0 },
        at,
      },
      code: 'wrong_mode',
    });
  } else if (mode === 'salvo') {
    attempts.push({ action: { type: 'fire', player: shooter, target: { row: 0, col: 0 }, at }, code: 'wrong_mode' });
    attempts.push({
      action: {
        type: 'ability',
        player: shooter,
        abilityId: 'submarine-sonar',
        target: { row: 0, col: 0 },
        at,
      },
      code: 'wrong_mode',
    });
  } else {
    attempts.push({ action: { type: 'salvo', player: shooter, targets: [], at }, code: 'wrong_mode' });
  }

  if (mode === 'salvo') {
    const count = shotsAllowed(state, shooter);
    const available = chooseSalvoTargets(view, deriveRng(state.seed, 'illegal-targets', state.turnNumber), Math.min(count, view.boardSize ** 2));
    const overCountTargets: Coordinate[] = [];
    for (let index = 0; index < count + 1; index++) {
      overCountTargets.push(available[index % Math.max(1, available.length)] ?? { row: 0, col: 0 });
    }
    attempts.push({
      action: { type: 'salvo', player: shooter, targets: overCountTargets, at },
      code: 'wrong_shot_count',
    });
    if (count >= 2 && available.length > 0) {
      attempts.push({
        action: {
          type: 'salvo',
          player: shooter,
          targets: Array.from({ length: count }, () => available[0]!),
          at,
        },
        code: 'duplicate_target',
      });
    }
    if (count > 0) {
      const targets = [{ row: state.settings.boardSize, col: 0 }, ...available.slice(0, count - 1)];
      attempts.push({ action: { type: 'salvo', player: shooter, targets, at }, code: 'off_board' });
      if (view.ownShots.length > 0) {
        const targetsWithTriedCell = [
          { row: view.ownShots[0]!.row, col: view.ownShots[0]!.col },
          ...available.slice(0, count - 1),
        ];
        attempts.push({
          action: { type: 'salvo', player: shooter, targets: targetsWithTriedCell, at },
          code: 'already_fired',
        });
      }
    }
  } else {
    attempts.push({
      action: { type: 'fire', player: shooter, target: { row: state.settings.boardSize, col: 0 }, at },
      code: 'off_board',
    });
    if (view.ownShots.length > 0) {
      const { row, col } = view.ownShots[0]!;
      attempts.push({ action: { type: 'fire', player: shooter, target: { row, col }, at }, code: 'already_fired' });
    }
  }

  if (mode === 'abilities') {
    for (const abilityId of ABILITY_IDS) {
      const status = abilityStatus(state, shooter, abilityId);
      if (status === 'used') {
        attempts.push({ action: genericAbilityAction(shooter, abilityId, at), code: 'ability_used' });
      } else if (status === 'lost') {
        attempts.push({ action: genericAbilityAction(shooter, abilityId, at), code: 'invalid_ability' });
      }
    }

    if (abilityStatus(state, shooter, 'carrier-airstrike') === 'ready') {
      attempts.push({
        action: {
          type: 'ability',
          player: shooter,
          abilityId: 'carrier-airstrike',
          target: { row: 0, col: state.settings.boardSize - 2, horizontal: true },
          at,
        },
        code: 'off_board',
      });
      const tried = new Set(view.ownShots.map(({ row, col }) => cellKey(row, col)));
      const completedLine = airstrikeLines(view.boardSize).find(({ cells }) =>
        cells.every(({ row, col }) => tried.has(cellKey(row, col))),
      );
      if (completedLine) {
        attempts.push({
          action: {
            type: 'ability',
            player: shooter,
            abilityId: 'carrier-airstrike',
            target: completedLine.target,
            at,
          },
          code: 'already_fired',
        });
      }
    }

    if (abilityStatus(state, shooter, 'destroyer-relocate') === 'ready') {
      for (const target of illegalRelocationTargets(state, shooter)) {
        attempts.push({
          action: { type: 'ability', player: shooter, abilityId: 'destroyer-relocate', target, at },
          code: 'illegal_relocation',
        });
      }
    }
  }

  return attempts;
}

function genericAbilityAction(player: string, abilityId: AbilityId, at: number): AbilityAction {
  if (abilityId === 'carrier-airstrike') {
    return { type: 'ability', player, abilityId, target: { row: 0, col: 0, horizontal: true }, at };
  }
  if (abilityId === 'submarine-sonar') {
    return { type: 'ability', player, abilityId, target: { row: 0, col: 0 }, at };
  }
  return {
    type: 'ability',
    player,
    abilityId,
    target: { row: 0, col: 0, horizontal: true },
    at,
  };
}

function illegalRelocationTargets(state: CoreState, player: string): ShipPlacement[] {
  const fleet = state.boards[player]!.fleet!;
  const destroyer = fleet.find(({ type }) => type === 'destroyer')!;
  const opponent = state.playerIds.find((uid) => uid !== player)!;
  const firedAt = new Set(state.shots[opponent]!.map(({ row, col }) => cellKey(row, col)));
  const otherShipCells = new Set(
    fleet
      .filter(({ type }) => type !== 'destroyer')
      .flatMap((ship) => cellsOf(ship).map(({ row, col }) => cellKey(row, col))),
  );
  const placements = allOnBoardPlacements('destroyer', state.settings.boardSize);
  const candidates: ShipPlacement[] = [];
  if (cellsOf(destroyer).every(({ row, col }) => !firedAt.has(cellKey(row, col)))) {
    candidates.push({ ...destroyer });
  }
  candidates.push(
    ...placements.filter((placement) =>
      !deepEqual(placement, destroyer) &&
      cellsOf(placement).some(({ row, col }) => otherShipCells.has(cellKey(row, col))) &&
      cellsOf(placement).every(({ row, col }) => !firedAt.has(cellKey(row, col))),
    ),
  );
  candidates.push(
    ...placements.filter((placement) =>
      !deepEqual(placement, destroyer) &&
      cellsOf(placement).every(({ row, col }) => !otherShipCells.has(cellKey(row, col))) &&
      cellsOf(placement).some(({ row, col }) => firedAt.has(cellKey(row, col))),
    ),
  );
  return candidates;
}

function assertAcceptedAction(
  pre: CoreState,
  next: CoreState,
  events: readonly CoreEvent[],
  action: ModeAction,
): void {
  if (pre.phase !== 'playing') throw new Error('Accepted actions must start during play');
  const shooter = action.player;
  const opponent = pre.playerIds.find((uid) => uid !== shooter)!;
  if (next.turnNumber !== pre.turnNumber + 1) throw new Error('Accepted action must increment turnNumber exactly once');
  const terminalEvents = events.filter((event) => event.type === 'turnChanged' || event.type === 'gameOver');
  const lastEvent = events.at(-1);
  if (terminalEvents.length !== 1 || lastEvent?.type !== terminalEvents[0]?.type) {
    throw new Error('Accepted action must end with exactly one turnChanged or gameOver event');
  }
  if (next.phase === 'playing') {
    if (next.currentTurn !== opponent || terminalEvents[0]!.type !== 'turnChanged') {
      throw new Error('A continuing action must pass the turn to the opponent');
    }
  } else if (next.phase === 'gameOver') {
    if (next.currentTurn !== null || terminalEvents[0]!.type !== 'gameOver') {
      throw new Error('A terminal action must end the game');
    }
  } else {
    throw new Error(`Accepted action left the game in unexpected phase "${next.phase}"`);
  }

  assertAbilityLogUniqueness(next);
  const appended = next.shots[shooter]!.slice(pre.shots[shooter]!.length);
  if (action.type === 'salvo') {
    const expectedCount = shotsAllowed(pre, shooter);
    if (appended.length !== expectedCount || appended.some((shot) => shot.volley !== pre.turnNumber)) {
      throw new Error('Salvo shots must match the start-of-turn allowance and volley number');
    }
  } else if (action.type === 'fire') {
    if (pre.settings.mode === 'abilities' && appended.length !== 1) {
      throw new Error('An Abilities-mode fire action must append exactly one shot');
    }
    if (pre.settings.mode === 'classic' && appended.length !== 1) {
      throw new Error('A Classic action must append exactly one shot');
    }
  } else {
    assertAbilityAction(pre, next, events, action, appended);
  }
}

function assertAbilityLogUniqueness(state: CoreState): void {
  for (const player of state.playerIds) {
    for (const abilityId of ABILITY_IDS) {
      const uses = state.abilityLog.filter(
        (entry) => entry.player === player && entry.result.abilityId === abilityId,
      ).length;
      if (uses > 1) throw new Error(`${player} used ${abilityId} more than once`);
    }
  }
}

function assertAbilityAction(
  pre: CoreState,
  next: CoreState,
  events: readonly CoreEvent[],
  action: AbilityAction,
  appended: readonly Shot[],
): void {
  if (abilityStatus(pre, action.player, action.abilityId) !== 'ready') {
    throw new Error(`Ability ${action.abilityId} was not ready before use`);
  }
  if (next.abilityLog.length !== pre.abilityLog.length + 1) {
    throw new Error('An ability action must append exactly one ability log entry');
  }
  const entry = next.abilityLog.at(-1)!;
  if (
    entry.player !== action.player ||
    entry.turnNumber !== pre.turnNumber ||
    entry.result.abilityId !== action.abilityId
  ) {
    throw new Error('Ability log entry does not match the accepted action');
  }
  assertAbilityLogUniqueness(next);
  const usedEvents = events.filter((event) => event.type === 'abilityUsed');
  if (usedEvents.length !== 1) throw new Error('An ability action must emit exactly one abilityUsed event');
  const abilityEvent = usedEvents[0] as Extract<CoreEvent, { type: 'abilityUsed' }>;
  if (
    abilityEvent.player !== action.player ||
    abilityEvent.abilityId !== action.abilityId ||
    abilityEvent.turnNumber !== pre.turnNumber ||
    !deepEqual(abilityEvent.result, entry.result)
  ) {
    throw new Error('abilityUsed event does not match its ability log entry');
  }

  if (action.abilityId === 'submarine-sonar') {
    if (!deepEqual(next.boards, pre.boards) || !deepEqual(next.shots, pre.shots)) {
      throw new Error('Sonar must not change boards or shots');
    }
    const opponent = pre.playerIds.find((uid) => uid !== action.player)!;
    const fleet = pre.boards[opponent]!.fleet!;
    const shipPresent = fleet.some((ship) =>
      cellsOf(ship).some(({ row, col }) =>
        Math.abs(row - action.target.row) <= 1 && Math.abs(col - action.target.col) <= 1,
      ),
    );
    const expected = {
      abilityId: 'submarine-sonar' as const,
      center: action.target,
      shipPresent,
    };
    if (!deepEqual(entry.result, expected)) throw new Error('Sonar result does not match the independent fleet scan');
  } else if (action.abilityId === 'destroyer-relocate') {
    const oldFleet = pre.boards[action.player]!.fleet!;
    const newFleet = next.boards[action.player]!.fleet!;
    const previous = oldFleet.find(({ type }) => type === 'destroyer')!;
    const relocated = newFleet.find(({ type }) => type === 'destroyer')!;
    const opponent = pre.playerIds.find((uid) => uid !== action.player)!;
    const firedAt = new Set(pre.shots[opponent]!.map(({ row, col }) => cellKey(row, col)));
    const oldHits = new Set(pre.boards[action.player]!.hitCells);
    if (cellsOf(previous).some(({ row, col }) => oldHits.has(cellKey(row, col)))) {
      throw new Error('A damaged destroyer cannot be relocated');
    }
    if (
      !cellsOf(relocated).every(({ row, col }) => isOnBoard(row, col)) ||
      deepEqual(previous, relocated) ||
      newFleet
        .filter(({ type }) => type !== 'destroyer')
        .some((ship) => cellsOf(ship).some((cell) => cellsOf(relocated).some((nextCell) => deepEqual(cell, nextCell)))) ||
      cellsOf(relocated).some(({ row, col }) => firedAt.has(cellKey(row, col)))
    ) {
      throw new Error('Relocated destroyer placement violates a relocation invariant');
    }
    if (
      !deepEqual(
        oldFleet.filter(({ type }) => type !== 'destroyer'),
        newFleet.filter(({ type }) => type !== 'destroyer'),
      )
    ) {
      throw new Error('Relocation changed another friendly ship');
    }
    if (!deepEqual(next.shots, pre.shots) || !deepEqual(
      Object.fromEntries(pre.playerIds.map((player) => [player, pre.boards[player]!.hitCells])),
      Object.fromEntries(next.playerIds.map((player) => [player, next.boards[player]!.hitCells])),
    )) {
      throw new Error('Relocation must not change shots or hit cells');
    }
    const expected = { abilityId: 'destroyer-relocate' as const };
    if (!deepEqual(entry.result, expected) || !deepEqual(abilityEvent.result, expected)) {
      throw new Error('Relocation must not reveal the new placement in its result');
    }
  } else {
    const tried = new Set(pre.shots[action.player]!.map(({ row, col }) => cellKey(row, col)));
    const line = Array.from({ length: 3 }, (_, index) => ({
      row: action.target.row + (action.target.horizontal ? 0 : index),
      col: action.target.col + (action.target.horizontal ? index : 0),
    }));
    const expected = line.filter(({ row, col }) => !tried.has(cellKey(row, col)));
    const expectedKeys = new Set(expected.map(({ row, col }) => cellKey(row, col)));
    if (
      appended.length !== expected.length ||
      !setEqual(new Set(appended.map(({ row, col }) => cellKey(row, col))), expectedKeys) ||
      appended.some((shot) => shot.volley !== pre.turnNumber)
    ) {
      throw new Error('Airstrike shots must equal its untried cells in this volley');
    }
    let seenSink = false;
    for (const shot of appended) {
      if (shot.result === 'sunk') seenSink = true;
      else if (seenSink) throw new Error('Airstrike sinking shots must resolve last');
    }
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function assertInvariants(state: CoreState): void {
  if (state.phase === 'playing' && (!state.currentTurn || state.playerIds.filter((uid) => uid === state.currentTurn).length !== 1)) {
    throw new Error('Playing phase must have exactly one current turn');
  }

  for (const shooter of state.playerIds) {
    const shots = state.shots[shooter]!;
    const keys = shots.map((shot) => cellKey(shot.row, shot.col));
    if (new Set(keys).size !== keys.length) throw new Error(`Duplicate shot by ${shooter}`);
    if (shots.length > 100) throw new Error(`More than 100 shots by ${shooter}`);
    const owner = state.playerIds.find((uid) => uid !== shooter)!;
    const expectedHits = shots.filter((shot) => shot.result !== 'miss').map((shot) => cellKey(shot.row, shot.col)).sort();
    const actualHits = [...state.boards[owner]!.hitCells].sort();
    if (!deepEqual(actualHits, expectedHits)) throw new Error(`Hit cells do not match shots for ${owner}`);
  }

  const destroyedOwners: string[] = [];
  for (const owner of state.playerIds) {
    const fleet = state.boards[owner]!.fleet;
    if (!fleet) throw new Error('A playing game must have both fleets');
    const hits = new Set(state.boards[owner]!.hitCells);
    const attacker = state.playerIds.find((uid) => uid !== owner)!;
    for (const ship of fleet) {
      const sunk = cellsOf(ship).every((cell) => hits.has(cellKey(cell.row, cell.col)));
      const sinkEvents = state.shots[attacker]!.filter((shot) => shot.sunkShip === ship.type).length;
      if (sunk !== (sinkEvents === 1)) throw new Error(`Sunk status mismatch for ${owner}'s ${ship.type}`);
    }
    if (isFleetDestroyed(fleet, hits)) destroyedOwners.push(owner);
  }

  if (state.phase === 'playing' && destroyedOwners.length !== 0) throw new Error('Fleet destroyed before game over');
  if (state.phase === 'gameOver') {
    if (state.endReason === 'all_sunk') {
      if (destroyedOwners.length !== 1) throw new Error('All-sunk game must have exactly one destroyed fleet');
      const expectedWinner = state.playerIds.find((uid) => uid !== destroyedOwners[0]);
      if (state.winner !== expectedWinner) throw new Error('Winner must be the opponent of the destroyed fleet owner');
    } else if (state.endReason !== 'resign' && state.endReason !== 'timeout') {
      throw new Error('Game over requires a recognized end reason');
    }
  } else if (state.phase !== 'playing') {
    throw new Error('Simulation left the playing phase unexpectedly');
  }
}
