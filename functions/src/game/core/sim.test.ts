import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { simulateGame } from './sim';

describe('headless simulation', () => {
  it('plays seeded games to completion while preserving core invariants', () => {
    const count = Math.max(1, Number(process.env.SIM_GAMES ?? 5));
    const seed = Number(process.env.SIM_SEED ?? 12345) >>> 0;
    const start = performance.now();
    let classicMoves = 0;
    let classicTurns = 0;
    let salvoMoves = 0;
    let salvoTurns = 0;
    let illegalActions = 0;
    for (let i = 0; i < count; i++) {
      const classic = simulateGame((seed + i) >>> 0);
      expect(classic.state.phase).toBe('gameOver');
      expect(classic.state.endReason).toBe('all_sunk');
      expect(classic.state.settings.mode).toBe('classic');
      expect(classic.moves).toBeGreaterThan(0);
      classicMoves += classic.moves;
      classicTurns += classic.turns;
      illegalActions += classic.illegalActions;

      const salvo = simulateGame((seed + count + i) >>> 0, { mode: 'salvo' });
      expect(salvo.state.phase).toBe('gameOver');
      expect(salvo.state.endReason).toBe('all_sunk');
      expect(salvo.state.settings.mode).toBe('salvo');
      expect(salvo.moves).toBeGreaterThan(0);
      expect(salvo.turns).toBeGreaterThan(0);
      salvoMoves += salvo.moves;
      salvoTurns += salvo.turns;
      illegalActions += salvo.illegalActions;
    }
    const elapsedMs = performance.now() - start;
    process.stdout.write(
      `Simulated ${count} Classic games: ${classicMoves} shots, ${Math.round((classicTurns / count) * 100) / 100} average turns; ` +
        `${count} Salvo games: ${salvoMoves} shots, ${Math.round((salvoTurns / count) * 100) / 100} average volley turns; ` +
        `${illegalActions} rejected illegal actions, ${Math.round(elapsedMs)}ms\n`,
    );
    expect(illegalActions).toBeGreaterThan(0);
  }, 120_000);
});
