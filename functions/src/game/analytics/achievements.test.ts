import { describe, expect, it } from 'vitest';
import type { ShipType } from '../config';
import type { AbilityLogEntry } from '../core/modes/types';
import type { ShipPlacement, Shot } from '../engine';
import { evaluateGameAchievements, hasFullArsenal, hasOneVolleySink } from './achievements';
import { gameEndRecord, type AchievementInput, type GameEndSource } from './contract';

const ts = (ms: number) => ({ toMillis: () => ms });
const shot = (row: number, col: number, result: Shot['result'], extra: Partial<Shot> = {}): Shot => ({
  row,
  col,
  result,
  at: 0,
  ...extra,
});
const DESTROYER: ShipPlacement = { type: 'destroyer', row: 0, col: 0, horizontal: true };
const ALL_SHIPS: ShipType[] = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'];

function source(overrides: Partial<GameEndSource> = {}): GameEndSource {
  return {
    mode: 'classic',
    status: 'finished',
    playerUids: ['alice', 'bob'],
    players: {
      alice: { username: 'Alice', sunkShips: ['destroyer'] },
      bob: { username: 'Bob', sunkShips: ALL_SHIPS },
    },
    shots: { alice: [shot(0, 0, 'hit')], bob: [shot(1, 1, 'miss')] },
    winnerUid: 'alice',
    endReason: 'all_sunk',
    startedAt: ts(0),
    finishedAt: ts(1),
    ...overrides,
  };
}

function input(overrides: Partial<GameEndSource> = {}): AchievementInput {
  const game = source(overrides);
  return { record: gameEndRecord('g1', game)!, game };
}

const ability = (player: string, abilityId: AbilityLogEntry['result']['abilityId'], turnNumber: number): AbilityLogEntry =>
  ({ player, turnNumber, result: abilityId === 'destroyer-relocate' ? { abilityId } : abilityId === 'submarine-sonar' ? { abilityId, center: { row: 0, col: 0 }, shipPresent: false } : { abilityId, cells: [] } }) as AbilityLogEntry;

describe('win achievements', () => {
  it('first-victory: a sink win qualifies, the loser does not', () => {
    expect(evaluateGameAchievements(input(), 'alice')).toContain('first-victory');
    expect(evaluateGameAchievements(input(), 'bob')).toEqual([]);
  });

  it('a resign or timeout win gives nothing', () => {
    for (const endReason of ['resign', 'timeout'] as const) {
      const i = input({ endReason, players: { alice: { sunkShips: [] }, bob: { sunkShips: [] } } });
      expect(evaluateGameAchievements(i, 'alice')).toEqual([]);
    }
  });

  it('last-ship-standing needs exactly one ship afloat', () => {
    const four = input({ players: { alice: { sunkShips: ['carrier', 'battleship', 'cruiser', 'submarine'] }, bob: { sunkShips: ALL_SHIPS } } });
    expect(evaluateGameAchievements(four, 'alice')).toContain('last-ship-standing');
    expect(evaluateGameAchievements(input(), 'alice')).not.toContain('last-ship-standing');
  });

  it('flawless needs no ships lost', () => {
    const clean = input({ players: { alice: { sunkShips: [] }, bob: { sunkShips: ALL_SHIPS } } });
    expect(evaluateGameAchievements(clean, 'alice')).toEqual(['first-victory', 'flawless']);
    expect(evaluateGameAchievements(input(), 'alice')).not.toContain('flawless');
  });

  it('admiral-slayer needs a sink win over the hard bot', () => {
    const bot = (botDifficulty: 'easy' | 'medium' | 'hard', endReason: 'all_sunk' | 'resign' = 'all_sunk') =>
      input({
        playerUids: ['alice', 'bot-admiral'],
        players: { alice: { sunkShips: ['destroyer'] }, 'bot-admiral': { sunkShips: ALL_SHIPS } },
        shots: { alice: [], 'bot-admiral': [] },
        isBotGame: true,
        botDifficulty,
        endReason,
      });
    expect(evaluateGameAchievements(bot('hard'), 'alice')).toEqual(['first-victory', 'admiral-slayer']);
    expect(evaluateGameAchievements(bot('medium'), 'alice')).toEqual(['first-victory']);
    expect(evaluateGameAchievements(bot('hard', 'resign'), 'alice')).toEqual([]);
    expect(evaluateGameAchievements(input({ botDifficulty: 'hard' }), 'alice')).not.toContain('admiral-slayer');
  });

  it('bot players never qualify', () => {
    const i = input({
      playerUids: ['alice', 'bot-admiral'],
      players: { alice: { sunkShips: ALL_SHIPS }, 'bot-admiral': { sunkShips: [] } },
      shots: { alice: [], 'bot-admiral': [] },
      winnerUid: 'bot-admiral',
      isBotGame: true,
      botDifficulty: 'hard',
    });
    expect(evaluateGameAchievements(i, 'bot-admiral')).toEqual([]);
  });

  it('a uid not in the game gets nothing', () => {
    expect(evaluateGameAchievements(input(), 'carol')).toEqual([]);
  });
});

describe('one-volley-sink', () => {
  const volleyShots = (secondVolley: number) => [
    shot(0, 0, 'hit', { volley: 1 }),
    shot(0, 1, 'sunk', { volley: secondVolley, sunkShip: 'destroyer', sunkPlacement: DESTROYER }),
  ];

  it('qualifies when every cell of the sunk ship was hit in the same volley, even when losing', () => {
    const i = input({ mode: 'salvo', winnerUid: 'bob', shots: { alice: volleyShots(1), bob: [] } });
    expect(hasOneVolleySink(i, 'alice')).toBe(true);
    expect(evaluateGameAchievements(i, 'alice')).toEqual(['one-volley-sink']);
  });

  it('does not qualify when the hits span volleys', () => {
    expect(hasOneVolleySink(input({ mode: 'salvo', shots: { alice: volleyShots(2), bob: [] } }), 'alice')).toBe(false);
  });

  it('is Salvo only', () => {
    expect(hasOneVolleySink(input({ mode: 'classic', shots: { alice: volleyShots(1), bob: [] } }), 'alice')).toBe(false);
  });

  it('ignores a sunk shot without a placement', () => {
    const shots = [shot(0, 0, 'hit', { volley: 1 }), shot(0, 1, 'sunk', { volley: 1, sunkShip: 'destroyer' })];
    expect(hasOneVolleySink(input({ mode: 'salvo', shots: { alice: shots, bob: [] } }), 'alice')).toBe(false);
  });
});

describe('full-arsenal', () => {
  const all = [ability('alice', 'carrier-airstrike', 1), ability('alice', 'submarine-sonar', 3), ability('alice', 'destroyer-relocate', 5)];

  it('qualifies when all three abilities were used, win not required', () => {
    const i = input({ mode: 'abilities', winnerUid: 'bob', abilityLog: all });
    expect(hasFullArsenal(i, 'alice')).toBe(true);
    expect(evaluateGameAchievements(i, 'alice')).toEqual(['full-arsenal']);
  });

  it('needs every ability, used by this player', () => {
    expect(hasFullArsenal(input({ mode: 'abilities', abilityLog: all.slice(0, 2) }), 'alice')).toBe(false);
    expect(hasFullArsenal(input({ mode: 'abilities', abilityLog: all }), 'bob')).toBe(false);
    const mixed = [all[0]!, all[1]!, ability('bob', 'destroyer-relocate', 2)];
    expect(hasFullArsenal(input({ mode: 'abilities', abilityLog: mixed }), 'alice')).toBe(false);
  });

  it('is Abilities only', () => {
    expect(hasFullArsenal(input({ mode: 'classic', abilityLog: all }), 'alice')).toBe(false);
  });
});
