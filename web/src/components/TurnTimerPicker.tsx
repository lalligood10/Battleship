import { useId } from 'react';
import { TURN_TIMER_CHOICES } from '../game/turnTimer';
import './TurnTimer.css';

export function TurnTimerPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (ms: number | null) => void;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <div className="gm-picker turn-timer-picker">
      <span className="muted small game-mode-picker-label" id={labelId}>
        Turn timer
      </span>
      <div className="gm-options" role="radiogroup" aria-labelledby={labelId} aria-describedby={descriptionId}>
        {TURN_TIMER_CHOICES.map((option) => {
          const selected = value === option.value;
          return (
            <div key={option.label} className={`gm-option${selected ? ' gm-option--selected' : ''}`}>
              <label className="gm-choice">
                <input
                  type="radio"
                  className="gm-radio"
                  name={`${id}-turn-timer`}
                  value={option.value ?? 'off'}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                />
                <span className="gm-choice-text">
                  <b>{option.label}</b>
                </span>
              </label>
            </div>
          );
        })}
      </div>
      <p className="muted small turn-timer-picker-description" id={descriptionId}>
        Optional per-turn clock for live games. Running out skips your turn; three skips forfeits.
      </p>
    </div>
  );
}
