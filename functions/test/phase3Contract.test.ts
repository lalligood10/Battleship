import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBotGame } from '../src/handlers/bots';
import { createChallenge, respondChallenge } from '../src/handlers/challenges';
import {
  createGame,
  fireShot,
  joinGame,
  placeShips,
  requestRematch,
  resign,
} from '../src/handlers/games';
import { claimTurnTimeout } from '../src/handlers/timers';
import { completeGuestUpgrade } from '../src/handlers/guests';
import { weekId } from '../src/game/scoring';
import { refs } from '../src/lib/firestore';
import { setUsername } from '../src/handlers/users';
import { joinQuickMatch } from '../src/handlers/quickMatch';
import { clearFirestore } from './setup';

const ALICE = 'uid-phase3-alice';
const BOB = 'uid-phase3-bob';
const FLEET = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
] as const;

async function expectHttpsError(promise: Promise<unknown>, code: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
}

async function setupPlayers() {
  await setUsername(ALICE, { username: 'Phase3Alice' });
  await setUsername(BOB, { username: 'Phase3Bob' });
}

async function startedGame(turnTimerMs?: number) {
  const { gameId, code } = await createGame(ALICE, { ...(turnTimerMs === undefined ? {} : { turnTimerMs }) });
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  await placeShips(BOB, { gameId, ships: FLEET });
  const game = (await refs.game(gameId).get()).data()!;
  return { gameId, game };
}

beforeEach(async () => {
  await clearFirestore();
  await setupPlayers();
});

describe('Phase 3 timer and guest contract', () => {
  it('accepts a supported createGame timer and rejects an unsupported value', async () => {
    const { gameId } = await createGame(ALICE, { turnTimerMs: 60_000 });
    expect((await refs.game(gameId).get()).data()?.turnTimerMs).toBe(60_000);
    await expectHttpsError(createGame(ALICE, { turnTimerMs: 5_000 }), 'invalid-argument');
  });

  it('starts the deadline after both fleets are placed and resets the shooter streak after a shot', async () => {
    const { gameId, game: started } = await startedGame(60_000);
    expect(started.turnDeadline!.toMillis()).toBe(started.lastMoveAt!.toMillis() + 60_000);

    const first = started.currentTurnUid!;
    const oldDeadline = Timestamp.fromMillis(1_000);
    await refs.game(gameId).update({
      turnDeadline: oldDeadline,
      lastMoveAt: Timestamp.fromMillis(1),
      [`timeoutStreak.${first}`]: 2,
    });

    await fireShot(first, { gameId, row: 9, col: 9 });
    const updated = (await refs.game(gameId).get()).data()!;
    expect(updated.turnDeadline!.toMillis()).toBe(updated.lastMoveAt!.toMillis() + 60_000);
    expect(updated.turnDeadline!.toMillis()).toBeGreaterThan(oldDeadline.toMillis());
    expect(updated.timeoutStreak?.[first]).toBe(0);
  });

  it('copies the timer to a rematch', async () => {
    const { gameId, code } = await createGame(ALICE, { turnTimerMs: 120_000 });
    await joinGame(BOB, { code });
    await resign(ALICE, { gameId });
    const { gameId: rematchId } = await requestRematch(ALICE, { gameId });
    expect((await refs.game(rematchId).get()).data()?.turnTimerMs).toBe(120_000);
  });

  it('carries a challenge timer into the accepted game', async () => {
    await refs.opponent(ALICE, BOB).set({
      username: 'Phase3Bob',
      gamesPlayed: 1,
      lastPlayedAt: Timestamp.now(),
    });
    const { challengeId } = await createChallenge(ALICE, {
      opponentUid: BOB,
      mode: 'classic',
      turnTimerMs: 120_000,
    });
    const { gameId } = await respondChallenge(BOB, { challengeId, accept: true });
    expect(gameId).toBeTruthy();
    expect((await refs.game(gameId!).get()).data()?.turnTimerMs).toBe(120_000);
  });

  it('keeps untimed, bot, and Quick Match deadlines null', async () => {
    const { gameId: untimedId } = await createGame(ALICE);
    expect((await refs.game(untimedId).get()).data()?.turnDeadline).toBeNull();

    const { gameId: botId } = await createBotGame(ALICE, { difficulty: 'easy', mode: 'classic' });
    expect((await refs.game(botId).get()).data()?.turnDeadline).toBeNull();

    await joinQuickMatch(ALICE, { mode: 'classic' });
    const { gameId: quickMatchId } = await joinQuickMatch(BOB, { mode: 'classic' });
    expect(quickMatchId).toBeTruthy();
    expect((await refs.game(quickMatchId!).get()).data()?.turnDeadline).toBeNull();
  });

  it('marks guest games unrated and updates only stats when a player resigns', async () => {
    await refs.user(ALICE).update({ isGuest: true });
    const { gameId, code } = await createGame(ALICE);
    await joinGame(BOB, { code });
    const started = (await refs.game(gameId).get()).data()!;
    expect(started.isRated).toBe(false);
    expect(started.players[ALICE]?.isGuest).toBe(true);

    const aliceBefore = (await refs.user(ALICE).get()).data()!;
    const bobBefore = (await refs.user(BOB).get()).data()!;
    await resign(ALICE, { gameId });

    const finished = (await refs.game(gameId).get()).data()!;
    const aliceAfter = (await refs.user(ALICE).get()).data()!;
    const bobAfter = (await refs.user(BOB).get()).data()!;
    expect(finished.ratingChanges).toBeNull();
    expect(aliceAfter.rating).toBe(aliceBefore.rating);
    expect(bobAfter.rating).toBe(bobBefore.rating);
    expect(aliceAfter.stats.gamesPlayed).toBe(aliceBefore.stats.gamesPlayed + 1);
    expect(bobAfter.stats.gamesPlayed).toBe(bobBefore.stats.gamesPlayed + 1);
    expect((await refs.weeklyWins(weekId(new Date()), BOB).get()).exists).toBe(false);
    expect((await refs.opponent(ALICE, BOB).get()).exists).toBe(false);
    expect((await refs.opponent(BOB, ALICE).get()).exists).toBe(false);
  });

  it('keeps normal human games rated and writes rating changes', async () => {
    const { gameId, code } = await createGame(ALICE);
    await joinGame(BOB, { code });
    expect((await refs.game(gameId).get()).data()?.isRated).toBe(true);
    await resign(ALICE, { gameId });
    const game = (await refs.game(gameId).get()).data()!;
    expect(game.ratingChanges).not.toBeNull();
    expect(game.ratingChanges?.[ALICE]).toBeDefined();
    expect(game.ratingChanges?.[BOB]).toBeDefined();
  });

  it('exposes the timer and guest upgrade callable stubs', async () => {
    await expectHttpsError(claimTurnTimeout(ALICE, { gameId: 'missing-game' }), 'not-found');
    await expectHttpsError(completeGuestUpgrade(ALICE), 'unimplemented');
  });
});
