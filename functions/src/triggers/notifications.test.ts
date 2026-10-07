import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import type { ChallengeDoc, GameDoc, GamePlayer } from '../types';
import {
  notificationForChallenge,
  notificationsForChallengeUpdate,
  notificationsForChange,
} from './notifications';

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

describe('notificationsForChallengeUpdate', () => {
  const pending: ChallengeDoc = {
    fromUid: 'host',
    toUid: 'guest',
    fromUsername: 'Ann',
    toUsername: 'Bob',
    status: 'pending',
    sourceGameId: null,
    gameId: null,
    createdAt: now,
    respondedAt: null,
  };

  it('tells the challenger when their invite is accepted', () => {
    const after: ChallengeDoc = { ...pending, status: 'accepted', gameId: 'g9', respondedAt: now };
    expect(notificationsForChallengeUpdate('c1', pending, after)).toEqual([
      {
        uid: 'host',
        challengeId: 'c1',
        gameId: 'g9',
        title: 'Bob accepted your Classic challenge',
        body: 'Place your fleet to begin.',
      },
    ]);
  });

  it('names the mode in the accept title and tolerates a missing gameId', () => {
    const after: ChallengeDoc = { ...pending, mode: 'salvo', status: 'accepted', respondedAt: now };
    expect(notificationsForChallengeUpdate('c1', pending, after)).toEqual([
      expect.objectContaining({ uid: 'host', challengeId: 'c1', title: 'Bob accepted your Salvo challenge' }),
    ]);
  });

  it('tells the challenger when their invite is declined', () => {
    const after: ChallengeDoc = { ...pending, status: 'declined', respondedAt: now };
    expect(notificationsForChallengeUpdate('c1', pending, after)).toEqual([
      {
        uid: 'host',
        challengeId: 'c1',
        title: 'Bob declined your challenge',
        body: 'Try Quick Match or challenge someone else.',
      },
    ]);
  });

  it('ignores everything that did not come from a pending challenge', () => {
    const accepted: ChallengeDoc = { ...pending, status: 'accepted', gameId: 'g9' };
    expect(notificationsForChallengeUpdate('c1', undefined, accepted)).toEqual([]);
    expect(notificationsForChallengeUpdate('c1', accepted, { ...accepted, respondedAt: now })).toEqual([]);
    expect(notificationsForChallengeUpdate('c1', pending, { ...pending, status: 'cancelled' })).toEqual([]);
    expect(notificationsForChallengeUpdate('c1', pending, { ...pending, status: 'expired' })).toEqual([]);
  });

  it('never notifies a bot challenger', () => {
    const fromBot: ChallengeDoc = { ...pending, fromUid: 'bot-officer' };
    const after: ChallengeDoc = { ...fromBot, status: 'accepted', gameId: 'g9' };
    expect(notificationsForChallengeUpdate('c1', fromBot, after)).toEqual([]);
    expect(notificationsForChallengeUpdate('c1', fromBot, { ...fromBot, status: 'declined' })).toEqual([]);
  });
});

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

  it('summarises a salvo volley and appends the mode to the title', () => {
    const before: GameDoc = { ...joined, status: 'active', mode: 'salvo', currentTurnUid: 'host' };
    const after: GameDoc = {
      ...before,
      currentTurnUid: 'guest',
      shots: {
        host: [
          { row: 0, col: 0, result: 'hit', at: 1 },
          { row: 0, col: 1, result: 'miss', at: 1 },
          { row: 4, col: 0, result: 'sunk', sunkShip: 'cruiser', at: 1 },
          { row: 4, col: 1, result: 'hit', at: 1 },
        ],
        guest: [],
      },
    };
    expect(notificationsForChange('g1', before, after)).toEqual([
      {
        uid: 'guest',
        gameId: 'g1',
        title: 'Your turn · Salvo',
        body: 'Ann fired 4 shots: 3 hits, sank your Cruiser.',
      },
    ]);
  });

  it('says all missed for a whiffed volley', () => {
    const before: GameDoc = { ...joined, status: 'active', mode: 'salvo', currentTurnUid: 'host' };
    const after: GameDoc = {
      ...before,
      currentTurnUid: 'guest',
      shots: {
        host: [
          { row: 0, col: 0, result: 'miss', at: 1 },
          { row: 1, col: 0, result: 'miss', at: 1 },
          { row: 2, col: 0, result: 'miss', at: 1 },
        ],
        guest: [],
      },
    };
    expect(notificationsForChange('g1', before, after)).toEqual([
      expect.objectContaining({ body: 'Ann fired 3 shots: all missed.' }),
    ]);
  });

  it('describes an airstrike without leaking ship positions', () => {
    const before: GameDoc = { ...joined, status: 'active', mode: 'abilities', currentTurnUid: 'host' };
    const after: GameDoc = {
      ...before,
      currentTurnUid: 'guest',
      shots: {
        host: [
          { row: 8, col: 0, result: 'sunk', sunkShip: 'destroyer', at: 1 },
          { row: 8, col: 1, result: 'sunk', sunkShip: 'destroyer', at: 1 },
          { row: 3, col: 3, result: 'miss', at: 1 },
        ],
        guest: [],
      },
      abilityLog: [
        {
          player: 'host',
          turnNumber: 1,
          result: {
            abilityId: 'carrier-airstrike',
            cells: [
              { row: 8, col: 0, result: 'sunk' },
              { row: 8, col: 1, result: 'sunk' },
              { row: 3, col: 3, result: 'miss' },
            ],
          },
        },
      ],
    };
    expect(notificationsForChange('g1', before, after)).toEqual([
      {
        uid: 'guest',
        gameId: 'g1',
        title: 'Your turn · Abilities',
        body: 'Ann launched an airstrike: 2 hits, 1 miss. Sank your Destroyer.',
      },
    ]);
  });

  it('describes sonar and relocate without revealing results', () => {
    const before: GameDoc = { ...joined, status: 'active', mode: 'abilities', currentTurnUid: 'host' };
    const sonar: GameDoc = {
      ...before,
      currentTurnUid: 'guest',
      abilityLog: [
        { player: 'host', turnNumber: 1, result: { abilityId: 'submarine-sonar', center: { row: 4, col: 4 }, shipPresent: true } },
      ],
    };
    expect(notificationsForChange('g1', before, sonar)).toEqual([
      expect.objectContaining({ body: 'Ann scanned near E5.' }),
    ]);

    const relocate: GameDoc = {
      ...before,
      currentTurnUid: 'guest',
      abilityLog: [{ player: 'host', turnNumber: 1, result: { abilityId: 'destroyer-relocate' } }],
    };
    expect(notificationsForChange('g1', before, relocate)).toEqual([
      expect.objectContaining({ body: 'Ann moved a ship.' }),
    ]);
  });

  it('reports a skipped turn when the timeout streak grows', () => {
    const before: GameDoc = { ...joined, status: 'active', currentTurnUid: 'host', timeoutStreak: {} };
    const after: GameDoc = { ...before, currentTurnUid: 'guest', turnNumber: 2, timeoutStreak: { host: 1 } };
    expect(notificationsForChange('g1', before, after)).toEqual([
      { uid: 'guest', gameId: 'g1', title: 'Your turn', body: 'Ann ran out of time.' },
    ]);
  });

  it('falls back to a generic nudge when the turn changed without shots', () => {
    const before: GameDoc = { ...joined, status: 'active', currentTurnUid: 'host' };
    const after: GameDoc = { ...before, currentTurnUid: 'guest', turnNumber: 2 };
    expect(notificationsForChange('g1', before, after)).toEqual([
      { uid: 'guest', gameId: 'g1', title: 'Your turn', body: "It's your move against Ann." },
    ]);
  });

  it('appends the mode suffix to game-over titles but not classic', () => {
    const active: GameDoc = { ...joined, status: 'active', mode: 'salvo', currentTurnUid: 'host' };
    const sunk: GameDoc = { ...active, status: 'finished', winnerUid: 'host', endReason: 'all_sunk', currentTurnUid: null };
    expect(notificationsForChange('g1', active, sunk)).toEqual([
      expect.objectContaining({ title: 'Fleet destroyed · Salvo' }),
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
    expect(notificationsForChange('g1', active, timeout)).toEqual([
      expect.objectContaining({
        uid: 'guest',
        title: 'Game forfeited',
        body: 'Ann claimed the win after you were inactive.',
      }),
    ]);
  });

  it('uses turn-timer copy for consecutive timeout forfeits', () => {
    const active: GameDoc = { ...joined, status: 'active', currentTurnUid: 'host' };
    const timeout: GameDoc = {
      ...active,
      status: 'finished',
      winnerUid: 'host',
      endReason: 'timeout',
      currentTurnUid: null,
      turnTimerMs: 60_000,
    };

    expect(notificationsForChange('g1', active, timeout)).toEqual([
      expect.objectContaining({
        uid: 'guest',
        title: 'Game forfeited',
        body: 'You ran out of time on three turns in a row.',
      }),
    ]);
  });

  it('notifies only the non-requester once when a rematch is requested', () => {
    const finished: GameDoc = { ...joined, status: 'finished', winnerUid: 'host', endReason: 'all_sunk' };
    const requested: GameDoc = {
      ...finished,
      rematch: { gameId: 'rematch-1', requestedBy: 'host' },
    };

    expect(notificationsForChange('g1', finished, requested)).toEqual([
      { uid: 'guest', gameId: 'g1', title: 'Ann wants a rematch', body: 'Tap to accept.' },
    ]);
    expect(notificationsForChange('g1', requested, { ...requested, updatedAt: now })).toEqual([]);

    const replaced: GameDoc = {
      ...requested,
      rematch: { gameId: 'rematch-2', requestedBy: 'host' },
    };
    expect(notificationsForChange('g1', requested, replaced)).toEqual([
      { uid: 'guest', gameId: 'g1', title: 'Ann wants a rematch', body: 'Tap to accept.' },
    ]);
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

    const finishedBotGame: GameDoc = {
      ...botJoined,
      status: 'finished',
      winnerUid: 'host',
      endReason: 'all_sunk',
    };
    expect(
      notificationsForChange('g1', finishedBotGame, {
        ...finishedBotGame,
        rematch: { gameId: 'bot-rematch', requestedBy: 'host' },
      }),
    ).toEqual([]);
  });
});

describe('notificationForChallenge', () => {
  const challenge: ChallengeDoc = {
    fromUid: 'host',
    toUid: 'guest',
    fromUsername: 'Ann',
    toUsername: 'Bob',
    status: 'pending',
    sourceGameId: null,
    gameId: null,
    createdAt: now,
    respondedAt: null,
  };

  it('tells the invitee who challenged them', () => {
    expect(notificationForChallenge('c1', challenge)).toEqual({
      uid: 'guest',
      challengeId: 'c1',
      title: 'Ann challenged you',
      body: 'Open Broadside to accept or decline.',
    });
  });

  it('never notifies a bot and ignores non-pending challenges', () => {
    expect(notificationForChallenge('c1', { ...challenge, toUid: 'bot-officer' })).toBeNull();
    expect(notificationForChallenge('c1', { ...challenge, status: 'accepted' })).toBeNull();
  });
});
