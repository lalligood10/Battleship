import type { ShipPlacement } from '../engine';
import type { ShipType } from '../config';
import type { EndReason } from './schema';

export type CoreEvent =
  | { type: 'shotFired'; shooter: string; target: { row: number; col: number }; turnNumber: number }
  | {
      type: 'shotResolved';
      shooter: string;
      target: { row: number; col: number };
      result: 'hit' | 'miss';
      turnNumber: number;
    }
  | { type: 'shipSunk'; shooter: string; owner: string; shipId: ShipType; placement: ShipPlacement }
  | { type: 'turnChanged'; currentTurn: string; turnNumber: number }
  | { type: 'gameOver'; winner: string; reason: EndReason };

export type CoreEventType = CoreEvent['type'];
export type EventListener = (event: CoreEvent) => void;

export function createEventBus() {
  const listeners = new Set<{ listener: EventListener; types?: ReadonlySet<CoreEventType> }>();

  return {
    emit(events: readonly CoreEvent[]) {
      for (const event of events) {
        for (const subscription of listeners) {
          if (subscription.types && !subscription.types.has(event.type)) continue;
          try {
            subscription.listener(event);
          } catch {
            // Event consumers must not interrupt game logic or other consumers.
          }
        }
      }
    },
    subscribe(listener: EventListener, types?: readonly CoreEventType[]) {
      const subscription = { listener, types: types ? new Set(types) : undefined };
      listeners.add(subscription);
      return () => {
        listeners.delete(subscription);
      };
    },
  };
}
