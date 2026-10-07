import { describe, expect, it } from 'vitest';
import { abilityPreview } from './abilityPreview';

const keys = (cells: { row: number; col: number }[]) => cells.map(({ row, col }) => `${row},${col}`);

describe('abilityPreview', () => {
  it('draws a horizontal airstrike line to the right on the enemy board', () => {
    const preview = abilityPreview('carrier-airstrike', { row: 2, col: 3 }, true, 10);
    expect(preview.board).toBe('enemy');
    expect(keys(preview.cells)).toEqual(['2,3', '2,4', '2,5']);
  });

  it('draws a vertical airstrike line downward', () => {
    expect(keys(abilityPreview('carrier-airstrike', { row: 7, col: 0 }, false, 10).cells)).toEqual(['7,0', '8,0', '9,0']);
  });

  it('clips an airstrike that would run off the board', () => {
    expect(keys(abilityPreview('carrier-airstrike', { row: 4, col: 8 }, true, 10).cells)).toEqual(['4,8', '4,9']);
    expect(keys(abilityPreview('carrier-airstrike', { row: 9, col: 4 }, false, 10).cells)).toEqual(['9,4']);
  });

  it('draws a 3x3 sonar area on the enemy board, ignoring orientation', () => {
    const preview = abilityPreview('submarine-sonar', { row: 5, col: 5 }, true, 10);
    expect(preview.board).toBe('enemy');
    expect(keys(preview.cells).sort()).toEqual(['4,4', '4,5', '4,6', '5,4', '5,5', '5,6', '6,4', '6,5', '6,6']);
    expect(abilityPreview('submarine-sonar', { row: 5, col: 5 }, false, 10)).toEqual(preview);
  });

  it('clips sonar at corners and edges', () => {
    expect(keys(abilityPreview('submarine-sonar', { row: 0, col: 0 }, true, 10).cells).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(abilityPreview('submarine-sonar', { row: 9, col: 4 }, true, 10).cells).toHaveLength(6);
  });

  it('draws the destroyer footprint on the player’s own board', () => {
    const across = abilityPreview('destroyer-relocate', { row: 6, col: 2 }, true, 10);
    expect(across.board).toBe('own');
    expect(keys(across.cells)).toEqual(['6,2', '6,3']);
    expect(keys(abilityPreview('destroyer-relocate', { row: 6, col: 2 }, false, 10).cells)).toEqual(['6,2', '7,2']);
    expect(keys(abilityPreview('destroyer-relocate', { row: 9, col: 9 }, true, 10).cells)).toEqual(['9,9']);
  });

  it('respects the board size', () => {
    expect(abilityPreview('carrier-airstrike', { row: 0, col: 5 }, true, 6).cells).toHaveLength(1);
    expect(abilityPreview('submarine-sonar', { row: 5, col: 5 }, true, 6).cells).toHaveLength(4);
  });
});
