/**
 * Quick Match (M4): a simple first-come queue. `joinQuickMatch` either pairs the caller with the
 * oldest waiting ticket (creating a game that skips the 'waiting' phase) or leaves a ticket for
 * the next caller. The waiting client listens to its own quickMatch/{uid} doc; when `gameId`
 * appears it navigates to the game.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { GAME_CONFIG } from '../game/config';
import { db, refs } from '../lib/firestore';
import { generateJoinCode } from '../lib/joinCode';
import { joinUpdate, newGameDoc } from './games';

export interface QuickMatchResult {
  /** Set when a game was created immediately; otherwise the caller is waiting in the queue. */
  gameId: string | null;
}

export async function joinQuickMatch(uid: string): Promise<QuickMatchResult> {
  return db.runTransaction(async (tx) => {
    const meSnap = await tx.get(refs.user(uid));
    const me = meSnap.data();
    if (!me) throw new HttpsError('failed-precondition', 'Choose a username before playing');

    const now = Timestamp.now();
    const freshAfter = Timestamp.fromMillis(now.toMillis() - GAME_CONFIG.QUICK_MATCH_TICKET_TTL_MS);
    const candidates = await tx.get(
      refs
        .quickMatchQueue()
        .where('createdAt', '>=', freshAfter)
        .orderBy('createdAt', 'asc')
        .limit(5),
    );
    const ticket = candidates.docs.find((d) => d.id !== uid && !d.data().gameId);

    if (!ticket) {
      tx.set(refs.quickMatch(uid), { username: me.username, rating: me.rating, createdAt: now, gameId: null });
      return { gameId: null };
    }

    const opponentUid = ticket.id;
    const opponent = (await tx.get(refs.user(opponentUid))).data();
    if (!opponent) {
      tx.delete(ticket.ref);
      throw new HttpsError('unavailable', 'Try again');
    }

    const gameRef = refs.games().doc();
    const code = generateJoinCode();
    const base = newGameDoc(opponentUid, opponent, code, now, { isQuickMatch: true });
    tx.set(gameRef, { ...base, ...joinUpdate(base, uid, me, now) });
    tx.set(refs.gameCode(code), { gameId: gameRef.id, createdAt: now });
    // Tell the waiting player where to go; they delete the ticket once they've navigated.
    tx.update(ticket.ref, { gameId: gameRef.id });
    tx.delete(refs.quickMatch(uid));
    return { gameId: gameRef.id };
  });
}

export async function cancelQuickMatch(uid: string): Promise<void> {
  await refs.quickMatch(uid).delete();
}
