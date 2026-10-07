import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { reduce, createCoreState } from './reducer';
import { playerView, simulateGame } from './sim';
import type { GameMode } from './schema';
import type { ShipPlacement } from '../engine';

const SIM_MODES: GameMode[] = parseModes(process.env.SIM_MODES);
const ABILITY_IDS = ['carrier-airstrike', 'submarine-sonar', 'destroyer-relocate'] as const;

function parseModes(value: string | undefined): GameMode[] {
  const modes = (value || 'classic,salvo,abilities').split(',').map((mode) => mode.trim()).filter(Boolean);
  const knownModes = new Set<GameMode>(['classic', 'salvo', 'abilities']);
  const unknown = modes.filter((mode) => !knownModes.has(mode as GameMode));
  if (unknown.length > 0) throw new Error(`Unknown simulation mode: ${unknown.join(', ')}`);
  if (modes.length === 0) throw new Error('SIM_MODES must include at least one mode');
  return modes as GameMode[];
}

function fleet(placements: readonly ShipPlacement[]): ShipPlacement[] {
  return placements.map((placement) => ({ ...placement }));
}

describe('headless simulation', () => {
  for (const [modeIndex, mode] of SIM_MODES.entries()) {
    it(`plays seeded ${mode} games to completion while preserving core invariants`, () => {
      const count = Math.max(1, Number(process.env.SIM_GAMES ?? 5));
      const seed = Number(process.env.SIM_SEED ?? 12345) >>> 0;
      const start = performance.now();
      let totalShots = 0;
      let totalTurns = 0;
      let rejectedActions = 0;
      const abilityUses = Object.fromEntries(ABILITY_IDS.map((abilityId) => [abilityId, 0])) as Record<
        (typeof ABILITY_IDS)[number],
        number
      >;

      for (let index = 0; index < count; index++) {
        const result = simulateGame((seed + modeIndex * count + index) >>> 0, { mode });
        expect(result.state.phase).toBe('gameOver');
        expect(result.state.endReason).toBe('all_sunk');
        expect(result.state.settings.mode).toBe(mode);
        expect(result.moves).toBeGreaterThan(0);
        expect(result.turns).toBeGreaterThan(0);
        totalShots += result.moves;
        totalTurns += result.turns;
        rejectedActions += result.illegalActions;
        for (const abilityId of ABILITY_IDS) abilityUses[abilityId] += result.abilityUses[abilityId];
      }

      const elapsedMs = performance.now() - start;
      const average = (value: number) => Math.round((value / count) * 100) / 100;
      process.stdout.write(
        `${mode}: ${count} games, ${average(totalTurns)} average turns, ${average(totalShots)} average shots, ` +
          `${rejectedActions} rejected illegal actions, ability uses by type: ` +
          `${ABILITY_IDS.map((abilityId) => `${abilityId}=${abilityUses[abilityId]}`).join(', ')}, ` +
          `${Math.round(elapsedMs)}ms\n`,
      );
      expect(rejectedActions).toBeGreaterThan(0);
    }, 120_000);
  }

  it('does not expose the opponent fleet in a player view', () => {
    const ownFleet = fleet([
      { type: 'carrier', row: 0, col: 0, horizontal: true },
      { type: 'battleship', row: 2, col: 0, horizontal: true },
      { type: 'cruiser', row: 4, col: 0, horizontal: true },
      { type: 'submarine', row: 6, col: 0, horizontal: true },
      { type: 'destroyer', row: 8, col: 0, horizontal: true },
    ]);
    const opponentFleet = fleet([
      { type: 'carrier', row: 0, col: 7, horizontal: false },
      { type: 'battleship', row: 0, col: 9, horizontal: false },
      { type: 'cruiser', row: 5, col: 2, horizontal: true },
      { type: 'submarine', row: 7, col: 3, horizontal: true },
      { type: 'destroyer', row: 9, col: 0, horizontal: true },
    ]);
    let state = createCoreState({ playerIds: ['player-one', 'player-two'], seed: 1, mode: 'classic' });
    for (const [player, placedFleet] of [
      ['player-one', ownFleet],
      ['player-two', opponentFleet],
    ] as const) {
      const placement = reduce(state, { type: 'placeFleet', player, fleet: placedFleet });
      if (!placement.ok) throw new Error(`Test fleet rejected: ${placement.error.message}`);
      state = placement.state;
    }

    const view = playerView(state, 'player-one');
    const serialized = JSON.stringify(view);
    expect(view).not.toHaveProperty('boards');
    for (const placement of opponentFleet) {
      expect(serialized).not.toContain(JSON.stringify(placement));
    }
  });
});
