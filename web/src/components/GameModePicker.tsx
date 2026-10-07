import { GAME_MODE_OPTIONS, type GameMode } from '@shared/core/schema';

export function GameModePicker({
  value,
  onChange,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
}) {
  return (
    <div className="game-mode-picker-section">
      <span className="muted small game-mode-picker-label" id="game-mode-picker-label">
        Game type
      </span>
      <div className="game-mode-picker" role="radiogroup" aria-labelledby="game-mode-picker-label">
        {GAME_MODE_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={value === option.mode}
            className={`game-mode-option${value === option.mode ? ' game-mode-option--selected' : ''}`}
            onClick={() => onChange(option.mode)}
          >
            <b>{option.label}</b>
            <span className="muted small">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
