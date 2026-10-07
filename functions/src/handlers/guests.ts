import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { refs, db } from '../lib/firestore';

export async function completeGuestUpgrade(uid: string): Promise<{ isGuest: boolean }> {
  let user;
  try {
    user = await getAuth().getUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/user-not-found') {
      throw new HttpsError('failed-precondition', 'Link an email or Google account first');
    }
    throw new HttpsError('unavailable', "Couldn't verify your account. Please try again.");
  }
  if (user.providerData.length === 0) {
    throw new HttpsError('failed-precondition', 'Link an email or Google account first');
  }

  return db.runTransaction(async (tx) => {
    const ref = refs.user(uid);
    const profile = (await tx.get(ref)).data();
    if (!profile || profile.isGuest !== true) return { isGuest: false };
    tx.update(ref, {
      isGuest: false,
      leaderboardVisible: !profile.suspended,
      updatedAt: Timestamp.now(),
    });
    return { isGuest: false };
  });
}
