import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { EMPTY_STATS, SCORING_CONFIG, weekId } from '../game/scoring';
import { db, refs } from '../lib/firestore';
import { validateUsername } from '../lib/username';
import type { UserDoc } from '../types';

export interface SetUsernameResult {
  username: string;
}

async function propagateUsername(uid: string, username: string): Promise<void> {
  const [games, weekly, ticket] = await Promise.all([
    refs.games().where('playerUids', 'array-contains', uid).get(),
    refs.weeklyWins(weekId(new Date()), uid).get(),
    refs.quickMatch(uid).get(),
  ]);
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = games.docs.map(
    (game) => (batch) => batch.update(game.ref, new FieldPath('players', uid, 'username'), username),
  );
  if (weekly.exists) writes.push((batch) => batch.update(weekly.ref, { username }));
  if (ticket.exists) writes.push((batch) => batch.update(ticket.ref, { username }));

  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + 400)) write(batch);
    await batch.commit();
  }
}

/**
 * First-sign-in onboarding: claims a unique username and creates the users/{uid} profile.
 * Also allows renaming later (the old username is released).
 */
export async function setUsername(uid: string, data: unknown): Promise<SetUsernameResult> {
  const input = (data ?? {}) as { username?: unknown };
  const validation = validateUsername(input.username);
  if (!validation.ok) throw new HttpsError('invalid-argument', validation.reason);
  const { username, lower } = validation;

  await db.runTransaction(async (tx) => {
    const [claimSnap, userSnap] = await Promise.all([tx.get(refs.username(lower)), tx.get(refs.user(uid))]);
    const claim = claimSnap.data();
    if (claim && claim.uid !== uid) throw new HttpsError('already-exists', 'That username is taken');

    const now = Timestamp.now();
    const existing = userSnap.data();
    if (existing) {
      if (existing.usernameLower !== lower) tx.delete(refs.username(existing.usernameLower));
      tx.update(refs.user(uid), { username, usernameLower: lower, updatedAt: now });
    } else {
      const doc: UserDoc = {
        username,
        usernameLower: lower,
        rating: SCORING_CONFIG.INITIAL_RATING,
        stats: EMPTY_STATS,
        leaderboardVisible: true,
        suspended: false,
        createdAt: now,
        updatedAt: now,
        lastGameAt: null,
      };
      tx.set(refs.user(uid), doc);
    }
    tx.set(refs.username(lower), { uid });
  });

  await propagateUsername(uid, username);
  return { username };
}

export interface CheckUsernameResult {
  available: boolean;
  reason?: string;
}

/** Live availability check while the user types (no side effects). */
export async function checkUsername(uid: string, data: unknown): Promise<CheckUsernameResult> {
  const input = (data ?? {}) as { username?: unknown };
  const validation = validateUsername(input.username);
  if (!validation.ok) return { available: false, reason: validation.reason };
  const claim = (await refs.username(validation.lower).get()).data();
  if (claim && claim.uid !== uid) return { available: false, reason: 'That username is taken' };
  return { available: true };
}
