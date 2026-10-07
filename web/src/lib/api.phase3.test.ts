import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { name: string; data: unknown }[] = [];

vi.mock('./firebase', () => ({ functions: () => ({}) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => async (data: unknown) => {
    calls.push({ name, data });
    return { data: {} };
  },
}));

const api = await import('./api');

beforeEach(() => {
  calls.length = 0;
});

describe('Phase 3 callable payloads', () => {
  it('createGame omits an unset timer and passes an explicit one or null', async () => {
    await api.createGame('salvo');
    await api.createGame('abilities', 60_000);
    await api.createGame('classic', null);
    expect(calls).toEqual([
      { name: 'createGame', data: { mode: 'salvo' } },
      { name: 'createGame', data: { mode: 'abilities', turnTimerMs: 60_000 } },
      { name: 'createGame', data: { mode: 'classic', turnTimerMs: null } },
    ]);
  });

  it('createChallenge sends mode and timer, and a rematch source only when given', async () => {
    await api.createChallenge('bob', 'abilities', undefined, 120_000);
    await api.createChallenge('bob', 'salvo', 'game-1');
    expect(calls).toEqual([
      { name: 'createChallenge', data: { opponentUid: 'bob', mode: 'abilities', turnTimerMs: 120_000 } },
      { name: 'createChallenge', data: { opponentUid: 'bob', mode: 'salvo', sourceGameId: 'game-1' } },
    ]);
  });

  it('Quick Match sends only the mode', async () => {
    await api.joinQuickMatch('abilities');
    expect(calls).toEqual([{ name: 'joinQuickMatch', data: { mode: 'abilities' } }]);
  });

  it('timeout and guest callables use the contract names', async () => {
    await api.claimTurnTimeout('game-1');
    await api.claimTimeoutWin('game-1');
    await api.completeGuestUpgrade();
    expect(calls).toEqual([
      { name: 'claimTurnTimeout', data: { gameId: 'game-1' } },
      { name: 'claimTimeoutWin', data: { gameId: 'game-1' } },
      { name: 'completeGuestUpgrade', data: {} },
    ]);
  });
});
