/**
 * Typed wrappers for every Cloud Function (functions/src/index.ts). All game mutations go through here –
 * the browser never writes game or user documents directly, which is what makes the anti-cheat hold.
 */
import { httpsCallable } from 'firebase/functions';
import type { ShipPlacement, ShipType, ShotResult, GameStatus, Coordinate } from './types';
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

export const createGame = () => call<{ gameId: string; code: string }>('createGame', {});

export const joinGame = (code: string) => call<{ gameId: string }, { code: string }>('joinGame', { code });

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

export const resign = (gameId: string) => call<{ winnerUid: string }, { gameId: string }>('resign', { gameId });

export const claimTimeoutWin = (gameId: string) =>
  call<{ winnerUid: string }, { gameId: string }>('claimTimeoutWin', { gameId });

export const joinQuickMatch = () => call<{ gameId: string | null }>('joinQuickMatch', {});

export const cancelQuickMatch = () => call<unknown>('cancelQuickMatch', {});
