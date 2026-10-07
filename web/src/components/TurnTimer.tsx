import { useEffect, useMemo, useRef, useState } from 'react';
import {
  announcementFor,
  createExpiryGate,
  estimateServerOffset,
  formatCountdown,
  remainingMs,
  timerPhase,
} from '../game/turnTimer';
import './TurnTimer.css';

/**
 * The first observed move time may be stale after reload, so it must not be treated as server "now".
 * Later turn changes approximate server offset from the move timestamp and current client time.
 */
export function useServerOffset(lastMoveAtMs: number | null): number {
  const [offset, setOffset] = useState(0);
  const hasInitialValue = useRef(false);
  const previousValue = useRef<number | null>(null);

  useEffect(() => {
    if (lastMoveAtMs === null) {
      previousValue.current = null;
      return;
    }
    if (!hasInitialValue.current) {
      hasInitialValue.current = true;
      previousValue.current = lastMoveAtMs;
      return;
    }
    if (previousValue.current !== lastMoveAtMs) {
      previousValue.current = lastMoveAtMs;
      const clientNow = Date.now();
      setOffset(estimateServerOffset(lastMoveAtMs, clientNow, clientNow));
    }
  }, [lastMoveAtMs]);

  return offset;
}

export function TurnTimer({
  turnDeadline,
  serverOffsetMs,
  isMyTurn,
  onExpire,
}: {
  turnDeadline: number | null;
  serverOffsetMs: number;
  isMyTurn: boolean;
  onExpire: () => void;
}) {
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState('');
  const onExpireRef = useRef(onExpire);
  const expiryGate = useMemo(() => createExpiryGate(), []);
  const previousDeadlineRef = useRef(turnDeadline);
  const previousRemainingRef = useRef<number | null>(null);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (turnDeadline === null) return;
    const refresh = () => setClientNowMs(Date.now());
    refresh();
    const interval = window.setInterval(refresh, 250);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [turnDeadline]);

  const remaining = turnDeadline === null ? 0 : remainingMs(turnDeadline, clientNowMs, serverOffsetMs);
  const phase = timerPhase(remaining);

  useEffect(() => {
    if (turnDeadline === null) {
      previousDeadlineRef.current = null;
      previousRemainingRef.current = null;
      return;
    }
    if (previousDeadlineRef.current !== turnDeadline) {
      previousDeadlineRef.current = turnDeadline;
      previousRemainingRef.current = null;
    }
    const nextAnnouncement = announcementFor(previousRemainingRef.current, remaining, isMyTurn);
    if (nextAnnouncement) setAnnouncement(nextAnnouncement);
    previousRemainingRef.current = remaining;
  }, [turnDeadline, remaining, isMyTurn]);

  useEffect(() => {
    if (turnDeadline !== null && expiryGate.shouldFire(turnDeadline, remaining)) {
      onExpireRef.current();
    }
  }, [expiryGate, turnDeadline, remaining]);

  if (turnDeadline === null) return null;

  return (
    <>
      <div
        className={`turn-timer turn-timer--${phase} turn-timer--${isMyTurn ? 'mine' : 'theirs'}`}
        role="timer"
        aria-label="Turn clock"
      >
        <span className="turn-timer-icon" aria-hidden="true">
          ◷
        </span>
        <span className="turn-timer-label">{isMyTurn ? 'Your turn' : 'Their turn'}</span>
        <span className="turn-timer-countdown">
          {phase === 'expired' ? (isMyTurn ? "Time's up" : 'Skipping…') : formatCountdown(remaining)}
        </span>
      </div>
      <span className="turn-timer-sr" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
