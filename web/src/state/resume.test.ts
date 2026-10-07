import { describe, expect, it } from 'vitest';
import type { Game } from '../lib/types';
import { freshTurnGames, quickMatchResume } from './resume';

describe('quickMatchResume', () => {
  it('ignores missing, undated, and expired tickets', () => {
    expect(quickMatchResume(null, 20_000)).toEqual({ kind: 'none' });
    expect(quickMatchResume({ mode: 'salvo', createdAtMs: null }, 20_000)).toEqual({ kind: 'none' });
    expect(quickMatchResume({ createdAtMs: 10_000 }, 20_000, 10_000)).toEqual({ kind: 'none' });
  });

  it('resumes a fresh matched game', () => {
    expect(quickMatchResume({ gameId: 'game-1', createdAtMs: 9_999 }, 10_000)).toEqual({
      kind: 'matched',
      gameId: 'game-1',
    });
  });

  it('resumes a fresh search using a supported mode or Classic fallback', () => {
    expect(quickMatchResume({ mode: 'salvo', createdAtMs: 9_999 }, 10_000)).toEqual({
      kind: 'searching',
      mode: 'salvo',
    });
    expect(quickMatchResume({ mode: 'invalid', createdAtMs: 9_999 }, 10_000)).toEqual({
      kind: 'searching',
      mode: 'classic',
    });
  });
});

describe('freshTurnGames', () => {
  const activeTurn = { id: 'active', status: 'active', currentTurnUid: 'me' } as unknown as Game;
  const placing = { id: 'placing', status: 'placing', players: { me: { ready: false } } } as unknown as Game;

  it('does not announce the first snapshot or an identical reconnect snapshot', () => {
    const first = freshTurnGames(null, [activeTurn], 'me');
    expect(first.fresh).toEqual([]);
    expect(freshTurnGames(first.nowMine, [activeTurn], 'me').fresh).toEqual([]);
  });

  it('announces a game that newly becomes my turn while active', () => {
    expect(freshTurnGames(new Set(), [activeTurn], 'me').fresh).toEqual([activeTurn]);
  });

  it('does not announce games that are still in placement', () => {
    expect(freshTurnGames(new Set(), [placing], 'me').fresh).toEqual([]);
  });
});
