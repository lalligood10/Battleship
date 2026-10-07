import type { CoreEvent } from '@shared/core/events';
import type { Coordinate } from '@shared/engine';
import { FEEL, type FeelConfig } from './config';
import type { FeelCue, Side, SunkInfo } from './cues';

interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FeelDirector {
  fireRequested(target: Coordinate | readonly Coordinate[]): void;
  fireFailed(): void;
  handle(events: readonly CoreEvent[]): void;
  subscribe(listener: (cue: FeelCue) => void): () => void;
  revealed(): { target: number; own: number };
  settled(): boolean;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

interface QueuedShot {
  shooter: string;
  side: Side;
  shotKey: string;
  target: Coordinate;
  result: 'miss' | 'hit';
  turnNumber: number;
  impactAt: number;
  sunk?: SunkInfo;
  impacted: boolean;
}

const systemClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createFeelDirector(opts: {
  myUid: string;
  botGame: boolean;
  initialShots: { target: number; own: number };
  config?: FeelConfig;
  clock?: Clock;
}): FeelDirector {
  const config = opts.config ?? FEEL;
  const clock = opts.clock ?? systemClock;
  const listeners = new Set<(cue: FeelCue) => void>();
  const changeListeners = new Set<() => void>();
  const timers = new Map<number, unknown>();
  const queuedShots: QueuedShot[] = [];
  const shotCounts = new Map<string, number>();
  let timerSequence = 0;
  let revealedState = { target: opts.initialShots.target, own: opts.initialShots.own };
  let localWindup: { shotKey: string; targets: Coordinate[]; t0: number; handled: number } | null = null;
  let lastVolley: { shooter: string; turnNumber: number; impactAt: number } | null = null;
  let free = -Infinity;
  let gameOverPending = false;
  let disposed = false;

  function settled(): boolean {
    return timers.size === 0 && !gameOverPending;
  }

  function snapshot(): { revealed: { target: number; own: number }; settled: boolean } {
    return { revealed: revealedState, settled: settled() };
  }

  function notifyIfChanged(previous: ReturnType<typeof snapshot>) {
    const current = snapshot();
    if (previous.revealed === current.revealed && previous.settled === current.settled) return;
    for (const listener of changeListeners) {
      try {
        listener();
      } catch {
        // One observer cannot prevent the remaining observers from updating.
      }
    }
  }

  function emit(cue: FeelCue) {
    for (const listener of listeners) {
      try {
        listener(cue);
      } catch {
        // Cue consumers are isolated from each other.
      }
    }
  }

  function scheduleAt(at: number, callback: () => void) {
    if (disposed) return;
    const id = ++timerSequence;
    const handle = clock.setTimeout(() => {
      timers.delete(id);
      if (disposed) return;
      const previous = snapshot();
      callback();
      notifyIfChanged(previous);
    }, Math.max(0, at - clock.now()));
    timers.set(id, handle);
  }

  function emitAt(at: number, callback: () => void) {
    if (at <= clock.now()) callback();
    else scheduleAt(at, callback);
  }

  function shotCount(shooter: string, side: Side): number {
    return shotCounts.get(shooter) ?? (side === 'target' ? opts.initialShots.target : opts.initialShots.own);
  }

  function scheduleImpact(shot: QueuedShot) {
    scheduleAt(shot.impactAt, () => {
      shot.impacted = true;
      revealedState = { ...revealedState, [shot.side]: revealedState[shot.side] + 1 };
      emit({
        type: 'impact',
        side: shot.side,
        shotKey: shot.shotKey,
        target: shot.target,
        result: shot.result,
        ...(shot.sunk ? { sunk: shot.sunk } : {}),
      });
    });
  }

  function handleShotResolved(event: Extract<CoreEvent, { type: 'shotResolved' }>, time: number) {
    const side: Side = event.shooter === opts.myUid ? 'target' : 'own';
    const pending = side === 'target' ? localWindup : null;
    const index = shotCount(event.shooter, side);
    const shotKey = `${event.shooter}:${index}`;
    shotCounts.set(event.shooter, index + 1);
    const lastVolleyImpactAt =
      lastVolley?.shooter === event.shooter && lastVolley.turnNumber === event.turnNumber
        ? lastVolley.impactAt
        : null;

    let windupAt: number | null = null;
    let impactAt: number;
    if (side === 'target' && pending) {
      impactAt =
        pending.handled === 0
          ? Math.max(pending.t0 + config.timing.windupMs, time, free)
          : Math.max(
              time,
              free,
              lastVolleyImpactAt === null ? -Infinity : lastVolleyImpactAt + config.timing.salvoStaggerMs,
            );
      pending.handled += 1;
      if (pending.handled >= pending.targets.length) localWindup = null;
    } else if (side === 'target') {
      if (lastVolleyImpactAt !== null) {
        impactAt = Math.max(time, free, lastVolleyImpactAt + config.timing.salvoStaggerMs);
        windupAt = Math.max(time, impactAt - config.timing.windupMs);
      } else {
        windupAt = Math.max(time, free);
        impactAt = windupAt + config.timing.windupMs;
      }
    } else {
      if (lastVolleyImpactAt !== null) {
        impactAt = Math.max(time, free, lastVolleyImpactAt + config.timing.salvoStaggerMs);
        windupAt = Math.max(time, impactAt - config.timing.windupMs);
      } else {
        windupAt = Math.max(
          time + (opts.botGame ? config.timing.botReplyDelayMs - config.timing.windupMs : 0),
          free,
        );
        impactAt = windupAt + config.timing.windupMs;
      }
    }

    const shot: QueuedShot = {
      shooter: event.shooter,
      side,
      shotKey,
      target: { ...event.target },
      result: event.result,
      turnNumber: event.turnNumber,
      impactAt,
      impacted: false,
    };
    queuedShots.push(shot);
    lastVolley = { shooter: event.shooter, turnNumber: event.turnNumber, impactAt };

    if (windupAt !== null && !pending) {
      emitAt(windupAt, () => emit({ type: 'windup', side, shotKey, target: shot.target }));
    }
    free = impactAt;
    scheduleImpact(shot);
  }

  function handleGameOver(event: Extract<CoreEvent, { type: 'gameOver' }>, time: number) {
    const lastShot = queuedShots.at(-1);
    const endAt = lastShot
      ? lastShot.impactAt +
        (lastShot.sunk
          ? config.timing.sinkDelayMs +
            (lastShot.sunk.shipId === 'carrier' ? config.timing.carrierSinkHoldMs : config.timing.sinkHoldMs)
          : config.timing.impactHoldMs)
      : time;
    const cue: FeelCue = { type: 'gameOver', won: event.winner === opts.myUid, reason: event.reason };
    if (!lastShot) {
      emit(cue);
      return;
    }
    gameOverPending = true;
    emitAt(Math.max(time, endAt), () => {
      gameOverPending = false;
      emit(cue);
    });
  }

  return {
    fireRequested(target) {
      if (disposed || localWindup) return;
      const targets = (Array.isArray(target) ? target : [target]).map((coordinate) => ({ ...coordinate }));
      if (targets.length === 0) return;
      const shotKey = `${opts.myUid}:${shotCount(opts.myUid, 'target')}`;
      localWindup = { shotKey, targets, t0: clock.now(), handled: 0 };
      emit({
        type: 'windup',
        side: 'target',
        shotKey,
        target: targets[0]!,
        ...(targets.length > 1 ? { targets } : {}),
      });
    },
    fireFailed() {
      if (disposed || !localWindup) return;
      const pending = localWindup;
      localWindup = null;
      emit({ type: 'cancel', side: 'target', shotKey: pending.shotKey });
    },
    handle(events) {
      if (disposed) return;
      const previous = snapshot();
      for (const event of events) {
        const time = clock.now();
        switch (event.type) {
          case 'shotResolved':
            handleShotResolved(event, time);
            break;
          case 'shipSunk': {
            const shot = [...queuedShots].reverse().find((queued) => queued.shooter === event.shooter && !queued.sunk);
            if (!shot) break;
            shot.sunk = { shipId: event.shipId, placement: { ...event.placement } };
            free = Math.max(free, shot.impactAt + config.timing.sinkDelayMs + config.timing.sinkBeatMs);
            scheduleAt(shot.impactAt + config.timing.sinkDelayMs, () => {
              if (!shot.sunk) return;
              emit({ type: 'sink', side: shot.side, shotKey: shot.shotKey, target: shot.target, sunk: shot.sunk });
            });
            break;
          }
          case 'gameOver':
            handleGameOver(event, time);
            break;
          case 'abilityUsed':
            emit({
              type: 'abilityUsed',
              side: event.player === opts.myUid ? 'target' : 'own',
              player: event.player,
              abilityId: event.abilityId,
              result: event.result,
            });
            break;
          case 'shotFired':
          case 'turnChanged':
            break;
        }
      }
      notifyIfChanged(previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revealed() {
      return revealedState;
    },
    settled,
    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of timers.values()) clock.clearTimeout(handle);
      timers.clear();
      listeners.clear();
      changeListeners.clear();
      gameOverPending = false;
      localWindup = null;
    },
  };
}
