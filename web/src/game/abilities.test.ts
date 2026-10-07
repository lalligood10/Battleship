import { describe, expect, it } from 'vitest';
import type { AbilityLogEntry } from '@shared/core/modes/types';
import type { ShipPlacement } from '@shared/engine';
import type { Game, PrivateBoard } from '../lib/types';
import { abilityStatusesForWeb, deriveSonarMarkers, isAbilityPreviewValid } from './abilities';

const fleet: ShipPlacement[] = [
  { type: 'carrier', row: 0, col: 0, horizontal: true },
  { type: 'battleship', row: 2, col: 0, horizontal: true },
  { type: 'cruiser', row: 4, col: 0, horizontal: true },
  { type: 'submarine', row: 6, col: 0, horizontal: true },
  { type: 'destroyer', row: 8, col: 0, horizontal: true },
];

function game(overrides: Partial<Pick<Game, 'abilityLog' | 'playerUids' | 'shots'>> = {}) {
  return {
    abilityLog: [],
    playerUids: ['me', 'opponent'],
    shots: { me: [], opponent: [] },
    ...overrides,
  };
}

const privateBoard: PrivateBoard = { fleet, hitCells: [] };

describe('Abilities web state helpers', () => {
  it('derives statuses from the private fleet, opponent hits, and public ability log', () => {
    const used: AbilityLogEntry = {
      player: 'me',
      turnNumber: 2,
      result: { abilityId: 'submarine-sonar', center: { row: 4, col: 4 }, shipPresent: true },
    };
    expect(abilityStatusesForWeb(game(), 'me', privateBoard)).toEqual({
      'carrier-airstrike': 'ready',
      'submarine-sonar': 'ready',
      'destroyer-relocate': 'ready',
    });
    expect(abilityStatusesForWeb(game({ abilityLog: [used] }), 'me', privateBoard)['submarine-sonar']).toBe('used');
    expect(
      abilityStatusesForWeb(
        game({
          shots: { me: [], opponent: [{ row: 8, col: 0, result: 'hit', at: 1 }] },
        }),
        'me',
        privateBoard,
      )['destroyer-relocate'],
    ).toBe('lost');
  });

  it('marks airstrikes invalid off-board or when every affected cell was fired at', () => {
    const base = {
      abilityId: 'carrier-airstrike' as const,
      horizontal: true,
      game: game(),
      uid: 'me',
      board: privateBoard,
    };
    expect(isAbilityPreviewValid({ ...base, target: { row: 0, col: 7, horizontal: true } })).toBe(true);
    expect(isAbilityPreviewValid({ ...base, target: { row: 0, col: 8, horizontal: true } })).toBe(false);
    const allTried = game({
      shots: {
        me: [
          { row: 0, col: 0, result: 'miss', at: 1 },
          { row: 0, col: 1, result: 'miss', at: 2 },
          { row: 0, col: 2, result: 'miss', at: 3 },
        ],
        opponent: [],
      },
    });
    expect(
      isAbilityPreviewValid({
        ...base,
        game: allTried,
        target: { row: 0, col: 0, horizontal: true },
      }),
    ).toBe(false);
  });

  it('never invalidates sonar and validates destroyer relocation', () => {
    expect(
      isAbilityPreviewValid({
        abilityId: 'submarine-sonar',
        target: { row: 99, col: 99 },
        horizontal: true,
        game: game(),
        uid: 'me',
        board: privateBoard,
      }),
    ).toBe(true);
    const relocation = {
      abilityId: 'destroyer-relocate' as const,
      target: { row: 9, col: 8, horizontal: true },
      horizontal: true,
      game: game(),
      uid: 'me',
      board: privateBoard,
    };
    expect(isAbilityPreviewValid(relocation)).toBe(true);
    expect(isAbilityPreviewValid({ ...relocation, target: { row: 8, col: 0, horizontal: true } })).toBe(false);
    expect(
      isAbilityPreviewValid({
        ...relocation,
        game: game({
          shots: { me: [], opponent: [{ row: 9, col: 8, result: 'miss', at: 1 }] },
        }),
      }),
    ).toBe(false);
  });

  it('derives persistent sonar markers only for the player who used sonar', () => {
    const log: AbilityLogEntry[] = [
      {
        player: 'me',
        turnNumber: 3,
        result: { abilityId: 'submarine-sonar', center: { row: 0, col: 0 }, shipPresent: true },
      },
      {
        player: 'opponent',
        turnNumber: 4,
        result: { abilityId: 'submarine-sonar', center: { row: 5, col: 5 }, shipPresent: false },
      },
    ];
    expect(deriveSonarMarkers(log, 'me')).toEqual([
      {
        player: 'me',
        center: { row: 0, col: 0 },
        cells: [
          { row: 0, col: 0 },
          { row: 0, col: 1 },
          { row: 1, col: 0 },
          { row: 1, col: 1 },
        ],
        shipPresent: true,
      },
    ]);
    expect(deriveSonarMarkers(log, 'opponent')[0]?.shipPresent).toBe(false);
  });
});
