/**
 * Typed wrappers for every Cloud Function (functions/src/index.ts). All game mutations go through here –
 * the browser never writes game or user documents directly, which is what makes the anti-cheat hold.
 */
import { httpsCallable } from 'firebase/functions';
import type {
  AbilityId,
  AbilityTarget,
  BotDifficulty,
  Coordinate,
  GameMode,
  GameStatus,
  ReactionId,
  ShipPlacement,
  ShipType,
  ShotResult,
} from './types';
import { functions } from './firebase';
import { toAppError } from './errors';

async function call<TResult, TData extends object = Record<string, never>>(
  name: string,
  data: TData,
): Promise<TResult> {
  try {
    const fn = httpsCallable<TData, TResult>(functions(), name);
    return (await fn(data)).data;
  } catch (err) {
    throw toAppError(err);
  }
}

export interface CheckUsernameResult {
  available: boolean;
  reason?: string;
}
export const checkUsername = (username: string) =>
  call<CheckUsernameResult, { username: string }>('checkUsername', { username });

export const setUsername = (username: string) =>
  call<{ username: string }, { username: string }>('setUsername', { username });

export const adminStatus = () => call<{ isAdmin: boolean }>('adminStatus', {});

export interface AdminUser {
  uid: string;
  email: string | null;
  username: string;
  rating: number;
  wins: number;
  losses: number;
  leaderboardVisible: boolean;
  suspended: boolean;
  createdAt: string | null;
}

export const adminListUsers = () => call<{ users: AdminUser[] }>('adminListUsers', {});

export interface AdminUserUpdate {
  uid: string;
  username?: string;
  leaderboardVisible?: boolean;
  suspended?: boolean;
}

export const adminUpdateUser = (update: AdminUserUpdate) => call<unknown, AdminUserUpdate>('adminUpdateUser', update);

export const createGame = (mode: GameMode, turnTimerMs?: number | null) =>
  call<{ gameId: string; code: string }, { mode: GameMode; turnTimerMs?: number | null }>(
    'createGame',
    turnTimerMs === undefined ? { mode } : { mode, turnTimerMs },
  );

export const joinGame = (code: string) => call<{ gameId: string }, { code: string }>('joinGame', { code });

export const requestRematch = (gameId: string) =>
  call<{ gameId: string; status: GameStatus }, { gameId: string }>('requestRematch', { gameId });

export const cancelGame = (gameId: string) => call<unknown, { gameId: string }>('cancelGame', { gameId });

export const placeShips = (gameId: string, ships: ShipPlacement[]) =>
  call<{ status: GameStatus }, { gameId: string; ships: ShipPlacement[] }>('placeShips', { gameId, ships });

export interface FireShotResult {
  result: ShotResult;
  sunkShip?: ShipType;
  gameOver: boolean;
  winnerUid?: string;
}
export const fireShot = (gameId: string, target: Coordinate) =>
  call<FireShotResult, { gameId: string; row: number; col: number }>('fireShot', {
    gameId,
    row: target.row,
    col: target.col,
  });

export interface FireSalvoResult {
  gameOver: boolean;
  winnerUid: string | null;
}
export const fireSalvo = (gameId: string, targets: Coordinate[]) =>
  call<FireSalvoResult, { gameId: string; targets: Coordinate[] }>('fireSalvo', { gameId, targets });

export interface UseAbilityResult {
  gameOver: boolean;
  winnerUid: string | null;
}
export const useAbility = (gameId: string, abilityId: AbilityId, target: AbilityTarget) =>
  call<UseAbilityResult, { gameId: string; abilityId: AbilityId; target: AbilityTarget }>(
    'useAbility',
    { gameId, abilityId, target },
  );

export const resign = (gameId: string) => call<{ winnerUid: string }, { gameId: string }>('resign', { gameId });

export const claimTimeoutWin = (gameId: string) =>
  call<{ winnerUid: string }, { gameId: string }>('claimTimeoutWin', { gameId });

export const claimTurnTimeout = (gameId: string) =>
  call<{ skipped: boolean; forfeited: boolean }, { gameId: string }>('claimTurnTimeout', { gameId });

export const completeGuestUpgrade = () =>
  call<{ isGuest: boolean }>('completeGuestUpgrade', {});

export const createBotGame = (difficulty: BotDifficulty, mode: GameMode) =>
  call<{ gameId: string }, { difficulty: BotDifficulty; mode: GameMode }>('createBotGame', { difficulty, mode });

export const joinQuickMatch = (mode: GameMode) =>
  call<{ gameId: string | null }, { mode: GameMode }>('joinQuickMatch', { mode });

export const cancelQuickMatch = () => call<unknown>('cancelQuickMatch', {});

export const createChallenge = (
  opponentUid: string,
  mode: GameMode,
  sourceGameId?: string,
  turnTimerMs?: number | null,
) =>
  call<
    { challengeId: string; gameId: string | null },
    { opponentUid: string; mode: GameMode; sourceGameId?: string; turnTimerMs?: number | null }
  >(
    'createChallenge',
    {
      opponentUid,
      mode,
      ...(sourceGameId ? { sourceGameId } : {}),
      ...(turnTimerMs === undefined ? {} : { turnTimerMs }),
    },
  );

export const respondChallenge = (challengeId: string, accept: boolean) =>
  call<{ gameId: string | null }, { challengeId: string; accept: boolean }>('respondChallenge', { challengeId, accept });

export const cancelChallenge = (challengeId: string) =>
  call<unknown, { challengeId: string }>('cancelChallenge', { challengeId });

export const sendReaction = (gameId: string, reactionId: ReactionId) =>
  call<unknown, { gameId: string; reactionId: ReactionId }>('sendReaction', { gameId, reactionId });

export const sendChatMessage = (gameId: string, text: string) =>
  call<unknown, { gameId: string; text: string }>('sendChatMessage', { gameId, text });
