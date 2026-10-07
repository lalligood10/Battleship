import { createEventBus, type CoreEvent } from '@shared/core/events';
import type { Game, Shot } from '../lib/types';

export const gameEvents = createEventBus();

export function diffGameEvents(prev: Game | null, next: Game): CoreEvent[] {
  if (!prev) return [];

  const added: { shooter: string; shot: Shot }[] = [];
  for (const [shooter, shots] of Object.entries(next.shots)) {
    const previousCount = prev.shots[shooter]?.length ?? 0;
    for (const shot of shots.slice(previousCount)) added.push({ shooter, shot });
  }
  added.sort((a, b) => a.shot.at - b.shot.at);

  const events: CoreEvent[] = [];
  let nextShotTurn = Math.max(1, prev.turnNumber);
  for (const [index, { shooter, shot }] of added.entries()) {
    const shotTurn = shot.volley ?? nextShotTurn;
    const target = { row: shot.row, col: shot.col };
    events.push({ type: 'shotFired', shooter, target, turnNumber: shotTurn });
    events.push({
      type: 'shotResolved',
      shooter,
      target,
      result: shot.result === 'miss' ? 'miss' : 'hit',
      turnNumber: shotTurn,
    });
    if (shot.sunkShip && shot.sunkPlacement) {
      const owner = next.playerUids.find((uid) => uid !== shooter);
      if (owner) {
        events.push({
          type: 'shipSunk',
          shooter,
          owner,
          shipId: shot.sunkShip,
          placement: shot.sunkPlacement,
        });
      }
    }
    const nextShot = added[index + 1];
    const sameVolley = nextShot?.shooter === shooter && shot.volley !== undefined && nextShot.shot.volley === shot.volley;
    if (nextShot && !sameVolley) {
      events.push({
        type: 'turnChanged',
        currentTurn: nextShot.shooter,
        turnNumber: shotTurn + 1,
      });
    }
    nextShotTurn = sameVolley ? shotTurn : shotTurn + 1;
  }

  if (added.length > 0) {
    if (next.status === 'active' && next.currentTurnUid) {
      events.push({
        type: 'turnChanged',
        currentTurn: next.currentTurnUid,
        turnNumber: next.turnNumber,
      });
    }
  } else if (
    next.status === 'active' &&
    next.currentTurnUid &&
    (next.currentTurnUid !== prev.currentTurnUid || next.turnNumber !== prev.turnNumber)
  ) {
    events.push({ type: 'turnChanged', currentTurn: next.currentTurnUid, turnNumber: next.turnNumber });
  }
  if (prev.status !== 'finished' && next.status === 'finished' && next.winnerUid && next.endReason) {
    events.push({ type: 'gameOver', winner: next.winnerUid, reason: next.endReason });
  }
  return events;
}
