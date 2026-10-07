/** Minimum interactive target size (`--tap-min`), and the rules the a11y sweep applies. */
export const MIN_TARGET_PX = 44;

/** Sub-pixel layout can report 43.99px for a 44px box. */
const TOLERANCE_PX = 0.5;

/** Everything the sweep treats as an interactive target. */
export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[tabindex="0"]',
].join(', ');

/** Board cells are the documented exception: a 10×10 grid has to fit at 375px. */
export const TARGET_SIZE_EXEMPT_SELECTOR = '.board';

export interface TargetBox {
  /** Human-readable description of the element (tag, class, name). */
  label: string;
  width: number;
  height: number;
  /** True for elements inside an exempt container such as `.board`. */
  exempt?: boolean;
}

export function isUndersized(box: TargetBox, min = MIN_TARGET_PX): boolean {
  return !box.exempt && (box.width + TOLERANCE_PX < min || box.height + TOLERANCE_PX < min);
}

export function undersizedTargets(boxes: readonly TargetBox[], min = MIN_TARGET_PX): TargetBox[] {
  return boxes.filter((box) => isUndersized(box, min));
}
