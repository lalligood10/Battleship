import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { simulateGame } from './sim';

describe('headless simulation', () => {
  it('plays seeded games to completion while preserving core invariants', () => {
    const count = Math.max(1, Number(process.env.SIM_GAMES ?? 5));
    const seed = Number(process.env.SIM_SEED ?? 12345) >>> 0;
    const start = performance.now();
    let moves = 0;
    let illegalActions = 0;
    for (let i = 0; i < count; i++) {
      const result = simulateGame((seed + i) >>> 0);
      expect(result.state.phase).toBe('gameOver');
      expect(result.state.endReason).toBe('all_sunk');
      expect(result.moves).toBeGreaterThan(0);
      moves += result.moves;
      illegalActions += result.illegalActions;
    }
    const elapsedMs = performance.now() - start;
    process.stdout.write(
      `Simulated ${count} games: ${moves} moves, ${Math.round((moves / count) * 100) / 100} average turns, ${illegalActions} rejected illegal actions, ${Math.round(elapsedMs)}ms\n`,
    );
    expect(illegalActions).toBeGreaterThan(0);
  }, 120_000);
});
