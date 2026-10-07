/**
 * Turn reminders (Phase 3): one push per pending turn after TURN_REMINDER_AFTER_MS of idle time in
 * untimed human games. `remindedTurn` on the game doc guarantees at most one reminder per turn.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { isBotUid } from '../game/bots';
import { GAME_CONFIG } from '../game/config';
import { db, refs } from '../lib/firestore';
import type { GameDoc } from '../types';
import { deliver, withMode, type Notification } from './notifications';

/** Pure eligibility check. Exported for unit tests. */
export function reminderEligible(game: GameDoc, nowMs: number): boolean {
  if (game.status !== 'active') return false;
  if (game.isBotGame) return false;
  if (game.turnTimerMs != null) return false;
  const uid = game.currentTurnUid;
  if (!uid || isBotUid(uid)) return false;
  if (!game.lastMoveAt) return false;
  if (game.lastMoveAt.toMillis() > nowMs - GAME_CONFIG.TURN_REMINDER_AFTER_MS) return false;
  return game.remindedTurn !== game.turnNumber;
}

function formatLeft(leftMs: number): string {
  const hours = Math.floor(leftMs / (60 * 60 * 1000));
  if (hours >= 48) return `about ${Math.floor(hours / 24)} days`;
  if (hours >= 1) return `about ${hours} hours`;
  return 'less than an hour';
}

/** Pure copy builder. Exported for unit tests. */
export function reminderNotification(gameId: string, game: GameDoc, nowMs: number): Notification | null {
  const uid = game.currentTurnUid;
  if (!uid) return null;
  const opp = game.playerUids.find((u) => u !== uid);
  const oppName = (opp && game.players[opp]?.username) || 'Your opponent';
  const timeoutMs = game.abandonTimeoutMs || GAME_CONFIG.ABANDON_TIMEOUT_MS;
  const leftMs = timeoutMs - (nowMs - (game.lastMoveAt?.toMillis() ?? nowMs));
  const body =
    leftMs <= 0
      ? `It's your move. ${oppName} can now claim the win.`
      : `It's your move. ${oppName} can claim the win in ${formatLeft(leftMs)} if you don't play.`;
  return { uid, gameId, title: withMode(`${oppName} is waiting for your move`, game.mode), body };
}

export async function sendTurnReminders(now: Timestamp = Timestamp.now()): Promise<number> {
  const nowMs = now.toMillis();
  const cutoff = Timestamp.fromMillis(nowMs - GAME_CONFIG.TURN_REMINDER_AFTER_MS);
  const candidates = await refs.games().where('status', '==', 'active').where('lastMoveAt', '<=', cutoff).get();

  const notifications: Notification[] = [];
  for (const snap of candidates.docs) {
    try {
      const notification = await db.runTransaction(async (tx) => {
        const game = (await tx.get(snap.ref)).data();
        if (!game || !reminderEligible(game, nowMs)) return null;
        tx.update(snap.ref, { remindedTurn: game.turnNumber });
        return reminderNotification(snap.id, game, nowMs);
      });
      if (notification) notifications.push(notification);
    } catch (error) {
      logger.warn('Turn reminder failed for game', { gameId: snap.id, error });
    }
  }
  for (const notification of notifications) {
    try {
      await deliver([notification]);
    } catch (error) {
      logger.warn('Turn reminder delivery failed', { gameId: notification.gameId, error });
    }
  }
  return notifications.length;
}
