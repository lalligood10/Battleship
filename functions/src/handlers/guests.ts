import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { RETENTION_PATHS, dailyDateKey, type DailyRunDoc, type DailyScoreDoc } from '../game/analytics/contract';
import { refs, db } from '../lib/firestore';

export async function completeGuestUpgrade(uid: string, nowMs = Date.now()): Promise<{ isGuest: boolean }> {
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

  const todayKey = dailyDateKey(nowMs);
  return db.runTransaction(async (tx) => {
    const ref = refs.user(uid);
    const runRef = db.doc(RETENTION_PATHS.dailyRun(uid, todayKey));
    const scoreRef = db.doc(RETENTION_PATHS.dailyScore(todayKey, uid));
    const [profileSnap, runSnap, scoreSnap] = await Promise.all([tx.get(ref), tx.get(runRef), tx.get(scoreRef)]);
    const profile = profileSnap.data();
    if (!profile || profile.isGuest !== true) return { isGuest: false };
    const run = runSnap.data() as DailyRunDoc | undefined;
    if (run?.completedAtMs != null && !scoreSnap.exists && !profile.suspended) {
      const score: DailyScoreDoc = {
        username: profile.username,
        shots: run.shots.length,
        completedAtMs: run.completedAtMs,
      };
      tx.create(scoreRef, score);
    }
    tx.update(ref, {
      isGuest: false,
      leaderboardVisible: !profile.suspended,
      updatedAt: Timestamp.now(),
    });
    return { isGuest: false };
  });
}
