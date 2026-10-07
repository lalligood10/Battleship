import { isBotUid } from '@shared/bots';
import type { HeadToHeadDoc } from '../../lib/stats';

export function resultsRetentionVisibility(playerUids: readonly string[], uid: string) {
  const participant = playerUids.includes(uid);
  const opponentUid = playerUids.find((playerUid) => playerUid !== uid) ?? null;
  return {
    showAchievementUnlocks: participant,
    opponentUid,
    showHeadToHead: participant && opponentUid !== null && !isBotUid(opponentUid),
  };
}

export function pollHeadToHeadForGame(
  gameId: string,
  read: () => Promise<HeadToHeadDoc | null>,
  onUpdate: (h2h: HeadToHeadDoc | null) => void,
  intervalMs = 1500,
  timeoutMs = 10_000,
): () => void {
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineTimer = setTimeout(stop, timeoutMs);

  function stop() {
    if (stopped) return;
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    clearTimeout(deadlineTimer);
  }

  const poll = async () => {
    try {
      const h2h = await read();
      if (stopped) return;
      onUpdate(h2h);
      if (h2h?.lastGameId === gameId) {
        stop();
        return;
      }
    } catch {
      if (stopped) return;
      onUpdate(null);
    }

    if (!stopped) pollTimer = setTimeout(() => void poll(), intervalMs);
  };

  void poll();
  return stop;
}
