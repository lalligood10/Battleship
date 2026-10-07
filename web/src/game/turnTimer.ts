import { GAME_CONFIG } from '@shared/config';

export const MAX_SERVER_OFFSET_MS = 5 * 60_000;
export const URGENT_MS = 10_000;
export const ANNOUNCE_AT_MS = [30_000, 10_000] as const;

export const TURN_TIMER_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  ...GAME_CONFIG.TURN_TIMER_OPTIONS_MS.map((value) => ({
    value,
    label: value < 120_000 ? `${value / 1_000} s` : `${value / 60_000} min`,
  })),
];

export function estimateServerOffset(serverMs: number, clientSentMs: number, clientRecvMs: number): number {
  const offset = serverMs - (clientSentMs + clientRecvMs) / 2;
  return Math.max(-MAX_SERVER_OFFSET_MS, Math.min(MAX_SERVER_OFFSET_MS, offset));
}

export function remainingMs(deadlineMs: number, clientNowMs: number, serverOffsetMs: number): number {
  return deadlineMs - (clientNowMs + serverOffsetMs);
}

export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1_000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export type TimerPhase = 'normal' | 'urgent' | 'expired';

export function timerPhase(ms: number): TimerPhase {
  if (ms <= 0) return 'expired';
  if (ms < URGENT_MS) return 'urgent';
  return 'normal';
}

export function announcementFor(prevMs: number | null, ms: number, isMyTurn: boolean): string | null {
  if (prevMs === null || ms <= 0) return null;
  const threshold = [...ANNOUNCE_AT_MS].reverse().find((value) => prevMs > value && value >= ms);
  if (threshold === undefined) return null;
  const player = isMyTurn ? 'your turn' : "your opponent's turn";
  return `${threshold / 1_000} seconds left on ${player}`;
}

export function createExpiryGate(graceMs = GAME_CONFIG.TURN_TIMEOUT_GRACE_MS): {
  shouldFire(deadlineMs: number, remaining: number): boolean;
} {
  let currentDeadline: number | null = null;
  let fired = false;
  return {
    shouldFire(deadlineMs, remaining) {
      if (deadlineMs !== currentDeadline) {
        currentDeadline = deadlineMs;
        fired = false;
      }
      if (fired || remaining > -graceMs) return false;
      fired = true;
      return true;
    },
  };
}
