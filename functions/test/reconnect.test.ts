/**
 * Reconnect and retry tests for callable handlers against the Firestore emulator.
 * Run with: npm run test:emulator
 */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShipPlacement } from '../src/game/engine';
import { claimTimeoutWin, createGame, fireSalvo, fireShot, joinGame, placeShips, requestRematch, resign } from '../src/handlers/games';
import { createChallenge, respondChallenge } from '../src/handlers/challenges';
import { setUsername } from '../src/handlers/users';
import { coreStateFromGame } from '../src/lib/coreAdapter';
import { refs } from '../src/lib/firestore';
import { clearFirestore } from './setup';

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const FLEET: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];

async function expectHttpsError(promise: Promise<unknown>, code: string, messagePart?: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  const err = caught as HttpsError;
  expect(err.code).toBe(code);
  if (messagePart) expect(err.message).toContain(messagePart);
}

async function setupPlayers() {
  await setUsername(ALICE, { username: 'Alice' });
  await setUsername(BOB, { username: 'Bob' });
}

/** Creates a game, joins Bob, and places both fleets. Returns who fires first. */
async function startedGame() {
  const { gameId, code } = await createGame(ALICE);
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  const { status } = await placeShips(BOB, { gameId, ships: FLEET });
  expect(status).toBe('active');
  const game = (await refs.game(gameId).get()).data()!;
  const first = game.currentTurnUid!;
  const second = first === ALICE ? BOB : ALICE;
  return { gameId, code, first, second };
}

async function startedSalvoGame() {
  const { gameId, code } = await createGame(ALICE, { mode: 'salvo' });
  await joinGame(BOB, { code });
  await placeShips(ALICE, { gameId, ships: FLEET });
  await placeShips(BOB, { gameId, ships: FLEET });
  const game = (await refs.game(gameId).get()).data()!;
  const first = game.currentTurnUid!;
  return { gameId, first, second: first === ALICE ? BOB : ALICE };
}

beforeEach(async () => {
  await clearFirestore();
});

describe('reconnect and retries', () => {
  it('lets a player who reloads mid-game resume from Firestore alone', async () => {
    await setupPlayers();
    const { gameId, first, second } = await startedGame();

    await fireShot(first, { gameId, row: 0, col: 0 });
    await fireShot(second, { gameId, row: 9, col: 9 });
    await fireShot(first, { gameId, row: 0, col: 1 });

    const game = (await refs.game(gameId).get()).data()!;
    const firstBoard = (await refs.privateBoard(gameId, first).get()).data()!;
    const secondBoard = (await refs.privateBoard(gameId, second).get()).data()!;
    expect(game).toMatchObject({
      status: 'active',
      currentTurnUid: second,
      turnNumber: 4,
      shots: {
        [first]: [{ result: 'hit' }, { result: 'hit' }],
        [second]: [{ result: 'miss' }],
      },
      players: {
        [first]: { shotsFired: 2, hits: 2 },
      },
    });
    expect(secondBoard.hitCells.slice().sort()).toEqual(['0,0', '0,1']);
    expect(firstBoard.hitCells).toEqual([]);

    const coreState = coreStateFromGame(game, { [first]: firstBoard, [second]: secondBoard });
    expect(coreState.currentTurn).toBe(second);
    expect(coreState.turnNumber).toBe(4);

    await fireShot(second, { gameId, row: 9, col: 8 });
    await expectHttpsError(fireShot(second, { gameId, row: 9, col: 7 }), 'failed-precondition');
  });

  it('rejects retrying a shot after a lost response without firing twice', async () => {
    await setupPlayers();
    const { gameId, first, second } = await startedGame();
    const shot = { gameId, row: 0, col: 0 };

    await fireShot(first, shot);
    await expectHttpsError(fireShot(first, shot), 'failed-precondition');

    const game = (await refs.game(gameId).get()).data()!;
    expect(game.shots[first]).toHaveLength(1);
    expect(game.players[first]!.shotsFired).toBe(1);
    expect(game.turnNumber).toBe(2);
    expect(game.currentTurnUid).toBe(second);
  });

  it('rejects retrying a Salvo volley after a lost response without a second volley', async () => {
    await setupPlayers();
    const { gameId, first, second } = await startedSalvoGame();
    const volley = {
      gameId,
      targets: [0, 1, 2, 3, 4].map((col) => ({ row: 9, col })),
    };

    await fireSalvo(first, volley);
    const before = (await refs.game(gameId).get()).data()!;
    await expectHttpsError(fireSalvo(first, volley), 'failed-precondition');

    const after = (await refs.game(gameId).get()).data()!;
    expect(after.shots[first]).toHaveLength(before.shots[first]!.length);
    expect(after.players[first]!.shotsFired).toBe(before.players[first]!.shotsFired);
    expect(after.currentTurnUid).toBe(second);
  });

  it('returns the same game when a guest reopens the join link after joining', async () => {
    await setupPlayers();
    const { gameId, code } = await createGame(ALICE);

    expect(await joinGame(BOB, { code })).toEqual({ gameId });
    expect(await joinGame(BOB, { code })).toEqual({ gameId });
    expect((await refs.game(gameId).get()).data()).toMatchObject({
      playerUids: [ALICE, BOB],
      status: 'placing',
    });

    await placeShips(ALICE, { gameId, ships: FLEET });
    await placeShips(BOB, { gameId, ships: FLEET });
    expect((await refs.game(gameId).get()).data()!.status).toBe('active');
    expect(await joinGame(BOB, { code })).toEqual({ gameId });
  });

  it('accepts a challenge only once after a lost response', async () => {
    await setupPlayers();
    const lastPlayedAt = Timestamp.now();
    await refs.opponent(ALICE, BOB).set({ username: 'Bob', gamesPlayed: 1, lastPlayedAt });
    await refs.opponent(BOB, ALICE).set({ username: 'Alice', gamesPlayed: 1, lastPlayedAt });

    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB });
    const { gameId } = await respondChallenge(BOB, { challengeId, accept: true });
    await expectHttpsError(respondChallenge(BOB, { challengeId, accept: true }), 'failed-precondition', 'no longer open');

    expect((await refs.challenge(challengeId).get()).data()).toMatchObject({ status: 'accepted', gameId });
    expect((await refs.games().where('playerUids', 'array-contains', BOB).get()).size).toBe(1);
  });

  it('returns the same game when the invitee retries rematch acceptance', async () => {
    await setupPlayers();
    const { gameId: originalId } = await startedGame();
    await resign(ALICE, { gameId: originalId });

    const waiting = await requestRematch(ALICE, { gameId: originalId });
    const accepted = { gameId: waiting.gameId, status: 'placing' };
    expect(await requestRematch(BOB, { gameId: originalId })).toEqual(accepted);
    expect(await requestRematch(BOB, { gameId: originalId })).toEqual(accepted);
    expect(await requestRematch(ALICE, { gameId: originalId })).toEqual(accepted);

    expect((await refs.game(waiting.gameId).get()).data()!.playerUids).toEqual([ALICE, BOB]);
    expect((await refs.game(originalId).get()).data()!.rematch).toEqual({
      gameId: waiting.gameId,
      requestedBy: ALICE,
    });
  });

  it('restarts the abandonment clock after every accepted move', async () => {
    await setupPlayers();
    const { gameId, first } = await startedGame();
    const fourDaysAgo = Timestamp.fromMillis(Date.now() - 4 * 24 * 3600 * 1000);
    await refs.game(gameId).update({ lastMoveAt: fourDaysAgo });

    const moveStartedAt = Date.now();
    await fireShot(first, { gameId, row: 0, col: 0 });
    const afterShot = (await refs.game(gameId).get()).data()!;
    expect(afterShot.lastMoveAt!.toMillis()).toBeGreaterThanOrEqual(moveStartedAt);
    await expectHttpsError(claimTimeoutWin(first, { gameId }), 'failed-precondition', 'still has');

    const placing = await createGame(ALICE);
    await joinGame(BOB, { code: placing.code });
    await refs.game(placing.gameId).update({ lastMoveAt: fourDaysAgo });
    const placementStartedAt = Date.now();
    await placeShips(ALICE, { gameId: placing.gameId, ships: FLEET });
    const afterPlacement = (await refs.game(placing.gameId).get()).data()!;
    expect(afterPlacement.lastMoveAt!.toMillis()).toBeGreaterThanOrEqual(placementStartedAt);
    await expectHttpsError(claimTimeoutWin(ALICE, { gameId: placing.gameId }), 'failed-precondition', 'still has');
  });
});
