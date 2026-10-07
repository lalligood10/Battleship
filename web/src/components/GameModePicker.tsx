import { useId } from 'react';
import { GAME_MODE_OPTIONS, type GameMode } from '@shared/core/schema';

/**
 * Mode choice as native radios (arrow keys move between modes) with a separate "How to play"
 * disclosure per mode. Pass `heading` to render the titled Home section; without it a compact label is used.
 */
export function GameModePicker({
  value,
  onChange,
  heading,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
  heading?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  return (
    <div className={`gm-picker${heading ? ' gm-picker--section' : ''}`}>
      {heading ? (
        <h2 className="gm-heading" id={labelId}>
          {heading}
        </h2>
      ) : (
        <span className="muted small game-mode-picker-label" id={labelId}>
          Game type
        </span>
      )}
      <div className="gm-options" role="radiogroup" aria-labelledby={labelId}>
        {GAME_MODE_OPTIONS.map((option) => {
          const selected = value === option.mode;
          const descriptionId = `${id}-${option.mode}-description`;
          return (
            <div key={option.mode} className={`gm-option${selected ? ' gm-option--selected' : ''}`}>
              <label className="gm-choice">
                <input
                  type="radio"
                  className="gm-radio"
                  name={`${id}-mode`}
                  value={option.mode}
                  checked={selected}
                  onChange={() => onChange(option.mode)}
                  aria-describedby={descriptionId}
                />
                <span className="gm-choice-text">
                  <b>{option.label}</b>
                  <span className="muted small" id={descriptionId}>
                    {option.description}
                  </span>
                </span>
              </label>
              <details className="gm-how">
                <summary>
                  How to play<span className="gm-sr-only"> {option.label}</span>
                </summary>
                <p className="small">{option.howToPlay}</p>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
