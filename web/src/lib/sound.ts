/** Tiny synthesised sound effects (no audio assets to license). Respects a persisted mute toggle. */
const KEY = 'broadside.muted';
let ctx: AudioContext | undefined;

export function isMuted(): boolean {
  return localStorage.getItem(KEY) === 'true';
}
export function setMuted(muted: boolean) {
  localStorage.setItem(KEY, String(muted));
}

function tone(freq: number, durationMs: number, type: OscillatorType, startDelayMs = 0, gain = 0.15) {
  if (!ctx) ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  const t0 = ctx.currentTime + startDelayMs / 1000;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  vol.gain.setValueAtTime(gain, t0);
  vol.gain.exponentialRampToValueAtTime(0.001, t0 + durationMs / 1000);
  osc.connect(vol).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000);
}

export function play(kind: 'miss' | 'hit' | 'sunk' | 'win' | 'lose') {
  if (isMuted() || typeof AudioContext === 'undefined') return;
  try {
    switch (kind) {
      case 'miss':
        tone(220, 180, 'sine');
        break;
      case 'hit':
        tone(110, 260, 'sawtooth', 0, 0.2);
        tone(70, 320, 'square', 40, 0.12);
        break;
      case 'sunk':
        tone(110, 300, 'sawtooth', 0, 0.2);
        tone(82, 400, 'square', 120, 0.15);
        tone(55, 600, 'triangle', 260, 0.18);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => tone(f, 220, 'triangle', i * 120));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => tone(f, 300, 'sine', i * 200));
        break;
    }
  } catch {
    // Audio is best-effort; never let it break the game.
  }
}
