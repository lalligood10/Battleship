/**
 * Push notifications (M3). Fires on every games/{gameId} write, diffs before/after, and sends an
 * FCM message to whichever player needs to act or learn the outcome. Tokens live in
 * users/{uid}/private/push; tokens FCM reports as dead are pruned.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';
import { coordinateLabel } from '../game/engine';
import { refs } from '../lib/firestore';
import type { GameDoc } from '../types';

export interface Notification {
  uid: string;
  title: string;
  body: string;
  gameId: string;
}

/** Pure diff: decides who should be told what. Exported for unit tests. */
export function notificationsForChange(gameId: string, before: GameDoc | undefined, after: GameDoc): Notification[] {
  const out: Notification[] = [];
  const name = (uid: string) => after.players[uid]?.username ?? 'Your opponent';

  if (before?.status === 'waiting' && after.status === 'placing') {
    const joiner = after.playerUids.find((u) => u !== after.hostUid);
    if (joiner) {
      out.push({ uid: after.hostUid, gameId, title: `${name(joiner)} joined your game`, body: 'Place your fleet to begin.' });
    }
    return out;
  }

  if (before?.status === 'placing' && after.status === 'placing') {
    // Opponent finished placing while I haven't: nudge me.
    for (const uid of after.playerUids) {
      const wasReady = before.players[uid]?.ready === true;
      const isReady = after.players[uid]?.ready === true;
      if (!wasReady && isReady) {
        const other = after.playerUids.find((u) => u !== uid);
        if (other && after.players[other]?.ready !== true) {
          out.push({ uid: other, gameId, title: `${name(uid)} is ready`, body: 'Place your ships to start the battle.' });
        }
      }
    }
    return out;
  }

  if (after.status === 'active' && after.currentTurnUid && before?.currentTurnUid !== after.currentTurnUid) {
    const me = after.currentTurnUid;
    const opp = after.playerUids.find((u) => u !== me);
    if (before?.status === 'placing') {
      out.push({ uid: me, gameId, title: 'Battle stations!', body: `Both fleets are placed — you fire first against ${opp ? name(opp) : 'your opponent'}.` });
    } else if (opp) {
      const lastShot = (after.shots[opp] ?? []).at(-1);
      const where = lastShot ? coordinateLabel(lastShot.row, lastShot.col) : '';
      const outcome =
        lastShot?.result === 'sunk'
          ? `sank your ${lastShot.sunkShip}`
          : lastShot?.result === 'hit'
            ? 'hit'
            : 'missed';
      out.push({ uid: me, gameId, title: 'Your turn', body: `${name(opp)} fired at ${where} and ${outcome}.` });
    }
    return out;
  }

  if (before?.status !== 'finished' && after.status === 'finished' && after.winnerUid) {
    const winner = after.winnerUid;
    const loser = after.playerUids.find((u) => u !== winner);
    if (!loser) return out;
    switch (after.endReason) {
      case 'all_sunk':
        out.push({ uid: loser, gameId, title: 'Fleet destroyed', body: `${name(winner)} sank your last ship.` });
        break;
      case 'resign':
        out.push({ uid: winner, gameId, title: 'Victory', body: `${name(loser)} resigned.` });
        break;
      case 'timeout':
        out.push({ uid: loser, gameId, title: 'Game forfeited', body: `${name(winner)} claimed the win after you were inactive.` });
        break;
      default:
        break;
    }
  }
  return out;
}

export async function deliver(notifications: Notification[]): Promise<void> {
  for (const n of notifications) {
    const pushDoc = (await refs.push(n.uid).get()).data();
    const tokens = pushDoc?.tokens ?? [];
    if (tokens.length === 0) continue;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: n.title, body: n.body },
      data: { gameId: n.gameId },
      apns: { payload: { aps: { sound: 'default', badge: 1, 'thread-id': n.gameId } } },
    });

    const dead = response.responses
      .map((r, i) => (r.success ? null : { token: tokens[i], code: r.error?.code }))
      .filter((r): r is { token: string; code: string | undefined } => r !== null && r.token !== undefined)
      .filter((r) => r.code === 'messaging/registration-token-not-registered' || r.code === 'messaging/invalid-argument')
      .map((r) => r.token);
    if (dead.length > 0) {
      await refs.push(n.uid).update({ tokens: FieldValue.arrayRemove(...dead) });
      logger.info('Pruned dead FCM tokens', { uid: n.uid, count: dead.length });
    }
  }
}
