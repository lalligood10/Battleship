import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../game/config';
import type { GameDoc, GamePlayer } from '../types';
import { reminderEligible, reminderNotification } from './reminders';

const nowMs = 1_700_000_000_000;
const now = Timestamp.fromMillis(nowMs);
const player = (username: string): GamePlayer => ({
  username,
  rating: 1000,
  ready: true,
  sunkShips: [],
  shotsFired: 0,
  hits: 0,
});

const stale = Timestamp.fromMillis(nowMs - GAME_CONFIG.TURN_REMINDER_AFTER_MS - 60_000);
const fresh = Timestamp.fromMillis(nowMs - 60_000);

const game: GameDoc = {
  code: 'ABC234',
  status: 'active',
  hostUid: 'host',
  playerUids: ['host', 'guest'],
  players: { host: player('Ann'), guest: player('Bob') },
  shots: { host: [], guest: [] },
  currentTurnUid: 'guest',
  turnNumber: 5,
  winnerUid: null,
  endReason: null,
  ratingChanges: null,
  revealedFleets: null,
  isQuickMatch: false,
  isBotGame: false,
  botDifficulty: null,
  abandonTimeoutMs: GAME_CONFIG.ABANDON_TIMEOUT_MS,
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  finishedAt: null,
  lastMoveAt: stale,
};

describe('reminderEligible', () => {
  it('accepts a stale untimed human game on a new turn', () => {
    expect(reminderEligible(game, nowMs)).toBe(true);
  });

  it('skips games that are not active', () => {
    expect(reminderEligible({ ...game, status: 'placing' }, nowMs)).toBe(false);
    expect(reminderEligible({ ...game, status: 'finished' }, nowMs)).toBe(false);
    expect(reminderEligible({ ...game, status: 'waiting' }, nowMs)).toBe(false);
  });

  it('skips bot games and bot turns', () => {
    expect(reminderEligible({ ...game, isBotGame: true }, nowMs)).toBe(false);
    expect(reminderEligible({ ...game, currentTurnUid: 'bot-officer' }, nowMs)).toBe(false);
  });

  it('skips timed games', () => {
    expect(reminderEligible({ ...game, turnTimerMs: 60_000 }, nowMs)).toBe(false);
  });

  it('skips games with no current turn or no lastMoveAt', () => {
    expect(reminderEligible({ ...game, currentTurnUid: null }, nowMs)).toBe(false);
    expect(reminderEligible({ ...game, lastMoveAt: null }, nowMs)).toBe(false);
  });

  it('skips games that moved recently', () => {
    expect(reminderEligible({ ...game, lastMoveAt: fresh }, nowMs)).toBe(false);
  });

  it('skips a turn that was already reminded', () => {
    expect(reminderEligible({ ...game, remindedTurn: 5 }, nowMs)).toBe(false);
    expect(reminderEligible({ ...game, remindedTurn: 4 }, nowMs)).toBe(true);
  });
});

describe('reminderNotification', () => {
  it('addresses the player on turn and names the waiting opponent', () => {
    expect(reminderNotification('g1', game, nowMs)).toMatchObject({
      uid: 'guest',
      gameId: 'g1',
      title: 'Ann is waiting for your move',
    });
  });

  it('appends the mode label for salvo games', () => {
    const out = reminderNotification('g1', { ...game, mode: 'salvo' }, nowMs);
    expect(out?.title).toBe('Ann is waiting for your move · Salvo');
  });

  it('formats the claim window in hours', () => {
    // 25h idle of a 3-day window → about 47 hours left.
    const out = reminderNotification('g1', game, nowMs);
    expect(out?.body).toBe("It's your move. Ann can claim the win in about 47 hours if you don't play.");
  });

  it('formats multi-day and sub-hour windows', () => {
    const dayLeft = reminderNotification('g1', { ...game, lastMoveAt: fresh }, nowMs);
    expect(dayLeft?.body).toBe("It's your move. Ann can claim the win in about 2 days if you don't play.");

    const nearlyExpired = Timestamp.fromMillis(nowMs - GAME_CONFIG.ABANDON_TIMEOUT_MS + 30 * 60_000);
    const subHour = reminderNotification('g1', { ...game, lastMoveAt: nearlyExpired }, nowMs);
    expect(subHour?.body).toBe("It's your move. Ann can claim the win in less than an hour if you don't play.");
  });

  it('says the win can be claimed once the window has passed', () => {
    const expired = Timestamp.fromMillis(nowMs - GAME_CONFIG.ABANDON_TIMEOUT_MS - 1);
    const out = reminderNotification('g1', { ...game, lastMoveAt: expired }, nowMs);
    expect(out?.body).toBe("It's your move. Ann can now claim the win.");
  });

  it('returns null when nobody is on turn', () => {
    expect(reminderNotification('g1', { ...game, currentTurnUid: null }, nowMs)).toBeNull();
  });
});
