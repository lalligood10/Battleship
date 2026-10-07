import { isMuted } from './mute';

export function vibrate(pattern: number | readonly number[]): void {
  if (isMuted() || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]);
  } catch {
    return;
  }
}
