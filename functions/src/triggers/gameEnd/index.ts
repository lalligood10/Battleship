/**
 * Phase 5 game-end pipeline. `onGameFinished` builds one GameEndRecord per finished game, stores it
 * at `gameEnds/{gameId}`, then runs each consumer in its own transaction guarded by an `applied`
 * marker, so a retried or duplicated trigger never double-counts.
 */
import type { Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { gameEndRecord, RETENTION_PATHS, type GameEndConsumerId, type GameEndRecord } from '../../game/analytics/contract';
import { db } from '../../lib/firestore';
import type { GameDoc } from '../../types';
import { achievementsConsumer } from './achievements';
import { headToHeadConsumer, statsConsumer } from './stats';

export interface GameEndConsumer {
  id: GameEndConsumerId;
  /** Runs inside `tx` after the marker check. Do every `tx.get` before the first write. */
  apply(tx: Transaction, record: GameEndRecord, game: GameDoc, nowMs: number): Promise<void>;
}

export const GAME_END_CONSUMERS: readonly GameEndConsumer[] = [statsConsumer, headToHeadConsumer, achievementsConsumer];

export function isFinishTransition(before: Pick<GameDoc, 'status'> | undefined, after: Pick<GameDoc, 'status'> | undefined): boolean {
  return before?.status !== 'finished' && after?.status === 'finished';
}

/** Idempotent: safe to call any number of times for the same finished game. */
export async function processGameEnd(
  gameId: string,
  game: GameDoc,
  consumers: readonly GameEndConsumer[] = GAME_END_CONSUMERS,
  nowMs: number = Date.now(),
): Promise<GameEndRecord | null> {
  const record = gameEndRecord(gameId, game);
  if (!record) return null;
  const recordRef = db.doc(RETENTION_PATHS.gameEnd(gameId));
  if (!(await recordRef.get()).exists) await recordRef.set(record);
  const failedConsumers: GameEndConsumerId[] = [];
  for (const consumer of consumers) {
    try {
      await db.runTransaction(async (tx) => {
        const marker = db.doc(RETENTION_PATHS.gameEndApplied(gameId, consumer.id));
        if ((await tx.get(marker)).exists) return;
        await consumer.apply(tx, record, game, nowMs);
        tx.create(marker, { appliedAtMs: nowMs });
      });
    } catch (err) {
      failedConsumers.push(consumer.id);
      logger.error('game-end consumer failed', { gameId, consumer: consumer.id, err: String(err) });
    }
  }
  if (failedConsumers.length > 0) {
    throw new Error(`Game-end consumers failed: ${failedConsumers.join(', ')}`);
  }
  return record;
}
