import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireShot, createGame, joinGame, placeShips } from '../src/handlers/games';
import { claimTurnTimeout, sweepTurnTimeouts } from '../src/handlers/timers';
import { refs } from '../src/lib/firestore';
import { setUsername } from '../src/handlers/users';
import { clearFirestore } from './setup';

const ALICE = 'uid-timer-alice';
const BOB = 'uid-timer-bob';
const CAROL = 'uid-timer-carol';
const FLEET = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
] as const;

async function expectHttpsError(promise: Promise<unknown>, code: string, message?: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe(code);
  if (message) expect((caught as HttpsError).message).toBe(message);
}

async function setupPlayers() {
  await setUsername(ALICE, { username: 'TimerAlice' });
  await setUsername(BOB, { username: 'TimerBob' });
  await setUsername(CAROL, { username: 'TimerCarol' });
}

async function startedGame(turnTimerMs: number | null = 60_000) {
  const { gameId, code } = await createGame(ALICE, { turnTimerMs });
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  await placeShips(BOB, { gameId, ships: FLEET });
  return { gameId, game: (await refs.game(gameId).get()).data()! };
}

async function forceExpiry(gameId: string) {
  await refs.game(gameId).update({ turnDeadline: Timestamp.fromMillis(Date.now() - 10_000) });
}

beforeEach(async () => {
  await clearFirestore();
  await setupPlayers();
});

describe('turn timeout handler', () => {
  it('does nothing before the deadline and leaves the game unchanged', async () => {
    const { gameId, game: before } = await startedGame();

    expect(await claimTurnTimeout(ALICE, { gameId })).toEqual({ skipped: false, forfeited: false });
    expect((await refs.game(gameId).get()).data()).toEqual(before);
  });

  it('skips an expired turn, updates the deadline, and increments the timeout streak', async () => {
    const { gameId, game } = await startedGame();
    await forceExpiry(gameId);
    const before = (await refs.game(gameId).get()).data()!;
    const player = before.currentTurnUid!;
    const other = before.playerUids.find((uid) => uid !== player);
    const callStartedAt = Date.now();

    expect(await claimTurnTimeout(player, { gameId })).toEqual({ skipped: true, forfeited: false });

    const after = (await refs.game(gameId).get()).data()!;
    expect(after.currentTurnUid).toBe(other);
    expect(after.turnNumber).toBe(before.turnNumber + 1);
    expect(after.lastMoveAt?.toMillis()).toBeGreaterThanOrEqual(callStartedAt);
    expect(after.turnDeadline?.toMillis()).toBeGreaterThanOrEqual(callStartedAt + 60_000);
    expect(after.turnDeadline?.toMillis()).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(after.timeoutStreak?.[player]).toBe(1);
    expect(game.turnNumber).toBe(before.turnNumber);
  });

  it('forfeits on the third consecutive skipped turn', async () => {
    const { gameId, game } = await startedGame();
    const player = game.currentTurnUid!;
    const winner = game.playerUids.find((uid) => uid !== player);
    await refs.game(gameId).update({ [`timeoutStreak.${player}`]: 2 });
    await forceExpiry(gameId);

    expect(await claimTurnTimeout(player, { gameId })).toEqual({ skipped: true, forfeited: true });

    const after = (await refs.game(gameId).get()).data()!;
    expect(after.status).toBe('finished');
    expect(after.endReason).toBe('timeout');
    expect(after.winnerUid).toBe(winner);
  });

  it('resets a player timeout streak when they make a real move after a skipped turn', async () => {
    const { gameId, game } = await startedGame();
    const skippedPlayer = game.currentTurnUid!;
    const opponent = game.playerUids.find((uid) => uid !== skippedPlayer)!;
    await forceExpiry(gameId);
    await claimTurnTimeout(skippedPlayer, { gameId });
    expect((await refs.game(gameId).get()).data()?.timeoutStreak?.[skippedPlayer]).toBe(1);

    await fireShot(opponent, { gameId, row: 9, col: 9 });
    await fireShot(skippedPlayer, { gameId, row: 9, col: 8 });
    expect((await refs.game(gameId).get()).data()?.timeoutStreak?.[skippedPlayer]).toBe(0);
  });

  it('does nothing for an untimed game with an expired-looking deadline', async () => {
    const { gameId, game } = await startedGame(null);
    await forceExpiry(gameId);
    const before = (await refs.game(gameId).get()).data()!;

    expect(await claimTurnTimeout(game.currentTurnUid!, { gameId })).toEqual({ skipped: false, forfeited: false });
    expect((await refs.game(gameId).get()).data()).toEqual(before);
  });

  it('rejects callers who are not game members', async () => {
    const { gameId } = await startedGame();
    await forceExpiry(gameId);

    await expectHttpsError(
      claimTurnTimeout(CAROL, { gameId }),
      'permission-denied',
      'You are not in this game',
    );
  });

  it('rejects a missing gameId', async () => {
    await expectHttpsError(claimTurnTimeout(ALICE, {}), 'invalid-argument', 'gameId is required');
  });

  it('allows concurrent claims to skip a turn only once', async () => {
    const { gameId, game: before } = await startedGame();
    await forceExpiry(gameId);

    const results = await Promise.all([
      claimTurnTimeout(ALICE, { gameId }),
      claimTurnTimeout(BOB, { gameId }),
    ]);

    expect(results.filter((result) => result.skipped)).toHaveLength(1);
    const after = (await refs.game(gameId).get()).data()!;
    expect(after.turnNumber).toBe(before.turnNumber + 1);
  });

  it('sweeps expired active games, skips ineligible games, and continues after forfeits', async () => {
    const skipped = await startedGame();
    const notExpired = await startedGame();
    const untimed = await startedGame(null);
    const forfeited = await startedGame();
    const now = Timestamp.now();

    await refs.game(skipped.gameId).update({
      turnDeadline: Timestamp.fromMillis(now.toMillis() - 10_000),
    });
    await refs.game(notExpired.gameId).update({
      turnDeadline: Timestamp.fromMillis(now.toMillis() + 60_000),
    });
    await refs.game(untimed.gameId).update({
      turnDeadline: Timestamp.fromMillis(now.toMillis() - 10_000),
    });
    await refs.game(forfeited.gameId).update({
      turnDeadline: Timestamp.fromMillis(now.toMillis() - 10_000),
      [`timeoutStreak.${forfeited.game.currentTurnUid}`]: 2,
    });

    expect(await sweepTurnTimeouts(now)).toBe(2);

    const [skippedAfter, notExpiredAfter, untimedAfter, forfeitedAfter] = await Promise.all([
      refs.game(skipped.gameId).get(),
      refs.game(notExpired.gameId).get(),
      refs.game(untimed.gameId).get(),
      refs.game(forfeited.gameId).get(),
    ]);
    expect(skippedAfter.data()?.turnNumber).toBe(skipped.game.turnNumber + 1);
    expect(notExpiredAfter.data()?.turnNumber).toBe(notExpired.game.turnNumber);
    expect(untimedAfter.data()?.turnNumber).toBe(untimed.game.turnNumber);
    expect(forfeitedAfter.data()).toMatchObject({ status: 'finished', endReason: 'timeout' });
  });
});
