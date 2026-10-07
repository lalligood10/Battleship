import type { GameDoc, PrivateBoardDoc } from '../types';
import { defaultSettings, phaseFromStatus, type CoreState } from '../game/core/schema';

export function coreStateFromGame(
  game: GameDoc,
  boards: Record<string, PrivateBoardDoc | undefined>,
): CoreState {
  const [first, second] = game.playerUids;
  if (!first || !second) throw new Error('Core state requires two players');
  const botBoard = Object.values(boards).find((board) => board?.rngSeed !== undefined);

  return {
    settings: {
      ...defaultSettings(game.mode ?? 'classic'),
      abandonTimeoutMs: game.abandonTimeoutMs,
    },
    seed: botBoard?.rngSeed ?? 0,
    phase: phaseFromStatus(game.status),
    playerIds: [first, second],
    currentTurn: game.currentTurnUid,
    turnNumber: game.turnNumber,
    lastProgressAt: (game.lastMoveAt ?? game.createdAt)?.toMillis() ?? 0,
    boards: Object.fromEntries(
      game.playerUids.map((uid) => [
        uid,
        {
          fleet: boards[uid]?.fleet ?? null,
          hitCells: [...(boards[uid]?.hitCells ?? [])],
          shipMeta: {},
        },
      ]),
    ),
    shots: Object.fromEntries(game.playerUids.map((uid) => [uid, [...(game.shots[uid] ?? [])]])),
    winner: game.winnerUid,
    endReason: game.endReason,
  };
}
