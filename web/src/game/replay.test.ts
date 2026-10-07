import { describe, expect, it } from 'vitest';
import type { Game, Shot } from '../lib/types';
import { buildMarks } from './marks';
import { replayTimeline, hasReplay, shotsUpTo } from './replay';
import { shotsBy } from '../lib/types';

const base: Game = {
  id: 'g1',
  code: 'ABC234',
  status: 'finished',
  hostUid: 'me',
  playerUids: ['me', 'bob'],
  players: {
    me: { username: 'Me', rating: 1000, ready: true, sunkShips: [], shotsFired: 0, hits: 0 },
    bob: { username: 'Bob', rating: 1000, ready: true, sunkShips: [], shotsFired: 0, hits: 0 },
  },
  shots: {},
  currentTurnUid: null,
  turnNumber: 0,
  winnerUid: null,
  endReason: null,
  ratingChanges: null,
  revealedFleets: null,
  isQuickMatch: false,
  isBotGame: false,
  botDifficulty: null,
  abandonTimeoutMs: 0,
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  finishedAt: null,
  lastMoveAt: null,
};

const shot = (row: number, col: number, at: number, result: Shot['result'] = 'miss', extra: Partial<Shot> = {}): Shot => ({
  row,
  col,
  result,
  at,
  ...extra,
});

describe('replay timeline', () => {
  it('merges human shot arrays by time without mutating the game', () => {
    const aShots = [shot(0, 1, 400), shot(0, 0, 200)];
    const bShots = [shot(1, 1, 300), shot(1, 0, 100)];
    const game = { ...base, shots: { me: aShots, bob: bShots } };

    const timeline = replayTimeline(game);

    expect(timeline.map(({ shooterUid, shot: s }) => [shooterUid, s.at])).toEqual([
      ['bob', 100],
      ['me', 200],
      ['bob', 300],
      ['me', 400],
    ]);
    expect(aShots).toEqual([shot(0, 1, 400), shot(0, 0, 200)]);
    expect(bShots).toEqual([shot(1, 1, 300), shot(1, 0, 100)]);
  });

  it('alternates bot replies timestamped one millisecond after each human shot', () => {
    const game = {
      ...base,
      playerUids: ['me', 'bot-officer'],
      isBotGame: true,
      shots: {
        me: [shot(0, 0, 100), shot(0, 1, 4100), shot(0, 2, 8100)],
        'bot-officer': [shot(1, 0, 101), shot(1, 1, 4101)],
      },
    };
    expect(replayTimeline(game).map((entry) => entry.shooterUid)).toEqual(['me', 'bot-officer', 'me', 'bot-officer', 'me']);
  });

  it('uses alternation when a human reply shares its bot reply timestamp', () => {
    const game = {
      ...base,
      shots: {
        me: [shot(0, 0, 100), shot(0, 1, 101)],
        bob: [shot(1, 0, 101)],
      },
    };
    expect(replayTimeline(game).map((entry) => entry.shooterUid)).toEqual(['me', 'bob', 'me']);
  });

  it('keeps complete Salvo volleys together when both sides share a timestamp', () => {
    const game = {
      ...base,
      mode: 'salvo' as const,
      shots: {
        me: [shot(0, 0, 100, 'miss', { volley: 3 }), shot(0, 1, 100, 'hit', { volley: 3 })],
        bob: [shot(1, 0, 100, 'miss', { volley: 4 })],
      },
    };

    expect(replayTimeline(game).map((entry) => [entry.shooterUid, entry.shot.volley])).toEqual([
      ['me', 3],
      ['me', 3],
      ['bob', 4],
    ]);
  });

  it('breaks an initial timestamp tie in favor of the player with more shots', () => {
    const game = {
      ...base,
      shots: {
        me: [shot(0, 0, 10), shot(0, 1, 20)],
        bob: [shot(1, 0, 10)],
      },
    };
    expect(replayTimeline(game).map((entry) => entry.shooterUid)).toEqual(['me', 'bob', 'me']);
  });

  it('reconstructs ResultsView marks at the final frame and only the prefix at intermediate frames', () => {
    const destroyer = { type: 'destroyer' as const, row: 2, col: 3, horizontal: true };
    const game: Game = {
      ...base,
      shots: {
        me: [shot(2, 3, 100, 'sunk', { sunkShip: 'destroyer', sunkPlacement: destroyer }), shot(5, 5, 300)],
        bob: [shot(0, 0, 200)],
      },
      revealedFleets: {
        me: [destroyer],
        bob: [{ type: 'cruiser', row: 6, col: 1, horizontal: true }],
      },
    };
    const timeline = replayTimeline(game);

    for (const uid of game.playerUids) {
      const opp = uid === 'me' ? 'bob' : 'me';
      expect(buildMarks(shotsUpTo(timeline, uid, timeline.length), game.revealedFleets?.[opp] ?? [], true)).toEqual(
        buildMarks(shotsBy(game, uid), game.revealedFleets?.[opp] ?? [], true),
      );
    }
    expect(shotsUpTo(timeline, 'me', 1)).toEqual([game.shots['me']![0]]);
    expect(shotsUpTo(timeline, 'me', 2)).toEqual([game.shots['me']![0]]);
    expect(shotsUpTo(timeline, 'me', 2).length + shotsUpTo(timeline, 'bob', 2).length).toBe(2);
  });

  it('returns no steps when there are no shots and detects replayable games', () => {
    expect(replayTimeline(base)).toEqual([]);
    expect(replayTimeline({ playerUids: ['me'], shots: { me: [shot(0, 0, 1)] } })).toEqual([{ shooterUid: 'me', shot: shot(0, 0, 1) }]);
    expect(hasReplay(base)).toBe(false);
    expect(hasReplay({ ...base, shots: { me: [shot(0, 0, 1)] } })).toBe(true);
  });
});
