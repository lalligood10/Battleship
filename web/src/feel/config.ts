// Timing is shared and read-only; audio and haptics belong to audio work,
// while fx belongs to visual-FX work.
export const FEEL = {
  timing: {
    windupMs: 400,
    botReplyDelayMs: 1000,
    sinkDelayMs: 250,
    sinkBeatMs: 1400,
    impactHoldMs: 1500,
    sinkHoldMs: 1800,
    carrierSinkHoldMs: 2400,
  },
  fx: {
    shake: { hitPx: 3, sinkPx: 6, ownSinkPx: 10, durationMs: 280 },
    particles: { hit: 8, sink: 16 },
    bannerMs: 2200,
  },
  audio: { masterVolume: 0.6, ambientVolume: 0.08 },
  haptics: { hit: [30], sink: [60, 40, 120], ownSink: [120, 60, 220] },
} as const;

export type FeelConfig = typeof FEEL;
