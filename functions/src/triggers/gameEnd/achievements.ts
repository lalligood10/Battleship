import { db } from '../../lib/firestore';
import { evaluateGameAchievements } from '../../game/analytics/achievements';
import { RETENTION_PATHS, type AchievementDoc } from '../../game/analytics/contract';
import type { GameEndConsumer } from './index';

/** Unlocks game-based achievements for each human player. Reads every target first, then creates the missing ones. */
export const achievementsConsumer: GameEndConsumer = {
  id: 'achievements',
  apply: async (tx, record, game, nowMs) => {
    const input = { record, game };
    const candidates = record.lines
      .filter((line) => !line.isBot)
      .flatMap((line) => evaluateGameAchievements(input, line.uid).map((id) => ({ uid: line.uid, id })))
      .map((c) => ({ ...c, ref: db.doc(RETENTION_PATHS.achievement(c.uid, c.id)) }));
    const existing = await Promise.all(candidates.map((c) => tx.get(c.ref)));
    candidates.forEach((c, i) => {
      if (existing[i]!.exists) return;
      const doc: AchievementDoc = { id: c.id, unlockedAtMs: nowMs, gameId: record.gameId, dailyDateKey: null };
      tx.create(c.ref, doc);
    });
  },
};
