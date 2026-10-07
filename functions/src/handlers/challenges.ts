/**
 * Direct challenges (F1): invite a past opponent to a new game. Challenges live in their own
 * collection because games/{id} is only readable by its players, so an invitee could never see a
 * waiting game. Accepting creates a game that skips 'waiting' and goes straight to 'placing'.
 * A challenge with a `sourceGameId` is a rematch (F2) of that finished game.
 */
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { isBotUid } from '../game/bots';
import { GAME_CONFIG } from '../game/config';
import { parseGameModeInput, type GameMode } from '../game/core/schema';
import { db, refs } from '../lib/firestore';
import type { ChallengeDoc } from '../types';
import { joinUpdate, newGameDoc, requireUser, reserveJoinCode } from './games';

export interface CreateChallengeResult {
  challengeId: string;
  /** Set when an opposite pending challenge was auto-accepted and the game already exists. */
  gameId: string | null;
}

export interface RespondChallengeResult {
  gameId: string | null;
}

function requireId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${name} is required`);
  }
  return value;
}

export function isChallengeExpired(challenge: ChallengeDoc, nowMs: number): boolean {
  return challenge.createdAt.toMillis() < nowMs - GAME_CONFIG.CHALLENGE_TTL_MS;
}

function pendingBetween(tx: Transaction, fromUid: string, toUid: string) {
  return tx.get(
    refs
      .challenges()
      .where('fromUid', '==', fromUid)
      .where('toUid', '==', toUid)
      .where('status', '==', 'pending'),
  );
}

/**
 * Accepts `challenge` inside `tx`: creates the game (challenger hosts) and links it. Performs all of
 * its reads before any write, so callers must not have written in `tx` yet.
 */
async function acceptInTx(
  tx: Transaction,
  ref: DocumentReference<ChallengeDoc>,
  challenge: ChallengeDoc,
  now: Timestamp,
): Promise<string> {
  const fromUser = (await tx.get(refs.user(challenge.fromUid))).data();
  if (!fromUser) throw new HttpsError('not-found', 'That player no longer exists');
  const toUser = await requireUser(challenge.toUid, tx);
  const code = await reserveJoinCode(tx);

  const gameRef = refs.games().doc();
  const base = newGameDoc(challenge.fromUid, fromUser, code, now, {
    isQuickMatch: false,
    mode: challenge.mode ?? 'classic',
  });
  tx.set(gameRef, { ...base, ...joinUpdate(base, challenge.toUid, toUser, now) });
  tx.set(refs.gameCode(code), { gameId: gameRef.id, createdAt: now });
  tx.update(ref, { status: 'accepted', gameId: gameRef.id, respondedAt: now });
  return gameRef.id;
}

/** Rematch of an already-accepted `sourceGameId`: the game it started, if any. */
function acceptedRematch(tx: Transaction, sourceGameId: string) {
  return tx.get(
    refs.challenges().where('sourceGameId', '==', sourceGameId).where('status', '==', 'accepted').limit(1),
  );
}

// ---------- createChallenge ----------

export async function createChallenge(uid: string, data: unknown): Promise<CreateChallengeResult> {
  const input = (data ?? {}) as { opponentUid?: unknown; mode?: unknown; sourceGameId?: unknown };
  const opponentUid = requireId(input.opponentUid, 'opponentUid');
  const requestedMode = parseGameModeInput(input.mode);
  if (!requestedMode) throw new HttpsError('invalid-argument', 'Choose a game type');
  const sourceGameId =
    input.sourceGameId === undefined || input.sourceGameId === null ? null : requireId(input.sourceGameId, 'sourceGameId');
  if (opponentUid === uid) throw new HttpsError('invalid-argument', "You can't challenge yourself");
  if (isBotUid(opponentUid)) throw new HttpsError('invalid-argument', 'Use Play vs Computer to play a bot');

  return db.runTransaction(async (tx) => {
    const [me, opponentSnap, playedSnap, forward, reverse, sourceSnap, rematched] = await Promise.all([
      requireUser(uid, tx),
      tx.get(refs.user(opponentUid)),
      tx.get(refs.opponent(uid, opponentUid)),
      pendingBetween(tx, uid, opponentUid),
      pendingBetween(tx, opponentUid, uid),
      sourceGameId ? tx.get(refs.game(sourceGameId)) : null,
      sourceGameId ? acceptedRematch(tx, sourceGameId) : null,
    ]);
    const opponent = opponentSnap.data();
    if (!opponent) throw new HttpsError('not-found', 'Player not found');
    if (opponent.isBot) throw new HttpsError('invalid-argument', 'Use Play vs Computer to play a bot');
    if (!playedSnap.exists) {
      throw new HttpsError('failed-precondition', "You can only challenge players you've already played");
    }
    if (sourceSnap) {
      const source = sourceSnap.data();
      if (!source || !source.playerUids.includes(uid) || !source.playerUids.includes(opponentUid)) {
        throw new HttpsError('permission-denied', 'You can only rematch a game you both played');
      }
      if (source.status !== 'finished') throw new HttpsError('failed-precondition', 'That game is not finished yet');
    }
    const mode: GameMode = sourceSnap?.data()?.mode ?? requestedMode;
    // Both players already agreed to this rematch: point at the game it started.
    const done = rematched?.docs[0];
    if (done) return { challengeId: done.id, gameId: done.data().gameId };

    const now = Timestamp.now();
    const live = (d: (typeof forward.docs)[number]) => !isChallengeExpired(d.data(), now.toMillis());
    const staleDocs = [...forward.docs, ...reverse.docs].filter((d) => !live(d));

    // They already challenged me: accepting theirs is the same as both agreeing to play.
    const incoming = reverse.docs.find((d) => live(d) && (d.data().mode ?? 'classic') === mode);
    if (incoming) {
      const gameId = await acceptInTx(tx, incoming.ref, incoming.data(), now);
      for (const d of staleDocs) tx.update(d.ref, { status: 'expired', respondedAt: now });
      return { challengeId: incoming.id, gameId };
    }

    const mine = forward.docs.find((d) => live(d) && (d.data().mode ?? 'classic') === mode);
    if (mine && sourceGameId && mine.data().sourceGameId === sourceGameId) return { challengeId: mine.id, gameId: null };
    if (mine) {
      throw new HttpsError('already-exists', `You already challenged ${opponent.username}`);
    }

    for (const d of staleDocs) tx.update(d.ref, { status: 'expired', respondedAt: now });
    const ref = refs.challenges().doc();
    const challenge: ChallengeDoc = {
      fromUid: uid,
      toUid: opponentUid,
      fromUsername: me.username,
      toUsername: opponent.username,
      mode,
      status: 'pending',
      sourceGameId,
      gameId: null,
      createdAt: now,
      respondedAt: null,
    };
    tx.set(ref, challenge);
    return { challengeId: ref.id, gameId: null };
  });
}

// ---------- respondChallenge (invitee) ----------

export async function respondChallenge(uid: string, data: unknown): Promise<RespondChallengeResult> {
  const input = (data ?? {}) as { challengeId?: unknown; accept?: unknown };
  const challengeId = requireId(input.challengeId, 'challengeId');
  if (typeof input.accept !== 'boolean') throw new HttpsError('invalid-argument', 'accept must be true or false');
  const accept = input.accept;

  return db.runTransaction(async (tx) => {
    const ref = refs.challenge(challengeId);
    const challenge = (await tx.get(ref)).data();
    if (!challenge) throw new HttpsError('not-found', 'Challenge not found');
    if (challenge.toUid !== uid) throw new HttpsError('permission-denied', 'This challenge is not for you');
    if (challenge.status !== 'pending') throw new HttpsError('failed-precondition', 'This challenge is no longer open');

    const now = Timestamp.now();
    if (isChallengeExpired(challenge, now.toMillis())) {
      throw new HttpsError('failed-precondition', 'This challenge has expired');
    }
    if (!accept) {
      tx.update(ref, { status: 'declined', respondedAt: now });
      return { gameId: null };
    }
    return { gameId: await acceptInTx(tx, ref, challenge, now) };
  });
}

// ---------- cancelChallenge (challenger) ----------

export async function cancelChallenge(uid: string, data: unknown): Promise<void> {
  const challengeId = requireId((data as { challengeId?: unknown } | undefined)?.challengeId, 'challengeId');
  await db.runTransaction(async (tx) => {
    const ref = refs.challenge(challengeId);
    const challenge = (await tx.get(ref)).data();
    if (!challenge) throw new HttpsError('not-found', 'Challenge not found');
    if (challenge.fromUid !== uid) throw new HttpsError('permission-denied', 'Only the challenger can cancel');
    if (challenge.status !== 'pending') throw new HttpsError('failed-precondition', 'This challenge is no longer open');
    tx.update(ref, { status: 'cancelled', respondedAt: Timestamp.now() });
  });
}
