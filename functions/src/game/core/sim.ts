import { chooseShot } from '../ai';
import { BOT_DIFFICULTIES, type BotDifficulty } from '../bots';
import { cellKey, cellsOf, isFleetDestroyed, randomFleet, type Coordinate } from '../engine';
import { createCoreState, reduce, salvoShotsAllowed } from './reducer';
import { deriveRng } from './rng';
import type { CoreState, GameMode } from './schema';

export interface SimulationOptions {
  randomShotRate?: number;
  illegalActionRate?: number;
  difficulties?: readonly BotDifficulty[];
  mode?: GameMode;
}

export interface SimulationResult {
  state: CoreState;
  moves: number;
  turns: number;
  illegalActions: number;
}

export function simulateGame(seed: number, opts: SimulationOptions = {}): SimulationResult {
  const randomShotRate = opts.randomShotRate ?? 0.5;
  const illegalActionRate = opts.illegalActionRate ?? 0.1;
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
  let previousTurnNumber = state.turnNumber;
  while (state.phase === 'playing') {
    const shooter = state.currentTurn;
    if (!shooter || !state.playerIds.includes(shooter)) throw new Error('A playing game must have one current player');

    if (mode === 'salvo') {
      const allowed = salvoShotsAllowed(state, shooter);
      if (random() < illegalActionRate) {
        const legalTargets = randomTargets(state, shooter, allowed, random);
        const illegalTargets =
          allowed === 1
            ? []
            : [legalTargets[0]!, legalTargets[0]!, ...legalTargets.slice(2)];
        const before = structuredClone(state);
        const rejected = reduce(state, { type: 'salvo', player: shooter, targets: illegalTargets, at: moves });
        if (rejected.ok || !['wrong_shot_count', 'duplicate_target'].includes(rejected.error.code)) {
          throw new Error('Injected illegal Salvo action was not rejected');
        }
        if (JSON.stringify(state) !== JSON.stringify(before)) throw new Error('Illegal Salvo action changed the state');
        illegalActions++;
      }

      const turnNumber = state.turnNumber;
      const shotCount = state.shots[shooter]!.length;
      const targets = randomTargets(state, shooter, allowed, random);
      const result = reduce(state, { type: 'salvo', player: shooter, targets, at: moves + 3 });
      if (!result.ok) throw new Error(`Legal Salvo volley rejected: ${result.error.message}`);
      state = result.state;
      const volley = state.shots[shooter]!.slice(shotCount);
      if (volley.length !== allowed || volley.some((shot) => shot.volley !== turnNumber)) {
        throw new Error('Salvo volley length or turn number did not match the start-of-volley allowance');
      }
      moves += volley.length;
      turns++;
    } else {
      if (random() < illegalActionRate) {
        const previousShot = state.shots[shooter]!.at(-1);
        const illegal = previousShot
          ? {
              type: 'fire' as const,
              player: shooter,
              target: { row: previousShot.row, col: previousShot.col },
              at: moves,
            }
          : {
              type: 'fire' as const,
              player: state.playerIds.find((uid) => uid !== shooter)!,
              target: { row: 0, col: 0 },
              at: moves,
            };
        const before = structuredClone(state);
        const rejected = reduce(state, illegal);
        if (rejected.ok || !['already_fired', 'not_your_turn'].includes(rejected.error.code)) {
          throw new Error('Injected illegal action was not rejected');
        }
        if (JSON.stringify(state) !== JSON.stringify(before)) throw new Error('Illegal action changed the state');
        illegalActions++;
      }

      const tried = new Set(state.shots[shooter]!.map((shot) => cellKey(shot.row, shot.col)));
      let target: Coordinate;
      if (random() < randomShotRate) {
        const available: Coordinate[] = [];
        for (let row = 0; row < state.settings.boardSize; row++) {
          for (let col = 0; col < state.settings.boardSize; col++) {
            if (!tried.has(cellKey(row, col))) available.push({ row, col });
          }
        }
        if (available.length === 0) throw new Error('No legal shots remain');
        target = available[Math.floor(random() * available.length)]!;
      } else {
        const difficulty = difficulties[moves % difficulties.length] ?? 'easy';
        target = chooseShot({
          shots: state.shots[shooter]!,
          boardSize: state.settings.boardSize,
          difficulty,
          rng: deriveRng(seed, 'target', moves),
        });
      }

      const result = reduce(state, { type: 'fire', player: shooter, target, at: moves + 3 });
      if (!result.ok) throw new Error(`Legal shot rejected: ${result.error.message}`);
      state = result.state;
      moves++;
      turns++;
    }

    if (state.turnNumber < previousTurnNumber) throw new Error('Turn number decreased');
    previousTurnNumber = state.turnNumber;
    assertInvariants(state);
  }

  return { state, moves, turns, illegalActions };
}

function randomTargets(state: CoreState, player: string, count: number, random: () => number): Coordinate[] {
  const tried = new Set(state.shots[player]!.map((shot) => cellKey(shot.row, shot.col)));
  const available: Coordinate[] = [];
  for (let row = 0; row < state.settings.boardSize; row++) {
    for (let col = 0; col < state.settings.boardSize; col++) {
      if (!tried.has(cellKey(row, col))) available.push({ row, col });
    }
  }
  if (available.length < count) throw new Error('Not enough legal targets remain for this volley');
  const targets: Coordinate[] = [];
  for (let index = 0; index < count; index++) {
    targets.push(available.splice(Math.floor(random() * available.length), 1)[0]!);
  }
  return targets;
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
    if (JSON.stringify(actualHits) !== JSON.stringify(expectedHits)) throw new Error(`Hit cells do not match shots for ${owner}`);
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
