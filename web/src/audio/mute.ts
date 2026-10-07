/** Persisted mute preference with change notifications. */
const KEY = 'broadside.muted';

type MuteListener = () => void;
const listeners = new Set<MuteListener>();

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, String(muted));
  } catch {
    // A missing/throwing localStorage still counts as a mute change for this session.
  }
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Listener errors must not break the toggle.
    }
  }
}

export function subscribeMuted(listener: MuteListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
