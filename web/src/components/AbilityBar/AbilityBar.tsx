import type { KeyboardEvent } from 'react';
import { ABILITY_DEFINITIONS, type AbilityId, type AbilityStatus } from '@shared/core/modes/types';
import './AbilityBar.css';

export interface AbilityBarProps {
  statuses: Record<AbilityId, AbilityStatus>;
  disabled: boolean;
  selected: AbilityId | null;
  onSelect(id: AbilityId | null): void;
  horizontal: boolean;
  onToggleOrientation(): void;
}

const STATUS_LABEL: Record<AbilityStatus, string> = { ready: 'Ready', used: 'Used', lost: 'Lost' };

const AIM_HINT: Record<AbilityId, string> = {
  'carrier-airstrike': 'Pick the first cell of the strike on the enemy board.',
  'submarine-sonar': 'Pick the centre of the scan on the enemy board.',
  'destroyer-relocate': 'Pick the destroyer’s new position on your board.',
};

const ORIENTABLE: ReadonlySet<AbilityId> = new Set(['carrier-airstrike', 'destroyer-relocate']);

export function AbilityBar({ statuses, disabled, selected, onSelect, horizontal, onToggleOrientation }: AbilityBarProps) {
  const selectedDefinition = ABILITY_DEFINITIONS.find((definition) => definition.id === selected);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      onSelect(null);
    }
  };

  return (
    <div className="ability-bar" role="group" aria-labelledby="ability-bar-title" onKeyDown={onKeyDown}>
      <span className="ability-bar__title muted small" id="ability-bar-title">
        Ship abilities · once per game, replaces your shot
      </span>
      <div className="ability-bar__list">
        {ABILITY_DEFINITIONS.map((definition) => {
          const status = statuses[definition.id];
          const isSelected = selected === definition.id;
          const unavailable = disabled || status !== 'ready';
          return (
            <button
              key={definition.id}
              type="button"
              className={`ability-option ability-option--${status}${isSelected ? ' ability-option--selected' : ''}${disabled ? ' ability-option--disabled' : ''}`}
              aria-pressed={isSelected}
              aria-disabled={unavailable || undefined}
              onClick={() => {
                if (unavailable) return;
                onSelect(isSelected ? null : definition.id);
              }}
            >
              <span className="ability-option__head">
                <b className="ability-option__label">{definition.label}</b>
                <span className={`ability-status ability-status--${status}`}>{STATUS_LABEL[status]}</span>
              </span>
              <span className="ability-option__ship muted small">{shipName(definition.ship)}</span>
              <span className="ability-option__desc small" id={`ability-${definition.id}-desc`}>
                {definition.description}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ability-bar__aim" aria-live="polite">
        {selectedDefinition && (
          <>
            <span className="ability-bar__hint small">
              <b>{selectedDefinition.label}:</b> {AIM_HINT[selectedDefinition.id]}
            </span>
            <span className="ability-bar__actions">
              {ORIENTABLE.has(selectedDefinition.id) && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm ability-bar__action"
                  aria-label={`Orientation: ${horizontal ? 'horizontal' : 'vertical'}. Switch to ${horizontal ? 'vertical' : 'horizontal'}`}
                  onClick={onToggleOrientation}
                >
                  <span aria-hidden className={`ability-bar__rotate${horizontal ? '' : ' ability-bar__rotate--vertical'}`}>
                    ⟷
                  </span>
                  {horizontal ? 'Horizontal' : 'Vertical'}
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm ability-bar__action" onClick={() => onSelect(null)}>
                Cancel
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function shipName(ship: string): string {
  return ship[0]!.toUpperCase() + ship.slice(1);
}
