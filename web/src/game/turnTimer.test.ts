import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TurnTimer } from '../components/TurnTimer';
import { TurnTimerPicker } from '../components/TurnTimerPicker';
import {
  ANNOUNCE_AT_MS,
  announcementFor,
  createExpiryGate,
  estimateServerOffset,
  formatCountdown,
  MAX_SERVER_OFFSET_MS,
  remainingMs,
  timerPhase,
  TURN_TIMER_CHOICES,
  URGENT_MS,
} from './turnTimer';

describe('turn timer utilities', () => {
  it('formats a countdown by ceiling to whole seconds and flooring at zero', () => {
    expect(formatCountdown(65_001)).toBe('1:06');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(8_001)).toBe('0:09');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-100)).toBe('0:00');
  });

  it('calculates remaining time using the estimated server offset', () => {
    expect(remainingMs(10_000, 1_000, 500)).toBe(8_500);
    expect(remainingMs(10_000, 1_000, -500)).toBe(9_500);
  });

  it('assigns normal, urgent, and expired phases', () => {
    expect(timerPhase(URGENT_MS)).toBe('normal');
    expect(timerPhase(URGENT_MS - 1)).toBe('urgent');
    expect(timerPhase(1)).toBe('urgent');
    expect(timerPhase(0)).toBe('expired');
    expect(timerPhase(-1)).toBe('expired');
  });

  it('announces only downward crossings of the thresholds', () => {
    expect(announcementFor(null, 30_000, true)).toBeNull();
    expect(announcementFor(30_001, 30_000, true)).toBe('30 seconds left on your turn');
    expect(announcementFor(10_001, 10_000, false)).toBe("10 seconds left on your opponent's turn");
    expect(announcementFor(30_000, 29_999, true)).toBeNull();
    expect(announcementFor(10_000, 9_999, true)).toBeNull();
    expect(announcementFor(15_000, 0, true)).toBeNull();
    expect(ANNOUNCE_AT_MS).toEqual([30_000, 10_000]);
  });

  it('fires an expiry gate once per deadline and re-arms for a new turn', () => {
    const gate = createExpiryGate(2_000);
    expect(gate.shouldFire(10, -1_999)).toBe(false);
    expect(gate.shouldFire(10, -2_000)).toBe(true);
    expect(gate.shouldFire(10, -2_500)).toBe(false);
    expect(gate.shouldFire(11, -2_000)).toBe(true);
  });

  it('uses wall-clock remaining time when a fresh gate mounts mid-countdown', () => {
    const gate = createExpiryGate();
    const deadline = Date.now() - 3_000;
    const remaining = remainingMs(deadline, Date.now(), 0);
    expect(gate.shouldFire(deadline, remaining)).toBe(true);
    expect(gate.shouldFire(deadline, remaining)).toBe(false);
  });

  it('estimates server offset from the client request midpoint', () => {
    expect(estimateServerOffset(10_000, 4_000, 6_000)).toBe(5_000);
  });

  it('clamps estimated server offset in both directions', () => {
    expect(estimateServerOffset(1_000_000, 0, 0)).toBe(MAX_SERVER_OFFSET_MS);
    expect(estimateServerOffset(-1_000_000, 0, 0)).toBe(-MAX_SERVER_OFFSET_MS);
  });
});

describe('turn timer markup', () => {
  it('renders nothing without a deadline', () => {
    expect(
      renderToStaticMarkup(
        React.createElement(TurnTimer, {
          turnDeadline: null,
          serverOffsetMs: 0,
          isMyTurn: true,
          onExpire: () => undefined,
        }),
      ),
    ).toBe('');
  });

  it('renders a timer role and urgent class when five seconds remain', () => {
    const markup = renderToStaticMarkup(
      React.createElement(TurnTimer, {
        turnDeadline: Date.now() + 5_000,
        serverOffsetMs: 0,
        isMyTurn: true,
        onExpire: () => undefined,
      }),
    );
    expect(markup).toContain('role="timer"');
    expect(markup).toContain('turn-timer--urgent');
  });

  it('renders three timer options with Off selected by default', () => {
    const markup = renderToStaticMarkup(React.createElement(TurnTimerPicker, { value: null, onChange: () => undefined }));
    expect(TURN_TIMER_CHOICES.map((choice) => choice.label)).toEqual(['Off', '60 s', '2 min']);
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup).toMatch(/checked="" value="off"/);
  });
});
