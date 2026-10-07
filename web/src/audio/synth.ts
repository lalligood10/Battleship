/** Pure Web Audio recipes. Each builds a short voice graph under `out` and returns a handle to stop it. */

export interface Voice {
  stop(): void;
}

export type SoundName =
  | 'launch'
  | 'splash'
  | 'explosion'
  | 'bomb'
  | 'sinkRumble'
  | 'sinkRumbleHeavy'
  | 'win'
  | 'lose';

interface NoiseBuffers {
  white: AudioBuffer;
  brown: AudioBuffer;
}

const noiseBuffers = new WeakMap<BaseAudioContext, NoiseBuffers>();

function noise(ctx: BaseAudioContext): NoiseBuffers {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const rate = ctx.sampleRate;

  const white = ctx.createBuffer(1, Math.max(1, Math.floor(rate * 2)), rate);
  const whiteData = white.getChannelData(0);
  for (let i = 0; i < whiteData.length; i++) whiteData[i] = Math.random() * 2 - 1;

  const brown = ctx.createBuffer(1, Math.max(1, Math.floor(rate * 4)), rate);
  const brownData = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < brownData.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    brownData[i] = last * 3.5;
  }

  const buffers = { white, brown };
  noiseBuffers.set(ctx, buffers);
  return buffers;
}

interface Source {
  start(when?: number): void;
  stop(when?: number): void;
}

function makeVoice(gain: GainNode, sources: Source[]): Voice {
  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        const t = gain.context.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0.0001, t + 0.03);
        for (const source of sources) {
          try {
            source.stop(t + 0.04);
          } catch {
            // Source may already be stopped.
          }
        }
      } catch {
        // Stopping a voice is best-effort.
      }
    },
  };
}

function envelope(gain: GainNode, t0: number, peak: number, attackMs: number, decayMs: number): void {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + (attackMs + decayMs) / 1000);
}

function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number,
  freq: number,
  durationMs: number,
  type: OscillatorType,
  level: number,
  endFreq?: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + durationMs / 1000);
  gain.gain.setValueAtTime(level, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
  osc.connect(gain).connect(out);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);
}

function noiseBurst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t0: number,
  buffer: AudioBuffer,
  filterType: BiquadFilterType,
  fromHz: number,
  toHz: number,
  durationMs: number,
  peak: number,
  attackMs = 8,
): Voice {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(fromHz, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t0 + durationMs / 1000);
  const gain = ctx.createGain();
  envelope(gain, t0, peak, attackMs, durationMs - attackMs);
  src.connect(filter).connect(gain).connect(out);
  src.start(t0);
  src.stop(t0 + durationMs / 1000 + 0.05);
  return makeVoice(gain, [src]);
}

function launch(ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  // Low thump plus a whoosh that swells then falls inside the windup window.
  tone(ctx, out, t0, 90, 120, 'sine', 0.35, 45);

  const src = ctx.createBufferSource();
  src.buffer = noise(ctx).white;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(400, t0);
  filter.frequency.exponentialRampToValueAtTime(2200, t0 + 0.35);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.18);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.36);
  src.connect(filter).connect(gain).connect(out);
  src.start(t0);
  src.stop(t0 + 0.4);
  return makeVoice(gain, [src]);
}

function splash(ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  tone(ctx, out, t0, 240, 90, 'sine', 0.12, 90);
  return noiseBurst(ctx, out, t0, noise(ctx).white, 'bandpass', 1400, 300, 450, 0.3, 6);
}

function explosionAt(ctx: BaseAudioContext, out: AudioNode, t0: number, scale: number, durationMs: number): Voice {
  const osc = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t0);
  osc.frequency.exponentialRampToValueAtTime(40, t0 + durationMs / 1000);
  envelope(thumpGain, t0, 0.5 * scale, 8, durationMs);
  osc.connect(thumpGain).connect(out);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.05);

  const crack = noiseBurst(ctx, out, t0, noise(ctx).white, 'lowpass', 3000, 300, Math.max(250, durationMs * 0.8), 0.4 * scale, 4);
  return makeVoice(thumpGain, [osc, { start: () => undefined, stop: () => crack.stop() }]);
}

function explosion(ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  return explosionAt(ctx, out, t0, 1, 350);
}

function bomb(ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  // Descending whistle timed to land with a bigger burst.
  [880, 660, 440].forEach((f, i) => tone(ctx, out, t0 + i * 0.12, f, 140, 'sine', 0.08));
  return explosionAt(ctx, out, t0 + 0.8, 1.4, 900);
}

function sinkRumble(ctx: BaseAudioContext, out: AudioNode, t0: number, heavy: boolean): Voice {
  const duration = heavy ? 1.8 : 1.2;
  const peak = heavy ? 0.42 : 0.28;

  const rumble = ctx.createBufferSource();
  rumble.buffer = noise(ctx).brown;
  rumble.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = heavy ? 160 : 220;
  const rumbleGain = ctx.createGain();
  envelope(rumbleGain, t0, peak, 60, duration * 1000 - 60);
  rumble.connect(lp).connect(rumbleGain).connect(out);
  rumble.start(t0);
  rumble.stop(t0 + duration + 0.05);

  const sources: Source[] = [rumble];
  const oscs: OscillatorNode[] = [];
  const types: OscillatorType[] = heavy ? ['sawtooth', 'triangle', 'sine'] : ['sawtooth', 'triangle'];
  types.forEach((type, i) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    const base = (heavy ? 60 : 70) - i * (heavy ? 8 : 4);
    const end = heavy ? 30 : 35;
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.exponentialRampToValueAtTime(end, t0 + duration);
    if (i === 0) {
      // Slow wobble on the lead osc.
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = 5;
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + duration + 0.05);
      oscs.push(lfo);
    }
    const g = ctx.createGain();
    envelope(g, t0, heavy ? 0.12 : 0.09, 80, duration * 1000 - 80);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
    oscs.push(osc);
  });
  sources.push(...oscs);
  return makeVoice(rumbleGain, sources);
}

function win(ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  [523, 659, 784, 1046].forEach((f, i) => tone(ctx, out, t0 + i * 0.12, f, 220, 'triangle', 0.16));
  return makeVoice(ctx.createGain(), []);
}

function lose(ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  [392, 330, 262].forEach((f, i) => tone(ctx, out, t0 + i * 0.2, f, 300, 'sine', 0.16));
  return makeVoice(ctx.createGain(), []);
}

const recipes: Record<SoundName, (ctx: BaseAudioContext, out: AudioNode, t0: number) => Voice> = {
  launch,
  splash,
  explosion,
  bomb,
  sinkRumble: (ctx, out, t0) => sinkRumble(ctx, out, t0, false),
  sinkRumbleHeavy: (ctx, out, t0) => sinkRumble(ctx, out, t0, true),
  win,
  lose,
};

export function playSound(name: SoundName, ctx: BaseAudioContext, out: AudioNode, t0: number): Voice {
  return recipes[name](ctx, out, t0);
}

export interface OceanVoice {
  stop(fadeMs: number): void;
}

export function startOcean(ctx: BaseAudioContext, out: AudioNode, volume: number): OceanVoice {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx).brown;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 450;
  const gain = ctx.createGain();
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, volume), t0 + 1);

  // Slow swell on top of the base volume.
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08;
  lfoGain.gain.value = volume * 0.4;
  lfo.connect(lfoGain).connect(gain.gain);

  src.connect(lp).connect(gain).connect(out);
  src.start(t0);
  lfo.start(t0);

  let stopped = false;
  return {
    stop(fadeMs: number) {
      if (stopped) return;
      stopped = true;
      try {
        const t = ctx.currentTime;
        const fade = Math.max(0, fadeMs) / 1000;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0.0001, t + fade);
        src.stop(t + fade + 0.02);
        lfo.stop(t + fade + 0.02);
      } catch {
        // Best-effort.
      }
    },
  };
}
