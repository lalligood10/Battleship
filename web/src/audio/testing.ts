/** Test helpers: fake Web Audio graph recording calls for Vitest (node env). */
import { vi } from 'vitest';

export class FakeParam {
  calls: Array<{ method: string; args: number[] }> = [];
  value = 0;

  setValueAtTime(v: number, t: number) {
    this.calls.push({ method: 'setValueAtTime', args: [v, t] });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push({ method: 'linearRampToValueAtTime', args: [v, t] });
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.calls.push({ method: 'exponentialRampToValueAtTime', args: [v, t] });
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.calls.push({ method: 'setTargetAtTime', args: [v, t, tc] });
    this.value = v;
    return this;
  }
  cancelScheduledValues(t: number) {
    this.calls.push({ method: 'cancelScheduledValues', args: [t] });
    return this;
  }
}

export class FakeNode {
  connected: FakeNode[] = [];
  connect<T extends FakeNode>(target: T): T {
    this.connected.push(target);
    return target;
  }
  disconnect() {
    this.connected = [];
  }
}

export class FakeGainNode extends FakeNode {
  gain = new FakeParam();
  context: FakeAudioContext;
  constructor(context: FakeAudioContext) {
    super();
    this.context = context;
  }
}

export class FakeOscillatorNode extends FakeNode {
  type: OscillatorType = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
  start = vi.fn();
  stop = vi.fn();
  context: FakeAudioContext;
  constructor(context: FakeAudioContext) {
    super();
    this.context = context;
  }
}

export class FakeBiquadFilterNode extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
  context: FakeAudioContext;
  constructor(context: FakeAudioContext) {
    super();
    this.context = context;
  }
}

export class FakeBufferSourceNode extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
  context: FakeAudioContext;
  constructor(context: FakeAudioContext) {
    super();
    this.context = context;
  }
}

export class FakeAudioBuffer {
  length: number;
  sampleRate: number;
  constructor(_channels: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
  }
  getChannelData() {
    return new Float32Array(this.length);
  }
}

export class FakeAudioContext {
  static instances = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode();
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  gains: FakeGainNode[] = [];
  oscillators: FakeOscillatorNode[] = [];
  filters: FakeBiquadFilterNode[] = [];
  bufferSources: FakeBufferSourceNode[] = [];

  constructor() {
    FakeAudioContext.instances++;
  }

  createGain() {
    const node = new FakeGainNode(this);
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillatorNode(this);
    this.oscillators.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeBiquadFilterNode(this);
    this.filters.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeBufferSourceNode(this);
    this.bufferSources.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer(channels, length, sampleRate);
  }
}

export class FakeDocument {
  hidden = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type: string) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.dispatch('visibilitychange');
  }
}

export function makeMuteStore(initial = false) {
  let muted = initial;
  const listeners = new Set<() => void>();
  return {
    isMuted: () => muted,
    setMuted(m: boolean) {
      muted = m;
      for (const l of [...listeners]) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
