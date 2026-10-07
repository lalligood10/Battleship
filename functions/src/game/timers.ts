import { Timestamp } from 'firebase-admin/firestore';
import { GAME_CONFIG } from './config';
import type { GameDoc } from '../types';

export type TurnTimerInputResult = { ok: true; value: number | null } | { ok: false };

export function parseTurnTimerInput(value: unknown): TurnTimerInputResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  if ((GAME_CONFIG.TURN_TIMER_OPTIONS_MS as readonly number[]).includes(value as number)) {
    return { ok: true, value: value as number };
  }
  return { ok: false };
}

export function turnDeadlineFor(turnTimerMs: number | null | undefined, now: Timestamp): Timestamp | null {
  return turnTimerMs == null ? null : Timestamp.fromMillis(now.toMillis() + turnTimerMs);
}

export function isTurnExpired(game: Pick<GameDoc, 'status' | 'turnDeadline'>, nowMs: number): boolean {
  if (game.status !== 'active' || !game.turnDeadline) return false;
  return nowMs >= game.turnDeadline.toMillis() + GAME_CONFIG.TURN_TIMEOUT_GRACE_MS;
}
