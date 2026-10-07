import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from './config';
import { BOT_DIFFICULTIES, type BotDifficulty } from './bots';
import { chooseAbilityAction, chooseShot, simulateGame } from './ai';
import type { AbilityLogEntry } from './core/modes/types';
import { cellKey, cellsOf, randomFleet, type Coordinate, type ShipPlacement, type Shot } from './engine';

/** Deterministic rng so tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = GAME_CONFIG.BOARD_SIZE;

const neighbours = (c: Coordinate): Coordinate[] =>
  [
    { row: c.row - 1, col: c.col },
    { row: c.row + 1, col: c.col },
    { row: c.row, col: c.col - 1 },
    { row: c.row, col: c.col + 1 },
  ].filter((x) => x.row >= 0 && x.row < N && x.col >= 0 && x.col < N);

describe('chooseShot', () => {
  it.each(BOT_DIFFICULTIES)('%s: terminates on a random fleet and never repeats a cell', (difficulty) => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = mulberry32(seed);
      const fleet = randomFleet(rng);
      const shots: Shot[] = [];
      const hitCells = new Set<string>();
      const fleetCells = new Set(fleet.flatMap((s) => cellsOf(s)).map((c) => cellKey(c.row, c.col)));
      while (fleetCells.size > hitCells.size) {
        const target = chooseShot({ shots, boardSize: N, difficulty, rng });
        const k = cellKey(target.row, target.col);
        expect(shots.some((s) => cellKey(s.row, s.col) === k)).toBe(false);
        const result = fleetCells.has(k) ? 'hit' : 'miss';
        if (result === 'hit') hitCells.add(k);
        shots.push({ ...target, result, at: shots.length });
      }
      expect(shots.length).toBeLessThanOrEqual(N * N);
    }
  });

  it('excludes cells chosen earlier in the same volley without adding their results to history', () => {
    const exclude = new Set<string>();
    const shots: Shot[] = [];
    for (let i = 0; i < 5; i++) {
      const target = chooseShot({
        shots,
        boardSize: N,
        difficulty: 'easy',
        rng: () => 0,
        exclude,
      });
      const key = cellKey(target.row, target.col);
      expect(exclude.has(key)).toBe(false);
      exclude.add(key);
    }
    expect(shots).toEqual([]);
  });

  it('medium: after a hit, fires orthogonally adjacent until the ship sinks', () => {
    const rng = mulberry32(7);
    const shots: Shot[] = [{ row: 4, col: 4, result: 'hit', at: 0 }];
    const next = chooseShot({ shots, boardSize: N, difficulty: 'medium', rng });
    expect(neighbours({ row: 4, col: 4 }).some((c) => c.row === next.row && c.col === next.col)).toBe(true);

    // Hit again adjacent: now the line is known, it must extend along it and sink a destroyer.
    const hits: Coordinate[] = [
      { row: 4, col: 4 },
      { row: 4, col: 5 },
    ];
    const history: Shot[] = hits.map((c, i) => ({ ...c, result: 'hit', at: i }));
    const follow = chooseShot({ shots: history, boardSize: N, difficulty: 'medium', rng });
    expect([{ row: 4, col: 3 }, { row: 4, col: 6 }]).toContainEqual(follow);
  });

  it('hard: never targets a cell that cannot contain a remaining ship', () => {
    // Only the carrier (length 5) remains. Everything except column 0 rows 0-3 and the rest of
    // the board is tried: leave a 1x5 gap too short for the carrier and one full column open.
    const shots: Shot[] = [];
    const keep = new Set<string>([
      // Column 9 rows 0-4: a vertical run of 5 that CAN hold the carrier.
      ...[0, 1, 2, 3, 4].map((r) => cellKey(r, 9)),
      // Cell (7,7) is untried but boxed in by misses on all sides: carrier cannot fit.
      cellKey(7, 7),
    ]);
    let at = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (keep.has(cellKey(r, c))) continue;
        shots.push({ row: r, col: c, result: 'miss', at: at++ });
      }
    }
    // Sink everything except the carrier so remaining = [5].
    const sunkTypes = ['battleship', 'cruiser', 'submarine', 'destroyer'] as const;
    for (const t of sunkTypes) {
      const p: ShipPlacement = { type: t, row: 0, col: 0, horizontal: true };
      shots.push({ row: 0, col: 0, result: 'sunk', sunkShip: t, sunkPlacement: p, at: at++ });
    }
    const rng = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      const target = chooseShot({ shots, boardSize: N, difficulty: 'hard', rng });
      expect(target.col === 9 && target.row <= 4).toBe(true);
    }
  });
});

describe('simulateGame', () => {
  it('ranks hard < medium < easy in mean shots over 200 seeded games', () => {
    const means: Record<BotDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
    const games = 200;
    for (const difficulty of BOT_DIFFICULTIES) {
      let total = 0;
      for (let seed = 0; seed < games; seed++) {
        const rng = mulberry32(seed * 2654435761 + difficulty.length);
        const fleet = randomFleet(rng);
        total += simulateGame(difficulty, fleet, rng);
      }
      means[difficulty] = total / games;
    }
    expect(means.hard).toBeLessThan(means.medium);
    expect(means.medium).toBeLessThan(means.easy);
    expect(means.easy).toBeGreaterThan(80);
    expect(means.hard).toBeLessThan(65);
    console.log(`simulation means: easy=${means.easy.toFixed(1)} medium=${means.medium.toFixed(1)} hard=${means.hard.toFixed(1)}`);
  });
});

describe('chooseAbilityAction', () => {
  const choose = (
    overrides: Partial<Parameters<typeof chooseAbilityAction>[0]> = {},
  ) =>
    chooseAbilityAction({
      uid: 'bot-hard',
      shots: [],
      opponentShots: [],
      abilityLog: [],
      turnNumber: 1,
      boardSize: N,
      difficulty: 'hard',
      rng: () => 0,
      ...overrides,
    });

  it('keeps easy bots to normal shots even with an unresolved hit', () => {
    const action = choose({
      difficulty: 'easy',
      shots: [{ row: 4, col: 4, result: 'hit', at: 0 }],
    });
    expect(action.type).toBe('fire');
  });

  it('uses a carrier airstrike when an unresolved hit has a legal line with two untried cells', () => {
    const hit = { row: 4, col: 4 };
    const action = choose({
      difficulty: 'medium',
      shots: [{ ...hit, result: 'hit', at: 0 }],
    });
    expect(action).toMatchObject({ type: 'ability', abilityId: 'carrier-airstrike' });
    if (action.type !== 'ability' || action.abilityId !== 'carrier-airstrike') return;

    const cells = Array.from({ length: 3 }, (_, index) => ({
      row: action.target.row + (action.target.horizontal ? 0 : index),
      col: action.target.col + (action.target.horizontal ? index : 0),
    }));
    expect(cells.every((cell) => cell.row >= 0 && cell.row < N && cell.col >= 0 && cell.col < N)).toBe(true);
    expect(cells.filter((cell) => !(cell.row === hit.row && cell.col === hit.col)).length).toBeGreaterThanOrEqual(2);
    expect(cells.some((cell) => Math.abs(cell.row - hit.row) + Math.abs(cell.col - hit.col) <= 1)).toBe(true);
  });

  it('does not use a carrier airstrike after the bot carrier has sunk or it was already used', () => {
    const shots: Shot[] = [{ row: 4, col: 4, result: 'hit', at: 0 }];
    const carrierSunk = choose({
      difficulty: 'medium',
      shots,
      opponentShots: [{ row: 0, col: 0, result: 'sunk', sunkShip: 'carrier', at: 2 }],
    });
    const alreadyUsed: AbilityLogEntry[] = [
      { player: 'bot-hard', turnNumber: 2, result: { abilityId: 'carrier-airstrike', cells: [] } },
    ];
    const used = choose({ difficulty: 'medium', shots, abilityLog: alreadyUsed });
    expect(carrierSunk.type).toBe('fire');
    expect(used.type).toBe('fire');
  });

  it('uses sonar on a hard bot hunting from turn six and chooses the center with most untried cells', () => {
    const action = choose({ turnNumber: 6 });
    expect(action).toMatchObject({ type: 'ability', abilityId: 'submarine-sonar' });
    if (action.type !== 'ability' || action.abilityId !== 'submarine-sonar') return;
    expect(action.target.row).toBeGreaterThanOrEqual(1);
    expect(action.target.row).toBeLessThanOrEqual(8);
    expect(action.target.col).toBeGreaterThanOrEqual(1);
    expect(action.target.col).toBeLessThanOrEqual(8);
  });

  it('prefers untried cells inside a positive sonar area while hunting', () => {
    const log: AbilityLogEntry[] = [
      {
        player: 'bot-hard',
        turnNumber: 6,
        result: { abilityId: 'submarine-sonar', center: { row: 4, col: 4 }, shipPresent: true },
      },
    ];
    const action = choose({ turnNumber: 7, abilityLog: log });
    expect(action.type).toBe('fire');
    if (action.type !== 'fire') return;
    expect(Math.abs(action.target.row - 4)).toBeLessThanOrEqual(1);
    expect(Math.abs(action.target.col - 4)).toBeLessThanOrEqual(1);
  });

  it('excludes a negative sonar area from hard-mode hunting', () => {
    const log: AbilityLogEntry[] = [
      {
        player: 'bot-hard',
        turnNumber: 6,
        result: { abilityId: 'submarine-sonar', center: { row: 0, col: 0 }, shipPresent: false },
      },
    ];
    const action = choose({ turnNumber: 7, abilityLog: log });
    expect(action.type).toBe('fire');
    if (action.type !== 'fire') return;
    expect(action.target.row <= 1 && action.target.col <= 1).toBe(false);
  });

  it('waits until turn six to use sonar and does not use it after the submarine sinks', () => {
    const tooEarly = choose({ turnNumber: 5 });
    const submarineSunk = choose({
      turnNumber: 6,
      opponentShots: [{ row: 0, col: 0, result: 'sunk', sunkShip: 'submarine', at: 2 }],
    });
    expect(tooEarly.type).toBe('fire');
    expect(submarineSunk.type).toBe('fire');
  });
});
