import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotGame } from '../src/handlers/bots';
import { createGame, fireShot, joinGame, placeShips, resign } from '../src/handlers/games';
import { setUsername } from '../src/handlers/users';
import { refs } from '../src/lib/firestore';
import { sendTurnReminders } from '../src/triggers/reminders';
import { clearFirestore } from './setup';

interface FcmMessage {
  tokens: string[];
  notification?: { title: string; body: string };
  data?: Record<string, string>;
}

const sendMock = vi.hoisted(() =>
  vi.fn(async ({ tokens }: FcmMessage) => ({ responses: tokens.map(() => ({ success: true })) })),
);
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast: sendMock }) }));

const ALICE = 'uid-rem-alice';
const BOB = 'uid-rem-bob';
const FLEET = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
] as const;

async function startedGame(turnTimerMs?: number) {
  const { gameId, code } = await createGame(ALICE, {
    ...(turnTimerMs === undefined ? {} : { turnTimerMs }),
  });
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  await placeShips(BOB, { gameId, ships: FLEET });
  return gameId;
}

async function backdate(gameId: string, msAgo = 25 * 60 * 60 * 1000) {
  await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - msAgo) });
}

beforeEach(async () => {
  sendMock.mockClear();
  await clearFirestore();
  await setUsername(ALICE, { username: 'RemAlice' });
  await setUsername(BOB, { username: 'RemBob' });
});

describe('sendTurnReminders', () => {
  it('reminds an idle untimed game once and stamps remindedTurn', async () => {
    const gameId = await startedGame();
    const before = (await refs.game(gameId).get()).data()!;
    const onTurn = before.currentTurnUid!;
    await refs.push(onTurn).set({ tokens: ['tok-a'], updatedAt: Timestamp.now() });
    await backdate(gameId);

    expect(await sendTurnReminders()).toBe(1);
    const after = (await refs.game(gameId).get()).data()!;
    expect(after.remindedTurn).toBe(after.turnNumber);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0]![0];
    expect(message.tokens).toEqual(['tok-a']);
    expect(message.data?.gameId).toBe(gameId);
    expect(message.notification?.title).toContain('waiting for your move');

    // Second sweep: same turn, no new push.
    expect(await sendTurnReminders()).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('reminds again once the turn advances', async () => {
    const gameId = await startedGame();
    await backdate(gameId);
    expect(await sendTurnReminders()).toBe(1);

    const first = (await refs.game(gameId).get()).data()!;
    await fireShot(first.currentTurnUid!, { gameId, row: 9, col: 9 });
    await backdate(gameId);

    expect(await sendTurnReminders()).toBe(1);
    const after = (await refs.game(gameId).get()).data()!;
    expect(after.remindedTurn).toBe(after.turnNumber);
    expect(after.turnNumber).toBeGreaterThan(first.turnNumber);
  });

  it('counts the reminder even when the player has no push tokens', async () => {
    const gameId = await startedGame();
    await backdate(gameId);
    expect(await sendTurnReminders()).toBe(1);
    expect(sendMock).not.toHaveBeenCalled();
    const after = (await refs.game(gameId).get()).data()!;
    expect(after.remindedTurn).toBe(after.turnNumber);
  });

  it('skips fresh, timed, bot and finished games', async () => {
    const freshId = await startedGame(); // lastMoveAt is "now" — too recent
    const timedId = await createGame(ALICE, { turnTimerMs: 60_000 }).then(async ({ gameId, code }) => {
      await joinGame(BOB, { code });
      await placeShips(ALICE, { gameId, ships: FLEET });
      await placeShips(BOB, { gameId, ships: FLEET });
      return gameId;
    });
    const { gameId: botId } = await createBotGame(ALICE, { difficulty: 'easy', mode: 'classic' });
    const doneId = await createGame(ALICE).then(async ({ gameId, code }) => {
      await joinGame(BOB, { code });
      await resign(ALICE, { gameId });
      return gameId;
    });

    await backdate(timedId);
    await backdate(botId);
    await backdate(doneId);
    await backdate(freshId, 0);

    expect(await sendTurnReminders()).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
