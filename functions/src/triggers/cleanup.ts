/**
 * Scheduled housekeeping: cancels games nobody ever joined and drops stale Quick Match tickets.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { GAME_CONFIG } from '../game/config';
import { db, refs } from '../lib/firestore';

export async function cleanupStale(now = Date.now()): Promise<{ cancelledGames: number; removedTickets: number }> {
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

  await batch.commit();
  const result = { cancelledGames: staleGames.size, removedTickets: staleTickets.size };
  logger.info('cleanupStale', result);
  return result;
}
