/**
 * Phase 3 integration and regression QA (docs/PHASE-3-CONTRACT.md, docs/PHASE-3-QA.md).
 * Drives real callable handlers against the Firestore emulator. Tests that need Child A/B/C work
 * are marked `// depends on Child X` and are expected to fail on `phase-3-contract`.
 * Run with: npm run test:emulator (or vitest directly with --config vitest.emulator.config.mts).
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/game/config';
import type { GameMode } from '../src/game/core/schema';
import type { ShipPlacement } from '../src/game/engine';
import { coordinateLabel } from '../src/game/engine';
import { cancelChallenge, createChallenge, respondChallenge } from '../src/handlers/challenges';
import {
  claimTimeoutWin,
  createGame,
  fireSalvo,
  fireShot,
  joinGame,
  placeShips,
  requestRematch,
  resign,
  useAbility,
} from '../src/handlers/games';
import { joinQuickMatch } from '../src/handlers/quickMatch';
import { claimTurnTimeout, sweepTurnTimeouts } from '../src/handlers/timers';
import { setUsername } from '../src/handlers/users';
import { weekId } from '../src/game/scoring';
import { coreStateFromGame } from '../src/lib/coreAdapter';
import { db, refs } from '../src/lib/firestore';
import {
  notificationForChallenge,
  notificationsForChallengeUpdate,
  notificationsForChange,
  type Notification,
} from '../src/triggers/notifications';
import { sendTurnReminders } from '../src/triggers/reminders';
import type { ChallengeDoc, GameDoc } from '../src/types';
import { clearFirestore } from './setup';

const ALICE = 'uid-p3i-alice';
const BOB = 'uid-p3i-bob';
const CAROL = 'uid-p3i-carol';
const NAMES: Record<string, string> = { [ALICE]: 'P3Alice', [BOB]: 'P3Bob', [CAROL]: 'P3Carol' };

const FLEET: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];
const SHIP_LENGTH: Record<string, number> = { carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2 };
/** Every cell FLEET occupies, in firing order. */
const FLEET_CELLS = FLEET.flatMap((s) =>
  Array.from({ length: SHIP_LENGTH[s.type]! }, (_, i) => ({ row: s.row, col: s.col + i })),
);
/** Odd rows are always empty water for FLEET. */
const MISS_CELLS = [1, 3, 5, 7, 9].flatMap((row) => Array.from({ length: 10 }, (_, col) => ({ row, col })));
const MODES: GameMode[] = ['classic', 'salvo', 'abilities'];
const DAY_MS = 24 * 60 * 60 * 1000;

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

async function expectHttpsError(promise: Promise<unknown>, code: string | string[]) {
  const error = await caught(promise);
  expect(error).toBeInstanceOf(HttpsError);
  expect([code].flat()).toContain((error as HttpsError).code);
}

/** A claim that must not skip: either rejected as a precondition failure or answered with no change. */
async function expectNoSkip(promise: Promise<{ skipped: boolean; forfeited: boolean }>) {
  let result: { skipped: boolean; forfeited: boolean } | undefined;
  let error: unknown;
  try {
    result = await promise;
  } catch (e) {
    error = e;
  }
  if (error) {
    expect(error).toBeInstanceOf(HttpsError);
    expect((error as HttpsError).code).toBe('failed-precondition');
  } else {
    expect(result).toEqual({ skipped: false, forfeited: false });
  }
}

async function users(...uids: string[]) {
  for (const uid of uids) await setUsername(uid, { username: NAMES[uid]! });
}

async function pastOpponents(a = ALICE, b = BOB) {
  const lastPlayedAt = Timestamp.now();
  await refs.opponent(a, b).set({ username: NAMES[b]!, gamesPlayed: 1, lastPlayedAt });
  await refs.opponent(b, a).set({ username: NAMES[a]!, gamesPlayed: 1, lastPlayedAt });
}

async function gameDoc(gameId: string): Promise<GameDoc> {
  return (await refs.game(gameId).get()).data()!;
}

/** Runs `action` and returns the pushes the game trigger would compute for that write. */
async function pushesFor(gameId: string, action: () => Promise<unknown>) {
  const before = (await refs.game(gameId).get()).data();
  await action();
  const after = await gameDoc(gameId);
  return { before, after, pushes: notificationsForChange(gameId, before, after) };
}

async function placeBoth(gameId: string, a = ALICE, b = BOB) {
  await placeShips(a, { gameId, ships: FLEET });
  await placeShips(b, { gameId, ships: FLEET });
  const game = await gameDoc(gameId);
  expect(game.status).toBe('active');
  const first = game.currentTurnUid!;
  return { game, first, second: first === a ? b : a };
}

async function startedGame(opts: { mode?: GameMode; turnTimerMs?: number } = {}) {
  const { gameId, code } = await createGame(ALICE, opts);
  await joinGame(BOB, { code });
  return { gameId, ...(await placeBoth(gameId)) };
}

/** Fires one harmless shot (a miss) for whoever's turn it is, in any mode. */
const missCursor = new Map<string, number>();
async function missFor(uid: string, gameId: string) {
  const game = await gameDoc(gameId);
  const key = `${gameId}:${uid}`;
  const used = missCursor.get(key) ?? 0;
  if (game.mode === 'salvo') {
    const count = 5 - (game.players[uid === ALICE ? BOB : ALICE]?.sunkShips.length ?? 0);
    const targets = MISS_CELLS.slice(used, used + count);
    missCursor.set(key, used + count);
    await fireSalvo(uid, { gameId, targets });
  } else {
    missCursor.set(key, used + 1);
    await fireShot(uid, { gameId, ...MISS_CELLS[used]! });
  }
}

/** Moves the active turn's deadline past the grace window. */
async function expireTurn(gameId: string) {
  await refs.game(gameId).update({
    turnDeadline: Timestamp.fromMillis(Date.now() - GAME_CONFIG.TURN_TIMEOUT_GRACE_MS - 5_000),
  });
}

/** Coordinates that are already public on the game doc: shot targets plus ability log cells. */
function publicLabels(game: GameDoc): Set<string> {
  const labels = new Set<string>();
  for (const shots of Object.values(game.shots)) for (const s of shots) labels.add(coordinateLabel(s.row, s.col));
  for (const entry of game.abilityLog ?? []) {
    const result = entry.result as { cells?: { row: number; col: number }[]; center?: { row: number; col: number } };
    for (const c of result.cells ?? []) labels.add(coordinateLabel(c.row, c.col));
    if (result.center) labels.add(coordinateLabel(result.center.row, result.center.col));
  }
  return labels;
}

/** No push may mention a fleet coordinate that is not already public. */
function expectNoPrivateCoordinates(pushes: Notification[], game: GameDoc | undefined) {
  const allowed = game ? publicLabels(game) : new Set<string>();
  const fleetLabels = new Set(FLEET_CELLS.map((c) => coordinateLabel(c.row, c.col)));
  for (const push of pushes) {
    const mentioned = `${push.title} ${push.body}`.match(/\b[A-J](?:10|[1-9])\b/g) ?? [];
    for (const label of mentioned) {
      if (fleetLabels.has(label)) expect(allowed, `${label} leaked in "${push.body}"`).toContain(label);
    }
  }
}

const recipients = (pushes: Notification[]) => pushes.map((p) => p.uid).sort();

beforeEach(async () => {
  await clearFirestore();
  missCursor.clear();
});

// ---------------------------------------------------------------------------------------------
describe('challenges keep mode and turn timer', () => {
  const cases: { mode: GameMode; turnTimerMs: number | null }[] = [
    { mode: 'classic', turnTimerMs: null },
    { mode: 'classic', turnTimerMs: 120_000 },
    { mode: 'salvo', turnTimerMs: 60_000 },
    { mode: 'abilities', turnTimerMs: 120_000 },
  ];

  it.each(cases)('create → accept: $mode with timer $turnTimerMs', async ({ mode, turnTimerMs }) => {
    await users(ALICE, BOB);
    await pastOpponents();
    const { challengeId } = await createChallenge(ALICE, {
      opponentUid: BOB,
      mode,
      ...(turnTimerMs === null ? {} : { turnTimerMs }),
    });
    expect((await refs.challenge(challengeId).get()).data()).toMatchObject({ mode, turnTimerMs, status: 'pending' });

    const { gameId } = await respondChallenge(BOB, { challengeId, accept: true });
    const game = await gameDoc(gameId!);
    expect(game).toMatchObject({
      status: 'placing',
      mode,
      turnTimerMs,
      turnDeadline: null,
      timeoutStreak: {},
      remindedTurn: null,
      isRated: true,
      hostUid: ALICE,
      playerUids: [ALICE, BOB],
    });

    const { game: active } = await placeBoth(gameId!);
    if (turnTimerMs === null) expect(active.turnDeadline).toBeNull();
    else expect(active.turnDeadline!.toMillis()).toBe(active.lastMoveAt!.toMillis() + turnTimerMs);
  });

  it('auto-accepting a reverse challenge uses the incoming challenge timer and mode', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    await createChallenge(BOB, { opponentUid: ALICE, mode: 'salvo', turnTimerMs: 60_000 });
    const { gameId } = await createChallenge(ALICE, { opponentUid: BOB, mode: 'salvo', turnTimerMs: 120_000 });
    expect(gameId).toBeTruthy();
    expect(await gameDoc(gameId!)).toMatchObject({ mode: 'salvo', turnTimerMs: 60_000, hostUid: BOB });
  });

  it('decline leaves no game, no join code, and cannot be accepted afterwards', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB, mode: 'abilities', turnTimerMs: 60_000 });
    expect(await respondChallenge(BOB, { challengeId, accept: false })).toEqual({ gameId: null });

    expect((await refs.challenge(challengeId).get()).data()).toMatchObject({ status: 'declined', gameId: null });
    expect((await refs.games().get()).size).toBe(0);
    expect((await db.collection('gameCodes').get()).size).toBe(0);
    await expectHttpsError(respondChallenge(BOB, { challengeId, accept: true }), 'failed-precondition');
    await expectHttpsError(respondChallenge(BOB, { challengeId, accept: false }), 'failed-precondition');
    expect((await refs.games().get()).size).toBe(0);
  });

  it('rejects an unsupported challenge timer without writing a challenge', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    await expectHttpsError(createChallenge(ALICE, { opponentUid: BOB, mode: 'classic', turnTimerMs: 30_000 }), 'invalid-argument');
    expect((await refs.challenges().get()).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Quick Match', () => {
  it.each(MODES)('pairs only %s tickets, untimed and rated', async (mode) => {
    await users(ALICE, BOB, CAROL);
    const other = MODES.find((m) => m !== mode)!;
    expect(await joinQuickMatch(ALICE, { mode })).toEqual({ gameId: null });
    expect(await joinQuickMatch(CAROL, { mode: other })).toEqual({ gameId: null });
    // A turn timer passed to Quick Match is ignored: Quick Match games never have one.
    const { gameId } = await joinQuickMatch(BOB, { mode, turnTimerMs: 60_000 });
    expect(gameId).toBeTruthy();

    const game = await gameDoc(gameId!);
    expect(game).toMatchObject({ mode, isQuickMatch: true, turnTimerMs: null, turnDeadline: null, isRated: true });
    expect(game.playerUids.sort()).toEqual([ALICE, BOB].sort());
    expect((await refs.quickMatch(CAROL).get()).data()).toMatchObject({ mode: other, gameId: null });
  });
});

// ---------------------------------------------------------------------------------------------
describe('rematch keeps mode, timer, and opponent', () => {
  it.each([
    { mode: 'classic' as GameMode, turnTimerMs: null },
    { mode: 'salvo' as GameMode, turnTimerMs: 60_000 },
    { mode: 'abilities' as GameMode, turnTimerMs: 120_000 },
  ])('$mode with timer $turnTimerMs', async ({ mode, turnTimerMs }) => {
    await users(ALICE, BOB);
    const { gameId } = await startedGame({ mode, ...(turnTimerMs === null ? {} : { turnTimerMs }) });
    await resign(BOB, { gameId });

    const requested = await requestRematch(BOB, { gameId });
    expect(requested.status).toBe('waiting');
    expect(await gameDoc(requested.gameId)).toMatchObject({
      mode,
      turnTimerMs,
      hostUid: BOB,
      invitedUid: ALICE,
      rematchOf: gameId,
      turnDeadline: null,
      timeoutStreak: {},
    });

    expect(await requestRematch(ALICE, { gameId })).toEqual({ gameId: requested.gameId, status: 'placing' });
    const accepted = await gameDoc(requested.gameId);
    expect(accepted).toMatchObject({ mode, turnTimerMs, isRated: true, status: 'placing' });
    expect(accepted.playerUids).toEqual([BOB, ALICE]);

    const { game: active } = await placeBoth(requested.gameId, BOB, ALICE);
    if (turnTimerMs === null) expect(active.turnDeadline).toBeNull();
    else expect(active.turnDeadline!.toMillis()).toBe(active.lastMoveAt!.toMillis() + turnTimerMs);
  });

  it('a rematch of a timed challenge game keeps the challenge settings', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB, mode: 'salvo', turnTimerMs: 120_000 });
    const { gameId } = await respondChallenge(BOB, { challengeId, accept: true });
    await resign(ALICE, { gameId: gameId! });

    const { gameId: rematchId } = await requestRematch(ALICE, { gameId: gameId! });
    await requestRematch(BOB, { gameId: gameId! });
    expect(await gameDoc(rematchId)).toMatchObject({ mode: 'salvo', turnTimerMs: 120_000, playerUids: [ALICE, BOB] });
  });

  it('a rematch of a Quick Match game stays untimed', async () => {
    await users(ALICE, BOB);
    await joinQuickMatch(ALICE, { mode: 'abilities' });
    const { gameId } = await joinQuickMatch(BOB, { mode: 'abilities' });
    await resign(ALICE, { gameId: gameId! });
    const { gameId: rematchId } = await requestRematch(ALICE, { gameId: gameId! });
    expect(await gameDoc(rematchId)).toMatchObject({ mode: 'abilities', turnTimerMs: null, isQuickMatch: false });
  });
});

// ---------------------------------------------------------------------------------------------
describe('reconnect and idempotency', () => {
  it.each(MODES)('re-reading the game and private boards mid-game returns identical %s state', async (mode) => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ mode, turnTimerMs: 60_000 });
    await missFor(first, gameId);
    await missFor(second, gameId);

    const read = async () => ({
      game: await gameDoc(gameId),
      boards: {
        [ALICE]: (await refs.privateBoard(gameId, ALICE).get()).data()!,
        [BOB]: (await refs.privateBoard(gameId, BOB).get()).data()!,
      },
    });
    const a = await read();
    const b = await read();
    expect(b).toEqual(a);
    expect(coreStateFromGame(b.game, b.boards)).toEqual(coreStateFromGame(a.game, a.boards));
    expect(a.game.currentTurnUid).toBe(first);
    expect(a.game.turnDeadline!.toMillis()).toBe(a.game.lastMoveAt!.toMillis() + 60_000);
  });

  it('a duplicate fire is rejected and does not touch the deadline or streaks', async () => {
    await users(ALICE, BOB);
    const { gameId, first } = await startedGame({ turnTimerMs: 60_000 });
    await fireShot(first, { gameId, row: 9, col: 9 });
    const before = await gameDoc(gameId);
    await expectHttpsError(fireShot(first, { gameId, row: 9, col: 9 }), 'failed-precondition');
    const after = await gameDoc(gameId);
    expect(after.turnDeadline!.toMillis()).toBe(before.turnDeadline!.toMillis());
    expect(after.timeoutStreak).toEqual(before.timeoutStreak);
    expect(after.turnNumber).toBe(before.turnNumber);
    expect(after.shots[first]).toHaveLength(1);
  });

  // depends on Child C
  it('a repeated turn-timeout claim skips the turn only once', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ turnTimerMs: 60_000 });
    await expireTurn(gameId);
    expect(await claimTurnTimeout(second, { gameId })).toEqual({ skipped: true, forfeited: false });
    const once = await gameDoc(gameId);

    await expectNoSkip(claimTurnTimeout(second, { gameId }));
    await expectNoSkip(claimTurnTimeout(first, { gameId }));
    const twice = await gameDoc(gameId);
    expect(twice.turnNumber).toBe(once.turnNumber);
    expect(twice.currentTurnUid).toBe(second);
    expect(twice.timeoutStreak?.[first]).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('turn timeouts', () => {
  // depends on Child C
  it('an expired turn is skipped: turn passes, deadline restarts, no shot is recorded', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ turnTimerMs: 60_000 });
    await expireTurn(gameId);
    const before = await gameDoc(gameId);

    await expectHttpsError(claimTurnTimeout('uid-p3i-outsider', { gameId }), ['permission-denied', 'not-found']);
    expect(await claimTurnTimeout(second, { gameId })).toEqual({ skipped: true, forfeited: false });

    const after = await gameDoc(gameId);
    expect(after.status).toBe('active');
    expect(after.currentTurnUid).toBe(second);
    expect(after.turnNumber).toBe(before.turnNumber + 1);
    expect(after.timeoutStreak?.[first]).toBe(1);
    expect(after.shots).toEqual(before.shots);
    expect(after.turnDeadline!.toMillis()).toBeGreaterThanOrEqual(Date.now() - 10_000 + 60_000);
  });

  // depends on Child C
  it('does not skip a turn before deadline + grace', async () => {
    await users(ALICE, BOB);
    const { gameId, second } = await startedGame({ turnTimerMs: 60_000 });
    const before = await gameDoc(gameId);
    await expectNoSkip(claimTurnTimeout(second, { gameId }));
    // Expired but still inside the grace window.
    await refs.game(gameId).update({ turnDeadline: Timestamp.fromMillis(Date.now() - 500) });
    await expectNoSkip(claimTurnTimeout(second, { gameId }));
    expect((await gameDoc(gameId)).turnNumber).toBe(before.turnNumber);
  });

  // depends on Child C
  it('the third consecutive skip forfeits a rated game with endReason timeout', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ turnTimerMs: 120_000 });
    for (let skip = 1; skip <= 2; skip += 1) {
      await expireTurn(gameId);
      expect(await claimTurnTimeout(second, { gameId })).toEqual({ skipped: true, forfeited: false });
      expect((await gameDoc(gameId)).timeoutStreak?.[first]).toBe(skip);
      await missFor(second, gameId);
    }
    await expireTurn(gameId);
    const { pushes, after } = await pushesFor(gameId, async () => {
      expect(await claimTurnTimeout(second, { gameId })).toEqual({ skipped: false, forfeited: true });
    });

    expect(after).toMatchObject({
      status: 'finished',
      winnerUid: second,
      endReason: 'timeout',
      currentTurnUid: null,
      turnDeadline: null,
    });
    expect(after.ratingChanges?.[first]?.delta).toBeLessThan(0);
    expect(after.ratingChanges?.[second]?.delta).toBeGreaterThan(0);
    expect(recipients(pushes)).toContain(first);
    expectNoPrivateCoordinates(pushes, after);
  });

  // depends on Child C
  it('a move by the stalling player resets their streak', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ turnTimerMs: 60_000 });
    await expireTurn(gameId);
    await claimTurnTimeout(second, { gameId });
    await missFor(second, gameId);
    await missFor(first, gameId);
    expect((await gameDoc(gameId)).timeoutStreak?.[first]).toBe(0);

    await missFor(second, gameId);
    await expireTurn(gameId);
    await claimTurnTimeout(second, { gameId });
    await missFor(second, gameId);
    await expireTurn(gameId);
    expect(await claimTurnTimeout(second, { gameId })).toEqual({ skipped: true, forfeited: false });
    const game = await gameDoc(gameId);
    expect(game.status).toBe('active');
    expect(game.timeoutStreak?.[first]).toBe(2);
  });

  // depends on Child C
  it.each(['salvo', 'abilities'] as GameMode[])('skips work the same in %s', async (mode) => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ mode, turnTimerMs: 60_000 });
    await expireTurn(gameId);
    expect(await claimTurnTimeout(second, { gameId })).toEqual({ skipped: true, forfeited: false });
    const game = await gameDoc(gameId);
    expect(game).toMatchObject({ mode, status: 'active', currentTurnUid: second });
    expect(game.timeoutStreak?.[first]).toBe(1);
    await missFor(second, gameId);
    expect((await gameDoc(gameId)).currentTurnUid).toBe(first);
  });

  // depends on Child C
  it('the scheduled sweep skips expired timed turns and ignores untimed games', async () => {
    await users(ALICE, BOB);
    const timed = await startedGame({ turnTimerMs: 60_000 });
    const untimed = await startedGame();
    await expireTurn(timed.gameId);
    await refs.game(untimed.gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 2 * DAY_MS) });

    expect(await sweepTurnTimeouts(Timestamp.now())).toBe(1);
    expect(await gameDoc(timed.gameId)).toMatchObject({ currentTurnUid: timed.second, status: 'active' });
    expect((await gameDoc(untimed.gameId)).currentTurnUid).toBe(untimed.first);
    expect(await sweepTurnTimeouts(Timestamp.now())).toBe(0);
  });

  it('untimed games are never skipped', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame();
    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 2 * DAY_MS) });
    await expectNoSkip(claimTurnTimeout(second, { gameId }).catch((e) => {
      if (e instanceof HttpsError && e.code === 'unimplemented') return { skipped: false, forfeited: false };
      throw e;
    }));
    await sweepTurnTimeouts(Timestamp.now());
    const game = await gameDoc(gameId);
    expect(game).toMatchObject({ status: 'active', currentTurnUid: first, turnDeadline: null });
    expect(game.timeoutStreak?.[first] ?? 0).toBe(0);
  });

  it('the 3-day claimTimeoutWin still works on untimed games', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame();
    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 2 * DAY_MS) });
    await expectHttpsError(claimTimeoutWin(second, { gameId }), 'failed-precondition');

    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 4 * DAY_MS) });
    const { pushes, after } = await pushesFor(gameId, () => claimTimeoutWin(second, { gameId }));
    expect(after).toMatchObject({ status: 'finished', winnerUid: second, endReason: 'timeout', turnDeadline: null });
    expect(after.ratingChanges).not.toBeNull();
    expect(recipients(pushes)).toEqual([first]);
  });

  it('claimTimeoutWin falls back to the 3-day default when abandonTimeoutMs is missing', async () => {
    await users(ALICE, BOB);
    const { gameId, second } = await startedGame();
    await refs.game(gameId).update({
      abandonTimeoutMs: FieldValue.delete(),
      lastMoveAt: Timestamp.fromMillis(Date.now() - DAY_MS),
    });
    await expectHttpsError(claimTimeoutWin(second, { gameId }), 'failed-precondition');
    await refs.game(gameId).update({ lastMoveAt: Timestamp.fromMillis(Date.now() - 4 * DAY_MS) });
    expect(await claimTimeoutWin(second, { gameId })).toEqual({ winnerUid: second });
  });
});

// ---------------------------------------------------------------------------------------------
describe('notification-triggering transitions', () => {
  it('lobby → placement → battle → finish → rematch push the right player only', async () => {
    await users(ALICE, BOB);
    const { gameId, code } = await createGame(ALICE, { turnTimerMs: 60_000 });

    const joined = await pushesFor(gameId, () => joinGame(BOB, { code }));
    expect(recipients(joined.pushes)).toEqual([ALICE]);

    const aliceReady = await pushesFor(gameId, () => placeShips(ALICE, { gameId, ships: FLEET }));
    expect(recipients(aliceReady.pushes)).toEqual([BOB]);

    const battle = await pushesFor(gameId, () => placeShips(BOB, { gameId, ships: FLEET }));
    const first = battle.after.currentTurnUid!;
    const second = first === ALICE ? BOB : ALICE;
    expect(recipients(battle.pushes)).toEqual([first]);

    const hit = await pushesFor(gameId, () => fireShot(first, { gameId, row: 0, col: 0 }));
    expect(recipients(hit.pushes)).toEqual([second]);
    expect(hit.pushes[0]!.gameId).toBe(gameId);

    const miss = await pushesFor(gameId, () => fireShot(second, { gameId, row: 9, col: 9 }));
    expect(recipients(miss.pushes)).toEqual([first]);

    // A rejected duplicate write changes nothing, so nobody is pushed.
    const dup = await pushesFor(gameId, () => caught(fireShot(second, { gameId, row: 9, col: 8 })));
    expect(dup.pushes).toEqual([]);

    const resigned = await pushesFor(gameId, () => resign(second, { gameId }));
    expect(recipients(resigned.pushes)).toEqual([first]);

    const rematchAsked = await pushesFor(gameId, () => requestRematch(second, { gameId }));
    expect(recipients(rematchAsked.pushes)).toEqual([first]);

    const rematchId = rematchAsked.after.rematch!.gameId;
    const rematchAccepted = await pushesFor(rematchId, () => requestRematch(first, { gameId }));
    expect(recipients(rematchAccepted.pushes)).toEqual([second]);

    for (const step of [joined, aliceReady, battle, hit, miss, resigned, rematchAsked, rematchAccepted]) {
      expectNoPrivateCoordinates(step.pushes, step.after);
    }
  });

  it('an all-sunk finish tells the loser without leaking coordinates', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame();
    let hitIndex = 0;
    let last: Awaited<ReturnType<typeof pushesFor>> | undefined;
    while ((await gameDoc(gameId)).status === 'active') {
      const current = (await gameDoc(gameId)).currentTurnUid!;
      if (current === first) {
        const cell = FLEET_CELLS[hitIndex++]!;
        last = await pushesFor(gameId, () => fireShot(first, { gameId, ...cell }));
        expectNoPrivateCoordinates(last.pushes, last.after);
      } else {
        await missFor(second, gameId);
      }
    }
    expect(last!.after).toMatchObject({ status: 'finished', winnerUid: first, endReason: 'all_sunk' });
    expect(recipients(last!.pushes)).toEqual([second]);
  });

  // depends on Child A
  it('a Salvo volley sends one turn push that summarises the whole volley', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ mode: 'salvo' });
    const targets = [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 9, col: 5 },
      { row: 9, col: 6 },
      { row: 9, col: 7 },
    ];
    const { pushes, after } = await pushesFor(gameId, () => fireSalvo(first, { gameId, targets }));
    expect(recipients(pushes)).toEqual([second]);
    expect(pushes[0]!.body).toMatch(/5 shots/);
    expectNoPrivateCoordinates(pushes, after);
  });

  // depends on Child A
  it('an Abilities sonar turn pushes the opponent without describing a shot', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ mode: 'abilities' });
    const { pushes, after } = await pushesFor(gameId, () =>
      useAbility(first, { gameId, abilityId: 'submarine-sonar', target: { row: 2, col: 2 } }),
    );
    expect(recipients(pushes)).toEqual([second]);
    expect(pushes[0]!.body).not.toMatch(/fired at\s+and/);
    expectNoPrivateCoordinates(pushes, after);
  });

  // depends on Child C (skip) and Child A (skip copy)
  it('a skipped turn pushes the new shooter without describing a stale shot', async () => {
    await users(ALICE, BOB);
    const { gameId, first, second } = await startedGame({ turnTimerMs: 60_000 });
    await missFor(first, gameId);
    await missFor(second, gameId);
    await expireTurn(gameId);
    const { pushes, after } = await pushesFor(gameId, () => claimTurnTimeout(second, { gameId }));
    expect(after.currentTurnUid).toBe(second);
    expect(recipients(pushes)).toEqual([second]);
    expect(pushes[0]!.body).not.toMatch(/fired at/);
    expectNoPrivateCoordinates(pushes, after);
  });

  it('a new challenge pushes only the invitee', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB, mode: 'salvo', turnTimerMs: 60_000 });
    const challenge = (await refs.challenge(challengeId).get()).data()!;
    expect(notificationForChallenge(challengeId, challenge)).toMatchObject({ uid: BOB, challengeId });
  });

  async function respondPushes(accept: boolean) {
    await users(ALICE, BOB);
    await pastOpponents();
    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB, mode: 'abilities', turnTimerMs: 120_000 });
    const before = (await refs.challenge(challengeId).get()).data()!;
    const { gameId } = await respondChallenge(BOB, { challengeId, accept });
    const after = (await refs.challenge(challengeId).get()).data()!;
    return { challengeId, gameId, before, after, pushes: notificationsForChallengeUpdate(challengeId, before, after) };
  }

  // depends on Child A
  it('an accepted challenge pushes the challenger with the new game', async () => {
    const { gameId, pushes } = await respondPushes(true);
    expect(recipients(pushes)).toEqual([ALICE]);
    expect(pushes[0]!.gameId).toBe(gameId);
    expectNoPrivateCoordinates(pushes, undefined);
  });

  // depends on Child A
  it('a declined challenge pushes the challenger with no game', async () => {
    const { pushes } = await respondPushes(false);
    expect(recipients(pushes)).toEqual([ALICE]);
    expect(pushes[0]!.gameId).toBeUndefined();
  });

  it('a cancelled or unchanged challenge pushes nobody', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    const { challengeId } = await createChallenge(ALICE, { opponentUid: BOB, mode: 'classic' });
    const before = (await refs.challenge(challengeId).get()).data()!;
    expect(notificationsForChallengeUpdate(challengeId, before, before)).toEqual([]);
    await cancelChallenge(ALICE, { challengeId });
    const after = (await refs.challenge(challengeId).get()).data() as ChallengeDoc;
    expect(recipients(notificationsForChallengeUpdate(challengeId, before, after))).not.toContain(ALICE);
  });

  // depends on Child A
  it('sends at most one 24 h reminder per pending untimed turn', async () => {
    await users(ALICE, BOB);
    const idle = await startedGame();
    const fresh = await startedGame({ mode: 'salvo' });
    const timed = await startedGame({ turnTimerMs: 60_000 });
    const old = Timestamp.fromMillis(Date.now() - GAME_CONFIG.TURN_REMINDER_AFTER_MS - 60_000);
    await refs.game(idle.gameId).update({ lastMoveAt: old });
    await refs.game(timed.gameId).update({ lastMoveAt: old });

    expect(await sendTurnReminders(Timestamp.now())).toBe(1);
    const reminded = await gameDoc(idle.gameId);
    expect(reminded.remindedTurn).toBe(reminded.turnNumber);
    expect((await gameDoc(fresh.gameId)).remindedTurn).toBeNull();
    expect((await gameDoc(timed.gameId)).remindedTurn).toBeNull();
    expect(await sendTurnReminders(Timestamp.now())).toBe(0);

    // The next pending turn is eligible again once it has also been idle for 24 h.
    await missFor(idle.first, idle.gameId);
    await refs.game(idle.gameId).update({ lastMoveAt: old });
    expect(await sendTurnReminders(Timestamp.now())).toBe(1);
    const next = await gameDoc(idle.gameId);
    expect(next.remindedTurn).toBe(next.turnNumber);
  });
});

// ---------------------------------------------------------------------------------------------
describe('guest games are unrated', () => {
  async function snapshotsOf(...uids: string[]) {
    return Promise.all(uids.map(async (uid) => (await refs.user(uid).get()).data()!));
  }

  it('an all-sunk finish updates stats only, never rating, weekly wins, or opponents', async () => {
    await users(ALICE, BOB);
    await refs.user(BOB).update({ isGuest: true });
    const { gameId, first, second } = await startedGame({ mode: 'classic' });
    expect((await gameDoc(gameId)).isRated).toBe(false);
    const [aliceBefore, bobBefore] = await snapshotsOf(ALICE, BOB);

    let hitIndex = 0;
    while ((await gameDoc(gameId)).status === 'active') {
      const current = (await gameDoc(gameId)).currentTurnUid!;
      if (current === first) await fireShot(first, { gameId, ...FLEET_CELLS[hitIndex++]! });
      else await missFor(second, gameId);
    }
    const finished = await gameDoc(gameId);
    expect(finished).toMatchObject({ status: 'finished', winnerUid: first, endReason: 'all_sunk', ratingChanges: null });

    const [aliceAfter, bobAfter] = await snapshotsOf(ALICE, BOB);
    expect(aliceAfter!.rating).toBe(aliceBefore!.rating);
    expect(bobAfter!.rating).toBe(bobBefore!.rating);
    expect(aliceAfter!.stats.gamesPlayed).toBe(aliceBefore!.stats.gamesPlayed + 1);
    expect(bobAfter!.stats.gamesPlayed).toBe(bobBefore!.stats.gamesPlayed + 1);
    const week = weekId(new Date());
    expect((await refs.weeklyWins(week, ALICE).get()).exists).toBe(false);
    expect((await refs.weeklyWins(week, BOB).get()).exists).toBe(false);
    expect((await refs.opponent(ALICE, BOB).get()).exists).toBe(false);
    expect((await refs.opponent(BOB, ALICE).get()).exists).toBe(false);
  });

  it('a guest host makes the game unrated and a rematch stays unrated', async () => {
    await users(ALICE, BOB);
    await refs.user(ALICE).update({ isGuest: true });
    const { gameId } = await startedGame({ mode: 'salvo', turnTimerMs: 60_000 });
    const game = await gameDoc(gameId);
    expect(game.isRated).toBe(false);
    expect(game.players[ALICE]!.isGuest).toBe(true);
    expect(game.players[BOB]!.isGuest).toBe(false);

    await resign(BOB, { gameId });
    const { gameId: rematchId } = await requestRematch(BOB, { gameId });
    await requestRematch(ALICE, { gameId });
    expect(await gameDoc(rematchId)).toMatchObject({ isRated: false, mode: 'salvo', turnTimerMs: 60_000 });
  });

  // depends on Child C
  it('a timeout forfeit involving a guest is unrated', async () => {
    await users(ALICE, BOB);
    await refs.user(BOB).update({ isGuest: true });
    const { gameId, second } = await startedGame({ turnTimerMs: 60_000 });
    const [aliceBefore, bobBefore] = await snapshotsOf(ALICE, BOB);
    for (let skip = 1; skip <= 3; skip += 1) {
      await expireTurn(gameId);
      await claimTurnTimeout(second, { gameId });
      if (skip < 3) await missFor(second, gameId);
    }
    expect(await gameDoc(gameId)).toMatchObject({ status: 'finished', endReason: 'timeout', winnerUid: second, ratingChanges: null });
    const [aliceAfter, bobAfter] = await snapshotsOf(ALICE, BOB);
    expect(aliceAfter!.rating).toBe(aliceBefore!.rating);
    expect(bobAfter!.rating).toBe(bobBefore!.rating);
    expect(aliceAfter!.stats.gamesPlayed).toBe(aliceBefore!.stats.gamesPlayed + 1);
  });

  // depends on Child B
  it('a guest cannot join Quick Match', async () => {
    await users(ALICE);
    await refs.user(ALICE).update({ isGuest: true });
    await expectHttpsError(joinQuickMatch(ALICE, { mode: 'classic' }), ['failed-precondition', 'permission-denied']);
    expect((await refs.quickMatch(ALICE).get()).exists).toBe(false);
  });

  // depends on Child B
  it('a guest cannot send a challenge', async () => {
    await users(ALICE, BOB);
    await pastOpponents();
    await refs.user(ALICE).update({ isGuest: true });
    await expectHttpsError(
      createChallenge(ALICE, { opponentUid: BOB, mode: 'classic' }),
      ['failed-precondition', 'permission-denied'],
    );
    expect((await refs.challenges().get()).size).toBe(0);
  });
});
