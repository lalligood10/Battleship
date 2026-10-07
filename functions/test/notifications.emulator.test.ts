import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelChallenge, createChallenge, respondChallenge } from '../src/handlers/challenges';
import { setUsername } from '../src/handlers/users';
import { refs } from '../src/lib/firestore';
import { deliver, notificationsForChallengeUpdate } from '../src/triggers/notifications';
import type { ChallengeDoc } from '../src/types';
import { clearFirestore } from './setup';

interface FcmMessage {
  tokens: string[];
  notification?: { title: string; body: string };
  data?: Record<string, string>;
}

const sendMock = vi.hoisted(() =>
  vi.fn(async ({ tokens }: FcmMessage) => ({ responses: tokens.map(() => ({ success: true })) })),
);
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast: sendMock }) }));

const ALICE = 'uid-push-alice';
const BOB = 'uid-push-bob';

async function challengeBetween(mode: 'classic' | 'salvo' | 'abilities' = 'classic') {
  await refs.opponent(ALICE, BOB).set({
    username: 'PushBob',
    gamesPlayed: 1,
    lastPlayedAt: Timestamp.now(),
  });
  return createChallenge(ALICE, { opponentUid: BOB, mode });
}

const snapshot = async (challengeId: string) => (await refs.challenge(challengeId).get()).data() as ChallengeDoc;

beforeEach(async () => {
  sendMock.mockClear();
  sendMock.mockImplementation(async ({ tokens }: FcmMessage) => ({
    responses: tokens.map(() => ({ success: true })),
  }));
  await clearFirestore();
  await setUsername(ALICE, { username: 'PushAlice' });
  await setUsername(BOB, { username: 'PushBob' });
});

describe('challenge update notifications', () => {
  it('pushes the challenger on accept, with the gameId attached', async () => {
    await refs.push(ALICE).set({ tokens: ['tok-alice'], updatedAt: Timestamp.now() });
    const { challengeId } = await challengeBetween('classic');
    const before = await snapshot(challengeId);
    const { gameId } = await respondChallenge(BOB, { challengeId, accept: true });
    const after = await snapshot(challengeId);

    await deliver(notificationsForChallengeUpdate(challengeId, before, after));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0]![0];
    expect(message.tokens).toEqual(['tok-alice']);
    expect(message.notification?.title).toBe('PushBob accepted your Classic challenge');
    expect(message.notification?.body).toBe('Place your fleet to begin.');
    expect(message.data?.gameId).toBe(gameId);
    expect(message.data?.challengeId).toBe(challengeId);
  });

  it('names the mode in the accept title', async () => {
    await refs.push(ALICE).set({ tokens: ['tok-alice'], updatedAt: Timestamp.now() });
    const { challengeId } = await challengeBetween('salvo');
    const before = await snapshot(challengeId);
    await respondChallenge(BOB, { challengeId, accept: true });
    await deliver(notificationsForChallengeUpdate(challengeId, before, await snapshot(challengeId)));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0]![0];
    expect(message.notification?.title).toBe('PushBob accepted your Salvo challenge');
  });

  it('pushes the challenger on decline without a gameId', async () => {
    await refs.push(ALICE).set({ tokens: ['tok-alice'], updatedAt: Timestamp.now() });
    const { challengeId } = await challengeBetween('salvo');
    const before = await snapshot(challengeId);
    await respondChallenge(BOB, { challengeId, accept: false });
    const after = await snapshot(challengeId);

    await deliver(notificationsForChallengeUpdate(challengeId, before, after));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0]![0];
    expect(message.notification?.title).toBe('PushBob declined your challenge');
    expect(message.data?.challengeId).toBe(challengeId);
    expect(message.data?.gameId).toBeUndefined();
  });

  it('sends nothing for a cancelled challenge', async () => {
    await refs.push(ALICE).set({ tokens: ['tok-alice'], updatedAt: Timestamp.now() });
    const { challengeId } = await challengeBetween();
    const before = await snapshot(challengeId);
    await cancelChallenge(ALICE, { challengeId });
    const after = await snapshot(challengeId);
    expect(notificationsForChallengeUpdate(challengeId, before, after)).toEqual([]);
    await deliver([]);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('delivers nothing when the recipient has no push doc', async () => {
    const { challengeId } = await challengeBetween();
    const before = await snapshot(challengeId);
    await respondChallenge(BOB, { challengeId, accept: true });
    await deliver(notificationsForChallengeUpdate(challengeId, before, await snapshot(challengeId)));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('prunes dead tokens reported by FCM', async () => {
    await refs.push(ALICE).set({ tokens: ['tok-dead', 'tok-live'], updatedAt: Timestamp.now() });
    sendMock.mockImplementationOnce(async () => ({
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: true },
      ],
    }));

    const { challengeId } = await challengeBetween();
    const before = await snapshot(challengeId);
    await respondChallenge(BOB, { challengeId, accept: true });
    await deliver(notificationsForChallengeUpdate(challengeId, before, await snapshot(challengeId)));

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((await refs.push(ALICE).get()).data()?.tokens).toEqual(['tok-live']);
  });
});
