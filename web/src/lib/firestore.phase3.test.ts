import type { DocumentData, DocumentSnapshot } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import { profileFromData } from '../state/SessionProvider';
import { challengeFromSnapshot, gameFromSnapshot } from './firestore';

function snapshot(data: DocumentData | undefined, id = 'doc-1'): DocumentSnapshot<DocumentData> {
  return { id, data: () => data } as unknown as DocumentSnapshot<DocumentData>;
}

const player = (username: string, extra: Record<string, unknown> = {}) => ({
  username,
  rating: 1000,
  ready: true,
  sunkShips: [],
  shotsFired: 0,
  hits: 0,
  ...extra,
});

describe('Phase 3 game mapping', () => {
  it.each(['classic', 'salvo', 'abilities'] as const)('reads a pre-Phase-3 %s game as untimed, rated-by-default, non-guest', (mode) => {
    const game = gameFromSnapshot(
      snapshot({ status: 'active', mode, playerUids: ['a', 'b'], players: { a: player('A'), b: player('B') } }),
    )!;
    expect(game.mode).toBe(mode);
    expect(game.turnTimerMs).toBeNull();
    expect(game.turnDeadline).toBeNull();
    expect(game.timeoutStreak).toEqual({});
    expect(game.remindedTurn).toBeNull();
    expect(game.isRated).toBeUndefined();
    expect(game.players.a!.isGuest).toBe(false);
    expect(game.players.b!.isGuest).toBe(false);
  });

  it('keeps a timed guest game exactly as the server wrote it', () => {
    const turnDeadline = { toMillis: () => 1_700_000_120_000 };
    const game = gameFromSnapshot(
      snapshot({
        status: 'active',
        mode: 'salvo',
        isRated: false,
        turnTimerMs: 120_000,
        turnDeadline,
        timeoutStreak: { a: 2, b: 0 },
        remindedTurn: null,
        playerUids: ['a', 'b'],
        players: { a: player('A', { isGuest: true }), b: player('B') },
      }),
    )!;
    expect(game).toMatchObject({ mode: 'salvo', isRated: false, turnTimerMs: 120_000, timeoutStreak: { a: 2, b: 0 } });
    expect(game.turnDeadline).toBe(turnDeadline);
    expect(game.players.a!.isGuest).toBe(true);
    expect(game.players.b!.isGuest).toBe(false);
  });

  it('reads a finished timeout forfeit with the deadline cleared', () => {
    const game = gameFromSnapshot(
      snapshot({ status: 'finished', endReason: 'timeout', winnerUid: 'b', turnTimerMs: 60_000, turnDeadline: null, timeoutStreak: { a: 3 } }),
    )!;
    expect(game).toMatchObject({ status: 'finished', endReason: 'timeout', winnerUid: 'b', turnDeadline: null, currentTurnUid: null });
    expect(game.timeoutStreak).toEqual({ a: 3 });
  });
});

describe('Phase 3 challenge and profile mapping', () => {
  it.each([
    ['classic', null],
    ['salvo', 60_000],
    ['abilities', 120_000],
  ] as const)('keeps %s challenge mode and timer %s', (mode, turnTimerMs) => {
    const challenge = challengeFromSnapshot(snapshot({ mode, turnTimerMs, status: 'accepted', gameId: 'g1' }))!;
    expect(challenge).toMatchObject({ mode, turnTimerMs, status: 'accepted', gameId: 'g1' });
  });

  it('defaults isGuest to false for existing profiles and keeps it for guests', () => {
    expect(profileFromData('u1', { username: 'Old' }).isGuest).toBe(false);
    expect(profileFromData('u2', { username: 'Guest', isGuest: true }).isGuest).toBe(true);
  });
});
