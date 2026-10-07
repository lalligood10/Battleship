import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FEEL } from '../feel/config';
import { createAudioManager } from './manager';
import type { SoundName } from './synth';
import { FakeAudioContext, FakeDocument, makeMuteStore } from './testing';

function setupWithCtx(opts: { muted?: boolean; hidden?: boolean } = {}) {
  let ctx: FakeAudioContext | null = null;
  FakeAudioContext.instances = 0;
  const doc = new FakeDocument();
  doc.hidden = opts.hidden ?? false;
  const mute = makeMuteStore(opts.muted);
  const manager = createAudioManager({
    createContext: () => {
      ctx = new FakeAudioContext();
      return ctx as unknown as AudioContext;
    },
    doc: doc as unknown as Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>,
    muteStore: mute,
  });
  return { doc, mute, manager, ctx: () => ctx! };
}

describe('createAudioManager unlock', () => {
  beforeEach(() => {
    FakeAudioContext.instances = 0;
  });

  it('constructs no context before unlock; unlock builds exactly one; second unlock none', () => {
    const { manager, ctx } = setupWithCtx();
    expect(FakeAudioContext.instances).toBe(0);
    expect(manager.isUnlocked()).toBe(false);
    manager.unlock();
    expect(FakeAudioContext.instances).toBe(1);
    expect(ctx().resume).toHaveBeenCalled();
    expect(manager.isUnlocked()).toBe(true);
    manager.unlock();
    expect(FakeAudioContext.instances).toBe(1);
  });

  it('stays silent forever when no AudioContext constructor exists', () => {
    const manager = createAudioManager({ createContext: () => null as unknown as AudioContext, doc: null });
    expect(() => manager.unlock()).not.toThrow();
    expect(manager.play('splash')).toBeNull();
  });

  it('uses globalThis.AudioContext by default', () => {
    FakeAudioContext.instances = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    const manager = createAudioManager({ doc: null });
    manager.unlock();
    expect(FakeAudioContext.instances).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('synth voices', () => {
  it('every SoundName builds nodes connected toward master without throwing', () => {
    const { manager, ctx } = setupWithCtx();
    manager.unlock();
    const names: SoundName[] = ['launch', 'splash', 'explosion', 'bomb', 'sinkRumble', 'sinkRumbleHeavy', 'win', 'lose'];
    const before = ctx().oscillators.length + ctx().bufferSources.length;
    for (const name of names) {
      const voice = manager.play(name);
      expect(voice).not.toBeNull();
      voice!.stop();
      voice!.stop(); // idempotent
    }
    expect(ctx().oscillators.length + ctx().bufferSources.length).toBeGreaterThan(before);
    const master = ctx().gains[0]!;
    const feedsMaster = ctx().gains.slice(1).some((g) => g.connected.includes(master));
    expect(feedsMaster || ctx().oscillators.some((o) => o.connected.length > 0)).toBe(true);
  });
});

describe('ambient ocean', () => {
  function oceanSources(ctx: FakeAudioContext) {
    return ctx.bufferSources.filter((s) => s.loop);
  }

  it('does not start before unlock; starts on unlock when wanted', async () => {
    const { manager, ctx } = setupWithCtx();
    manager.setAmbientWanted(true);
    expect(FakeAudioContext.instances).toBe(0);
    manager.unlock();
    await Promise.resolve();
    expect(oceanSources(ctx())).toHaveLength(1);
    expect(oceanSources(ctx())[0]!.start).toHaveBeenCalled();
  });

  it('setAmbientWanted(false) stops with a fade', async () => {
    const { manager, ctx } = setupWithCtx();
    manager.unlock();
    manager.setAmbientWanted(true);
    await Promise.resolve();
    const ocean = oceanSources(ctx())[0]!;
    manager.setAmbientWanted(false);
    expect(ocean.stop).toHaveBeenCalled();
    expect(ocean.stop.mock.calls[0]![0]).toBeGreaterThan(0);
  });

  it('hidden document stops it; visible again restarts', async () => {
    const { manager, ctx, doc } = setupWithCtx();
    manager.unlock();
    manager.setAmbientWanted(true);
    await Promise.resolve();
    doc.setHidden(true);
    expect(oceanSources(ctx())[0]!.stop).toHaveBeenCalled();
    doc.setHidden(false);
    expect(oceanSources(ctx())).toHaveLength(2);
    expect(oceanSources(ctx())[1]!.stop).not.toHaveBeenCalled();
  });

  it('muting stops ambient immediately and zeroes master; unmute restores', async () => {
    const { manager, ctx, mute } = setupWithCtx();
    manager.unlock();
    manager.setAmbientWanted(true);
    await Promise.resolve();
    const master = ctx().gains[0]!;
    const ocean = oceanSources(ctx())[0]!;
    mute.setMuted(true);
    expect(ocean.stop).toHaveBeenCalled();
    expect(ocean.stop.mock.calls[0]![0]).toBeLessThan(0.1);
    expect(master.gain.calls.some((c) => c.method === 'setValueAtTime' && c.args[0] === 0)).toBe(true);
    mute.setMuted(false);
    const restores = master.gain.calls.filter((c) => c.method === 'setValueAtTime' && c.args[0] === FEEL.audio.masterVolume);
    expect(restores.length).toBeGreaterThan(0);
    expect(oceanSources(ctx()).filter((s) => !(s.stop as ReturnType<typeof vi.fn>).mock.calls.length)).toHaveLength(1);
  });

  it('does not double-start', async () => {
    const { manager, ctx } = setupWithCtx();
    manager.unlock();
    manager.setAmbientWanted(true);
    manager.setAmbientWanted(true);
    manager.unlock();
    await Promise.resolve();
    expect(oceanSources(ctx())).toHaveLength(1);
  });
});

describe('muted playback', () => {
  it('muted manager plays nothing', () => {
    const { manager } = setupWithCtx({ muted: true });
    manager.unlock();
    expect(manager.play('explosion')).toBeNull();
  });
});

describe('dispose', () => {
  it('stops ambient and is safe', async () => {
    const { manager, ctx } = setupWithCtx();
    manager.unlock();
    manager.setAmbientWanted(true);
    await Promise.resolve();
    expect(() => manager.dispose()).not.toThrow();
    const ocean = ctx().bufferSources.find((s) => s.loop);
    expect(ocean?.stop).toHaveBeenCalled();
    expect(manager.isUnlocked()).toBe(false);
  });
});
