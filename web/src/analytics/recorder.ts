import { SHIP_TYPES } from '@shared/config';
import type { CoreEvent } from '@shared/core/events';
import type { GameMode } from '@shared/core/schema';
import type { PlaytestRecord } from './types';

interface GameRecorderInput {
  gameId: string;
  mode: GameMode;
  myUid: string;
  startedAt: number;
}

interface GameRecorderDependencies {
  bus: { subscribe(listener: (event: CoreEvent) => void): () => void };
  now: () => number;
  onComplete: (record: PlaytestRecord) => void;
}

export function createGameRecorder(input: GameRecorderInput, deps: GameRecorderDependencies): () => void {
  const shotCountsByTurn = new Map<string, number>();
  const abilities = new Map<string, PlaytestRecord['abilities'][number]>();
  const sunkShips = new Set<string>();
  let turns = 0;
  let firstEventAt: number | null = null;
  let completed = false;
  let unsubscribe = () => {};

  const listener = (event: CoreEvent) => {
    try {
      if (completed) return;
      if (firstEventAt === null) firstEventAt = deps.now();

      switch (event.type) {
        case 'shotFired': {
          turns = Math.max(turns, event.turnNumber);
          const key = `${event.shooter}|${event.turnNumber}`;
          shotCountsByTurn.set(key, (shotCountsByTurn.get(key) ?? 0) + 1);
          break;
        }
        case 'salvoResolved': {
          turns = Math.max(turns, event.turnNumber);
          const key = `${event.shooter}|${event.turnNumber}`;
          shotCountsByTurn.set(key, Math.max(shotCountsByTurn.get(key) ?? 0, event.targets.length));
          break;
        }
        case 'abilityUsed': {
          turns = Math.max(turns, event.turnNumber);
          const key = `${event.player}|${event.abilityId}`;
          if (!abilities.has(key)) {
            abilities.set(key, {
              player: event.player,
              abilityId: event.abilityId,
              turnNumber: event.turnNumber,
            });
          }
          break;
        }
        case 'shipSunk':
          sunkShips.add(`${event.owner}|${event.shipId}`);
          break;
        case 'gameOver': {
          completed = true;
          const endedAt = deps.now();
          const startedAt = Number.isFinite(input.startedAt) && input.startedAt > 0
            ? input.startedAt
            : firstEventAt ?? 0;
          const winnerShipsSunk = SHIP_TYPES.filter((shipId) => sunkShips.has(`${event.winner}|${shipId}`)).length;
          const shotsByPlayer: Record<string, number> = {};
          for (const [key, count] of shotCountsByTurn) {
            const separator = key.lastIndexOf('|');
            const shooter = key.slice(0, separator);
            shotsByPlayer[shooter] = (shotsByPlayer[shooter] ?? 0) + count;
          }

          const record: PlaytestRecord = {
            version: 1,
            gameId: input.gameId,
            mode: input.mode,
            myUid: input.myUid,
            startedAt,
            endedAt,
            durationMs: Math.max(0, endedAt - startedAt),
            turns,
            winner: event.winner,
            endReason: event.reason,
            winnerShipsRemaining: Math.max(0, SHIP_TYPES.length - winnerShipsSunk),
            shotsByPlayer,
            abilities: [...abilities.values()],
          };

          try {
            deps.onComplete(record);
          } catch {
            // Completion handlers must not interrupt event delivery.
          } finally {
            unsubscribe();
          }
          break;
        }
        case 'shotResolved':
        case 'turnChanged':
          break;
      }
    } catch {
      // Event consumers must not interrupt game logic or other consumers.
    }
  };

  unsubscribe = deps.bus.subscribe(listener);
  return unsubscribe;
}
