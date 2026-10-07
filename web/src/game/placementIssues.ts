import { cellsOf, problemFor, SHIP_NAMES, SHIP_TYPES, type PlacementProblem, type ShipPlacement, type ShipType } from './placement';

export interface PlacementIssue {
  problem: PlacementProblem;
  other?: ShipType;
}

export function placementIssue(fleet: ShipPlacement[], type: ShipType): PlacementIssue | null {
  const problem = problemFor(fleet, type);
  if (!problem) return null;

  let other: ShipType | undefined;
  if (problem === 'overlap' || problem === 'touching') {
    const ship = fleet.find((candidate) => candidate.type === type);
    if (ship) {
      const candidateCells = cellsOf(ship);
      other = SHIP_TYPES.find((candidateType) => {
        if (candidateType === type) return false;
        const candidate = fleet.find((item) => item.type === candidateType);
        if (!candidate) return false;
        const otherCells = cellsOf(candidate);
        return candidateCells.some((cell) =>
          otherCells.some((otherCell) =>
            problem === 'overlap'
              ? cell.row === otherCell.row && cell.col === otherCell.col
              : Math.abs(cell.row - otherCell.row) <= 1 && Math.abs(cell.col - otherCell.col) <= 1,
          ),
        );
      });
    }
  }

  return { problem, ...(other ? { other } : {}) };
}

export function describeIssue(issue: PlacementIssue): string {
  switch (issue.problem) {
    case 'overlap':
      return issue.other ? `Overlaps ${SHIP_NAMES[issue.other]}` : 'Overlaps another ship';
    case 'touching':
      return issue.other ? `Touching ${SHIP_NAMES[issue.other]}` : 'Touching another ship';
    case 'off_board':
      return 'Off the board';
  }
}

export function fleetIssues(fleet: ShipPlacement[]): Array<{ type: ShipType; issue: PlacementIssue }> {
  return SHIP_TYPES.flatMap((type) => {
    const issue = placementIssue(fleet, type);
    return issue ? [{ type, issue }] : [];
  });
}
