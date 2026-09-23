import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { EMPTY_STATS, SCORING_CONFIG } from '../game/scoring';
import { db, refs } from '../lib/firestore';
import { validateUsername } from '../lib/username';
import type { UserDoc } from '../types';

export interface SetUsernameResult {
  username: string;
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
        createdAt: now,
        updatedAt: now,
        lastGameAt: null,
      };
      tx.set(refs.user(uid), doc);
    }
    tx.set(refs.username(lower), { uid });
  });

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
