/**
 * End-to-end tests for the callable handlers against the Firestore emulator.
 * Run with: npm run test:emulator   (starts the emulator automatically)
 */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { cellsOf, type ShipPlacement } from '../src/game/engine';
import { applyElo, weekId } from '../src/game/scoring';
import {
  cancelGame,
  claimTimeoutWin,
  createGame,
  fireShot,
  joinGame,
  placeShips,
  requestRematch,
  resign,
  sendReaction,
} from '../src/handlers/games';
import { createBotGame } from '../src/handlers/bots';
import { cancelChallenge, createChallenge, respondChallenge } from '../src/handlers/challenges';
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
    expect(game.shots[second]![1]).toMatchObject({
      row: 8,
      col: 1,
      result: 'sunk',
      sunkShip: 'destroyer',
      sunkPlacement: { type: 'destroyer', row: 8, col: 0, horizontal: true },
    });
    expect(game.shots[second]![0]).not.toHaveProperty('sunkPlacement');
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

  it('keeps far-apart ratings apart until the waiting ticket is old enough', async () => {
    await setupPlayers();
    await refs.user(BOB).update({ rating: 1450 });
    const t0 = Date.now();
    const at = (sec: number) => Timestamp.fromMillis(t0 + sec * 1000);

    expect(await joinQuickMatch(ALICE, {}, at(0))).toEqual({ gameId: null });
    expect(await joinQuickMatch(BOB, {}, at(1))).toEqual({ gameId: null });
    // Alice re-polls: Bob's ticket is 59s old (band 250) and the gap is 450.
    expect(await joinQuickMatch(ALICE, {}, at(60))).toEqual({ gameId: null });
    // Re-polling keeps the original ticket time so the band keeps widening.
    expect((await refs.quickMatch(ALICE).get()).data()!.createdAt.toMillis()).toBe(t0);

    // Alice's ticket is now 120s old, so it accepts anyone.
    const paired = await joinQuickMatch(BOB, {}, at(120));
    expect(paired.gameId).toBeTruthy();
    const game = (await refs.game(paired.gameId!).get()).data()!;
    expect(game).toMatchObject({ hostUid: ALICE, isQuickMatch: true });
    expect((await refs.quickMatch(ALICE).get()).data()!.gameId).toBe(paired.gameId);
    expect((await refs.quickMatch(BOB).get()).exists).toBe(false);
    // Alice's next poll hands back the same game instead of re-queueing.
    expect(await joinQuickMatch(ALICE, {}, at(121))).toEqual({ gameId: paired.gameId });
  });

  it('prefers the closer rating and skips a recent opponent', async () => {
    await setupPlayers();
    await setUsername(CAROL, { username: 'Carol' });
    await refs.user(CAROL).update({ rating: 1150 });
    const t0 = Date.now();
    expect(await joinQuickMatch(BOB, {}, Timestamp.fromMillis(t0))).toEqual({ gameId: null });
    expect(await joinQuickMatch(CAROL, {}, Timestamp.fromMillis(t0 + 1000))).toEqual({ gameId: null });

    // 30s later both tickets accept a 200-point gap. Bob (1000) is the closest fit for
    // Alice (1000), but they just played, so Carol (1150) is picked instead.
    await refs.opponent(ALICE, BOB).set({ username: 'Bob', gamesPlayed: 1, lastPlayedAt: Timestamp.fromMillis(t0) });
    const paired = await joinQuickMatch(ALICE, {}, Timestamp.fromMillis(t0 + 31_000));
    const game = (await refs.game(paired.gameId!).get()).data()!;
    expect(game.playerUids.sort()).toEqual([ALICE, CAROL].sort());
    expect((await refs.quickMatch(BOB).get()).data()!.gameId).toBeNull();
  });
});

describe('same-pair anti-farming', () => {
  it('halves K from the fourth rated game between the same pair within 24h', async () => {
    await setupPlayers();
    const deltas: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = (await refs.user(ALICE).get()).data()!.rating;
      const loser = (await refs.user(BOB).get()).data()!.rating;
      const { gameId, code } = await createGame(ALICE);
      await joinGame(BOB, { code });
      await resign(BOB, { gameId });
      const change = (await refs.game(gameId).get()).data()!.ratingChanges![ALICE]!;
      expect(change.before).toBe(before);
      expect(change.delta).toBe(applyElo(before, loser, i < 3 ? 1 : 0.5).winnerDelta);
      deltas.push(change.delta);
    }
    expect(deltas[3]).toBeLessThan(deltas[2]!);
    const pair = (await refs.opponent(ALICE, BOB).get()).data()!;
    expect(pair.gamesPlayed).toBe(4);
    expect(pair.recentGames).toHaveLength(4);
    expect((await refs.opponent(BOB, ALICE).get()).data()!.recentGames).toHaveLength(4);
  });
});

describe('reactions', () => {
  it('lets a member react in an active game without changing the game document', async () => {
    await setupPlayers();
    const { gameId, first } = await startedGame();
    const before = (await refs.game(gameId).get()).data()!;

    await sendReaction(first, { gameId, reactionId: 'nice_shot' });

    const reactions = await refs.reactions(gameId).get();
    expect(reactions.docs).toHaveLength(1);
    expect(reactions.docs[0]!.data()).toMatchObject({ uid: first, reactionId: 'nice_shot', at: expect.any(Timestamp) });
    expect((await refs.game(gameId).get()).data()!.updatedAt).toEqual(before.updatedAt);
  });

  it('limits each player independently to one reaction every 10 seconds', async () => {
    await setupPlayers();
    const { gameId } = await startedGame();

    await sendReaction(ALICE, { gameId, reactionId: 'gg' });
    await expectHttpsError(sendReaction(ALICE, { gameId, reactionId: 'oops' }), 'resource-exhausted');
    await sendReaction(BOB, { gameId, reactionId: 'fire' });
    expect((await refs.reactions(gameId).get()).size).toBe(2);
  });

  it('allows another reaction after the latest one is older than the cooldown', async () => {
    await setupPlayers();
    const { gameId } = await startedGame();
    await refs.reactions(gameId).add({
      uid: ALICE,
      reactionId: 'gg',
      at: Timestamp.fromMillis(Date.now() - 11_000),
    });

    await sendReaction(ALICE, { gameId, reactionId: 'nice_shot' });
    expect((await refs.reactions(gameId).where('uid', '==', ALICE).get()).size).toBe(2);
  });

  it('rejects a non-member', async () => {
    await setupPlayers();
    await setUsername(CAROL, { username: 'Carol' });
    const { gameId } = await startedGame();
    await expectHttpsError(sendReaction(CAROL, { gameId, reactionId: 'gg' }), 'permission-denied');
  });

  it('rejects unknown reaction ids before opening the transaction', async () => {
    await setupPlayers();
    const { gameId } = await startedGame();
    for (const input of [{ reactionId: 'hello' }, { reactionId: 'GG' }, { reactionId: 123 }, {}]) {
      await expectHttpsError(sendReaction(ALICE, { gameId, ...input }), 'invalid-argument');
    }
  });

  it('rejects waiting and cancelled games, but allows placing and finished games', async () => {
    await setupPlayers();
    const waiting = await createGame(ALICE);
    await expectHttpsError(sendReaction(ALICE, { gameId: waiting.gameId, reactionId: 'gg' }), 'failed-precondition');
    await cancelGame(ALICE, { gameId: waiting.gameId });
    await expectHttpsError(sendReaction(ALICE, { gameId: waiting.gameId, reactionId: 'gg' }), 'failed-precondition');

    const placing = await createGame(ALICE);
    await joinGame(BOB, { code: placing.code });
    await sendReaction(ALICE, { gameId: placing.gameId, reactionId: 'gg' });

    const { gameId } = await startedGame();
    await resign(ALICE, { gameId });
    await sendReaction(BOB, { gameId, reactionId: 'well_played' });
  });
});

describe('rematch', () => {
  it('creates a waiting invite, is idempotent, restricts code joins, and accepts without copying game state', async () => {
    await setupPlayers();
    await setUsername(CAROL, { username: 'Carol' });
    const original = await startedGame();
    await resign(original.first, { gameId: original.gameId });

    const created = await requestRematch(ALICE, { gameId: original.gameId });
    expect(created.status).toBe('waiting');
    const waiting = (await refs.game(created.gameId).get()).data()!;
    expect(waiting).toMatchObject({
      status: 'waiting',
      hostUid: ALICE,
      playerUids: [ALICE],
      invitedUid: BOB,
      rematchOf: original.gameId,
      shots: { [ALICE]: [] },
      revealedFleets: null,
    });
    expect(waiting.players[BOB]).toMatchObject({ username: 'Bob', ready: false, shotsFired: 0, hits: 0 });
    expect((await refs.game(original.gameId).get()).data()!.rematch).toEqual({
      gameId: created.gameId,
      requestedBy: ALICE,
    });
    expect((await refs.privateBoard(created.gameId, ALICE).get()).exists).toBe(false);
    expect((await refs.privateBoard(created.gameId, BOB).get()).exists).toBe(false);
    expect(await requestRematch(ALICE, { gameId: original.gameId })).toEqual(created);
    await expectHttpsError(joinGame(CAROL, { code: waiting.code }), 'permission-denied');

    expect(await requestRematch(BOB, { gameId: original.gameId })).toEqual({
      gameId: created.gameId,
      status: 'placing',
    });
    const accepted = (await refs.game(created.gameId).get()).data()!;
    expect(accepted).toMatchObject({
      status: 'placing',
      playerUids: [ALICE, BOB],
      shots: { [ALICE]: [], [BOB]: [] },
      revealedFleets: null,
    });
    expect((await refs.privateBoard(created.gameId, ALICE).get()).exists).toBe(false);
    expect((await refs.privateBoard(created.gameId, BOB).get()).exists).toBe(false);
  });

  it('rejects non-members and games that have not finished', async () => {
    await setupPlayers();
    await setUsername(CAROL, { username: 'Carol' });
    const active = await startedGame();
    await expectHttpsError(requestRematch(CAROL, { gameId: active.gameId }), 'permission-denied');
    await expectHttpsError(requestRematch(ALICE, { gameId: active.gameId }), 'failed-precondition');

    const waiting = await createGame(ALICE);
    await expectHttpsError(requestRematch(ALICE, { gameId: waiting.gameId }), 'failed-precondition');
  });

  it('allows a fresh request after the linked rematch is cancelled', async () => {
    await setupPlayers();
    const original = await startedGame();
    await resign(original.first, { gameId: original.gameId });
    const first = await requestRematch(ALICE, { gameId: original.gameId });
    await cancelGame(ALICE, { gameId: first.gameId });

    expect((await refs.game(original.gameId).get()).data()!.rematch).toBeNull();
    const second = await requestRematch(ALICE, { gameId: original.gameId });
    expect(second.status).toBe('waiting');
    expect(second.gameId).not.toBe(first.gameId);
    expect((await refs.game(first.gameId).get()).data()!.status).toBe('cancelled');
    expect((await refs.game(original.gameId).get()).data()!.rematch).toEqual({
      gameId: second.gameId,
      requestedBy: ALICE,
    });
  });

  it('allows a rematch from a Quick Match game', async () => {
    await setupPlayers();
    await joinQuickMatch(ALICE);
    const paired = await joinQuickMatch(BOB);
    const gameId = paired.gameId!;
    await placeShips(ALICE, { gameId, ships: FLEET });
    await placeShips(BOB, { gameId, ships: FLEET });
    await resign(ALICE, { gameId });

    const rematch = await requestRematch(BOB, { gameId });
    const game = (await refs.game(rematch.gameId).get()).data()!;
    expect(game).toMatchObject({ status: 'waiting', hostUid: BOB, invitedUid: ALICE, rematchOf: gameId });
  });

  it('applies Elo once when the human rematch finishes', async () => {
    await setupPlayers();
    const original = await startedGame();
    await resign(original.first, { gameId: original.gameId });
    const before = {
      alice: (await refs.user(ALICE).get()).data()!,
      bob: (await refs.user(BOB).get()).data()!,
    };
    const invite = await requestRematch(ALICE, { gameId: original.gameId });
    await requestRematch(BOB, { gameId: original.gameId });
    await placeShips(ALICE, { gameId: invite.gameId, ships: FLEET });
    await placeShips(BOB, { gameId: invite.gameId, ships: FLEET });
    await resign(ALICE, { gameId: invite.gameId });

    const finished = (await refs.game(invite.gameId).get()).data()!;
    const alice = (await refs.user(ALICE).get()).data()!;
    const bob = (await refs.user(BOB).get()).data()!;
    expect(finished.status).toBe('finished');
    expect(finished.ratingChanges).not.toBeNull();
    expect(alice.rating).toBe(finished.ratingChanges![ALICE]!.after);
    expect(bob.rating).toBe(finished.ratingChanges![BOB]!.after);
    expect(alice.stats.gamesPlayed).toBe(before.alice.stats.gamesPlayed + 1);
    expect(bob.stats.gamesPlayed).toBe(before.bob.stats.gamesPlayed + 1);

    await expectHttpsError(resign(ALICE, { gameId: invite.gameId }), 'failed-precondition');
    expect((await refs.user(ALICE).get()).data()!.rating).toBe(alice.rating);
    expect((await refs.user(BOB).get()).data()!.rating).toBe(bob.rating);
  });
});

describe('vs computer', () => {
  const BOT = 'bot-officer';

  async function botGame(difficulty = 'medium') {
    await setUsername(ALICE, { username: 'Alice' });
    const { gameId } = await createBotGame(ALICE, { difficulty });
    return gameId;
  }

  it('rejects a bad difficulty and requires a username', async () => {
    await setUsername(ALICE, { username: 'Alice' });
    await expectHttpsError(createBotGame(ALICE, { difficulty: 'impossible' }), 'invalid-argument');
    await expectHttpsError(createBotGame(BOB, { difficulty: 'easy' }), 'failed-precondition', 'username');
  });

  it('creates a placing game with a ready bot and a hidden bot fleet', async () => {
    const gameId = await botGame();
    const game = (await refs.game(gameId).get()).data()!;
    expect(game.status).toBe('placing');
    expect(game.playerUids).toEqual([ALICE, BOT]);
    expect(game.players[BOT]).toMatchObject({ username: 'Officer Bot', rating: 1000, ready: true });
    expect(game.isBotGame).toBe(true);
    expect(game.botDifficulty).toBe('medium');
    // The public doc never contains the bot's fleet.
    expect(JSON.stringify(game)).not.toContain('"carrier"');

    const bot = (await refs.user(BOT).get()).data()!;
    expect(bot).toMatchObject({ username: 'Officer Bot', usernameLower: 'officer bot', isBot: true, rating: 1000 });
    const board = (await refs.privateBoard(gameId, BOT).get()).data()!;
    expect(board.fleet).toHaveLength(5);
    expect(board.hitCells).toEqual([]);
  });

  it('creates an unrated rematch against the same bot difficulty', async () => {
    const originalId = await botGame('hard');
    const original = (await refs.game(originalId).get()).data()!;
    const botUid = original.playerUids.find((uid) => uid !== ALICE)!;
    await placeShips(ALICE, { gameId: originalId, ships: FLEET });
    await resign(ALICE, { gameId: originalId });

    const result = await requestRematch(ALICE, { gameId: originalId });
    const rematch = (await refs.game(result.gameId).get()).data()!;
    const rematchBotUid = rematch.playerUids.find((uid) => uid !== ALICE)!;
    expect(result.status).toBe('placing');
    expect(rematch).toMatchObject({
      status: 'placing',
      isBotGame: true,
      botDifficulty: 'hard',
      playerUids: [ALICE, botUid],
      ratingChanges: null,
      shots: { [ALICE]: [], [botUid]: [] },
    });
    expect(rematchBotUid).toBe(botUid);
    expect(rematch.players[botUid]!.ready).toBe(true);
    expect(rematch.invitedUid).toBeUndefined();
    expect(rematch.rematchOf).toBeUndefined();
    expect((await refs.privateBoard(result.gameId, ALICE).get()).exists).toBe(false);
    expect((await refs.privateBoard(result.gameId, rematchBotUid).get()).exists).toBe(true);
  });

  it('gives the human the first turn and replies to every shot in the same transaction', async () => {
    const gameId = await botGame();
    expect(await placeShips(ALICE, { gameId, ships: FLEET })).toEqual({ status: 'active' });
    let game = (await refs.game(gameId).get()).data()!;
    expect(game.currentTurnUid).toBe(ALICE);

    const res = await fireShot(ALICE, { gameId, row: 9, col: 9 });
    expect(res.gameOver).toBe(false);
    game = (await refs.game(gameId).get()).data()!;
    expect(game.shots[ALICE]).toHaveLength(1);
    expect(game.shots[BOT]).toHaveLength(1); // exactly one bot reply per human shot
    expect(game.currentTurnUid).toBe(ALICE);
    expect(game.turnNumber).toBe(3); // human + bot shots count as one exchange each
    expect(game.players[BOT]).toMatchObject({ shotsFired: 1 });

    await fireShot(ALICE, { gameId, row: 9, col: 8 });
    game = (await refs.game(gameId).get()).data()!;
    expect(game.shots[BOT]).toHaveLength(2);
    expect(game.turnNumber).toBe(5);
    // The bot's shots are stored with results only.
    expect(game.shots[BOT]![0]).toMatchObject({ result: expect.stringMatching(/miss|hit|sunk/) });
  });

  it('refuses timeout claims against the computer', async () => {
    const gameId = await botGame();
    await placeShips(ALICE, { gameId, ships: FLEET });
    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 4 * 24 * 3600 * 1000) });
    await expectHttpsError(claimTimeoutWin(ALICE, { gameId }), 'failed-precondition', 'never times out');
  });

  it('plays a full unrated game to completion', async () => {
    const gameId = await botGame();
    await placeShips(ALICE, { gameId, ships: FLEET });

    // Alice shoots through the bot's fleet cells; interleaved bot shots may finish her first.
    const botFleet = (await refs.privateBoard(gameId, BOT).get()).data()!.fleet;
    const targets = botFleet.flatMap((s) => cellsOf(s));
    let final: Awaited<ReturnType<typeof fireShot>> | undefined;
    for (const t of targets) {
      const game = (await refs.game(gameId).get()).data()!;
      if (game.status === 'finished') break;
      final = await fireShot(ALICE, { gameId, row: t.row, col: t.col });
      if (final.gameOver) break;
    }

    const game = (await refs.game(gameId).get()).data()!;
    expect(game.status).toBe('finished');
    expect([ALICE, BOT]).toContain(game.winnerUid);
    expect(game.endReason).toBe('all_sunk');
    expect(game.ratingChanges).toBeNull();
    expect(Object.keys(game.revealedFleets ?? {}).sort()).toEqual([ALICE, BOT].sort());

    const alice = (await refs.user(ALICE).get()).data()!;
    expect(alice.rating).toBe(1000); // unrated: rating and stats untouched
    expect(alice.stats.gamesPlayed).toBe(0);
    expect(alice.botStats!.gamesPlayed).toBe(1);
    expect(alice.botStats!.wins + alice.botStats!.losses).toBe(1);

    expect((await refs.weeklyWins(weekId(new Date()), game.winnerUid!).get()).exists).toBe(false);
    expect((await refs.opponent(ALICE, BOT).get()).exists).toBe(false);
    expect((await refs.opponent(BOT, ALICE).get()).exists).toBe(false);
    // The bot's own user doc is never touched by finishing a game.
    expect((await refs.user(BOT).get()).data()!.botStats!.gamesPlayed).toBe(0);
  });

  it('resign hands the bot an unrated win', async () => {
    const gameId = await botGame();
    await placeShips(ALICE, { gameId, ships: FLEET });
    expect(await resign(ALICE, { gameId })).toEqual({ winnerUid: BOT });
    const game = (await refs.game(gameId).get()).data()!;
    expect(game).toMatchObject({ status: 'finished', winnerUid: BOT, endReason: 'resign', ratingChanges: null });
    const alice = (await refs.user(ALICE).get()).data()!;
    expect(alice.rating).toBe(1000);
    expect(alice.stats.gamesPlayed).toBe(0);
    expect(alice.botStats).toMatchObject({ gamesPlayed: 1, losses: 1 });
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

    expect(await cleanupStale()).toEqual({ cancelledGames: 1, removedTickets: 1, expiredChallenges: 0 });
    expect((await refs.game(old.gameId).get()).data()!.status).toBe('cancelled');
    expect((await refs.gameCode(old.code).get()).exists).toBe(false);
    expect((await refs.game(fresh.gameId).get()).data()!.status).toBe('waiting');
    expect((await refs.quickMatch(ALICE).get()).exists).toBe(false);
  });
});

describe('challenges', () => {
  /** Alice and Bob have played before (the Friends relationship challenges require). */
  async function pastOpponents() {
    await setupPlayers();
    const lastPlayedAt = Timestamp.now();
    await refs.opponent(ALICE, BOB).set({ username: 'Bob', gamesPlayed: 1, lastPlayedAt });
    await refs.opponent(BOB, ALICE).set({ username: 'Alice', gamesPlayed: 1, lastPlayedAt });
  }

  it('create -> accept starts a placing game with both players', async () => {
    await pastOpponents();
    const { challengeId, gameId: immediate } = await createChallenge(ALICE, { opponentUid: BOB });
    expect(immediate).toBeNull();
    expect((await refs.challenge(challengeId).get()).data()).toMatchObject({
      fromUid: ALICE,
      toUid: BOB,
      fromUsername: 'Alice',
      toUsername: 'Bob',
      status: 'pending',
      sourceGameId: null,
      gameId: null,
      respondedAt: null,
    });

    const { gameId } = await respondChallenge(BOB, { challengeId, accept: true });
    expect(gameId).toEqual(expect.any(String));
    const game = (await refs.game(gameId!).get()).data()!;
    expect(game).toMatchObject({ status: 'placing', hostUid: ALICE, playerUids: [ALICE, BOB], isQuickMatch: false, isBotGame: false });
    expect(game.players[BOB]).toMatchObject({ username: 'Bob', ready: false });
    expect((await refs.gameCode(game.code).get()).data()!.gameId).toBe(gameId);
    expect((await refs.challenge(challengeId).get()).data()).toMatchObject({ status: 'accepted', gameId });

    // Already answered.
    await expectHttpsError(respondChallenge(BOB, { challengeId, accept: true }), 'failed-precondition');
  });

  it('decline and cancel close the challenge without a game', async () => {
    await pastOpponents();
    const first = await createChallenge(ALICE, { opponentUid: BOB });
    expect(await respondChallenge(BOB, { challengeId: first.challengeId, accept: false })).toEqual({ gameId: null });
    expect((await refs.challenge(first.challengeId).get()).data()).toMatchObject({ status: 'declined', gameId: null });

    const second = await createChallenge(ALICE, { opponentUid: BOB });
    await expectHttpsError(cancelChallenge(BOB, { challengeId: second.challengeId }), 'permission-denied');
    await cancelChallenge(ALICE, { challengeId: second.challengeId });
    expect((await refs.challenge(second.challengeId).get()).data()!.status).toBe('cancelled');
    await expectHttpsError(respondChallenge(BOB, { challengeId: second.challengeId, accept: true }), 'failed-precondition');
    expect((await refs.games().get()).size).toBe(0);
  });

  it('a reverse pending challenge is auto-accepted', async () => {
    await pastOpponents();
    const first = await createChallenge(ALICE, { opponentUid: BOB });
    const second = await createChallenge(BOB, { opponentUid: ALICE });
    expect(second.challengeId).toBe(first.challengeId);
    expect(second.gameId).toEqual(expect.any(String));
    const game = (await refs.game(second.gameId!).get()).data()!;
    expect(game).toMatchObject({ status: 'placing', hostUid: ALICE, playerUids: [ALICE, BOB] });
    expect((await refs.challenges().get()).size).toBe(1);
  });

  it('rejects a duplicate pending challenge to the same player', async () => {
    await pastOpponents();
    await createChallenge(ALICE, { opponentUid: BOB });
    await expectHttpsError(createChallenge(ALICE, { opponentUid: BOB }), 'already-exists');
    expect((await refs.challenges().get()).size).toBe(1);
  });

  it('only the invitee can respond', async () => {
    await pastOpponents();
    await setUsername(CAROL, { username: 'Carol' });
    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB });
    await expectHttpsError(respondChallenge(CAROL, { challengeId, accept: true }), 'permission-denied');
    await expectHttpsError(respondChallenge(ALICE, { challengeId, accept: true }), 'permission-denied');
    await expectHttpsError(respondChallenge(BOB, { challengeId, accept: 'yes' }), 'invalid-argument');
    await expectHttpsError(respondChallenge(BOB, { challengeId: 'nope', accept: true }), 'not-found');
    expect((await refs.challenge(challengeId).get()).data()!.status).toBe('pending');
  });

  it('rejects self, bot, unknown and never-played opponents', async () => {
    await pastOpponents();
    await setUsername(CAROL, { username: 'Carol' });
    await expectHttpsError(createChallenge(ALICE, { opponentUid: ALICE }), 'invalid-argument', 'yourself');
    await createBotGame(ALICE, { difficulty: 'medium' }); // creates the bot profile
    await expectHttpsError(createChallenge(ALICE, { opponentUid: 'bot-officer' }), 'invalid-argument');
    await refs.opponent(ALICE, CAROL).set({ username: 'Carol', gamesPlayed: 1, lastPlayedAt: Timestamp.now() });
    await refs.user(CAROL).update({ isBot: true });
    await expectHttpsError(createChallenge(ALICE, { opponentUid: CAROL }), 'invalid-argument');
    await refs.user(CAROL).update({ isBot: false });
    await refs.opponent(ALICE, CAROL).delete();
    await expectHttpsError(createChallenge(ALICE, { opponentUid: CAROL }), 'failed-precondition', 'already played');
    await expectHttpsError(createChallenge(ALICE, { opponentUid: 'uid-nobody' }), 'not-found');
    await expectHttpsError(createChallenge(ALICE, {}), 'invalid-argument');
    expect((await refs.challenges().get()).size).toBe(0);
  });

  it('expired challenges cannot be accepted and are expired by cleanupStale', async () => {
    await pastOpponents();
    const old = await createChallenge(ALICE, { opponentUid: BOB });
    await refs.challenge(old.challengeId).update({ createdAt: Timestamp.fromMillis(Date.now() - 49 * 3600 * 1000) });
    await expectHttpsError(respondChallenge(BOB, { challengeId: old.challengeId, accept: true }), 'failed-precondition', 'expired');

    expect(await cleanupStale()).toEqual({ cancelledGames: 0, removedTickets: 0, expiredChallenges: 1 });
    expect((await refs.challenge(old.challengeId).get()).data()).toMatchObject({ status: 'expired', gameId: null });

    // A fresh one is untouched, and a new challenge is allowed now the old one expired.
    const fresh = await createChallenge(ALICE, { opponentUid: BOB });
    expect(await cleanupStale()).toEqual({ cancelledGames: 0, removedTickets: 0, expiredChallenges: 0 });
    expect((await refs.challenge(fresh.challengeId).get()).data()!.status).toBe('pending');
  });

  it('a stale reverse challenge is expired instead of auto-accepted', async () => {
    await pastOpponents();
    const old = await createChallenge(ALICE, { opponentUid: BOB });
    await refs.challenge(old.challengeId).update({ createdAt: Timestamp.fromMillis(Date.now() - 49 * 3600 * 1000) });
    const res = await createChallenge(BOB, { opponentUid: ALICE });
    expect(res.gameId).toBeNull();
    expect(res.challengeId).not.toBe(old.challengeId);
    expect((await refs.challenge(old.challengeId).get()).data()!.status).toBe('expired');
    expect((await refs.games().get()).size).toBe(0);
  });

  describe('rematch', () => {
    async function finishedGame() {
      await setupPlayers();
      const { gameId } = await startedGame();
      await resign(ALICE, { gameId });
      return gameId;
    }

    it('both players asking for a rematch of the same game produces exactly one game', async () => {
      const sourceGameId = await finishedGame();
      const mine = await createChallenge(ALICE, { opponentUid: BOB, sourceGameId });
      expect(mine.gameId).toBeNull();
      expect((await refs.challenge(mine.challengeId).get()).data()).toMatchObject({ sourceGameId, status: 'pending' });
      // Tapping again before Bob answers is a no-op rather than an error.
      expect(await createChallenge(ALICE, { opponentUid: BOB, sourceGameId })).toEqual(mine);

      const theirs = await createChallenge(BOB, { opponentUid: ALICE, sourceGameId });
      expect(theirs.challengeId).toBe(mine.challengeId);
      expect(theirs.gameId).toEqual(expect.any(String));
      const game = (await refs.game(theirs.gameId!).get()).data()!;
      expect(game).toMatchObject({ status: 'placing', playerUids: [ALICE, BOB] });

      // A late tap from either side points at the same game instead of opening another challenge.
      expect(await createChallenge(ALICE, { opponentUid: BOB, sourceGameId })).toEqual(theirs);
      expect(await createChallenge(BOB, { opponentUid: ALICE, sourceGameId })).toEqual(theirs);
      expect((await refs.challenges().get()).size).toBe(1);
      expect((await refs.games().where('status', '==', 'placing').get()).size).toBe(1);
    });

    it('rejects a rematch of an unfinished game or one the pair did not both play', async () => {
      await setupPlayers();
      await setUsername(CAROL, { username: 'Carol' });
      const lastPlayedAt = Timestamp.now();
      await refs.opponent(ALICE, BOB).set({ username: 'Bob', gamesPlayed: 1, lastPlayedAt });
      await refs.opponent(ALICE, CAROL).set({ username: 'Carol', gamesPlayed: 1, lastPlayedAt });
      await refs.opponent(CAROL, BOB).set({ username: 'Bob', gamesPlayed: 1, lastPlayedAt });

      const { gameId: active } = await startedGame();
      await expectHttpsError(
        createChallenge(ALICE, { opponentUid: BOB, sourceGameId: active }),
        'failed-precondition',
        'not finished',
      );
      await resign(ALICE, { gameId: active });
      await expectHttpsError(createChallenge(ALICE, { opponentUid: CAROL, sourceGameId: active }), 'permission-denied');
      await expectHttpsError(createChallenge(CAROL, { opponentUid: BOB, sourceGameId: active }), 'permission-denied');
      await expectHttpsError(createChallenge(ALICE, { opponentUid: BOB, sourceGameId: 'missing' }), 'permission-denied');
      await expectHttpsError(createChallenge(ALICE, { opponentUid: BOB, sourceGameId: 42 }), 'invalid-argument');
      expect((await refs.challenges().get()).size).toBe(0);
    });
  });
});
