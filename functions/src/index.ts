/**
 * Cloud Functions entry point. Thin wrappers only: each callable checks authentication and hands
 * the verified uid to a handler in ./handlers. Business rules live in the handlers and ./game so
 * they can be unit tested without the Functions runtime.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from './handlers/admin';
import * as bots from './handlers/bots';
import * as challenges from './handlers/challenges';
import * as games from './handlers/games';
import * as guests from './handlers/guests';
import * as quickMatch from './handlers/quickMatch';
import * as timers from './handlers/timers';
import * as users from './handlers/users';
import { refs } from './lib/firestore';
import { cleanupStale } from './triggers/cleanup';
import { sendTurnReminders } from './triggers/reminders';
import {
  deliver,
  notificationForChallenge,
  notificationsForChallengeUpdate,
  notificationsForChange,
} from './triggers/notifications';
import type { ChallengeDoc, GameDoc } from './types';

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

type Handler<T> = (uid: string, data: unknown) => Promise<T>;

/** Wraps a handler as a callable that requires a signed-in user. */
function authed<T>(handler: Handler<T>) {
  return onCall({ enforceAppCheck: false }, async (request: CallableRequest<unknown>): Promise<T> => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue');
    return handler(uid, request.data);
  });
}

function active<T>(handler: Handler<T>) {
  return authed(async (uid, data) => {
    const profile = (await refs.user(uid).get()).data();
    if (!profile) throw new HttpsError('failed-precondition', 'Choose a username before playing');
    if (profile.suspended) throw new HttpsError('permission-denied', 'This account has been suspended');
    return handler(uid, data);
  });
}

// Accounts
export const setUsername = authed(users.setUsername);
export const checkUsername = authed(users.checkUsername);

// Owner administration
export const adminStatus = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue');
  return admin.adminStatus({
    uid,
    email: request.auth?.token.email as string | undefined,
    emailVerified: request.auth?.token.email_verified === true,
  });
});
export const adminListUsers = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue');
  return admin.listUsers({
    uid,
    email: request.auth?.token.email as string | undefined,
    emailVerified: request.auth?.token.email_verified === true,
  });
});
export const adminUpdateUser = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue');
  return admin.updateUser(
    {
      uid,
      email: request.auth?.token.email as string | undefined,
      emailVerified: request.auth?.token.email_verified === true,
    },
    request.data,
  );
});

// Game lifecycle (M1)
export const createGame = active(games.createGame);
export const joinGame = active(games.joinGame);
export const requestRematch = active(games.requestRematch);
export const cancelGame = active(games.cancelGame);
export const placeShips = active(games.placeShips);
export const fireShot = active(games.fireShot);
export const fireSalvo = active(games.fireSalvo);
export const useAbility = active(games.useAbility);
export const resign = active(games.resign);
export const claimTurnTimeout = active(timers.claimTurnTimeout);
export const completeGuestUpgrade = authed(guests.completeGuestUpgrade);

// Play vs Computer
export const createBotGame = active(bots.createBotGame);

// Abandonment (M3)
export const claimTimeoutWin = active(games.claimTimeoutWin);

// Quick Match (M4)
export const joinQuickMatch = active(quickMatch.joinQuickMatch);
export const cancelQuickMatch = active(quickMatch.cancelQuickMatch);

// Direct challenges (F1)
export const createChallenge = authed(challenges.createChallenge);
export const respondChallenge = authed(challenges.respondChallenge);
export const cancelChallenge = authed(challenges.cancelChallenge);

export const onChallengeCreated = onDocumentCreated('challenges/{challengeId}', async (event) => {
  const challenge = event.data?.data() as ChallengeDoc | undefined;
  const notification = challenge ? notificationForChallenge(event.params.challengeId, challenge) : null;
  if (notification) await deliver([notification]);
});

export const onChallengeUpdated = onDocumentUpdated('challenges/{challengeId}', async (event) => {
  const before = event.data?.before.data() as ChallengeDoc | undefined;
  const after = event.data?.after.data() as ChallengeDoc | undefined;
  if (!after) return;
  await deliver(notificationsForChallengeUpdate(event.params.challengeId, before, after));
});

// Quick-chat reactions (F5)
export const sendReaction = active(games.sendReaction);
export const sendChatMessage = active(games.sendChatMessage);

// Push notifications on every game change (M3)
export const onGameWritten = onDocumentWritten('games/{gameId}', async (event) => {
  const after = event.data?.after.data() as GameDoc | undefined;
  if (!after) return;
  const before = event.data?.before.data() as GameDoc | undefined;
  await deliver(notificationsForChange(event.params.gameId, before, after));
});

// Daily housekeeping (M3)
export const cleanupStaleGames = onSchedule('every 24 hours', async () => {
  await cleanupStale();
});

export const sweepExpiredTurns = onSchedule('every 5 minutes', async () => {
  await timers.sweepTurnTimeouts();
});
export const turnReminders = onSchedule('every 60 minutes', async () => {
  await sendTurnReminders();
});
