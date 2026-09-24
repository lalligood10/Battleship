/**
 * Bot targeting AI. Pure and deterministic given an rng so it is unit-testable.
 *
 * The bot reasons only over its OWN shot history (`game.shots[botUid]`) – the same
 * information a human opponent sees (results, sunkShip, sunkPlacement). It never
 * reads the other player's fleet.
 */
import { GAME_CONFIG, SHIP_LENGTHS, SHIP_TYPES } from './config';
import {
  cellKey,
  cellsOf,
  isFleetDestroyed,
  isOnBoard,
  resolveShot,
  type Coordinate,
  type ShipPlacement,
  type Shot,
} from './engine';
import type { BotDifficulty } from './bots';

export interface AiInput {
  /** The bot's own previous shots, in order. */
  shots: Shot[];
  boardSize: number;
  difficulty: BotDifficulty;
  rng: () => number;
}

interface AiState {
  tried: ReadonlySet<string>;
  /** Hit cells belonging to ships not yet sunk. */
  unresolved: Coordinate[];
  /** Lengths of ships still afloat. */
  remaining: number[];
  /** Cells belonging to already-sunk ships. */
  sunk: ReadonlySet<string>;
}

const key = (c: Coordinate) => cellKey(c.row, c.col);

function analyse(shots: Shot[]): AiState {
  const tried = new Set<string>();
  const sunk = new Set<string>();
  const sunkTypes = new Set<string>();
  const hits: Coordinate[] = [];
  for (const s of shots) {
    tried.add(cellKey(s.row, s.col));
    if (s.result === 'miss') continue;
    hits.push({ row: s.row, col: s.col });
    if (s.sunkShip) {
      sunkTypes.add(s.sunkShip);
      for (const c of cellsOf(s.sunkPlacement ?? { type: s.sunkShip, row: s.row, col: s.col, horizontal: true })) {
        sunk.add(cellKey(c.row, c.col));
      }
    }
  }
  const unresolved = hits.filter((c) => !sunk.has(key(c)));
  const remaining = SHIP_TYPES.filter((t) => !sunkTypes.has(t)).map((t) => SHIP_LENGTHS[t]);
  return { tried, unresolved, remaining, sunk };
}

const pick = <T>(items: T[], rng: () => number): T => items[Math.floor(rng() * items.length)]!;

/**
 * Can a ship of length `len` occupy a run of cells through `cell` along `dir` such that every
 * covered cell is either untried or an unresolved hit (never a miss or a sunk cell)?
 */
function fitsThrough(cell: Coordinate, len: number, dir: 'h' | 'v', state: AiState): boolean {
  const dr = dir === 'v' ? 1 : 0;
  const dc = dir === 'h' ? 1 : 0;
  for (let start = 0; start < len; start++) {
    let ok = true;
    for (let i = 0; i < len; i++) {
      const r = cell.row + (i - start) * dr;
      const c = cell.col + (i - start) * dc;
      // Blocked by a miss or a sunk-ship cell; allowed if untried or an unresolved hit.
      if (!isOnBoard(r, c) || !isOpen(state, r, c)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function isUnresolved(state: AiState, row: number, col: number): boolean {
  return state.unresolved.some((u) => u.row === row && u.col === col);
}

/** True when `cell` is either untried or an unresolved hit. */
function isOpen(state: AiState, row: number, col: number): boolean {
  return !state.tried.has(cellKey(row, col)) || isUnresolved(state, row, col);
}

function fitsAny(cell: Coordinate, state: AiState): boolean {
  for (const len of state.remaining) {
    for (let start = 0; start < len; start++) {
      for (const dir of ['h', 'v'] as const) {
        const dr = dir === 'v' ? 1 : 0;
        const dc = dir === 'h' ? 1 : 0;
        let ok = true;
        for (let i = 0; i < len; i++) {
          const r = cell.row + (i - start) * dr;
          const c = cell.col + (i - start) * dc;
          if (!isOnBoard(r, c) || !isOpen(state, r, c)) {
            ok = false;
            break;
          }
        }
        if (ok) return true;
      }
    }
  }
  return false;
}

/**
 * Lines of two or more adjacent unresolved hits sharing a row or column. Returns the untried
 * cells at each end of every such line plus the axis, so hard mode can prefer lines a remaining
 * ship still fits along.
 */
function lineEnds(state: AiState): { cell: Coordinate; dir: 'h' | 'v' }[] {
  const ends: { cell: Coordinate; dir: 'h' | 'v' }[] = [];

  const scan = (horizontal: boolean) => {
    // Group unresolved hits into runs along the axis.
    const lines = new Map<number, number[]>();
    for (const u of state.unresolved) {
      const fixed = horizontal ? u.row : u.col;
      const along = horizontal ? u.col : u.row;
      const line = lines.get(fixed) ?? [];
      line.push(along);
      lines.set(fixed, line);
    }
    for (const [fixed, alongs] of lines) {
      alongs.sort((a, b) => a - b);
      let run = [alongs[0]!];
      const flush = () => {
        if (run.length >= 2) {
          for (const end of [run[0]! - 1, run[run.length - 1]! + 1]) {
            const row = horizontal ? fixed : end;
            const col = horizontal ? end : fixed;
            if (isOnBoard(row, col) && !state.tried.has(cellKey(row, col))) {
              ends.push({ cell: { row, col }, dir: horizontal ? 'h' : 'v' });
            }
          }
        }
        run = [];
      };
      for (let i = 1; i < alongs.length; i++) {
        if (alongs[i] === run[run.length - 1]! + 1) run.push(alongs[i]!);
        else {
          flush();
          run = [alongs[i]!];
        }
      }
      flush();
    }
  };
  scan(true);
  scan(false);
  return ends;
}

/** Orthogonal neighbours of any unresolved hit that are on-board and untried. */
function neighbourCandidates(state: AiState): Coordinate[] {
  const out = new Map<string, Coordinate>();
  for (const u of state.unresolved) {
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const row = u.row + dr;
      const col = u.col + dc;
      const k = cellKey(row, col);
      if (isOnBoard(row, col) && !state.tried.has(k)) out.set(k, { row, col });
    }
  }
  return [...out.values()];
}

/** Target mode: shots that follow up on unresolved hits. Shared by medium and hard. */
function targetCandidates(state: AiState, hard: boolean): Coordinate[] {
  const ends = lineEnds(state);
  if (ends.length > 0) {
    if (hard) {
      // Prefer line ends where a remaining ship can still span the hit run.
      const preferred = ends.filter((e) =>
        state.remaining.some((len) => fitsThrough(e.cell, len, e.dir, state)),
      );
      if (preferred.length > 0) return preferred.map((e) => e.cell);
    }
    return ends.map((e) => e.cell);
  }
  return neighbourCandidates(state);
}

/** Hunt mode: untried cells, optionally parity-filtered and ship-fit filtered (hard). */
function huntCandidates(state: AiState, n: number, hard: boolean): Coordinate[] {
  let cells: Coordinate[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!state.tried.has(cellKey(row, col))) cells.push({ row, col });
    }
  }
  if (!hard || cells.length === 0) return cells;

  const minLen = Math.min(...state.remaining);
  const parity = cells.filter((c) => (c.row + c.col) % minLen === 0);
  if (parity.length > 0) cells = parity;

  const fitting = cells.filter((c) => fitsAny(c, state));
  if (fitting.length > 0) return fitting;
  return cells;
}

/**
 * Chooses the bot's next target. Never returns a cell already fired at;
 * throws only when no untried cell remains.
 */
export function chooseShot(input: AiInput): Coordinate {
  const { shots, boardSize, difficulty, rng } = input;
  const n = boardSize ?? GAME_CONFIG.BOARD_SIZE;
  const state = analyse(shots);

  if (difficulty !== 'easy' && state.unresolved.length > 0) {
    const targets = targetCandidates(state, difficulty === 'hard');
    if (targets.length > 0) return pick(targets, rng);
  }
  const hunt = huntCandidates(state, n, difficulty === 'hard');
  if (hunt.length === 0) throw new Error('No untried cells remain');
  return pick(hunt, rng);
}

/**
 * Fires until `fleet` is sunk, returning the number of shots taken. Used by tests to compare
 * the difficulty levels over many random boards.
 */
export function simulateGame(difficulty: BotDifficulty, fleet: ShipPlacement[], rng: () => number): number {
  const shots: Shot[] = [];
  const hitCells = new Set<string>();
  const n = GAME_CONFIG.BOARD_SIZE;
  while (!isFleetDestroyed(fleet, hitCells)) {
    const target = chooseShot({ shots, boardSize: n, difficulty, rng });
    const outcome = resolveShot(fleet, hitCells, target);
    const shot: Shot = { ...target, result: outcome.result, at: shots.length };
    if (outcome.result !== 'miss') hitCells.add(cellKey(target.row, target.col));
    if (outcome.sunkShip) {
      shot.sunkShip = outcome.sunkShip;
      shot.sunkPlacement = fleet.find((s) => s.type === outcome.sunkShip);
    }
    shots.push(shot);
  }
  return shots.length;
}
