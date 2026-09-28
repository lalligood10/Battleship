import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from './config';
import { pickQuickMatchOpponent, quickMatchBand, type QuickMatchCandidate } from './matchmaking';

const NOW = 1_800_000_000_000;
const sec = (s: number) => s * 1000;
const me = { uid: 'me', rating: 1200 };
const ticket = (uid: string, rating: number, ageSec: number, gameId: string | null = null): QuickMatchCandidate => ({
  uid,
  rating,
  createdAtMs: NOW - sec(ageSec),
  gameId,
});

describe('quickMatchBand', () => {
  it('starts at the base, widens every interval, caps, then opens fully', () => {
    expect(quickMatchBand(0)).toBe(GAME_CONFIG.QUICK_MATCH_BAND_BASE);
    expect(quickMatchBand(sec(14))).toBe(100);
    expect(quickMatchBand(sec(15))).toBe(150);
    expect(quickMatchBand(sec(59))).toBe(250);
    expect(quickMatchBand(sec(105))).toBe(GAME_CONFIG.QUICK_MATCH_BAND_MAX);
    expect(quickMatchBand(sec(119))).toBe(400);
    expect(quickMatchBand(sec(GAME_CONFIG.QUICK_MATCH_BAND_OPEN_AFTER_SEC))).toBe(Infinity);
  });
});

describe('pickQuickMatchOpponent', () => {
  it('prefers the closest rating over the oldest ticket', () => {
    const pick = pickQuickMatchOpponent(me, [ticket('old', 1290, 10), ticket('close', 1210, 1)], NOW);
    expect(pick?.uid).toBe('close');
  });

  it("widens the band with the candidate's ticket age", () => {
    expect(pickQuickMatchOpponent(me, [ticket('far', 1450, 10)], NOW)).toBeNull();
    expect(pickQuickMatchOpponent(me, [ticket('far', 1450, 75)], NOW)?.uid).toBe('far'); // band 350
    expect(pickQuickMatchOpponent(me, [ticket('far', 1750, 110)], NOW)).toBeNull(); // capped at 400
    expect(pickQuickMatchOpponent(me, [ticket('far', 1750, 120)], NOW)?.uid).toBe('far'); // open
  });

  it('returns null when nobody fits the band', () => {
    expect(pickQuickMatchOpponent(me, [ticket('a', 1000, 5), ticket('b', 1450, 30)], NOW)).toBeNull();
    expect(pickQuickMatchOpponent(me, [], NOW)).toBeNull();
  });

  it('breaks rating ties by the oldest ticket', () => {
    const pick = pickQuickMatchOpponent(me, [ticket('newer', 1250, 5), ticket('older', 1150, 20), ticket('mid', 1250, 10)], NOW);
    expect(pick?.uid).toBe('older');
  });

  it('never picks itself or an already-matched ticket', () => {
    expect(pickQuickMatchOpponent(me, [ticket('me', 1200, 30), ticket('taken', 1200, 30, 'g1')], NOW)).toBeNull();
  });

  it('skips recent opponents among the best three candidates', () => {
    const tickets = [ticket('best', 1200, 5), ticket('second', 1220, 5), ticket('third', 1240, 5), ticket('fourth', 1260, 5)];
    expect(pickQuickMatchOpponent(me, tickets, NOW, new Set(['best']))?.uid).toBe('second');
    expect(pickQuickMatchOpponent(me, tickets, NOW, new Set(['best', 'second']))?.uid).toBe('third');
    // Only the best three are checked (each costs a read), so the fourth is never reached.
    expect(pickQuickMatchOpponent(me, tickets, NOW, new Set(['best', 'second', 'third']))).toBeNull();
  });
});
