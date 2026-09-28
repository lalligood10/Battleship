/**
 * Quick Match (M4): a rating-banded queue. `joinQuickMatch` either pairs the caller with the
 * best-fitting waiting ticket (see ../game/matchmaking; creating a game that skips the 'waiting'
 * phase) or leaves a ticket for a later caller. The waiting client listens to its own
 * quickMatch/{uid} doc; when `gameId` appears it navigates to the game. Waiting clients call
 * `joinQuickMatch` again periodically: that keeps the ticket's original `createdAt` (so its band
 * keeps widening) and lets them pick up tickets that arrived while they waited.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { GAME_CONFIG } from '../game/config';
import { pickQuickMatchOpponent, QUICK_MATCH_COOLDOWN_CHECKS, rankQuickMatchCandidates } from '../game/matchmaking';
import { db, refs } from '../lib/firestore';
import { generateJoinCode } from '../lib/joinCode';
import { joinUpdate, newGameDoc } from './games';

export interface QuickMatchResult {
  /** Set when a game was created immediately; otherwise the caller is waiting in the queue. */
  gameId: string | null;
}

/** `now` is injectable for tests; callables always use the server clock. */
export async function joinQuickMatch(uid: string, _data?: unknown, now = Timestamp.now()): Promise<QuickMatchResult> {
  return db.runTransaction(async (tx) => {
    const [meSnap, myTicketSnap] = await Promise.all([tx.get(refs.user(uid)), tx.get(refs.quickMatch(uid))]);
    const me = meSnap.data();
    if (!me) throw new HttpsError('failed-precondition', 'Choose a username before playing');

    const nowMs = now.toMillis();
    const freshAfterMs = nowMs - GAME_CONFIG.QUICK_MATCH_TICKET_TTL_MS;
    const myTicket = myTicketSnap.data();
    // Already matched by someone else but not navigated yet: hand back the same game.
    if (myTicket?.gameId) return { gameId: myTicket.gameId };

    const candidates = await tx.get(
      refs
        .quickMatchQueue()
        .where('createdAt', '>=', Timestamp.fromMillis(freshAfterMs))
        .orderBy('createdAt', 'asc')
        .limit(25),
    );
    const tickets = candidates.docs.map((d) => {
      const t = d.data();
      return { uid: d.id, rating: t.rating, createdAtMs: t.createdAt.toMillis(), gameId: t.gameId };
    });
    const seeker = { uid, rating: me.rating };

    // Skip anyone we finished a rated game with recently (anti-farming).
    const best = rankQuickMatchCandidates(seeker, tickets, nowMs).slice(0, QUICK_MATCH_COOLDOWN_CHECKS);
    const history = await Promise.all(best.map((t) => tx.get(refs.opponent(uid, t.uid))));
    const onCooldown = new Set(
      history
        .filter((h) => {
          const last = h.data()?.lastPlayedAt;
          return last && nowMs - last.toMillis() < GAME_CONFIG.QUICK_MATCH_REPEAT_COOLDOWN_MS;
        })
        .map((h) => h.id),
    );
    const pick = pickQuickMatchOpponent(seeker, best, nowMs, onCooldown);

    if (!pick) {
      const keepCreatedAt = myTicket && myTicket.createdAt.toMillis() >= freshAfterMs;
      tx.set(refs.quickMatch(uid), {
        username: me.username,
        rating: me.rating,
        createdAt: keepCreatedAt ? myTicket.createdAt : now,
        gameId: null,
      });
      return { gameId: null };
    }

    const opponentUid = pick.uid;
    const ticketRef = refs.quickMatch(opponentUid);
    const opponent = (await tx.get(refs.user(opponentUid))).data();
    if (!opponent) {
      tx.delete(ticketRef);
      throw new HttpsError('unavailable', 'Try again');
    }

    const gameRef = refs.games().doc();
    const code = generateJoinCode();
    const base = newGameDoc(opponentUid, opponent, code, now, { isQuickMatch: true });
    tx.set(gameRef, { ...base, ...joinUpdate(base, uid, me, now) });
    tx.set(refs.gameCode(code), { gameId: gameRef.id, createdAt: now });
    // Tell the waiting player where to go; they delete the ticket once they've navigated.
    tx.update(ticketRef, { gameId: gameRef.id });
    tx.delete(refs.quickMatch(uid));
    return { gameId: gameRef.id };
  });
}

export async function cancelQuickMatch(uid: string): Promise<void> {
  await refs.quickMatch(uid).delete();
}
