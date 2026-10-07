import { useEffect, useState } from 'react';
import { Alert, Spinner } from '../ui';
import {
  formatUnlockDate,
  listenAchievements,
  shelfItems,
  unlockedCount,
  type AchievementDoc,
  type ShelfItem,
} from '../../lib/achievements';
import { errorMessage } from '../../lib/errors';
import { LockIcon, MedalIcon } from './AchievementIcons';

/** Every achievement, locked or unlocked, for a player's profile. */
export function AchievementShelf({ uid }: { uid: string }) {
  const [docs, setDocs] = useState<AchievementDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => listenAchievements(uid, setDocs, (e) => setError(errorMessage(e))), [uid]);

  if (error) return <Alert>{error}</Alert>;
  if (!docs) return <Spinner label="Loading achievements…" />;
  return <AchievementShelfView items={shelfItems(docs)} />;
}

export function AchievementShelfView({ items }: { items: readonly ShelfItem[] }) {
  return (
    <section className="card ach-shelf" aria-labelledby="ach-shelf-heading">
      <div className="ach-shelf__head">
        <h2 className="gm-heading" id="ach-shelf-heading">
          Achievements
        </h2>
        <span className="ach-shelf__count mono">
          {unlockedCount(items)} / {items.length}
          <span className="gm-sr-only"> unlocked</span>
        </span>
      </div>
      <ul className="ach-shelf__list">
        {items.map((item) => (
          <li key={item.id} className={`ach-item ach-item--${item.unlocked ? 'unlocked' : 'locked'}`} data-achievement={item.id}>
            {item.unlocked ? <MedalIcon /> : <LockIcon />}
            <div className="ach-item__body">
              <b className="ach-item__label">{item.label}</b>
              <span className="ach-item__desc">{item.description}</span>
            </div>
            <span className="ach-item__state">
              {item.unlocked && item.unlockedAtMs !== null ? (
                <>
                  Unlocked <time dateTime={new Date(item.unlockedAtMs).toISOString()}>{formatUnlockDate(item.unlockedAtMs)}</time>
                </>
              ) : (
                'Locked'
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
