import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { RETENTION_PATHS, type HeadToHeadDoc, type PlayerStatsDoc } from '../src/game/analytics/contract';
import type { Shot } from '../src/game/engine';
import { setUsername } from '../src/handlers/users';
import { db, refs } from '../src/lib/firestore';
import { processGameEnd } from '../src/triggers/gameEnd';
import { achievementsConsumer } from '../src/triggers/gameEnd/achievements';
import { headToHeadConsumer, statsConsumer } from '../src/triggers/gameEnd/stats';
import type { GameEndConsumer } from '../src/triggers/gameEnd';
import type { GameDoc, GamePlayer } from '../src/types';
import { clearFirestore } from './setup';

const ALICE = 'uid-p5-alice';
const BOB = 'uid-p5-bob';
const BOT = 'bot-hard';
const CONSUMERS = [statsConsumer, headToHeadConsumer];
const NOW = 1_800_000_000_000;

const shot = (row: number, col: number, result: Shot['result']): Shot =>
  ({ row, col, result, at: Timestamp.fromMillis(NOW) }) as unknown as Shot;

function player(username: string, sunkShips: GamePlayer['sunkShips'], shotsFired: number, hits: number): GamePlayer {
  return { username, sunkShips, shotsFired, hits, ready: true } as unknown as GamePlayer;
}

function finishedGame(overrides: Partial<GameDoc> = {}): GameDoc {
  const t = Timestamp.fromMillis(NOW);
  return {
    code: 'ABC123',
    status: 'finished',
    mode: 'classic',
    hostUid: ALICE,
    playerUids: [ALICE, BOB],
    players: {
      [ALICE]: player('P5Alice', ['destroyer'], 3, 2),
      [BOB]: player('P5Bob', ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'], 2, 1),
    },
    shots: { [ALICE]: [shot(0, 0, 'hit'), shot(0, 1, 'sunk'), shot(9, 9, 'miss')], [BOB]: [shot(1, 1, 'hit'), shot(2, 2, 'miss')] },
    currentTurnUid: null,
    turnNumber: 5,
    winnerUid: ALICE,
    endReason: 'all_sunk',
    ratingChanges: null,
    revealedFleets: null,
    isQuickMatch: false,
    isBotGame: false,
    botDifficulty: null,
    abandonTimeoutMs: 0,
    createdAt: t,
    updatedAt: t,
    startedAt: Timestamp.fromMillis(NOW - 60_000),
    finishedAt: t,
    lastMoveAt: t,
    ...overrides,
  };
}

const stats = async (uid: string) => (await db.doc(RETENTION_PATHS.playerStats(uid)).get()).data() as PlayerStatsDoc | undefined;
const h2h = async () => (await db.doc(RETENTION_PATHS.headToHead(ALICE, BOB)).get()).data() as HeadToHeadDoc | undefined;

beforeEach(async () => {
  await clearFirestore();
  await setUsername(ALICE, { username: 'P5Alice' });
  await setUsername(BOB, { username: 'P5Bob' });
});

describe('Phase 5 stats + head-to-head consumers', () => {
  it('updates per-mode stats and head-to-head after one game', async () => {
    await processGameEnd('g1', finishedGame(), CONSUMERS, NOW);

    const a = (await stats(ALICE))!;
    expect(a.uid).toBe(ALICE);
    expect(a.updatedAtMs).toBe(NOW);
    expect(a.pvp.classic).toMatchObject({ gamesPlayed: 1, wins: 1, losses: 0, shotsFired: 3, hits: 2, shipsLost: 1, shipsSunk: 5, sinkWins: 1, sinkWinTurns: 3 });
    expect(a.pvp.salvo.gamesPlayed).toBe(0);
    expect(a.bot.classic.gamesPlayed).toBe(0);
    const b = (await stats(BOB))!;
    expect(b.pvp.classic).toMatchObject({ gamesPlayed: 1, wins: 0, losses: 1, sinkWins: 0 });
    expect(b.pvp.classic.lossesByReason.all_sunk).toBe(1);

    const h = (await h2h())!;
    expect(h).toMatchObject({ gamesPlayed: 1, lastGameId: 'g1', lastWinnerUid: ALICE, lastPlayedAtMs: NOW });
    expect(h.playerUids).toEqual([ALICE, BOB].sort());
    expect(h.wins).toEqual({ [ALICE]: 1, [BOB]: 0 });
    expect(h.usernames).toEqual({ [ALICE]: 'P5Alice', [BOB]: 'P5Bob' });

    expect((await db.doc(RETENTION_PATHS.gameEndApplied('g1', 'stats')).get()).exists).toBe(true);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('g1', 'headToHead')).get()).exists).toBe(true);
  });

  it('is idempotent: processing the same game twice changes nothing', async () => {
    await processGameEnd('g1', finishedGame(), CONSUMERS, NOW);
    const first = { a: await stats(ALICE), b: await stats(BOB), h: await h2h() };
    await processGameEnd('g1', finishedGame(), CONSUMERS, NOW + 5_000);
    expect({ a: await stats(ALICE), b: await stats(BOB), h: await h2h() }).toEqual(first);
  });

  it('retries failed consumers without reapplying successful consumers', async () => {
    let attempts = 0;
    const flakyHeadToHead: GameEndConsumer = {
      ...headToHeadConsumer,
      apply: async (tx, record, game, nowMs) => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary failure');
        await headToHeadConsumer.apply(tx, record, game, nowMs);
      },
    };
    const consumers = [statsConsumer, flakyHeadToHead, achievementsConsumer];

    await expect(processGameEnd('g-retry', finishedGame(), consumers, NOW)).rejects.toThrow('headToHead');
    expect((await stats(ALICE))!.pvp.classic.gamesPlayed).toBe(1);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('g-retry', 'stats')).get()).exists).toBe(true);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('g-retry', 'achievements')).get()).exists).toBe(true);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('g-retry', 'headToHead')).get()).exists).toBe(false);
    expect((await db.doc(RETENTION_PATHS.headToHead(ALICE, BOB)).get()).exists).toBe(false);

    await processGameEnd('g-retry', finishedGame(), consumers, NOW);
    expect(attempts).toBe(2);
    expect((await stats(ALICE))!.pvp.classic.gamesPlayed).toBe(1);
    expect((await h2h())!.gamesPlayed).toBe(1);
    expect((await db.doc(RETENTION_PATHS.gameEndApplied('g-retry', 'headToHead')).get()).exists).toBe(true);
  });

  it('accumulates a rematch chain with the winner reversed', async () => {
    await processGameEnd('g1', finishedGame(), CONSUMERS, NOW);
    const rematch = finishedGame({
      mode: 'salvo',
      rematchOf: 'g1',
      hostUid: BOB,
      winnerUid: BOB,
      players: {
        [ALICE]: player('P5Alice', ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'], 2, 1),
        [BOB]: player('P5Bob', [], 3, 3),
      },
      finishedAt: Timestamp.fromMillis(NOW + 120_000),
    });
    await processGameEnd('g2', rematch, CONSUMERS, NOW + 120_000);

    const h = (await h2h())!;
    expect(h.gamesPlayed).toBe(2);
    expect(h.wins).toEqual({ [ALICE]: 1, [BOB]: 1 });
    expect(h.winsByMode.classic).toEqual({ [ALICE]: 1, [BOB]: 0 });
    expect(h.winsByMode.salvo).toEqual({ [ALICE]: 0, [BOB]: 1 });
    expect(h.winsByMode.abilities).toEqual({ [ALICE]: 0, [BOB]: 0 });
    expect(h).toMatchObject({ lastGameId: 'g2', lastWinnerUid: BOB });

    const a = (await stats(ALICE))!;
    expect(a.pvp.classic.wins).toBe(1);
    expect(a.pvp.salvo.losses).toBe(1);
    expect((await stats(BOB))!.pvp.salvo).toMatchObject({ wins: 1, sinkWins: 1 });
  });

  it('a bot game updates only the human bot bucket and writes no head-to-head', async () => {
    const game = finishedGame({
      isBotGame: true,
      botDifficulty: 'hard',
      playerUids: [ALICE, BOT],
      players: { [ALICE]: player('P5Alice', [], 3, 2), [BOT]: player('Admiral', ['destroyer'], 4, 0) },
      shots: { [ALICE]: [shot(0, 0, 'sunk')], [BOT]: [] },
    });
    await processGameEnd('gbot', game, CONSUMERS, NOW);

    const a = (await stats(ALICE))!;
    expect(a.bot.classic).toMatchObject({ gamesPlayed: 1, wins: 1, sinkWins: 1 });
    expect(a.pvp.classic.gamesPlayed).toBe(0);
    expect(await stats(BOT)).toBeUndefined();
    expect((await db.collection('headToHead').get()).empty).toBe(true);
  });

  it('a resignation counts as a win and a loss but adds no sink win', async () => {
    await processGameEnd('gres', finishedGame({ endReason: 'resign' }), CONSUMERS, NOW);
    const a = (await stats(ALICE))!.pvp.classic;
    const b = (await stats(BOB))!.pvp.classic;
    expect(a).toMatchObject({ wins: 1, sinkWins: 0, sinkWinTurns: 0 });
    expect(a.winsByReason.resign).toBe(1);
    expect(b).toMatchObject({ losses: 1 });
    expect(b.lossesByReason.resign).toBe(1);
    expect((await h2h())!.wins[ALICE]).toBe(1);
  });

  it('a cancelled or winnerless game writes nothing', async () => {
    expect(await processGameEnd('gc', finishedGame({ status: 'cancelled' }), CONSUMERS, NOW)).toBeNull();
    expect(await processGameEnd('gn', finishedGame({ winnerUid: null, endReason: null }), CONSUMERS, NOW)).toBeNull();
    expect((await db.collection('playerStats').get()).empty).toBe(true);
    expect((await db.collection('headToHead').get()).empty).toBe(true);
    expect((await db.collection('gameEnds').get()).empty).toBe(true);
  });

  it('leaves users/{uid}.stats untouched', async () => {
    const before = { a: (await refs.user(ALICE).get()).data()?.stats, b: (await refs.user(BOB).get()).data()?.stats };
    expect(before.a).toBeDefined();
    await processGameEnd('g1', finishedGame(), CONSUMERS, NOW);
    expect({ a: (await refs.user(ALICE).get()).data()?.stats, b: (await refs.user(BOB).get()).data()?.stats }).toEqual(before);
  });
});
