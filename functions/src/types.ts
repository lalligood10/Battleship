/**
 * Firestore document shapes shared by every Cloud Function.
 *
 * Collections
 *   users/{uid}                          public profile + stats (readable by any signed-in user)
 *   users/{uid}/private/push             FCM tokens (owner only)
 *   users/{uid}/opponents/{oppUid}       people this user has played (owner only) – drives "Friends" board
 *   usernames/{usernameLower}            uniqueness index -> { uid }
 *   games/{gameId}                       public game state (both players only). NEVER contains fleets
 *                                        until the game is finished.
 *   games/{gameId}/private/{uid}         that player's fleet + which of their cells were hit (owner only;
 *                                        clients cannot write, only Functions)
 *   gameCodes/{code}                     join-code lookup -> { gameId } (Functions only)
 *   weeklyWins/{weekId}/players/{uid}    wins in a calendar week (readable by signed-in users)
 *   quickMatch/{uid}                     waiting ticket for Quick Match (Functions only)
 */
import type { Timestamp } from 'firebase-admin/firestore';
import type { ShipPlacement, Shot } from './game/engine';
import type { ShipType } from './game/config';
import type { PlayerStats } from './game/scoring';

export interface UserDoc {
  username: string;
  usernameLower: string;
  rating: number;
  stats: PlayerStats;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastGameAt: Timestamp | null;
}

export interface UsernameDoc {
  uid: string;
}

export interface PushDoc {
  tokens: string[];
  updatedAt: Timestamp;
}

export interface OpponentDoc {
  username: string;
  gamesPlayed: number;
  lastPlayedAt: Timestamp;
}

export interface WeeklyWinsDoc {
  username: string;
  wins: number;
  rating: number;
  updatedAt: Timestamp;
}

export type GameStatus =
  /** Host created the game; waiting for a second player to join. */
  | 'waiting'
  /** Both players present; at least one still placing ships. */
  | 'placing'
  /** Turn loop in progress. */
  | 'active'
  /** Somebody won (by sinking, resignation, or timeout claim). */
  | 'finished'
  /** Host cancelled before anyone joined. */
  | 'cancelled';

export type EndReason = 'all_sunk' | 'resign' | 'timeout';

/** Public per-player info embedded in the game doc. Safe for the opponent to read. */
export interface GamePlayer {
  username: string;
  /** Rating when the game started (for display). */
  rating: number;
  /** True once this player's fleet has been placed. The fleet itself lives in private/{uid}. */
  ready: boolean;
  /** Types of THIS player's ships that the opponent has sunk. */
  sunkShips: ShipType[];
  shotsFired: number;
  hits: number;
}

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
}

export interface GameDoc {
  code: string;
  status: GameStatus;
  hostUid: string;
  /** Exactly the uids allowed to read this document (used by security rules). */
  playerUids: string[];
  players: Record<string, GamePlayer>;
  /** Shots fired BY each uid, in order. Results only – never positions of unhit ships. */
  shots: Record<string, Shot[]>;
  currentTurnUid: string | null;
  turnNumber: number;
  winnerUid: string | null;
  endReason: EndReason | null;
  ratingChanges: Record<string, RatingChange> | null;
  /** Populated only when status === 'finished' so the results screen can show both boards. */
  revealedFleets: Record<string, ShipPlacement[]> | null;
  isQuickMatch: boolean;
  /** Inactivity window after which the waiting player may claim a win. Copied from config at creation. */
  abandonTimeoutMs: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  /** Last time the turn changed. Drives the abandonment timeout. */
  lastMoveAt: Timestamp | null;
}

export interface PrivateBoardDoc {
  fleet: ShipPlacement[];
  /** Cell keys ("row,col") of this player's ship cells that have been hit. */
  hitCells: string[];
  updatedAt: Timestamp;
}

export interface GameCodeDoc {
  gameId: string;
  createdAt: Timestamp;
}

export interface QuickMatchTicketDoc {
  username: string;
  rating: number;
  createdAt: Timestamp;
  /** Filled in by the Function once an opponent is found. */
  gameId: string | null;
}
