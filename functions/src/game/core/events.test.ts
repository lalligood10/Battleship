import { describe, expect, it } from 'vitest';
import { createEventBus } from './events';

describe('core event bus', () => {
  it('filters subscriptions and isolates throwing listeners', () => {
    const bus = createEventBus();
    const observed: string[] = [];
    bus.subscribe(() => {
      throw new Error('listener failure');
    });
    bus.subscribe((event) => observed.push(event.type), ['shipSunk']);

    expect(() =>
      bus.emit([
        { type: 'turnChanged', currentTurn: 'one', turnNumber: 2 },
        {
          type: 'shipSunk',
          shooter: 'one',
          owner: 'two',
          shipId: 'destroyer',
          placement: { type: 'destroyer', row: 0, col: 0, horizontal: true },
        },
      ]),
    ).not.toThrow();
    expect(observed).toEqual(['shipSunk']);
  });

  it('stops delivering events after unsubscribe', () => {
    const bus = createEventBus();
    const observed: string[] = [];
    const unsubscribe = bus.subscribe((event) => observed.push(event.type));
    unsubscribe();
    bus.emit([{ type: 'turnChanged', currentTurn: 'one', turnNumber: 2 }]);
    expect(observed).toEqual([]);
  });
});
