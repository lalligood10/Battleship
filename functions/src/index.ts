/**
 * Cloud Functions entry point. Thin wrappers only: each callable checks authentication and hands
 * the verified uid to a handler in ./handlers. Business rules live in the handlers and ./game so
 * they can be unit tested without the Functions runtime.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as bots from './handlers/bots';
import * as games from './handlers/games';
import * as quickMatch from './handlers/quickMatch';
import * as users from './handlers/users';
import { cleanupStale } from './triggers/cleanup';
import { deliver, notificationsForChange } from './triggers/notifications';
import type { GameDoc } from './types';

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

// Accounts
export const setUsername = authed(users.setUsername);
export const checkUsername = authed(users.checkUsername);

// Game lifecycle (M1)
export const createGame = authed(games.createGame);
export const joinGame = authed(games.joinGame);
export const cancelGame = authed(games.cancelGame);
export const placeShips = authed(games.placeShips);
export const fireShot = authed(games.fireShot);
export const resign = authed(games.resign);

// Play vs Computer
export const createBotGame = authed(bots.createBotGame);

// Abandonment (M3)
export const claimTimeoutWin = authed(games.claimTimeoutWin);

// Quick Match (M4)
export const joinQuickMatch = authed(quickMatch.joinQuickMatch);
export const cancelQuickMatch = authed(quickMatch.cancelQuickMatch);

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
