/**
 * Scheduled housekeeping: cancels games nobody ever joined, drops stale Quick Match tickets and
 * expires unanswered challenges.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { GAME_CONFIG } from '../game/config';
import { db, refs } from '../lib/firestore';

export async function cleanupStale(now = Date.now()): Promise<{
  cancelledGames: number;
  removedTickets: number;
  expiredChallenges: number;
}> {
  const staleGames = await refs
    .games()
    .where('status', '==', 'waiting')
    .where('createdAt', '<', Timestamp.fromMillis(now - GAME_CONFIG.UNJOINED_GAME_TTL_MS))
    .limit(200)
    .get();

  const batch = db.batch();
  const ts = Timestamp.fromMillis(now);
  for (const doc of staleGames.docs) {
    batch.update(doc.ref, { status: 'cancelled', finishedAt: ts, updatedAt: ts });
    batch.delete(refs.gameCode(doc.data().code));
  }

  const staleTickets = await refs
    .quickMatchQueue()
    .where('createdAt', '<', Timestamp.fromMillis(now - GAME_CONFIG.QUICK_MATCH_TICKET_TTL_MS))
    .limit(200)
    .get();
  for (const doc of staleTickets.docs) batch.delete(doc.ref);

  const staleChallenges = await refs
    .challenges()
    .where('status', '==', 'pending')
    .where('createdAt', '<', Timestamp.fromMillis(now - GAME_CONFIG.CHALLENGE_TTL_MS))
    .limit(200)
    .get();
  for (const doc of staleChallenges.docs) batch.update(doc.ref, { status: 'expired', respondedAt: ts });

  await batch.commit();
  const result = {
    cancelledGames: staleGames.size,
    removedTickets: staleTickets.size,
    expiredChallenges: staleChallenges.size,
  };
  logger.info('cleanupStale', result);
  return result;
}
