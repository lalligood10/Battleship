import { GAME_MODE_OPTIONS, type GameMode } from '@shared/core/schema';

export function ModeBadge({ mode }: { mode?: GameMode }) {
  const selectedMode = mode ?? 'classic';
  const label = GAME_MODE_OPTIONS.find((item) => item.mode === selectedMode)?.label ?? 'Classic';
  return (
    <span className={`badge mode-badge mode-badge--${selectedMode}`} aria-label={`${label} game`}>
      {label}
    </span>
  );
}
