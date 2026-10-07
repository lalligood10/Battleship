import { GAME_CONFIG } from '@shared/config';
import { parseGameModeInput, type GameMode } from '@shared/core/schema';
import { needsMyAction, type Game } from '../lib/types';

export type QuickMatchResume =
  | { kind: 'none' }
  | { kind: 'matched'; gameId: string }
  | { kind: 'searching'; mode: GameMode };

export function quickMatchResume(
  ticket: { mode?: unknown; gameId?: unknown; createdAtMs: number | null } | null,
  nowMs: number,
  ttlMs = GAME_CONFIG.QUICK_MATCH_TICKET_TTL_MS,
): QuickMatchResume {
  if (
    !ticket ||
    typeof ticket.createdAtMs !== 'number' ||
    !Number.isFinite(ticket.createdAtMs) ||
    nowMs - ticket.createdAtMs >= ttlMs
  ) {
    return { kind: 'none' };
  }
  if (typeof ticket.gameId === 'string' && ticket.gameId.length > 0) {
    return { kind: 'matched', gameId: ticket.gameId };
  }
  return { kind: 'searching', mode: parseGameModeInput(ticket.mode) ?? 'classic' };
}

export function freshTurnGames(
  prev: Set<string> | null,
  list: Game[],
  uid: string,
): { nowMine: Set<string>; fresh: Game[] } {
  const nowMine = new Set(list.filter((game) => needsMyAction(game, uid)).map((game) => game.id));
  const fresh = prev
    ? list.filter((game) => nowMine.has(game.id) && !prev.has(game.id) && game.status === 'active')
    : [];
  return { nowMine, fresh };
}
