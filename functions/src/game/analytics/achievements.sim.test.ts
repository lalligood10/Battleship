/** Headless check of the achievement rules over seeded simulated games in every mode. */
import { describe, expect, it } from 'vitest';
import { BOT_PROFILES, type BotDifficulty } from '../bots';
import { cellKey, cellsOf } from '../engine';
import { simulateGame } from '../core/sim';
import type { CoreState, GameMode } from '../core/schema';
import { evaluateGameAchievements } from './achievements';
import { gameEndRecord, GAME_MODES, type AchievementId, type AchievementInput, type GameEndSource } from './contract';

// 200/mode takes ~13 s because simulateGame asserts core invariants after every action; 120 keeps the
// file under 10 s. Set ACHIEVEMENT_SIM_GAMES=200 for the full run.
const GAMES_PER_MODE = Math.max(1, Number(process.env.ACHIEVEMENT_SIM_GAMES ?? 120));
const WIN_ONLY: AchievementId[] = ['first-victory', 'last-ship-standing', 'flawless', 'admiral-slayer'];
const DIFFICULTIES: BotDifficulty[] = ['easy', 'medium', 'hard'];

/** Every third game is played as a bot game, with player-two renamed to a bot uid. */
function toSource(state: CoreState, botDifficulty: BotDifficulty | null): GameEndSource {
  const botUid = botDifficulty ? BOT_PROFILES[botDifficulty].uid : null;
  const rename = (uid: string) => (botUid && uid === state.playerIds[1] ? botUid : uid);
  const lost = (uid: string) => {
    const hits = new Set(state.boards[uid]!.hitCells);
    return (state.boards[uid]!.fleet ?? [])
      .filter((ship) => cellsOf(ship).every((c) => hits.has(cellKey(c.row, c.col))))
      .map((ship) => ship.type);
  };
  return {
    mode: state.settings.mode,
    status: 'finished',
    playerUids: state.playerIds.map(rename),
    players: Object.fromEntries(state.playerIds.map((uid) => [rename(uid), { sunkShips: lost(uid) }])),
    shots: Object.fromEntries(state.playerIds.map((uid) => [rename(uid), state.shots[uid]])),
    abilityLog: state.abilityLog.map((e) => ({ ...e, player: rename(e.player) })),
    winnerUid: state.winner ? rename(state.winner) : null,
    endReason: state.endReason,
    isBotGame: botUid !== null,
    botDifficulty,
    startedAt: { toMillis: () => 0 },
    finishedAt: { toMillis: () => state.lastProgressAt },
  };
}

function simulatedInputs(mode: GameMode): AchievementInput[] {
  return Array.from({ length: GAMES_PER_MODE }, (_, i) => {
    const seed = 50_000 + i;
    const { state } = simulateGame(seed, { mode, illegalActionRate: 0 });
    const game = toSource(state, i % 3 === 0 ? DIFFICULTIES[(i / 3) % 3]! : null);
    return { record: gameEndRecord(`sim-${mode}-${seed}`, game)!, game };
  });
}

describe('achievement rules over simulated games', () => {
  for (const mode of GAME_MODES) {
    it(`${mode}: deterministic, mode-gated, never rewards the loser or a bot, unlocks once per player`, () => {
      const inputs = simulatedInputs(mode);
      const unlocked = new Map<string, Set<AchievementId>>();
      const unlocks: string[] = [];
      const counts: Partial<Record<AchievementId, number>> = {};

      for (const input of inputs) {
        expect(input.record).not.toBeNull();
        for (const line of input.record.lines) {
          const ids = evaluateGameAchievements(input, line.uid);
          expect(evaluateGameAchievements(input, line.uid)).toEqual(ids);
          if (line.isBot) expect(ids).toEqual([]);
          if (!line.won) expect(ids.filter((id) => WIN_ONLY.includes(id))).toEqual([]);
          if (mode !== 'salvo') expect(ids).not.toContain('one-volley-sink');
          if (mode !== 'abilities') expect(ids).not.toContain('full-arsenal');
          expect(ids).not.toContain('daily-clear');
          if (ids.includes('admiral-slayer')) expect(input.record.botDifficulty).toBe('hard');

          const have = unlocked.get(line.uid) ?? new Set<AchievementId>();
          for (const id of ids) {
            if (have.has(id)) continue;
            have.add(id);
            unlocks.push(`${line.uid}/${id}`);
            counts[id] = (counts[id] ?? 0) + 1;
          }
          unlocked.set(line.uid, have);
        }
      }

      expect(new Set(unlocks).size).toBe(unlocks.length);
      const perGame: Partial<Record<AchievementId, number>> = {};
      for (const input of inputs) {
        for (const line of input.record.lines) {
          for (const id of evaluateGameAchievements(input, line.uid)) perGame[id] = (perGame[id] ?? 0) + 1;
        }
      }
      console.log(`[achievements sim] ${mode}: ${GAMES_PER_MODE} games; qualifying player-games ${JSON.stringify(perGame)}; first unlocks ${JSON.stringify(counts)}`);
      expect(perGame['first-victory']).toBeGreaterThan(0);
      if (mode === 'salvo') expect(perGame['one-volley-sink']).toBeGreaterThan(0);
      if (mode === 'abilities') expect(perGame['full-arsenal']).toBeGreaterThan(0);
    }, 20_000);
  }
});
