import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HeadToHeadDoc } from '../../lib/stats';
import { pollHeadToHeadForGame, resultsRetentionVisibility } from './resultsRetention';

const h2h = (lastGameId: string): HeadToHeadDoc => ({
  playerUids: ['alice', 'bob'],
  usernames: { alice: 'Alice', bob: 'Bob' },
  gamesPlayed: 1,
  wins: { alice: 1 },
  winsByMode: {
    classic: { alice: 1 },
    salvo: {},
    abilities: {},
  },
  lastGameId,
  lastWinnerUid: 'alice',
  lastPlayedAtMs: 1,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resultsRetentionVisibility', () => {
  it('hides achievement unlocks and head-to-head for spectators', () => {
    expect(resultsRetentionVisibility(['alice', 'bob'], 'spectator')).toEqual({
      showAchievementUnlocks: false,
      opponentUid: 'alice',
      showHeadToHead: false,
    });
  });

  it('hides head-to-head against a bot', () => {
    expect(resultsRetentionVisibility(['alice', 'bot-cadet'], 'alice')).toEqual({
      showAchievementUnlocks: true,
      opponentUid: 'bot-cadet',
      showHeadToHead: false,
    });
  });

  it('shows head-to-head for a human opponent', () => {
    expect(resultsRetentionVisibility(['alice', 'bob'], 'alice')).toMatchObject({
      showAchievementUnlocks: true,
      opponentUid: 'bob',
      showHeadToHead: true,
    });
  });
});

describe('pollHeadToHeadForGame', () => {
  it('stops polling when the last game id matches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    const read = vi.fn().mockResolvedValueOnce(h2h('older-game')).mockResolvedValueOnce(h2h('current-game'));
    const onUpdate = vi.fn();

    pollHeadToHeadForGame('current-game', read, onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenLastCalledWith(h2h('older-game'));

    await vi.advanceTimersByTimeAsync(1500);
    expect(read).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith(h2h('current-game'));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
