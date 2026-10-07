/**
 * Push notifications (M3). Fires on every games/{gameId} write, diffs before/after, and sends an
 * FCM message to whichever player needs to act or learn the outcome. Tokens live in
 * users/{uid}/private/push; tokens FCM reports as dead are pruned.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/v2';
import { isBotUid } from '../game/bots';
import { gameModeOption, type GameMode } from '../game/core/schema';
import type { AbilityResult } from '../game/core/modes/types';
import { coordinateLabel, type Shot } from '../game/engine';
import { refs } from '../lib/firestore';
import type { ChallengeDoc, GameDoc } from '../types';

/** Appends " · <mode label>" to push titles for Salvo/Abilities games; Classic stays bare. */
export function withMode(title: string, mode: GameMode | undefined): string {
  if (mode === 'salvo' || mode === 'abilities') return `${title} · ${gameModeOption(mode).label}`;
  return title;
}

const cap = (name: string) => (name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1));
const hitsWord = (n: number) => `${n} hit${n === 1 ? '' : 's'}`;
const missesWord = (n: number) => `${n} miss${n === 1 ? '' : 'es'}`;
const sunkIn = (shots: Shot[]) => [...new Set(shots.map((s) => s.sunkShip).filter((s): s is NonNullable<typeof s> => s != null))];

function abilityBody(result: AbilityResult, oppName: string, newShots: Shot[]): string {
  switch (result.abilityId) {
    case 'carrier-airstrike': {
      const hits = result.cells.filter((c) => c.result !== 'miss').length;
      const misses = result.cells.length - hits;
      let body = `${oppName} launched an airstrike: ${hitsWord(hits)}, ${missesWord(misses)}.`;
      const sunk = sunkIn(newShots);
      if (sunk.length > 0) body += ` Sank your ${sunk.map(cap).join(' and ')}.`;
      return body;
    }
    case 'submarine-sonar':
      return `${oppName} scanned near ${coordinateLabel(result.center.row, result.center.col)}.`;
    case 'destroyer-relocate':
      return `${oppName} moved a ship.`;
  }
}

function volleyBody(oppName: string, newShots: Shot[]): string {
  const hits = newShots.filter((s) => s.result !== 'miss').length;
  if (hits === 0) return `${oppName} fired ${newShots.length} shots: all missed.`;
  let body = `${oppName} fired ${newShots.length} shots: ${hitsWord(hits)}`;
  const sunk = sunkIn(newShots);
  if (sunk.length > 0) body += `, sank your ${sunk.map(cap).join(' and ')}`;
  return `${body}.`;
}

export interface Notification {
  uid: string;
  title: string;
  body: string;
  /** Game to open when tapped. Absent for notifications that aren't about a game yet (challenges). */
  gameId?: string;
  challengeId?: string;
}

/** Pure diff: decides who should be told what. Exported for unit tests. Bots never get push. */
export function notificationsForChange(gameId: string, before: GameDoc | undefined, after: GameDoc): Notification[] {
  return computeNotifications(gameId, before, after).filter((n) => !isBotUid(n.uid));
}

/** Push for a newly created challenge. Null when there is nobody (human) to tell. */
export function notificationForChallenge(challengeId: string, challenge: ChallengeDoc): Notification | null {
  if (challenge.status !== 'pending' || isBotUid(challenge.toUid)) return null;
  return {
    uid: challenge.toUid,
    challengeId,
    title: `${challenge.fromUsername} challenged you`,
    body: 'Open Broadside to accept or decline.',
  };
}

export function notificationsForChallengeUpdate(
  challengeId: string,
  before: ChallengeDoc | undefined,
  after: ChallengeDoc,
): Notification[] {
  if (before?.status !== 'pending' || isBotUid(after.fromUid)) return [];
  if (after.status === 'accepted') {
    const label = gameModeOption(after.mode ?? 'classic').label;
    return [
      {
        uid: after.fromUid,
        challengeId,
        ...(after.gameId ? { gameId: after.gameId } : {}),
        title: `${after.toUsername} accepted your ${label} challenge`,
        body: 'Place your fleet to begin.',
      },
    ];
  }
  if (after.status === 'declined') {
    return [
      {
        uid: after.fromUid,
        challengeId,
        title: `${after.toUsername} declined your challenge`,
        body: 'Try Quick Match or challenge someone else.',
      },
    ];
  }
  return [];
}

function computeNotifications(gameId: string, before: GameDoc | undefined, after: GameDoc): Notification[] {
  const out: Notification[] = [];
  const name = (uid: string) => after.players[uid]?.username ?? 'Your opponent';

  if (
    before?.status === 'finished' &&
    after.status === 'finished' &&
    after.rematch &&
    before.rematch?.gameId !== after.rematch.gameId
  ) {
    const recipient = after.playerUids.find((uid) => uid !== after.rematch!.requestedBy);
    if (recipient) {
      out.push({
        uid: recipient,
        gameId,
        title: withMode(`${name(after.rematch.requestedBy)} wants a rematch`, after.mode),
        body: 'Tap to accept.',
      });
    }
    return out;
  }

  if (before?.status === 'waiting' && after.status === 'placing') {
    const joiner = after.playerUids.find((u) => u !== after.hostUid);
    if (joiner) {
      out.push({
        uid: after.hostUid,
        gameId,
        title: withMode(`${name(joiner)} joined your game`, after.mode),
        body: 'Place your fleet to begin.',
      });
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
          out.push({
            uid: other,
            gameId,
            title: withMode(`${name(uid)} is ready`, after.mode),
            body: 'Place your ships to start the battle.',
          });
        }
      }
    }
    return out;
  }

  if (after.status === 'active' && after.currentTurnUid && before?.currentTurnUid !== after.currentTurnUid) {
    const me = after.currentTurnUid;
    const opp = after.playerUids.find((u) => u !== me);
    if (before?.status === 'placing') {
      out.push({
        uid: me,
        gameId,
        title: withMode('Battle stations!', after.mode),
        body: `Both fleets are placed — you fire first against ${opp ? name(opp) : 'your opponent'}.`,
      });
    } else if (opp) {
      const oppName = name(opp);
      const newShots = (after.shots[opp] ?? []).slice((before?.shots[opp] ?? []).length);
      const newAbilities = (after.abilityLog ?? [])
        .slice((before?.abilityLog ?? []).length)
        .filter((e) => e.player === opp);
      const title = withMode('Your turn', after.mode);
      let body: string;
      const lastAbility = newAbilities.at(-1);
      if (lastAbility) {
        body = abilityBody(lastAbility.result, oppName, newShots);
      } else if (newShots.length > 1) {
        body = volleyBody(oppName, newShots);
      } else if (newShots.length === 1) {
        const lastShot = newShots[0]!;
        const outcome =
          lastShot.result === 'sunk' ? `sank your ${lastShot.sunkShip}` : lastShot.result === 'hit' ? 'hit' : 'missed';
        body = `${oppName} fired at ${coordinateLabel(lastShot.row, lastShot.col)} and ${outcome}.`;
      } else if ((after.timeoutStreak?.[opp] ?? 0) > (before?.timeoutStreak?.[opp] ?? 0)) {
        body = `${oppName} ran out of time.`;
      } else {
        body = `It's your move against ${oppName}.`;
      }
      out.push({ uid: me, gameId, title, body });
    }
    return out;
  }

  if (before?.status !== 'finished' && after.status === 'finished' && after.winnerUid) {
    const winner = after.winnerUid;
    const loser = after.playerUids.find((u) => u !== winner);
    if (!loser) return out;
    switch (after.endReason) {
      case 'all_sunk':
        out.push({
          uid: loser,
          gameId,
          title: withMode('Fleet destroyed', after.mode),
          body: `${name(winner)} sank your last ship.`,
        });
        break;
      case 'resign':
        out.push({ uid: winner, gameId, title: withMode('Victory', after.mode), body: `${name(loser)} resigned.` });
        break;
      case 'timeout':
        out.push({
          uid: loser,
          gameId,
          title: withMode('Game forfeited', after.mode),
          body: `${name(winner)} claimed the win after you were inactive.`,
        });
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
      data: { ...(n.gameId ? { gameId: n.gameId } : {}), ...(n.challengeId ? { challengeId: n.challengeId } : {}) },
      apns: { payload: { aps: { sound: 'default', badge: 1, 'thread-id': n.gameId ?? 'challenges' } } },
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
