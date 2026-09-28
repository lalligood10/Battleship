/**
 * Quick Match opponent selection. Pure so it can be unit tested and shared with the web app.
 *
 * Each waiting ticket accepts opponents within a rating band that widens with the ticket's age
 * (see GAME_CONFIG.QUICK_MATCH_BAND_*). Among the tickets whose band fits, the closest rating wins
 * and ties go to the oldest ticket.
 */
import { GAME_CONFIG } from './config';

export interface QuickMatchSeeker {
  uid: string;
  rating: number;
}

export interface QuickMatchCandidate {
  uid: string;
  rating: number;
  createdAtMs: number;
  /** Set once the ticket has been matched; such tickets are never candidates. */
  gameId?: string | null;
}

/** How many of the best candidates are checked against the repeat-opponent cooldown. */
export const QUICK_MATCH_COOLDOWN_CHECKS = 3;

/** Largest rating gap a ticket of this age accepts. Infinity once the ticket is fully open. */
export function quickMatchBand(ageMs: number): number {
  const {
    QUICK_MATCH_BAND_BASE,
    QUICK_MATCH_BAND_STEP,
    QUICK_MATCH_BAND_INTERVAL_SEC,
    QUICK_MATCH_BAND_MAX,
    QUICK_MATCH_BAND_OPEN_AFTER_SEC,
  } = GAME_CONFIG;
  const ageSec = Math.max(0, ageMs) / 1000;
  if (ageSec >= QUICK_MATCH_BAND_OPEN_AFTER_SEC) return Infinity;
  const widened = QUICK_MATCH_BAND_BASE + QUICK_MATCH_BAND_STEP * Math.floor(ageSec / QUICK_MATCH_BAND_INTERVAL_SEC);
  return Math.min(widened, QUICK_MATCH_BAND_MAX);
}

/** Tickets that fit `me`, best first: smallest rating gap, then oldest. */
export function rankQuickMatchCandidates(
  me: QuickMatchSeeker,
  tickets: readonly QuickMatchCandidate[],
  nowMs: number,
): QuickMatchCandidate[] {
  return tickets
    .filter((t) => t.uid !== me.uid && !t.gameId)
    .filter((t) => Math.abs(t.rating - me.rating) <= quickMatchBand(nowMs - t.createdAtMs))
    .sort((a, b) => Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating) || a.createdAtMs - b.createdAtMs);
}

/**
 * Picks the opponent for `me`, or null to leave a ticket. Only the best QUICK_MATCH_COOLDOWN_CHECKS
 * candidates are considered; any of them in `onCooldown` (recent opponents) are skipped.
 */
export function pickQuickMatchOpponent(
  me: QuickMatchSeeker,
  tickets: readonly QuickMatchCandidate[],
  nowMs: number,
  onCooldown: ReadonlySet<string> = new Set(),
): QuickMatchCandidate | null {
  return (
    rankQuickMatchCandidates(me, tickets, nowMs)
      .slice(0, QUICK_MATCH_COOLDOWN_CHECKS)
      .find((t) => !onCooldown.has(t.uid)) ?? null
  );
}
