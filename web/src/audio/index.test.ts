import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEL } from '../feel/config';
import type { FeelCue, SunkInfo } from '../feel/cues';
import { createAudioEngine } from './index';
import { createAudioManager } from './manager';
import { FakeAudioContext, FakeDocument, makeMuteStore } from './testing';
import { vibrate } from './haptics';

const sunk = (shipId: SunkInfo['shipId']): SunkInfo => ({
  shipId,
  placement: { type: shipId, row: 0, col: 0, horizontal: true },
});

const cues = {
  windupTarget: { type: 'windup', side: 'target', shotKey: 'a', target: { row: 0, col: 0 } },
  windupOwn: { type: 'windup', side: 'own', shotKey: 'a', target: { row: 0, col: 0 } },
  cancel: { type: 'cancel', side: 'target', shotKey: 'a' },
  impactMiss: { type: 'impact', side: 'target', shotKey: 'a', target: { row: 0, col: 0 }, result: 'miss' },
  impactHit: { type: 'impact', side: 'target', shotKey: 'a', target: { row: 0, col: 0 }, result: 'hit' },
  impactHitDestroyer: { type: 'impact', side: 'target', shotKey: 'a', target: { row: 0, col: 0 }, result: 'hit', sunk: sunk('destroyer') },
  impactHitCarrier: { type: 'impact', side: 'target', shotKey: 'a', target: { row: 0, col: 0 }, result: 'hit', sunk: sunk('carrier') },
  impactOwnHit: { type: 'impact', side: 'own', shotKey: 'a', target: { row: 0, col: 0 }, result: 'hit' },
  impactOwnMiss: { type: 'impact', side: 'own', shotKey: 'a', target: { row: 0, col: 0 }, result: 'miss' },
  sinkTarget: { type: 'sink', side: 'target', shotKey: 'a', target: { row: 0, col: 0 }, sunk: sunk('destroyer') },
  sinkOwn: { type: 'sink', side: 'own', shotKey: 'a', target: { row: 0, col: 0 }, sunk: sunk('destroyer') },
  gameOverWon: { type: 'gameOver', won: true, reason: 'all_sunk' },
  gameOverLost: { type: 'gameOver', won: false, reason: 'all_sunk' },
} satisfies Record<string, FeelCue>;

function setup(opts: { muted?: boolean } = {}) {
  FakeAudioContext.instances = 0;
  const mute = makeMuteStore(opts.muted);
  const manager = createAudioManager({
    createContext: () => new FakeAudioContext() as unknown as AudioContext,
    doc: new FakeDocument() as unknown as Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
    muteStore: mute,
  });
  const play = vi.spyOn(manager, 'play');
  const buzz = vi.fn();
  const engine = createAudioEngine({ manager, vibrate: buzz, isMuted: mute.isMuted });
  return { manager, play, buzz, engine, mute };
}

describe('audio engine gating', () => {
  beforeEach(() => FakeAudioContext.instances = 0);

  it('constructs no AudioContext and plays nothing before unlock', () => {
    const { play, buzz, engine } = setup();
    for (const cue of Object.values(cues)) engine.handle(cue);
    expect(FakeAudioContext.instances).toBe(0);
    expect(play).not.toHaveBeenCalled();
    expect(buzz).not.toHaveBeenCalled();
  });

  it('pre-unlock cues are not queued for after unlock', () => {
    const { play, engine } = setup();
    engine.handle(cues.impactHit);
    engine.unlock();
    engine.handle(cues.impactMiss); // control cue to prove engine works
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenLastCalledWith('splash');
  });

  it('when muted: no play calls and no haptics', () => {
    const { play, buzz, engine } = setup({ muted: true });
    engine.unlock();
    for (const cue of Object.values(cues)) engine.handle(cue);
    expect(play).not.toHaveBeenCalled();
    expect(buzz).not.toHaveBeenCalled();
  });

  it('a throwing context never escapes handle()', () => {
    const manager = createAudioManager({
      createContext: () => {
        const ctx = new FakeAudioContext();
        ctx.createOscillator = () => {
          throw new Error('boom');
        };
        return ctx as unknown as AudioContext;
      },
      doc: null,
    });
    const engine = createAudioEngine({ manager });
    engine.unlock();
    expect(() => engine.handle(cues.impactHit)).not.toThrow();
    expect(() => engine.handle(cues.sinkTarget)).not.toThrow();
  });
});

describe('audio engine routing', () => {
  it.each([
    ['windupTarget', ['launch']],
    ['windupOwn', ['launch']],
    ['impactMiss', ['splash']],
    ['impactHit', ['explosion']],
    ['impactHitDestroyer', ['explosion']],
    ['impactHitCarrier', ['bomb']],
    ['sinkTarget', ['sinkRumble']],
    ['sinkOwn', ['sinkRumbleHeavy']],
    ['gameOverWon', ['win']],
    ['gameOverLost', ['lose']],
  ] as const)('%s → %s', (key, expected) => {
    const { play, engine } = setup();
    engine.unlock();
    engine.handle(cues[key]!);
    expect(play.mock.calls.map((c) => c[0])).toEqual([...expected]);
  });

  it('cancel stops the in-flight windup voice', () => {
    const { manager, engine } = setup();
    engine.unlock();
    const voice = { stop: vi.fn() };
    vi.spyOn(manager, 'play').mockReturnValue(voice);
    engine.handle(cues.windupTarget);
    engine.handle(cues.cancel);
    expect(voice.stop).toHaveBeenCalled();
  });

  it('cancel with no windup is a no-op', () => {
    const { engine } = setup();
    engine.unlock();
    expect(() => engine.handle(cues.cancel)).not.toThrow();
  });

  it('a second windup stops the first', () => {
    const { manager, engine } = setup();
    engine.unlock();
    const v1 = { stop: vi.fn() };
    const v2 = { stop: vi.fn() };
    vi.spyOn(manager, 'play').mockReturnValueOnce(v1).mockReturnValueOnce(v2);
    engine.handle(cues.windupTarget);
    engine.handle(cues.windupOwn);
    expect(v1.stop).toHaveBeenCalled();
    expect(v2.stop).not.toHaveBeenCalled();
  });

  it('impact lets the windup voice finish (no stop)', () => {
    const { manager, engine } = setup();
    engine.unlock();
    const voice = { stop: vi.fn() };
    vi.spyOn(manager, 'play').mockReturnValue(voice);
    engine.handle(cues.windupTarget);
    engine.handle(cues.impactHit);
    expect(voice.stop).not.toHaveBeenCalled();
  });

  it('dispose stops the windup voice', () => {
    const { manager, engine } = setup();
    engine.unlock();
    const voice = { stop: vi.fn() };
    vi.spyOn(manager, 'play').mockReturnValue(voice);
    engine.handle(cues.windupTarget);
    engine.dispose();
    expect(voice.stop).toHaveBeenCalled();
  });
});

describe('haptics', () => {
  it('vibrate() is a safe no-op without navigator or navigator.vibrate', () => {
    expect(() => vibrate([1, 2])).not.toThrow();
    vi.stubGlobal('navigator', {});
    expect(() => vibrate([1, 2])).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('calls navigator.vibrate with the pattern', () => {
    const fn = vi.fn();
    vi.stubGlobal('navigator', { vibrate: fn });
    vibrate([10, 20]);
    expect(fn).toHaveBeenCalledWith([10, 20]);
    vi.unstubAllGlobals();
  });

  it.each([
    ['impactHit', [FEEL.haptics.hit]],
    ['impactMiss', []],
    ['impactOwnHit', []],
    ['impactOwnMiss', []],
    ['sinkTarget', [FEEL.haptics.sink]],
    ['sinkOwn', [FEEL.haptics.ownSink]],
    ['windupTarget', []],
    ['gameOverWon', []],
  ] as const)('%s vibrates %j', (key, patterns) => {
    const { buzz, engine } = setup();
    engine.unlock();
    engine.handle(cues[key]!);
    expect(buzz.mock.calls.map((c) => c[0])).toEqual([...patterns]);
  });
});
