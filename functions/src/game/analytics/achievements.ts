/**
 * Phase 5 achievement rules. Pure functions of `AchievementInput`; one-time unlocks are enforced by
 * `create()` in the game-end consumer, not here. `daily-clear` is awarded by `fireDailyShot`.
 */
import { cellKey, cellsOf } from '../engine';
import { ABILITY_DEFINITIONS } from '../core/modes/types';
import { ACHIEVEMENTS, lineFor, type AchievementId, type AchievementInput } from './contract';

const ABILITY_IDS = ABILITY_DEFINITIONS.map((a) => a.id);

/** In Salvo, a ship sunk with every one of its cells hit by the same volley. */
export function hasOneVolleySink(input: AchievementInput, uid: string): boolean {
  if (input.record.mode !== 'salvo') return false;
  const shots = input.game.shots[uid] ?? [];
  return shots.some((shot) => {
    if (shot.result !== 'sunk' || !shot.sunkPlacement || shot.volley === undefined) return false;
    const volley = new Set(shots.filter((s) => s.volley === shot.volley).map((s) => cellKey(s.row, s.col)));
    return cellsOf(shot.sunkPlacement).every((c) => volley.has(cellKey(c.row, c.col)));
  });
}

/** In Abilities, the player used every ability in this game. */
export function hasFullArsenal(input: AchievementInput, uid: string): boolean {
  if (input.record.mode !== 'abilities') return false;
  const used = new Set((input.game.abilityLog ?? []).filter((e) => e.player === uid).map((e) => e.result.abilityId));
  return ABILITY_IDS.every((id) => used.has(id));
}

/** Every game-based achievement this game qualifies `uid` for, in `ACHIEVEMENTS` order. */
export function evaluateGameAchievements(input: AchievementInput, uid: string): AchievementId[] {
  const { record } = input;
  const line = lineFor(record, uid);
  if (!line || line.isBot) return [];
  const sinkWin = line.won && record.endReason === 'all_sunk';
  const earned: Record<AchievementId, boolean> = {
    'first-victory': sinkWin,
    'one-volley-sink': hasOneVolleySink(input, uid),
    'last-ship-standing': sinkWin && record.winnerShipsRemaining === 1,
    flawless: sinkWin && line.shipsLost === 0,
    'full-arsenal': hasFullArsenal(input, uid),
    'admiral-slayer': sinkWin && record.isBotGame && record.botDifficulty === 'hard',
    'daily-clear': false,
  };
  return ACHIEVEMENTS.map((a) => a.id).filter((id) => earned[id]);
}
