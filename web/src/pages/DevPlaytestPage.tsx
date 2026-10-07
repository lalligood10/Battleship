import { useMemo, useState, type CSSProperties } from 'react';
import { ABILITY_DEFINITIONS } from '@shared/core/modes/types';
import { GAME_MODE_OPTIONS } from '@shared/core/schema';
import { Empty, TopBar } from '../components/ui';
import { clearPlaytestRecords, loadPlaytestRecords, summarizeByMode, type PlaytestRecord } from '../analytics';

const wide: CSSProperties = { maxWidth: 1200 };
const heading: CSSProperties = { margin: 0, fontSize: 18 };
const scroll: CSSProperties = { overflowX: 'auto' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' };
const th: CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', verticalAlign: 'top' };

const abilityLabel = new Map(ABILITY_DEFINITIONS.map((ability) => [ability.id, ability.label]));

function num(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

function duration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function exportJson(records: PlaytestRecord[]) {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `broadside-playtest-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DevPlaytestPage() {
  const [records, setRecords] = useState(loadPlaytestRecords);
  const summary = useMemo(() => summarizeByMode(records), [records]);
  const newestFirst = useMemo(() => [...records].sort((a, b) => b.endedAt - a.endedAt), [records]);

  const clear = () => {
    if (!window.confirm(`Delete ${records.length} playtest record(s)?`)) return;
    clearPlaytestRecords();
    setRecords(loadPlaytestRecords());
  };

  return (
    <div className="page page--wide" style={wide}>
      <TopBar title="Playtest analytics" back="/" />
      <p className="muted small">
        Dev only. Records finished games on this device (localStorage <span className="mono">broadside.playtest.v1</span>).
      </p>
      <div className="row">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRecords(loadPlaytestRecords())}>
          Refresh
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={records.length === 0}
          onClick={() => exportJson(records)}
        >
          Export JSON
        </button>
        <button type="button" className="btn btn--danger btn--sm" disabled={records.length === 0} onClick={clear}>
          Clear
        </button>
        <span className="grow" />
        <span className="muted small">{records.length} game(s)</span>
      </div>

      <section className="card stack">
        <h2 style={heading}>By mode</h2>
        <div style={scroll}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Mode</th>
                <th style={th}>Games</th>
                <th style={th}>Avg turns</th>
                <th style={th}>Avg duration</th>
                <th style={th}>Avg winner ships left</th>
                {ABILITY_DEFINITIONS.map((ability) => (
                  <th key={ability.id} style={th}>
                    {ability.label} uses (avg turn)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GAME_MODE_OPTIONS.map(({ mode, label }) => {
                const row = summary[mode];
                return (
                  <tr key={mode}>
                    <td style={td}>{label}</td>
                    <td style={td}>{row.games}</td>
                    <td style={td}>{num(row.avgTurns)}</td>
                    <td style={td}>{duration(row.avgDurationMs)}</td>
                    <td style={td}>{num(row.avgWinnerShipsRemaining)}</td>
                    {ABILITY_DEFINITIONS.map((ability) => {
                      const stats = row.abilities[ability.id];
                      return (
                        <td key={ability.id} style={td}>
                          {stats.uses === 0 ? '—' : `${stats.uses} (${num(stats.avgTurn)})`}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2 style={heading}>Games</h2>
        {newestFirst.length === 0 ? (
          <Empty title="No games recorded" message="Finish a game with playtest analytics enabled." />
        ) : (
          <div style={scroll}>
            <table style={table}>
              <thead>
                <tr>
                  <th style={th}>Ended</th>
                  <th style={th}>Game</th>
                  <th style={th}>Mode</th>
                  <th style={th}>Turns</th>
                  <th style={th}>Duration</th>
                  <th style={th}>Result</th>
                  <th style={th}>Winner ships left</th>
                  <th style={th}>Shots (me / opp)</th>
                  <th style={th}>Abilities (turn)</th>
                </tr>
              </thead>
              <tbody>
                {newestFirst.map((record) => {
                  const myShots = record.shotsByPlayer[record.myUid] ?? 0;
                  const opponentShots = Object.entries(record.shotsByPlayer)
                    .filter(([uid]) => uid !== record.myUid)
                    .reduce((sum, [, count]) => sum + count, 0);
                  return (
                    <tr key={record.gameId}>
                      <td style={td}>{new Date(record.endedAt).toLocaleString()}</td>
                      <td style={td} className="mono" title={record.gameId}>
                        {shortId(record.gameId)}
                      </td>
                      <td style={td}>{record.mode}</td>
                      <td style={td}>{record.turns}</td>
                      <td style={td}>{duration(record.durationMs)}</td>
                      <td style={td}>
                        {record.winner === record.myUid ? 'Won' : 'Lost'} · {record.endReason}
                      </td>
                      <td style={td}>{record.winnerShipsRemaining}</td>
                      <td style={td}>
                        {myShots} / {opponentShots}
                      </td>
                      <td style={{ ...td, whiteSpace: 'normal', minWidth: 180 }}>
                        {record.abilities.length === 0
                          ? '—'
                          : record.abilities
                              .map((use) => `${use.player === record.myUid ? 'Me' : 'Opp'}: ${abilityLabel.get(use.abilityId) ?? use.abilityId} (t${use.turnNumber})`)
                              .join(', ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
