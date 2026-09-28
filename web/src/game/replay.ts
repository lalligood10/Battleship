import type { Game, Shot } from '../lib/types';

export interface ReplayStep {
  shooterUid: string;
  shot: Shot;
}

/** Merge alternating turns by time; bot replies are timestamped one millisecond after the shot. */
export function replayTimeline(game: Pick<Game, 'playerUids' | 'shots'>): ReplayStep[] {
  const a = game.playerUids[0] ?? '';
  const b = game.playerUids[1] ?? '';
  const sortShots = (uid: string) =>
    [...(game.shots?.[uid] ?? [])].sort((left, right) => left.at - right.at);
  const shotsA = sortShots(a);
  const shotsB = sortShots(b);
  const timeline: ReplayStep[] = [];
  let indexA = 0;
  let indexB = 0;
  let previousShooter: string | undefined;

  while (indexA < shotsA.length && indexB < shotsB.length) {
    const shotA = shotsA[indexA]!;
    const shotB = shotsB[indexB]!;
    let shooterUid: string;
    if (shotA.at < shotB.at) shooterUid = a;
    else if (shotB.at < shotA.at) shooterUid = b;
    else if (previousShooter === a) shooterUid = b;
    else if (previousShooter === b) shooterUid = a;
    else shooterUid = shotsA.length >= shotsB.length ? a : b;

    const shot = shooterUid === a ? shotA : shotB;
    timeline.push({ shooterUid, shot });
    if (shooterUid === a) indexA++;
    else indexB++;
    previousShooter = shooterUid;
  }

  while (indexA < shotsA.length) timeline.push({ shooterUid: a, shot: shotsA[indexA++]! });
  while (indexB < shotsB.length) timeline.push({ shooterUid: b, shot: shotsB[indexB++]! });
  return timeline;
}

export function shotsUpTo(timeline: ReplayStep[], shooterUid: string, step: number): Shot[] {
  return timeline.slice(0, step).filter((entry) => entry.shooterUid === shooterUid).map((entry) => entry.shot);
}

export function hasReplay(game: Pick<Game, 'shots'>): boolean {
  return Object.values(game.shots ?? {}).some((shots) => shots.length > 0);
}
