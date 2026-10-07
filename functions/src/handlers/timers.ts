import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';
import { GAME_CONFIG } from '../game/config';
import { isTurnExpired, turnDeadlineFor } from '../game/timers';
import { reduce } from '../game/core/reducer';
import { coreStateFromGame } from '../lib/coreAdapter';
import { db, refs } from '../lib/firestore';
import type { GameDoc } from '../types';
import { endGameByRule } from './games';

export interface TurnTimeoutResult {
  skipped: boolean;
  forfeited: boolean;
}

const NO_OP: TurnTimeoutResult = { skipped: false, forfeited: false };

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new HttpsError('invalid-argument', `${name} is required`);
  }
  return value;
}

function requireMember(game: GameDoc, uid: string): void {
  if (!game.playerUids.includes(uid)) throw new HttpsError('permission-denied', 'You are not in this game');
}

function opponentOf(game: GameDoc, uid: string): string {
  const other = game.playerUids.find((playerUid) => playerUid !== uid);
  if (!other) throw new HttpsError('failed-precondition', 'No opponent has joined yet');
  return other;
}

/** Expires the current turn if its deadline + grace has passed. Idempotent; re-reads inside the transaction. */
export async function expireTurn(
  gameId: string,
  now: Timestamp = Timestamp.now(),
  callerUid?: string,
): Promise<TurnTimeoutResult> {
  return db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(refs.game(gameId));
    const game = gameSnap.data();
    if (!game) {
      if (callerUid !== undefined) throw new HttpsError('not-found', 'Game not found');
      return NO_OP;
    }
    if (callerUid !== undefined) requireMember(game, callerUid);
    if (
      game.status !== 'active' ||
      game.turnTimerMs == null ||
      !game.currentTurnUid ||
      !isTurnExpired(game, now.toMillis())
    ) {
      return NO_OP;
    }

    const player = game.currentTurnUid;
    const streak = (game.timeoutStreak?.[player] ?? 0) + 1;
    if (streak >= GAME_CONFIG.TURN_TIMEOUT_FORFEIT_STREAK) {
      await endGameByRule(tx, game, {
        gameId,
        winnerUid: opponentOf(game, player),
        loserUid: player,
        reason: 'timeout',
      });
      return { skipped: true, forfeited: true };
    }

    const reduced = reduce(coreStateFromGame(game, {}), { type: 'skipTurn', player });
    if (!reduced.ok) {
      logger.warn('Unable to skip expired turn', { gameId, player, error: reduced.error });
      return NO_OP;
    }

    tx.update(refs.game(gameId), {
      currentTurnUid: reduced.state.currentTurn,
      turnNumber: reduced.state.turnNumber,
      lastMoveAt: now,
      updatedAt: now,
      turnDeadline: turnDeadlineFor(game.turnTimerMs, now),
      [`timeoutStreak.${player}`]: streak,
    });
    return { skipped: true, forfeited: false };
  });
}

export async function claimTurnTimeout(uid: string, data: unknown): Promise<TurnTimeoutResult> {
  const gameId = requireString((data as { gameId?: unknown } | undefined)?.gameId, 'gameId');
  return expireTurn(gameId, Timestamp.now(), uid);
}

export async function sweepTurnTimeouts(now: Timestamp = Timestamp.now()): Promise<number> {
  const expiredGames = await refs
    .games()
    .where('status', '==', 'active')
    .where('turnDeadline', '<=', Timestamp.fromMillis(now.toMillis() - GAME_CONFIG.TURN_TIMEOUT_GRACE_MS))
    .limit(100)
    .get();
  let count = 0;
  for (const doc of expiredGames.docs) {
    try {
      const result = await expireTurn(doc.id, now);
      if (result.skipped || result.forfeited) count += 1;
    } catch (error) {
      logger.error('Failed to expire turn during sweep', { gameId: doc.id, error });
    }
  }
  return count;
}
