import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '@shared/core/events';
import type { PlaytestRecord } from './types';
import { createGameRecorder } from './recorder';

const input = { gameId: 'game-1', mode: 'classic' as const, myUid: 'one', startedAt: 1_000 };

describe('createGameRecorder', () => {
  it('records classic shots, action turns, sunk ships, and duration', () => {
    const bus = createEventBus();
    const onComplete = vi.fn<(record: PlaytestRecord) => void>();
    createGameRecorder(input, { bus, now: () => 1_600, onComplete });

    bus.emit([
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 0 }, turnNumber: 1 },
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 1 }, turnNumber: 1 },
      { type: 'turnChanged', currentTurn: 'two', turnNumber: 12 },
      { type: 'shotFired', shooter: 'two', target: { row: 1, col: 0 }, turnNumber: 2 },
      {
        type: 'shipSunk',
        shooter: 'one',
        owner: 'one',
        shipId: 'destroyer',
        placement: { type: 'destroyer', row: 0, col: 0, horizontal: true },
      },
      {
        type: 'shipSunk',
        shooter: 'one',
        owner: 'two',
        shipId: 'carrier',
        placement: { type: 'carrier', row: 0, col: 0, horizontal: true },
      },
      { type: 'gameOver', winner: 'one', reason: 'all_sunk' },
    ]);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      gameId: 'game-1',
      startedAt: 1_000,
      endedAt: 1_600,
      durationMs: 600,
      turns: 2,
      winner: 'one',
      endReason: 'all_sunk',
      winnerShipsRemaining: 4,
      shotsByPlayer: { one: 2, two: 1 },
      abilities: [],
    }));
  });

  it('does not double-count salvo shots when both event styles are present', () => {
    const bus = createEventBus();
    const onComplete = vi.fn<(record: PlaytestRecord) => void>();
    createGameRecorder({ ...input, mode: 'salvo' }, { bus, now: () => 1_100, onComplete });

    bus.emit([
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 0 }, turnNumber: 1 },
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 1 }, turnNumber: 1 },
      {
        type: 'salvoResolved',
        shooter: 'one',
        targets: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
        results: ['miss', 'hit'],
        turnNumber: 1,
      },
      { type: 'gameOver', winner: 'one', reason: 'all_sunk' },
    ]);

    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ turns: 1, shotsByPlayer: { one: 2 } });
  });

  it('counts a salvoResolved-only stream', () => {
    const bus = createEventBus();
    const onComplete = vi.fn<(record: PlaytestRecord) => void>();
    createGameRecorder({ ...input, mode: 'salvo' }, { bus, now: () => 1_100, onComplete });

    bus.emit([
      {
        type: 'salvoResolved',
        shooter: 'two',
        targets: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
        results: ['miss', 'hit', 'sunk'],
        turnNumber: 3,
      },
      { type: 'gameOver', winner: 'two', reason: 'all_sunk' },
    ]);

    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ turns: 3, shotsByPlayer: { two: 3 } });
  });

  it('counts airstrike cells as shots, ignores other abilities as shots, and deduplicates ability uses', () => {
    const bus = createEventBus();
    const onComplete = vi.fn<(record: PlaytestRecord) => void>();
    createGameRecorder({ ...input, mode: 'abilities' }, { bus, now: () => 1_100, onComplete });

    bus.emit([
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 0 }, turnNumber: 2 },
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 1 }, turnNumber: 2 },
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 2 }, turnNumber: 2 },
      {
        type: 'abilityUsed',
        player: 'one',
        abilityId: 'carrier-airstrike',
        result: { abilityId: 'carrier-airstrike', cells: [] },
        turnNumber: 2,
      },
      {
        type: 'abilityUsed',
        player: 'one',
        abilityId: 'submarine-sonar',
        result: { abilityId: 'submarine-sonar', center: { row: 1, col: 1 }, shipPresent: true },
        turnNumber: 3,
      },
      {
        type: 'abilityUsed',
        player: 'one',
        abilityId: 'destroyer-relocate',
        result: { abilityId: 'destroyer-relocate' },
        turnNumber: 4,
      },
      {
        type: 'abilityUsed',
        player: 'one',
        abilityId: 'carrier-airstrike',
        result: { abilityId: 'carrier-airstrike', cells: [] },
        turnNumber: 5,
      },
      { type: 'gameOver', winner: 'one', reason: 'all_sunk' },
    ]);

    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({
      turns: 5,
      shotsByPlayer: { one: 3 },
      abilities: [
        { player: 'one', abilityId: 'carrier-airstrike', turnNumber: 2 },
        { player: 'one', abilityId: 'submarine-sonar', turnNumber: 3 },
        { player: 'one', abilityId: 'destroyer-relocate', turnNumber: 4 },
      ],
    });
  });

  it('ignores events after gameOver and calls onComplete exactly once', () => {
    const bus = createEventBus();
    const onComplete = vi.fn<(record: PlaytestRecord) => void>();
    createGameRecorder(input, { bus, now: () => 1_100, onComplete });

    bus.emit([{ type: 'gameOver', winner: 'one', reason: 'resign' }]);
    bus.emit([
      { type: 'shotFired', shooter: 'one', target: { row: 0, col: 0 }, turnNumber: 9 },
      { type: 'gameOver', winner: 'two', reason: 'timeout' },
    ]);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ turns: 0, shotsByPlayer: {} });
  });

  it('swallows completion errors without interrupting other subscribers', () => {
    const bus = createEventBus();
    const otherSubscriber = vi.fn();
    createGameRecorder(input, {
      bus,
      now: () => 1_100,
      onComplete: () => {
        throw new Error('storage failed');
      },
    });
    bus.subscribe(otherSubscriber);

    expect(() => bus.emit([{ type: 'gameOver', winner: 'one', reason: 'resign' }])).not.toThrow();
    expect(otherSubscriber).toHaveBeenCalledWith({ type: 'gameOver', winner: 'one', reason: 'resign' });
  });

  it('uses the first observed event time when startedAt is invalid', () => {
    const bus = createEventBus();
    const onComplete = vi.fn<(record: PlaytestRecord) => void>();
    const now = vi.fn().mockReturnValueOnce(1_200).mockReturnValueOnce(1_450);
    createGameRecorder({ ...input, startedAt: Number.NaN }, { bus, now, onComplete });

    bus.emit([
      { type: 'turnChanged', currentTurn: 'one', turnNumber: 20 },
      { type: 'gameOver', winner: 'one', reason: 'resign' },
    ]);

    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({
      startedAt: 1_200,
      endedAt: 1_450,
      durationMs: 250,
      turns: 0,
    });
  });
});
