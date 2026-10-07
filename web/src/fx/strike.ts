import { FEEL } from '../feel/config';
import type { FeelCue } from '../feel/cues';
import type { StrikePhase } from '../components/art/StrikeOverlay';

type Impact = Extract<FeelCue, { type: 'impact' }>;

/**
 * Phase shown at impact. A sinking shot shows the hit first and reveals the hull on the later
 * 'sink' cue; the carrier keeps its dedicated bomb-run sequence, which starts at impact.
 */
export function impactPhase(cue: Impact): StrikePhase {
  if (cue.sunk?.shipId === 'carrier') return 'sunk';
  return cue.result;
}

/** How long the overlay stays after an impact or sink cue (matches the director's holds). */
export function strikeHoldMs(cue: Impact | Extract<FeelCue, { type: 'sink' }>, timing = FEEL.timing): number {
  if (cue.type === 'sink') return cue.sunk.shipId === 'carrier' ? timing.carrierSinkHoldMs : timing.sinkHoldMs;
  if (!cue.sunk) return timing.impactHoldMs;
  return timing.sinkDelayMs + (cue.sunk.shipId === 'carrier' ? timing.carrierSinkHoldMs : timing.sinkHoldMs);
}
