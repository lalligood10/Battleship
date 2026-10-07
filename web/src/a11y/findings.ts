/** Accessibility sweep findings, and the out-of-scope ones the sweep records without failing. */

export type FindingKind = 'axe' | 'target-size';

export interface Finding {
  kind: FindingKind;
  /** Screen or state name used by the sweep, e.g. `home` or `game: active`. */
  screen: string;
  /** axe rule id, or `target-size` for the 44×44px check. */
  rule: string;
  impact: string;
  /** CSS selector (axe) or element description (target size). */
  target: string;
  detail: string;
  theme: string;
  width: number;
}

export interface KnownIssue {
  screen: string;
  rule: string;
  /** Substring of the finding's target; omit to match every element. */
  target?: string;
  /** Who owns the fix. */
  owner: string;
  note: string;
}

/** axe impacts that fail the sweep. */
export const BLOCKING_IMPACTS = ['serious', 'critical'] as const;

export function isBlocking(impact: string | null | undefined): boolean {
  return (BLOCKING_IMPACTS as readonly string[]).includes(impact ?? '');
}

export function matchesKnownIssue(finding: Finding, issue: KnownIssue): boolean {
  return (
    (issue.screen === '*' || issue.screen === finding.screen) &&
    issue.rule === finding.rule &&
    (issue.target === undefined || finding.target.includes(issue.target))
  );
}

export function partitionFindings(
  findings: readonly Finding[],
  known: readonly KnownIssue[],
): { unexpected: Finding[]; recorded: Array<Finding & { owner: string; note: string }> } {
  const unexpected: Finding[] = [];
  const recorded: Array<Finding & { owner: string; note: string }> = [];
  for (const finding of findings) {
    const issue = known.find((candidate) => matchesKnownIssue(finding, candidate));
    if (issue) recorded.push({ ...finding, owner: issue.owner, note: issue.note });
    else unexpected.push(finding);
  }
  return { unexpected, recorded };
}

/** Findings on screens other sessions own. Recorded in the sweep report; remove each once it is fixed. */
export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    screen: '*',
    rule: 'aria-required-children',
    target: 'div[role="row"]:nth-child(1)',
    owner: 'Session A (Board.tsx)',
    note: 'The board grid column-label row has role="row" but no cell/columnheader children.',
  },
  {
    screen: '*',
    rule: 'target-size',
    target: 'a.badge "Your rating"',
    owner: 'Session B (HomePage)',
    note: 'The home rating badge link is about 61×22px.',
  },
  {
    screen: 'dev playtest',
    rule: 'scrollable-region-focusable',
    owner: 'Lead (DevPlaytestPage, dev-only)',
    note: 'The horizontally scrolling tables at 375px are not keyboard-focusable.',
  },
];
