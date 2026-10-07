import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  EmailAuthProvider,
  getAuth as getClientAuth,
  linkWithCredential,
  signInAnonymously,
} from 'firebase/auth';
import { HttpsError } from 'firebase-functions/v2/https';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShipPlacement } from '../src/game/engine';
import { createBotGame } from '../src/handlers/bots';
import { createChallenge, respondChallenge } from '../src/handlers/challenges';
import { createGame, joinGame, placeShips, requestRematch, resign } from '../src/handlers/games';
import { completeGuestUpgrade } from '../src/handlers/guests';
import { joinQuickMatch } from '../src/handlers/quickMatch';
import { setUsername } from '../src/handlers/users';
import { refs } from '../src/lib/firestore';
import { clearFirestore, PROJECT_ID } from './setup';

const authApp = initializeApp({ apiKey: 'fake', projectId: PROJECT_ID }, 'guest-tests');
const clientAuth = getClientAuth(authApp);
connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });

const BOB = 'uid-guest-test-bob';
const FLEET: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];

async function expectHttpsError(promise: Promise<unknown>, code: string, message: string) {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect(caught).toMatchObject({ code, message });
}

async function createGuest() {
  const { user } = await signInAnonymously(clientAuth);
  return user;
}

async function linkGuest(user: Awaited<ReturnType<typeof createGuest>>, email: string) {
  return linkWithCredential(user, EmailAuthProvider.credential(email, 'password123'));
}

beforeEach(async () => {
  await clientAuth.signOut();
  const deleted = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
  if (!deleted.ok) throw new Error(`Failed to clear Auth emulator: ${deleted.status}`);
  await clearFirestore();
});

describe('guest profiles and upgrade', () => {
  it('creates anonymous profiles as hidden guests and preserves guest status when renamed', async () => {
    const user = await createGuest();
    await setUsername(user.uid, { username: 'GuestOne' });
    expect((await refs.user(user.uid).get()).data()).toMatchObject({
      isGuest: true,
      leaderboardVisible: false,
    });

    await setUsername(user.uid, { username: 'GuestTwo' });
    expect((await refs.user(user.uid).get()).data()).toMatchObject({
      username: 'GuestTwo',
      isGuest: true,
      leaderboardVisible: false,
    });
  });

  it('creates ordinary profiles for email users and auth-missing emulator test users', async () => {
    const emailUser = await getAuth().createUser({ email: 'member@example.test', password: 'password123' });
    await setUsername(emailUser.uid, { username: 'Member' });
    const emailProfile = (await refs.user(emailUser.uid).get()).data()!;
    expect(emailProfile).not.toHaveProperty('isGuest');
    expect(emailProfile.leaderboardVisible).toBe(true);

    await setUsername('uid-without-auth-record', { username: 'FakeUid' });
    const fakeProfile = (await refs.user('uid-without-auth-record').get()).data()!;
    expect(fakeProfile).not.toHaveProperty('isGuest');
    expect(fakeProfile.leaderboardVisible).toBe(true);
  });

  it('requires a linked provider, upgrades idempotently, and keeps suspended guests hidden', async () => {
    const user = await createGuest();
    await setUsername(user.uid, { username: 'UpgradeMe' });
    await expectHttpsError(
      completeGuestUpgrade(user.uid),
      'failed-precondition',
      'Link an email or Google account first',
    );

    await linkGuest(user, 'upgrade@example.test');
    expect(await completeGuestUpgrade(user.uid)).toEqual({ isGuest: false });
    expect((await refs.user(user.uid).get()).data()).toMatchObject({
      isGuest: false,
      leaderboardVisible: true,
    });
    expect(await completeGuestUpgrade(user.uid)).toEqual({ isGuest: false });

    const suspended = await createGuest();
    await setUsername(suspended.uid, { username: 'SuspendedGuest' });
    await refs.user(suspended.uid).update({ suspended: true });
    await linkGuest(suspended, 'suspended@example.test');
    expect(await completeGuestUpgrade(suspended.uid)).toEqual({ isGuest: false });
    expect((await refs.user(suspended.uid).get()).data()).toMatchObject({
      isGuest: false,
      suspended: true,
      leaderboardVisible: false,
    });
  });

  it('rejects an Auth-missing UID with the account-linking precondition', async () => {
    await expectHttpsError(
      completeGuestUpgrade('uid-without-auth-record'),
      'failed-precondition',
      'Link an email or Google account first',
    );
  });

  it('returns a non-guest result without writing when the profile is missing', async () => {
    const member = await getAuth().createUser({ email: 'profileless@example.test', password: 'password123' });
    expect(await completeGuestUpgrade(member.uid)).toEqual({ isGuest: false });
    expect((await refs.user(member.uid).get()).exists).toBe(false);
  });
});

describe('guest game permissions', () => {
  it('blocks Quick Match and sent challenges with the guest-specific message', async () => {
    const guest = await createGuest();
    await setUsername(guest.uid, { username: 'GuestSender' });
    await setUsername(BOB, { username: 'Bob' });

    await expectHttpsError(
      joinQuickMatch(guest.uid, { mode: 'classic' }),
      'failed-precondition',
      'Create an account to use Quick Match',
    );
    await expectHttpsError(
      createChallenge(guest.uid, { opponentUid: BOB, mode: 'classic' }),
      'failed-precondition',
      'Create an account to send challenges',
    );
  });

  it('allows guests to host, join, play bots, accept challenges, and request rematches unrated', async () => {
    const guest = await createGuest();
    await setUsername(guest.uid, { username: 'GuestPlayer' });
    await setUsername(BOB, { username: 'Bob' });

    const hosted = await createGame(guest.uid);
    await joinGame(BOB, { code: hosted.code });
    expect((await refs.game(hosted.gameId).get()).data()!.isRated).toBe(false);

    const joined = await createGame(BOB);
    await joinGame(guest.uid, { code: joined.code });
    expect((await refs.game(joined.gameId).get()).data()!.isRated).toBe(false);

    const botGame = await createBotGame(guest.uid, { difficulty: 'easy', mode: 'classic' });
    expect((await refs.game(botGame.gameId).get()).data()!.playerUids).toContain(guest.uid);

    await placeShips(guest.uid, { gameId: hosted.gameId, ships: FLEET });
    await placeShips(BOB, { gameId: hosted.gameId, ships: FLEET });
    await resign(guest.uid, { gameId: hosted.gameId });
    await refs.opponent(BOB, guest.uid).set({
      username: 'GuestPlayer',
      gamesPlayed: 1,
      lastPlayedAt: Timestamp.now(),
    });
    const invite = await createChallenge(BOB, { opponentUid: guest.uid, mode: 'classic' });
    expect(await respondChallenge(guest.uid, { challengeId: invite.challengeId, accept: true })).toHaveProperty('gameId');

    const waitingRematch = await requestRematch(guest.uid, { gameId: hosted.gameId });
    expect(waitingRematch.status).toBe('waiting');
    const acceptedRematch = await requestRematch(BOB, { gameId: hosted.gameId });
    expect(acceptedRematch.status).toBe('placing');
    expect((await refs.game(acceptedRematch.gameId).get()).data()).toMatchObject({
      playerUids: [guest.uid, BOB],
      isRated: false,
    });
  });
});
