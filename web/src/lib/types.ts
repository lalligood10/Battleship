/**
 * Client-side view of the Firestore documents. Mirrors functions/src/types.ts, with the client
 * SDK's Timestamp type. Fleets never appear here until a game is finished (revealedFleets).
 */
import type { Timestamp } from 'firebase/firestore';
import type { ShipType } from '@shared/config';
import type { ShipPlacement, Shot } from '@shared/engine';
import type { PlayerStats } from '@shared/scoring';
import type { BotDifficulty } from '@shared/bots';

export type { Coordinate, ShipPlacement, Shot, ShotResult } from '@shared/engine';
export type { ShipType } from '@shared/config';
export type { PlayerStats } from '@shared/scoring';
export type { BotDifficulty } from '@shared/bots';
export { isBotUid } from '@shared/bots';

export interface UserProfile {
  id: string;
  username: string;
  usernameLower: string;
  rating: number;
  stats: PlayerStats;
  isBot?: boolean;
  botStats?: PlayerStats;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  lastGameAt: Timestamp | null;
}

export type GameStatus = 'waiting' | 'placing' | 'active' | 'finished' | 'cancelled';
export type EndReason = 'all_sunk' | 'resign' | 'timeout';

export interface GamePlayer {
  username: string;
  rating: number;
  ready: boolean;
  sunkShips: ShipType[];
  shotsFired: number;
  hits: number;
}

export interface RatingChange {
  before: number;
  after: number;
  delta: number;
}

export interface Game {
  id: string;
  code: string;
  status: GameStatus;
  hostUid: string;
  playerUids: string[];
  players: Record<string, GamePlayer>;
  shots: Record<string, Shot[]>;
  currentTurnUid: string | null;
  turnNumber: number;
  winnerUid: string | null;
  endReason: EndReason | null;
  ratingChanges: Record<string, RatingChange> | null;
  revealedFleets: Record<string, ShipPlacement[]> | null;
  isQuickMatch: boolean;
  isBotGame: boolean;
  botDifficulty: BotDifficulty | null;
  abandonTimeoutMs: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  lastMoveAt: Timestamp | null;
}

export interface PrivateBoard {
  fleet: ShipPlacement[];
  hitCells: string[];
}

export interface WeeklyWins {
  id: string;
  username: string;
  wins: number;
  rating: number;
}

export interface Opponent {
  id: string;
  username: string;
  gamesPlayed: number;
}

// Helpers -----------------------------------------------------------------------------------

export function opponentUid(game: Game, uid: string): string | undefined {
  return game.playerUids.find((u) => u !== uid);
}

/** True for Play vs Computer games (missing field on old docs reads as false). */
export function isBotGame(game: Game): boolean {
  return game.isBotGame === true;
}

export function isMyTurn(game: Game, uid: string): boolean {
  return game.status === 'active' && game.currentTurnUid === uid;
}

export function shotsBy(game: Game, uid: string | undefined): Shot[] {
  return uid ? (game.shots[uid] ?? []) : [];
}

/** True when this game is waiting on `uid` to do something (place ships or fire). */
export function needsMyAction(game: Game, uid: string): boolean {
  if (game.status === 'placing') return game.players[uid]?.ready !== true;
  return isMyTurn(game, uid);
}

/** Avatar text for the game list: "AI" for computer games, else the opponent's initial. */
export function opponentAvatar(game: Game, uid: string): string {
  if (isBotGame(game)) return 'AI';
  const opp = opponentUid(game, uid);
  const name = opp ? game.players[opp]?.username : null;
  return (name ?? '?').slice(0, 1).toUpperCase();
}

/** One-line status shown under each game row on the home screen. */
export function gameRowStatus(game: Game, uid: string): string {
  if (game.status === 'waiting') return `Waiting for a friend · code ${game.code}`;
  const attention = needsMyAction(game, uid);
  if (game.status === 'placing') {
    return attention ? 'Place your ships' : 'Waiting for opponent to place ships';
  }
  if (attention) return 'Your turn';
  return isBotGame(game) ? "Computer's turn" : "Opponent's turn";
}
