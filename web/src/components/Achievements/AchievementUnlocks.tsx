import { useEffect, useState } from 'react';
import { listenAchievements, unlocksForGame, type AchievementDoc, type ShelfItem } from '../../lib/achievements';
import { MedalIcon } from './AchievementIcons';

/** Compact "Achievement unlocked" strip for the results screen. Renders nothing when this game unlocked nothing. */
export function AchievementUnlocks({ gameId, uid }: { gameId: string; uid: string }) {
  const [docs, setDocs] = useState<AchievementDoc[]>([]);

  // The game-end trigger writes unlocks just after the game finishes, so keep listening.
  useEffect(() => listenAchievements(uid, setDocs, () => setDocs([])), [uid]);

  return <AchievementUnlocksView items={unlocksForGame(docs, gameId)} />;
}

export function AchievementUnlocksView({ items }: { items: readonly ShelfItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="ach-unlocks" aria-labelledby="ach-unlocks-heading" aria-live="polite">
      <h2 className="ach-unlocks__title" id="ach-unlocks-heading">
        {items.length === 1 ? 'Achievement unlocked' : `${items.length} achievements unlocked`}
      </h2>
      <ul className="ach-unlocks__list">
        {items.map((item) => (
          <li key={item.id} className="ach-unlock" data-achievement={item.id}>
            <MedalIcon />
            <span>
              <b>{item.label}</b>
              <span className="ach-unlock__desc"> {item.description}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
