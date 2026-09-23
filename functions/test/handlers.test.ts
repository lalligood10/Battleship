/**
 * End-to-end tests for the callable handlers against the Firestore emulator.
 * Run with: npm run test:emulator   (starts the emulator automatically)
 */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { cellsOf, type ShipPlacement } from '../src/game/engine';
import { weekId } from '../src/game/scoring';
import {
  cancelGame,
  claimTimeoutWin,
  createGame,
  fireShot,
  joinGame,
  placeShips,
  resign,
} from '../src/handlers/games';
import { cancelQuickMatch, joinQuickMatch } from '../src/handlers/quickMatch';
import { checkUsername, setUsername } from '../src/handlers/users';
import { refs } from '../src/lib/firestore';
import { cleanupStale } from '../src/triggers/cleanup';
import { clearFirestore } from './setup';

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const CAROL = 'uid-carol';

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

beforeEach(async () => {
  await clearFirestore();
});

describe('usernames', () => {
  it('creates a profile with the starting rating and enforces uniqueness case-insensitively', async () => {
    await setUsername(ALICE, { username: 'Alice' });
    const alice = (await refs.user(ALICE).get()).data()!;
    expect(alice).toMatchObject({ username: 'Alice', usernameLower: 'alice', rating: 1000 });
    expect(alice.stats.gamesPlayed).toBe(0);

    await expectHttpsError(setUsername(BOB, { username: 'ALICE' }), 'already-exists');
    expect(await checkUsername(BOB, { username: 'alice' })).toMatchObject({ available: false });
    expect(await checkUsername(BOB, { username: 'Bobby' })).toEqual({ available: true });
    expect(await checkUsername(BOB, { username: 'sh1t' })).toMatchObject({ available: false });
  });

  it('lets a user rename and releases the old name', async () => {
    await setUsername(ALICE, { username: 'Alice' });
    await setUsername(ALICE, { username: 'Alicia' });
    expect((await refs.username('alice').get()).exists).toBe(false);
    expect((await refs.username('alicia').get()).data()).toEqual({ uid: ALICE });
    await setUsername(BOB, { username: 'Alice' }); // now free
  });

  it('rejects invalid names', async () => {
    await expectHttpsError(setUsername(ALICE, { username: 'x' }), 'invalid-argument');
    await expectHttpsError(setUsername(ALICE, {}), 'invalid-argument');
  });
});

describe('create / join / cancel', () => {
  it('requires a username first', async () => {
    await expectHttpsError(createGame(ALICE), 'failed-precondition', 'username');
  });

  it('creates a waiting game with a join code and lets a friend join', async () => {
    await setupPlayers();
    const { gameId, code } = await createGame(ALICE);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    let game = (await refs.game(gameId).get()).data()!;
    expect(game.status).toBe('waiting');
    expect(game.playerUids).toEqual([ALICE]);
    expect(game.abandonTimeoutMs).toBe(3 * 24 * 60 * 60 * 1000);

    // Case/spacing-insensitive code entry.
    const joined = await joinGame(BOB, { code: ` ${code.toLowerCase()} ` });
    expect(joined.gameId).toBe(gameId);
    game = (await refs.game(gameId).get()).data()!;
    expect(game.status).toBe('placing');
    expect(game.playerUids).toEqual([ALICE, BOB]);
    expect(game.players[BOB]).toMatchObject({ username: 'Bob', rating: 1000, ready: false });
  });

  it('host re-opening their own link just returns the game; third player is refused', async () => {
    await setupPlayers();
    await setUsername(CAROL, { username: 'Carol' });
    const { gameId, code } = await createGame(ALICE);
    expect(await joinGame(ALICE, { code })).toEqual({ gameId });
    await joinGame(BOB, { code });
    await expectHttpsError(joinGame(CAROL, { code }), 'failed-precondition');
    // Existing players can still "rejoin".
    expect(await joinGame(BOB, { code })).toEqual({ gameId });
  });

  it('rejects unknown or malformed codes', async () => {
    await setupPlayers();
    await expectHttpsError(joinGame(BOB, { code: 'ZZZZZZ' }), 'not-found');
    await expectHttpsError(joinGame(BOB, { code: 'abc' }), 'invalid-argument');
  });

  it('host can cancel while waiting; not after someone joined', async () => {
    await setupPlayers();
    const { gameId, code } = await createGame(ALICE);
    await expectHttpsError(cancelGame(BOB, { gameId }), 'permission-denied');
    await cancelGame(ALICE, { gameId });
    expect((await refs.game(gameId).get()).data()!.status).toBe('cancelled');
    expect((await refs.gameCode(code).get()).exists).toBe(false);

    const g2 = await createGame(ALICE);
    await joinGame(BOB, { code: g2.code });
    await expectHttpsError(cancelGame(ALICE, { gameId: g2.gameId }), 'failed-precondition');
  });
});

describe('placement', () => {
  it('stores the fleet privately and starts the game when both are ready', async () => {
    await setupPlayers();
    const { gameId, code } = await createGame(ALICE);
    await expectHttpsError(placeShips(ALICE, { gameId, ships: FLEET }), 'failed-precondition', 'join');
    await joinGame(BOB, { code });

    expect(await placeShips(ALICE, { gameId, ships: FLEET })).toEqual({ status: 'placing' });
    let game = (await refs.game(gameId).get()).data()!;
    expect(game.players[ALICE]!.ready).toBe(true);
    expect(game.status).toBe('placing');
    // The public doc never contains the fleet.
    expect(JSON.stringify(game)).not.toContain('"carrier"');
    expect((await refs.privateBoard(gameId, ALICE).get()).data()!.fleet).toEqual(FLEET);

    expect(await placeShips(BOB, { gameId, ships: FLEET })).toEqual({ status: 'active' });
    game = (await refs.game(gameId).get()).data()!;
    expect(game.status).toBe('active');
    expect([ALICE, BOB]).toContain(game.currentTurnUid);
    expect(game.turnNumber).toBe(1);

    // Locked once active.
    await expectHttpsError(placeShips(BOB, { gameId, ships: FLEET }), 'failed-precondition', 'locked');
  });

  it('rejects illegal fleets and outsiders', async () => {
    await setupPlayers();
    await setUsername(CAROL, { username: 'Carol' });
    const { gameId, code } = await createGame(ALICE);
    await joinGame(BOB, { code });
    const overlapping = [...FLEET.slice(0, 4), { type: 'destroyer', row: 0, col: 0, horizontal: true }];
    await expectHttpsError(placeShips(ALICE, { gameId, ships: overlapping }), 'invalid-argument', 'overlaps');
    await expectHttpsError(placeShips(CAROL, { gameId, ships: FLEET }), 'permission-denied');
  });
});

describe('firing', () => {
  it('validates turn order, bounds and duplicate shots', async () => {
    await setupPlayers();
    const { gameId, first, second } = await startedGame();

    await expectHttpsError(fireShot(second, { gameId, row: 9, col: 9 }), 'failed-precondition', 'not your turn');
    await expectHttpsError(fireShot(first, { gameId, row: 10, col: 0 }), 'invalid-argument');
    await expectHttpsError(fireShot(first, { gameId, row: '1', col: 0 }), 'invalid-argument');

    expect(await fireShot(first, { gameId, row: 9, col: 9 })).toEqual({
      result: 'miss',
      sunkShip: undefined,
      gameOver: false,
      winnerUid: null,
    });
    // Firing twice in a row is refused; the turn passed.
    await expectHttpsError(fireShot(first, { gameId, row: 9, col: 8 }), 'failed-precondition', 'not your turn');

    expect(await fireShot(second, { gameId, row: 8, col: 0 })).toMatchObject({ result: 'hit' });
    await fireShot(first, { gameId, row: 9, col: 8 });
    // Same cell again by the same player.
    await expectHttpsError(fireShot(second, { gameId, row: 8, col: 0 }), 'failed-precondition', 'already fired');
    expect(await fireShot(second, { gameId, row: 8, col: 1 })).toMatchObject({ result: 'sunk', sunkShip: 'destroyer' });

    const game = (await refs.game(gameId).get()).data()!;
    expect(game.turnNumber).toBe(5);
    expect(game.players[second]).toMatchObject({ shotsFired: 2, hits: 2 });
    expect(game.players[first]).toMatchObject({ shotsFired: 2, hits: 0, sunkShips: ['destroyer'] });
    expect(game.shots[second]).toHaveLength(2);
    expect(game.shots[second]![1]).toMatchObject({ row: 8, col: 1, result: 'sunk', sunkShip: 'destroyer' });
    // Private board of the victim records the hits; the shooter still can't see unhit cells.
    expect((await refs.privateBoard(gameId, first).get()).data()!.hitCells.sort()).toEqual(['8,0', '8,1']);
  });

  it('finishes the game, applies Elo/stats, weekly wins and opponents when the fleet is sunk', async () => {
    await setupPlayers();
    const { gameId, first, second } = await startedGame();

    // `first` sinks everything; `second` fires harmless misses on the empty odd rows.
    const targets = FLEET.flatMap((s) => cellsOf(s));
    const misses = [1, 3, 5, 7, 9].flatMap((row) => Array.from({ length: 10 }, (_, col) => ({ row, col })));
    let final: Awaited<ReturnType<typeof fireShot>> | undefined;
    for (const [i, t] of targets.entries()) {
      final = await fireShot(first, { gameId, row: t.row, col: t.col });
      if (final.gameOver) break;
      const m = misses[i]!;
      expect(await fireShot(second, { gameId, row: m.row, col: m.col })).toMatchObject({ result: 'miss' });
    }
    expect(final).toMatchObject({ result: 'sunk', gameOver: true, winnerUid: first });

    const game = (await refs.game(gameId).get()).data()!;
    expect(game.status).toBe('finished');
    expect(game.winnerUid).toBe(first);
    expect(game.endReason).toBe('all_sunk');
    expect(game.currentTurnUid).toBeNull();
    expect(game.ratingChanges).toEqual({
      [first]: { before: 1000, after: 1016, delta: 16 },
      [second]: { before: 1000, after: 984, delta: -16 },
    });
    expect(game.revealedFleets![first]).toEqual(FLEET);
    expect(game.revealedFleets![second]).toEqual(FLEET);
    expect(game.players[second]!.sunkShips).toHaveLength(5);

    const winner = (await refs.user(first).get()).data()!;
    const loser = (await refs.user(second).get()).data()!;
    expect(winner.rating).toBe(1016);
    expect(winner.stats).toMatchObject({ wins: 1, losses: 0, gamesPlayed: 1, shotsFired: 17, hits: 17, currentStreak: 1, longestStreak: 1 });
    expect(loser.rating).toBe(984);
    expect(loser.stats).toMatchObject({ wins: 0, losses: 1, gamesPlayed: 1, shotsFired: 16, hits: 0, currentStreak: 0 });

    const weekly = (await refs.weeklyWins(weekId(new Date()), first).get()).data()!;
    expect(weekly).toMatchObject({ wins: 1, rating: 1016, username: winner.username });
    expect((await refs.opponent(first, second).get()).data()).toMatchObject({ username: loser.username, gamesPlayed: 1 });
    expect((await refs.opponent(second, first).get()).data()).toMatchObject({ username: winner.username, gamesPlayed: 1 });

    await expectHttpsError(fireShot(second, { gameId, row: 0, col: 9 }), 'failed-precondition', 'not in progress');
  });
});

describe('resign and timeout', () => {
  it('resign hands the win to the opponent and applies ratings', async () => {
    await setupPlayers();
    const { gameId } = await startedGame();
    expect(await resign(BOB, { gameId })).toEqual({ winnerUid: ALICE });
    const game = (await refs.game(gameId).get()).data()!;
    expect(game).toMatchObject({ status: 'finished', winnerUid: ALICE, endReason: 'resign' });
    expect((await refs.user(ALICE).get()).data()!.rating).toBe(1016);
    expect((await refs.user(BOB).get()).data()!.stats.losses).toBe(1);
    await expectHttpsError(resign(ALICE, { gameId }), 'failed-precondition', 'already over');
  });

  it('resign is allowed during placement but not while waiting', async () => {
    await setupPlayers();
    const { gameId, code } = await createGame(ALICE);
    await expectHttpsError(resign(ALICE, { gameId }), 'failed-precondition', 'cancel');
    await joinGame(BOB, { code });
    expect(await resign(ALICE, { gameId })).toEqual({ winnerUid: BOB });
    const game = (await refs.game(gameId).get()).data()!;
    expect(game.revealedFleets).toEqual({});
  });

  it('timeout claim only works for the waiting player after the timeout elapsed', async () => {
    await setupPlayers();
    const { gameId, first, second } = await startedGame();

    // Too early.
    await expectHttpsError(claimTimeoutWin(second, { gameId }), 'failed-precondition', 'still has');
    // Wrong player (it's `first`'s turn, so `first` isn't waiting on anyone).
    await expectHttpsError(claimTimeoutWin(first, { gameId }), 'failed-precondition', 'waiting');

    // Simulate 4 days of silence.
    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 4 * 24 * 3600 * 1000) });
    expect(await claimTimeoutWin(second, { gameId })).toEqual({ winnerUid: second });
    const game = (await refs.game(gameId).get()).data()!;
    expect(game).toMatchObject({ status: 'finished', winnerUid: second, endReason: 'timeout' });
    expect((await refs.user(second).get()).data()!.rating).toBe(1016);
  });

  it('timeout claim works in the placing phase when the opponent never placed', async () => {
    await setupPlayers();
    const { gameId, code } = await createGame(ALICE);
    await joinGame(BOB, { code });
    await placeShips(ALICE, { gameId, ships: FLEET });
    await expectHttpsError(claimTimeoutWin(BOB, { gameId }), 'failed-precondition', 'waiting');
    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 4 * 24 * 3600 * 1000) });
    expect(await claimTimeoutWin(ALICE, { gameId })).toEqual({ winnerUid: ALICE });
  });
});

describe('quick match', () => {
  it('queues the first player and pairs the second', async () => {
    await setupPlayers();
    expect(await joinQuickMatch(ALICE)).toEqual({ gameId: null });
    expect((await refs.quickMatch(ALICE).get()).data()).toMatchObject({ username: 'Alice', gameId: null });
    // Re-joining while queued just refreshes the ticket.
    expect(await joinQuickMatch(ALICE)).toEqual({ gameId: null });

    const paired = await joinQuickMatch(BOB);
    expect(paired.gameId).toBeTruthy();
    const game = (await refs.game(paired.gameId!).get()).data()!;
    expect(game).toMatchObject({ status: 'placing', isQuickMatch: true, hostUid: ALICE });
    expect(game.playerUids.sort()).toEqual([ALICE, BOB].sort());
    // Alice's ticket now points at the game so her listener can navigate.
    expect((await refs.quickMatch(ALICE).get()).data()!.gameId).toBe(paired.gameId);
    expect((await refs.quickMatch(BOB).get()).exists).toBe(false);

    await cancelQuickMatch(ALICE);
    expect((await refs.quickMatch(ALICE).get()).exists).toBe(false);
  });
});

describe('cleanup', () => {
  it('cancels never-joined games older than the TTL and drops stale tickets', async () => {
    await setupPlayers();
    const old = await createGame(ALICE);
    const fresh = await createGame(BOB);
    await refs.game(old.gameId).update({ createdAt: Timestamp.fromMillis(Date.now() - 8 * 24 * 3600 * 1000) });
    await joinQuickMatch(ALICE);
    await refs.quickMatch(ALICE).update({ createdAt: Timestamp.fromMillis(Date.now() - 60 * 60 * 1000) });

    expect(await cleanupStale()).toEqual({ cancelledGames: 1, removedTickets: 1 });
    expect((await refs.game(old.gameId).get()).data()!.status).toBe('cancelled');
    expect((await refs.gameCode(old.code).get()).exists).toBe(false);
    expect((await refs.game(fresh.gameId).get()).data()!.status).toBe('waiting');
    expect((await refs.quickMatch(ALICE).get()).exists).toBe(false);
  });
});
