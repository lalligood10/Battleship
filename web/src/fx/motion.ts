export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Read at cue time so a mid-game OS setting change applies to the next effect. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
