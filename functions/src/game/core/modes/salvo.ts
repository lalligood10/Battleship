import { cellKey, isOnBoard, shotsToKeySet } from '../../engine';
import { finishTurn, resolveTargets, shotEvents } from './shared';
import type { ModeRules, SalvoAction } from './types';

type SalvoAllowanceState = {
  playerIds: readonly string[];
  settings: { boardSize: number; fleet: readonly unknown[] };
  shots: Readonly<Record<string, readonly { row: number; col: number; sunkShip?: string }[] | undefined>>;
};

export function salvoShotsAllowed(state: SalvoAllowanceState, player: string): number {
  if (!state.playerIds.includes(player)) return 0;
  const opponent = state.playerIds.find((uid) => uid !== player);
  if (!opponent) return 0;
  const sunkShips = new Set((state.shots[opponent] ?? []).flatMap((shot) => shot.sunkShip ? [shot.sunkShip] : []));
  const firedCells = new Set((state.shots[player] ?? []).map((shot) => cellKey(shot.row, shot.col)));
  return Math.min(
    Math.max(0, state.settings.fleet.length - sunkShips.size),
    Math.max(0, state.settings.boardSize ** 2 - firedCells.size),
  );
}

export const salvoRules: ModeRules = {
  shotsAllowed: salvoShotsAllowed,
  validateAction(state, action) {
    if (action.type !== 'salvo') return { code: 'wrong_mode', message: 'Use a Salvo volley in this game type' };
    const allowed = this.shotsAllowed(state, action.player);
    if (action.targets.length !== allowed) return { code: 'wrong_shot_count', message: `Fire exactly ${allowed} shots this turn` };
    const keys = action.targets.map((target) => cellKey(target.row, target.col));
    if (new Set(keys).size !== keys.length) return { code: 'duplicate_target', message: 'A volley cannot target the same cell twice' };
    if (action.targets.some((target) => !isOnBoard(target.row, target.col))) return { code: 'off_board', message: 'Target is off the board' };
    const tried = shotsToKeySet(state.shots[action.player] ?? []);
    if (keys.some((key) => tried.has(key))) return { code: 'already_fired', message: 'You already fired at that cell' };
    const owner = state.playerIds.find((uid) => uid !== action.player)!;
    if (!state.boards[owner]!.fleet) return { code: 'wrong_phase', message: 'Opponent fleet is not placed' };
    return null;
  },
  applyAction(state, rawAction) {
    const action = rawAction as SalvoAction;
    const resolved = resolveTargets(state, action.player, action.targets, action.at, state.turnNumber);
    const recordedShots = [
      ...resolved.shots.filter((shot) => shot.result !== 'sunk'),
      ...resolved.shots.filter((shot) => shot.result === 'sunk'),
    ];
    resolved.state.shots[action.player]!.push(...recordedShots);
    const events = shotEvents(state, action.player, resolved.owner, recordedShots);
    events.push({
      type: 'salvoResolved',
      shooter: action.player,
      targets: recordedShots.map(({ row, col }) => ({ row, col })),
      results: recordedShots.map(({ result }) => result),
      turnNumber: state.turnNumber,
    });
    finishTurn(resolved.state, action.player, resolved.owner, events);
    return { state: resolved.state, events };
  },
};
