import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import type { GameDoc, GamePlayer } from '../types';
import { notificationsForChange } from './notifications';

const now = Timestamp.fromMillis(1_700_000_000_000);
const player = (username: string, ready = false): GamePlayer => ({
  username,
  rating: 1000,
  ready,
  sunkShips: [],
  shotsFired: 0,
  hits: 0,
});

const base: GameDoc = {
  code: 'ABC234',
  status: 'waiting',
  hostUid: 'host',
  playerUids: ['host'],
  players: { host: player('Ann') },
  shots: { host: [] },
  currentTurnUid: null,
  turnNumber: 0,
  winnerUid: null,
  endReason: null,
  ratingChanges: null,
  revealedFleets: null,
  isQuickMatch: false,
  isBotGame: false,
  botDifficulty: null,
  abandonTimeoutMs: 1000,
  createdAt: now,
  updatedAt: now,
  startedAt: null,
  finishedAt: null,
  lastMoveAt: now,
};

const joined: GameDoc = {
  ...base,
  status: 'placing',
  playerUids: ['host', 'guest'],
  players: { host: player('Ann'), guest: player('Bob') },
  shots: { host: [], guest: [] },
};

describe('notificationsForChange', () => {
  it('tells the host when someone joins', () => {
    const out = notificationsForChange('g1', base, joined);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ uid: 'host', title: 'Bob joined your game' });
  });

  it('nudges the slower player when the other finishes placing', () => {
    const after: GameDoc = { ...joined, players: { host: player('Ann', true), guest: player('Bob') } };
    const out = notificationsForChange('g1', joined, after);
    expect(out).toEqual([expect.objectContaining({ uid: 'guest', title: 'Ann is ready' })]);
  });

  it('tells the first player the battle has started', () => {
    const before: GameDoc = { ...joined, players: { host: player('Ann', true), guest: player('Bob') } };
    const after: GameDoc = {
      ...before,
      status: 'active',
      players: { host: player('Ann', true), guest: player('Bob', true) },
      currentTurnUid: 'guest',
    };
    const out = notificationsForChange('g1', before, after);
    expect(out).toEqual([expect.objectContaining({ uid: 'guest', title: 'Battle stations!' })]);
  });

  it('describes the opponent shot when the turn changes', () => {
    const before: GameDoc = { ...joined, status: 'active', currentTurnUid: 'host' };
    const after: GameDoc = {
      ...before,
      currentTurnUid: 'guest',
      shots: { host: [{ row: 2, col: 1, result: 'sunk', sunkShip: 'destroyer', at: 1 }], guest: [] },
    };
    const out = notificationsForChange('g1', before, after);
    expect(out).toEqual([
      expect.objectContaining({ uid: 'guest', title: 'Your turn', body: 'Ann fired at B3 and sank your destroyer.' }),
    ]);
  });

  it('does not notify when nothing relevant changed', () => {
    const active: GameDoc = { ...joined, status: 'active', currentTurnUid: 'host' };
    expect(notificationsForChange('g1', active, { ...active, updatedAt: now })).toEqual([]);
  });

  it('notifies the right person at game end', () => {
    const active: GameDoc = { ...joined, status: 'active', currentTurnUid: 'host' };
    const sunk: GameDoc = { ...active, status: 'finished', winnerUid: 'host', endReason: 'all_sunk', currentTurnUid: null };
    expect(notificationsForChange('g1', active, sunk)).toEqual([expect.objectContaining({ uid: 'guest', title: 'Fleet destroyed' })]);

    const resigned: GameDoc = { ...sunk, endReason: 'resign' };
    expect(notificationsForChange('g1', active, resigned)).toEqual([expect.objectContaining({ uid: 'host', title: 'Victory' })]);

    const timeout: GameDoc = { ...sunk, endReason: 'timeout' };
    expect(notificationsForChange('g1', active, timeout)).toEqual([expect.objectContaining({ uid: 'guest', title: 'Game forfeited' })]);
  });

  it('never sends a notification to a bot uid', () => {
    const botJoined: GameDoc = {
      ...joined,
      playerUids: ['host', 'bot-officer'],
      players: { host: player('Ann'), 'bot-officer': player('Officer Bot') },
      shots: { host: [], 'bot-officer': [] },
    };
    // Resign in a bot game: the "winner" is the bot, so no notification survives the filter.
    const finished: GameDoc = { ...botJoined, status: 'finished', winnerUid: 'bot-officer', endReason: 'resign' };
    expect(notificationsForChange('g1', botJoined, finished)).toEqual([]);
    // Bot "joins" a waiting game: the host still gets told.
    expect(notificationsForChange('g1', base, botJoined)).toEqual([
      expect.objectContaining({ uid: 'host', title: 'Officer Bot joined your game' }),
    ]);
  });
});
