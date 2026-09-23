import { FieldValue, type Timestamp, type Transaction } from 'firebase-admin/firestore';
import type { ShipPlacement } from '../game/engine';
import { applyElo, applyGameToStats, weekId } from '../game/scoring';
import type { EndReason, GameDoc, RatingChange, UserDoc } from '../types';
import { refs } from './firestore';

export interface FinishGameInput {
  tx: Transaction;
  gameId: string;
  /** Game state as read at the start of the transaction. */
  game: GameDoc;
  winnerUid: string;
  loserUid: string;
  reason: EndReason;
  /** Both users' docs, read earlier in the same transaction. */
  users: Record<string, UserDoc>;
  /** Both players' fleets (may be missing if a player never placed). */
  fleets: Record<string, ShipPlacement[] | undefined>;
  /** Extra fields to merge into the game document (e.g. the final shot). */
  extraGameFields?: Record<string, unknown>;
  now: Timestamp;
}

/**
 * Ends a game inside a transaction: writes the final game state, applies Elo + stats to both
 * users, records the weekly win, and updates each player's opponents list. All reads must have
 * happened before this is called (Firestore transactions require reads before writes).
 */
export function finishGame(input: FinishGameInput): Record<string, RatingChange> {
  const { tx, gameId, game, winnerUid, loserUid, reason, users, fleets, now } = input;
  const winner = users[winnerUid];
  const loser = users[loserUid];
  if (!winner || !loser) throw new Error('finishGame requires both user documents');

  const elo = applyElo(winner.rating, loser.rating);
  const ratingChanges: Record<string, RatingChange> = {
    [winnerUid]: { before: winner.rating, after: elo.winnerNewRating, delta: elo.winnerDelta },
    [loserUid]: { before: loser.rating, after: elo.loserNewRating, delta: elo.loserDelta },
  };

  const revealedFleets: Record<string, ShipPlacement[]> = {};
  for (const uid of game.playerUids) {
    const fleet = fleets[uid];
    if (fleet) revealedFleets[uid] = fleet;
  }

  tx.update(refs.game(gameId), {
    ...(input.extraGameFields ?? {}),
    status: 'finished',
    currentTurnUid: null,
    winnerUid,
    endReason: reason,
    ratingChanges,
    revealedFleets,
    finishedAt: now,
    updatedAt: now,
  });

  for (const [uid, won] of [
    [winnerUid, true],
    [loserUid, false],
  ] as const) {
    const user = users[uid]!;
    const played = game.players[uid];
    const newStats = applyGameToStats(user.stats, won, {
      shotsFired: played?.shotsFired ?? 0,
      hits: played?.hits ?? 0,
    });
    tx.update(refs.user(uid), {
      rating: ratingChanges[uid]!.after,
      stats: newStats,
      lastGameAt: now,
      updatedAt: now,
    });
  }

  tx.set(
    refs.weeklyWins(weekId(now.toDate()), winnerUid),
    {
      username: winner.username,
      wins: FieldValue.increment(1),
      rating: elo.winnerNewRating,
      updatedAt: now,
    },
    { merge: true },
  );

  tx.set(
    refs.opponent(winnerUid, loserUid),
    { username: loser.username, gamesPlayed: FieldValue.increment(1), lastPlayedAt: now },
    { merge: true },
  );
  tx.set(
    refs.opponent(loserUid, winnerUid),
    { username: winner.username, gamesPlayed: FieldValue.increment(1), lastPlayedAt: now },
    { merge: true },
  );

  return ratingChanges;
}
