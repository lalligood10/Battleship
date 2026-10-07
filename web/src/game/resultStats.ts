import type { Game } from '../lib/types';

export interface ResultStats {
  shotsFired: number;
  hits: number;
  accuracy: number | null;
  turns: number;
  shipsLost: number;
  shipsSunk: number;
}

export function turnsTaken(game: Pick<Game, 'shots' | 'abilityLog'>, uid: string): number {
  const shots = game.shots[uid] ?? [];
  let classicShotCount = 0;
  const turnKeys = new Set<number>();

  for (const shot of shots) {
    if (shot.volley === undefined) {
      classicShotCount += 1;
    } else {
      turnKeys.add(shot.volley);
    }
  }

  for (const entry of game.abilityLog ?? []) {
    if (entry.player === uid) turnKeys.add(entry.turnNumber);
  }

  return classicShotCount + turnKeys.size;
}

export function resultStats(game: Pick<Game, 'shots' | 'abilityLog' | 'playerUids'>, uid: string): ResultStats {
  const shots = game.shots[uid] ?? [];
  const opponentUid = game.playerUids.find((playerUid) => playerUid !== uid);
  const opponentShots = opponentUid ? (game.shots[opponentUid] ?? []) : [];
  const shotsFired = shots.length;
  const hits = shots.filter((shot) => shot.result !== 'miss').length;

  return {
    shotsFired,
    hits,
    accuracy: shotsFired === 0 ? null : hits / shotsFired,
    turns: turnsTaken(game, uid),
    shipsLost: opponentShots.filter((shot) => shot.result === 'sunk').length,
    shipsSunk: shots.filter((shot) => shot.result === 'sunk').length,
  };
}

export function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? '–' : `${Math.round(accuracy * 100)}%`;
}
