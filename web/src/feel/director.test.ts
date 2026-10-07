import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '@shared/core/events';
import type { Coordinate } from '@shared/engine';
import { createFeelDirector } from './director';
import type { FeelCue } from './cues';

const target: Coordinate = { row: 2, col: 3 };
const sunk = {
  shipId: 'destroyer' as const,
  placement: { type: 'destroyer' as const, row: 2, col: 3, horizontal: true },
};

function resolved(shooter: string, result: 'hit' | 'miss' = 'hit'): CoreEvent {
  return { type: 'shotResolved', shooter, target, result, turnNumber: 1 };
}

function createDirector(botGame = false) {
  const director = createFeelDirector({
    myUid: 'me',
    botGame,
    initialShots: { target: 0, own: 0 },
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  });
  const cues: FeelCue[] = [];
  director.subscribe((cue) => cues.push(cue));
  return { director, cues };
}

describe('feel director', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the local wind-up before an early result and reveals only on impact', () => {
    const { director, cues } = createDirector();
    director.fireRequested(target);
    expect(cues).toEqual([{ type: 'windup', side: 'target', shotKey: 'me:0', target }]);
    vi.advanceTimersByTime(100);
    director.handle([resolved('me')]);
    expect(director.revealed()).toEqual({ target: 0, own: 0 });
    vi.advanceTimersByTime(299);
    expect(director.revealed()).toEqual({ target: 0, own: 0 });
    vi.advanceTimersByTime(1);
    expect(director.revealed()).toEqual({ target: 1, own: 0 });
    expect(cues.at(-1)).toMatchObject({ type: 'impact', shotKey: 'me:0' });
  });

  it('plays a local result as soon as a late result arrives', () => {
    const { director, cues } = createDirector();
    director.fireRequested(target);
    vi.advanceTimersByTime(900);
    director.handle([resolved('me')]);
    expect(director.revealed().target).toBe(0);
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(0);
    vi.advanceTimersByTime(0);
    expect(director.revealed().target).toBe(1);
  });

  it('adds a wind-up for a shot from another device', () => {
    const { director, cues } = createDirector();
    director.handle([resolved('me', 'miss')]);
    expect(cues).toEqual([{ type: 'windup', side: 'target', shotKey: 'me:0', target }]);
    vi.advanceTimersByTime(399);
    expect(director.revealed().target).toBe(0);
    vi.advanceTimersByTime(1);
    expect(director.revealed().target).toBe(1);
    expect(cues.at(-1)).toMatchObject({ type: 'impact', result: 'miss' });
  });

  it('delays a bot reply so it impacts one second after the response event', () => {
    const { director, cues } = createDirector(true);
    director.fireRequested(target);
    director.handle([resolved('me')]);
    director.handle([{ type: 'turnChanged', currentTurn: 'bot-easy', turnNumber: 2 }]);
    director.handle([resolved('bot-easy', 'miss')]);
    vi.advanceTimersByTime(400);
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(1);
    vi.advanceTimersByTime(199);
    expect(cues.filter((cue) => cue.type === 'windup' && cue.side === 'own')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(cues.at(-1)).toMatchObject({ type: 'windup', side: 'own', shotKey: 'bot-easy:0' });
    vi.advanceTimersByTime(399);
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(2);
    expect(director.revealed()).toEqual({ target: 1, own: 1 });
  });

  it('attaches sink data and delays the next impact through the sink beat', () => {
    const { director, cues } = createDirector();
    const impactTimes: number[] = [];
    director.subscribe((cue) => {
      if (cue.type === 'impact') impactTimes.push(Date.now());
    });
    director.fireRequested(target);
    director.handle([resolved('me')]);
    director.handle([
      { type: 'shipSunk', shooter: 'me', owner: 'opponent', shipId: sunk.shipId, placement: sunk.placement },
    ]);
    director.handle([resolved('opponent', 'miss')]);
    vi.advanceTimersByTime(400);
    expect(cues.find((cue) => cue.type === 'impact')).toMatchObject({ sunk });
    vi.advanceTimersByTime(250);
    expect(cues.find((cue) => cue.type === 'sink')).toMatchObject({ sunk });
    vi.advanceTimersByTime(1799);
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(cues.filter((cue) => cue.type === 'impact')).toHaveLength(2);
    const impacts = cues.filter((cue): cue is Extract<FeelCue, { type: 'impact' }> => cue.type === 'impact');
    expect(impacts[1]!.shotKey).toBe('opponent:0');
    expect(impactTimes[1]! - impactTimes[0]!).toBeGreaterThanOrEqual(1650);
  });

  it.each([
    ['destroyer', 1800, 2450],
    ['carrier', 2400, 3050],
  ] as const)('holds results for a final %s sink', (shipId, holdMs, expectedAt) => {
    const { director, cues } = createDirector();
    const placement = { type: shipId, row: 2, col: 3, horizontal: true } as const;
    director.fireRequested(target);
    director.handle([resolved('me')]);
    director.handle([
      { type: 'shipSunk', shooter: 'me', owner: 'opponent', shipId, placement },
      { type: 'gameOver', winner: 'me', reason: 'all_sunk' },
    ]);
    vi.advanceTimersByTime(expectedAt - 1);
    expect(cues.some((cue) => cue.type === 'gameOver')).toBe(false);
    expect(director.settled()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(cues.at(-1)).toEqual({ type: 'gameOver', won: true, reason: 'all_sunk' });
    expect(director.settled()).toBe(true);
    expect(expectedAt).toBe(400 + 250 + holdMs);
  });

  it('emits resignation immediately when there are no shots queued', () => {
    const { director, cues } = createDirector();
    director.handle([{ type: 'gameOver', winner: 'other', reason: 'resign' }]);
    expect(cues).toEqual([{ type: 'gameOver', won: false, reason: 'resign' }]);
    expect(director.settled()).toBe(true);
  });

  it('cancels a failed local shot without revealing an impact', () => {
    const { director, cues } = createDirector();
    director.fireRequested(target);
    director.fireFailed();
    vi.advanceTimersByTime(1000);
    expect(cues.map((cue) => cue.type)).toEqual(['windup', 'cancel']);
    expect(director.revealed()).toEqual({ target: 0, own: 0 });
  });

  it('clears pending timers on dispose', () => {
    const { director, cues } = createDirector();
    director.handle([resolved('me')]);
    director.dispose();
    vi.advanceTimersByTime(1000);
    expect(cues).toEqual([{ type: 'windup', side: 'target', shotKey: 'me:0', target }]);
    expect(director.settled()).toBe(true);
  });

  it('isolates cue listeners that throw', () => {
    const { director, cues } = createDirector();
    const observed: FeelCue[] = [];
    director.subscribe(() => {
      throw new Error('listener failed');
    });
    director.subscribe((cue) => observed.push(cue));
    director.fireRequested(target);
    expect(cues).toHaveLength(1);
    expect(observed).toHaveLength(1);
  });
});
