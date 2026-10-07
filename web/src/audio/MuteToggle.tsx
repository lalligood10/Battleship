import { useSyncExternalStore } from 'react';
import { Icon } from '../components/ui';
import { isMuted, setMuted, subscribeMuted } from './mute';

export function MuteToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, isMuted);
  return (
    <button
      className="btn btn--ghost btn--icon"
      onClick={() => setMuted(!muted)}
      aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
    >
      <Icon name={muted ? 'muted' : 'sound'} />
    </button>
  );
}
