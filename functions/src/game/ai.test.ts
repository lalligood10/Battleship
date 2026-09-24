import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from './config';
import { BOT_DIFFICULTIES, type BotDifficulty } from './bots';
import { chooseShot, simulateGame } from './ai';
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
