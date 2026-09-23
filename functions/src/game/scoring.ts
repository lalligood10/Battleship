/**
 * SCORING MODULE — the single place where rating and statistics math lives.
 *
 * Rating uses the standard Elo system:
 *   expected(A) = 1 / (1 + 10 ^ ((ratingB - ratingA) / 400))
 *   newRating(A) = ratingA + K * (actual(A) - expected(A))
 * where actual is 1 for a win and 0 for a loss. Both players' changes are computed from their
 * pre-game ratings so the system is zero-sum (winner gains exactly what the loser drops, before
 * rounding).
 *
 * To tune the system change the constants below. Nothing else in the codebase hard-codes them.
 */

export const SCORING_CONFIG = {
  /** Every new account starts here. */
  INITIAL_RATING: 1000,
  /** How much a single game can move a rating. Higher = more volatile. */
  K_FACTOR: 32,
  /** Ratings never drop below this floor. */
  MIN_RATING: 100,
} as const;

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

export interface EloOutcome {
  /** Signed change for the winner (always >= 0). */
  winnerDelta: number;
  /** Signed change for the loser (always <= 0). */
  loserDelta: number;
  winnerNewRating: number;
  loserNewRating: number;
}

/** Computes new ratings after a decisive game (no draws in this game). */
export function applyElo(winnerRating: number, loserRating: number): EloOutcome {
  const { K_FACTOR, MIN_RATING } = SCORING_CONFIG;
  const winnerDelta = Math.round(K_FACTOR * (1 - expectedScore(winnerRating, loserRating)));
  const loserDelta = Math.round(K_FACTOR * (0 - expectedScore(loserRating, winnerRating)));
  const winnerNewRating = winnerRating + winnerDelta;
  const loserNewRating = Math.max(MIN_RATING, loserRating + loserDelta);
  return { winnerDelta, loserDelta: loserNewRating - loserRating, winnerNewRating, loserNewRating };
}

/** Per-user lifetime statistics stored on users/{uid}. */
export interface PlayerStats {
  wins: number;
  losses: number;
  gamesPlayed: number;
  shotsFired: number;
  hits: number;
  currentStreak: number;
  longestStreak: number;
}

export const EMPTY_STATS: PlayerStats = {
  wins: 0,
  losses: 0,
  gamesPlayed: 0,
  shotsFired: 0,
  hits: 0,
  currentStreak: 0,
  longestStreak: 0,
};

export interface GameStatsDelta {
  shotsFired: number;
  hits: number;
}

/** Returns the updated stats after one finished game. Pure function; does not mutate input. */
export function applyGameToStats(stats: PlayerStats, won: boolean, delta: GameStatsDelta): PlayerStats {
  const currentStreak = won ? stats.currentStreak + 1 : 0;
  return {
    wins: stats.wins + (won ? 1 : 0),
    losses: stats.losses + (won ? 0 : 1),
    gamesPlayed: stats.gamesPlayed + 1,
    shotsFired: stats.shotsFired + delta.shotsFired,
    hits: stats.hits + delta.hits,
    currentStreak,
    longestStreak: Math.max(stats.longestStreak, currentStreak),
  };
}

/** Win percentage 0..100, rounded to one decimal. */
export function winPercentage(stats: Pick<PlayerStats, 'wins' | 'gamesPlayed'>): number {
  if (stats.gamesPlayed === 0) return 0;
  return Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10;
}

/** Shooting accuracy 0..100, rounded to one decimal. */
export function accuracyPercentage(stats: Pick<PlayerStats, 'hits' | 'shotsFired'>): number {
  if (stats.shotsFired === 0) return 0;
  return Math.round((stats.hits / stats.shotsFired) * 1000) / 10;
}

/**
 * Identifier for the calendar week a timestamp falls in, used for the weekly leaderboard.
 * Weeks start on Monday 00:00 UTC (ISO 8601). Format: "2026-W39".
 */
export function weekId(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Sunday -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // move to the Thursday of this ISO week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
