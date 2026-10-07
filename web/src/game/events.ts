import { createEventBus, type CoreEvent } from '@shared/core/events';
import type { AbilityLogEntry, Game, Shot } from '../lib/types';

export const gameEvents = createEventBus();

export function diffGameEvents(prev: Game | null, next: Game): CoreEvent[] {
  if (!prev) return [];

  const added: { shooter: string; shot: Shot }[] = [];
  for (const [shooter, shots] of Object.entries(next.shots)) {
    const previousCount = prev.shots[shooter]?.length ?? 0;
    for (const shot of shots.slice(previousCount)) added.push({ shooter, shot });
  }
  added.sort((a, b) => a.shot.at - b.shot.at);

  const newAbilityLog = (next.abilityLog ?? []).slice(prev.abilityLog?.length ?? 0);
  const airstrikeTurns = new Map<string, number>();
  for (const entry of newAbilityLog) {
    if (entry.result.abilityId !== 'carrier-airstrike') continue;
    for (const cell of entry.result.cells) {
      airstrikeTurns.set(`${entry.player}:${cell.row},${cell.col}`, entry.turnNumber);
    }
  }

  interface TurnGroup {
    shooter: string;
    turnNumber: number;
    shots: Shot[];
    abilities: AbilityLogEntry[];
  }
  const groupsByKey = new Map<string, TurnGroup>();
  const getGroup = (shooter: string, turnNumber: number) => {
    const key = `${turnNumber}:${shooter}`;
    let group = groupsByKey.get(key);
    if (!group) {
      group = { shooter, turnNumber, shots: [], abilities: [] };
      groupsByKey.set(key, group);
    }
    return group;
  };

  let nextShotTurn = Math.max(1, prev.turnNumber);
  for (const [index, { shooter, shot }] of added.entries()) {
    const airstrikeTurn = airstrikeTurns.get(`${shooter}:${shot.row},${shot.col}`);
    let shotTurn = airstrikeTurn ?? shot.volley;
    if (shotTurn === undefined) {
      while (newAbilityLog.some((entry) => entry.turnNumber === nextShotTurn && entry.player !== shooter)) {
        nextShotTurn += 1;
      }
      shotTurn = nextShotTurn;
    }
    getGroup(shooter, shotTurn).shots.push(shot);

    const nextShot = added[index + 1];
    const nextAirstrikeTurn = nextShot
      ? airstrikeTurns.get(`${nextShot.shooter}:${nextShot.shot.row},${nextShot.shot.col}`)
      : undefined;
    const sameTurn =
      nextShot?.shooter === shooter &&
      ((shot.volley !== undefined && nextShot.shot.volley === shot.volley) ||
        (airstrikeTurn !== undefined && nextAirstrikeTurn === airstrikeTurn));
    nextShotTurn = sameTurn ? shotTurn : shotTurn + 1;
  }
  for (const entry of newAbilityLog) {
    getGroup(entry.player, entry.turnNumber).abilities.push(entry);
  }
  const turnGroups = [...groupsByKey.values()].sort((a, b) => a.turnNumber - b.turnNumber);

  const events: CoreEvent[] = [];
  for (const [index, group] of turnGroups.entries()) {
    for (const shot of group.shots) {
      const target = { row: shot.row, col: shot.col };
      events.push({ type: 'shotFired', shooter: group.shooter, target, turnNumber: group.turnNumber });
      events.push({
        type: 'shotResolved',
        shooter: group.shooter,
        target,
        result: shot.result === 'miss' ? 'miss' : 'hit',
        turnNumber: group.turnNumber,
      });
      if (shot.sunkShip && shot.sunkPlacement) {
        const owner = next.playerUids.find((uid) => uid !== group.shooter);
        if (owner) {
          events.push({
            type: 'shipSunk',
            shooter: group.shooter,
            owner,
            shipId: shot.sunkShip,
            placement: shot.sunkPlacement,
          });
        }
      }
    }

    if (next.mode === 'salvo' && group.shots.length > 0) {
      events.push({
        type: 'salvoResolved',
        shooter: group.shooter,
        targets: group.shots.map((shot) => ({ row: shot.row, col: shot.col })),
        results: group.shots.map((shot) => shot.result),
        turnNumber: group.turnNumber,
      });
    }
    for (const entry of group.abilities) {
      events.push({
        type: 'abilityUsed',
        player: entry.player,
        abilityId: entry.result.abilityId,
        result: entry.result,
        turnNumber: entry.turnNumber,
      });
    }

    const nextGroup = turnGroups[index + 1];
    if (nextGroup) {
      events.push({
        type: 'turnChanged',
        currentTurn: nextGroup.shooter,
        turnNumber: nextGroup.turnNumber,
      });
    }
  }

  if (turnGroups.length > 0) {
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
