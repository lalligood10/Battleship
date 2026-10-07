/** Achievement shelf data: the seven contract achievements merged with the player's unlock docs. */
import { collection, onSnapshot, type DocumentData, type Unsubscribe } from 'firebase/firestore';
import { ACHIEVEMENTS, type AchievementDoc, type AchievementId } from '@shared/analytics/contract';
import { db } from './firebase';

export type { AchievementDoc, AchievementId } from '@shared/analytics/contract';

export interface ShelfItem {
  id: AchievementId;
  label: string;
  description: string;
  unlocked: boolean;
  unlockedAtMs: number | null;
  gameId: string | null;
  dailyDateKey: string | null;
}

const IDS = new Set<string>(ACHIEVEMENTS.map((a) => a.id));

export function achievementFromData(id: string, d: DocumentData | undefined): AchievementDoc | null {
  if (!d || !IDS.has(id) || typeof d.unlockedAtMs !== 'number') return null;
  return {
    id: id as AchievementId,
    unlockedAtMs: d.unlockedAtMs,
    gameId: typeof d.gameId === 'string' ? d.gameId : null,
    dailyDateKey: typeof d.dailyDateKey === 'string' ? d.dailyDateKey : null,
  };
}

/** All seven achievements in contract order, locked or unlocked. */
export function shelfItems(docs: readonly AchievementDoc[]): ShelfItem[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  return ACHIEVEMENTS.map(({ id, label, description }) => {
    const doc = byId.get(id);
    return {
      id,
      label,
      description,
      unlocked: doc !== undefined,
      unlockedAtMs: doc?.unlockedAtMs ?? null,
      gameId: doc?.gameId ?? null,
      dailyDateKey: doc?.dailyDateKey ?? null,
    };
  });
}

/** Achievements first unlocked by this game (for the results-screen strip). */
export function unlocksForGame(docs: readonly AchievementDoc[], gameId: string): ShelfItem[] {
  return shelfItems(docs).filter((item) => item.unlocked && item.gameId === gameId);
}

export function unlockedCount(items: readonly ShelfItem[]): number {
  return items.filter((i) => i.unlocked).length;
}

/** "7 Oct 2026" in the viewer's locale, fixed to UTC so the date matches the daily key. */
export function formatUnlockDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function listenAchievements(
  uid: string,
  onData: (docs: AchievementDoc[]) => void,
  onError: (e: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db(), 'users', uid, 'achievements'),
    (snap) => onData(snap.docs.map((d) => achievementFromData(d.id, d.data())).filter((d): d is AchievementDoc => d !== null)),
    onError,
  );
}
