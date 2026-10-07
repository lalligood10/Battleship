import { abilityStatuses, airstrikeCells, isLegalRelocation, sonarCells } from '@shared/core/modes/abilities';
import type { AbilityId, AbilityLogEntry, AbilityStatus } from '@shared/core/modes/types';
import { isOnBoard } from '@shared/engine';
import { BOARD_SIZE, cellKey, type Coordinate } from './placement';
import type { AbilityTarget, Game, PrivateBoard } from '../lib/types';

type WebAbilityGame = Pick<Game, 'abilityLog' | 'playerUids' | 'shots'>;

export interface SonarMarker {
  center: Coordinate;
  cells: Coordinate[];
  shipPresent: boolean;
  player: string;
}

export function abilityStatusesForWeb(
  game: WebAbilityGame,
  uid: string,
  board: PrivateBoard | null,
): Record<AbilityId, AbilityStatus> {
  const opponent = game.playerUids.find((player) => player !== uid);
  const hitCells = (opponent ? game.shots[opponent] ?? [] : [])
    .filter((shot) => shot.result !== 'miss')
    .map((shot) => cellKey(shot.row, shot.col));
  return abilityStatuses(
    {
      abilityLog: game.abilityLog ?? [],
      boards: {
        [uid]: {
          fleet: board?.fleet ?? null,
          hitCells,
        },
      },
    },
    uid,
  );
}

export function isAbilityPreviewValid(input: {
  abilityId: AbilityId;
  target: AbilityTarget;
  horizontal: boolean;
  game: WebAbilityGame;
  uid: string;
  board: PrivateBoard | null;
  boardSize?: number;
}): boolean {
  const { abilityId, target, horizontal, game, uid, board } = input;
  const boardSize = input.boardSize ?? BOARD_SIZE;

  if (abilityId === 'submarine-sonar') return true;

  if (abilityId === 'carrier-airstrike') {
    const cells = airstrikeCells({ row: target.row, col: target.col, horizontal }, boardSize);
    if (cells.some((cell) => !isOnBoard(cell.row, cell.col) || cell.row >= boardSize || cell.col >= boardSize)) {
      return false;
    }
    const fired = new Set((game.shots[uid] ?? []).map((shot) => cellKey(shot.row, shot.col)));
    return !cells.every((cell) => fired.has(cellKey(cell.row, cell.col)));
  }

  if (!board) return false;
  return isLegalRelocation(
    {
      boards: { [uid]: { fleet: board.fleet } },
      shots: game.shots,
      playerIds: game.playerUids,
    },
    uid,
    { row: target.row, col: target.col, horizontal },
  );
}

export function deriveSonarMarkers(log: readonly AbilityLogEntry[], player: string): SonarMarker[] {
  return log.flatMap((entry) => {
    if (entry.player !== player || entry.result.abilityId !== 'submarine-sonar') return [];
    return [{
      center: entry.result.center,
      cells: sonarCells(entry.result.center, BOARD_SIZE),
      shipPresent: entry.result.shipPresent,
      player: entry.player,
    }];
  });
}
