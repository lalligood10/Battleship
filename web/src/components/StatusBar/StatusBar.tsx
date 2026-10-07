import type { ReactNode } from 'react';
import type { ShipType } from '../../game/placement';
import { fleetSummary } from './fleetSummary';
import './StatusBar.css';

export interface StatusBarProps {
  turnText: string;
  tone: 'mine' | 'theirs' | 'over';
  timer?: ReactNode;
  enemyName: string;
  enemySunk: readonly ShipType[];
  ownSunk: readonly ShipType[];
  salvo?: { mine: boolean; shots: number } | null;
}

export function StatusBar({
  turnText,
  tone,
  timer,
  enemyName,
  enemySunk,
  ownSunk,
  salvo,
}: StatusBarProps) {
  const enemy = fleetSummary(enemySunk);
  const own = fleetSummary(ownSunk);
  const glyph = tone === 'mine' ? '▶' : tone === 'theirs' ? '◷' : '■';

  return (
    <section className={`status-bar status-bar--${tone}`} aria-label="Battle status">
      <div className="status-bar__turn-row">
        <p className="status-bar__turn" role="status">
          <span aria-hidden="true">{glyph}</span>
          {turnText}
        </p>
        {timer && <div className="status-bar__timer">{timer}</div>}
      </div>
      {salvo && (
        <p className="status-bar__salvo">
          {salvo.mine ? 'Shots this volley: ' : `${enemyName} fires `}
          <span>{salvo.shots}</span>
          {!salvo.mine && ' next volley'}
        </p>
      )}
      <div className="status-bar__enemy">
        <div className="status-bar__fleet-heading">
          <h2 className="panel-title">{enemyName}&apos;s fleet</h2>
          <span className="status-bar__count">
            {enemy.afloat}/{enemy.total} afloat
          </span>
        </div>
        <ul className="status-bar__ships" aria-label={`${enemyName}'s ships`}>
          {enemy.ships.map((ship) => (
            <li className={`status-ship${ship.sunk ? ' status-ship--sunk' : ''}`} key={ship.type}>
              <span className="status-ship__silhouette" aria-hidden="true">
                <i />
                {ship.sunk && <b>✕</b>}
              </span>
              <span className="status-ship__pips" aria-hidden="true">
                {Array.from({ length: ship.length }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
              <span className="status-ship__name">
                {ship.name}
                {ship.sunk && <span className="status-bar__sr-only"> — sunk</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="status-bar__own">
        <span className="status-bar__own-count">
          Your fleet <b>{own.afloat}/{own.total}</b> afloat
        </span>
        <ul className="status-bar__own-ships" aria-label="Your ships">
          {own.ships.map((ship) => (
            <li className={`status-own-ship${ship.sunk ? ' status-own-ship--sunk' : ''}`} key={ship.type}>
              <span className="status-own-ship__silhouette" aria-hidden="true">
                <i />
                {ship.sunk && <b>✕</b>}
              </span>
              <span className="status-bar__sr-only">
                {ship.name}
                {ship.sunk ? ' — sunk' : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
