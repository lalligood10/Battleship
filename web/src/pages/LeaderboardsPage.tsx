import { useEffect, useState } from 'react';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { fetchFriendsLeaderboard, fetchGlobalLeaderboard, fetchWeeklyLeaderboard } from '../lib/firestore';
import { useUid } from '../state/SessionProvider';

type Tab = 'global' | 'weekly' | 'friends';

interface Row {
  id: string;
  username: string;
  primary: number;
  secondary: string;
}

export function LeaderboardsPage() {
  const uid = useUid();
  const [tab, setTab] = useState<Tab>('global');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const load = async (): Promise<Row[]> => {
      switch (tab) {
        case 'global':
          return (await fetchGlobalLeaderboard()).map((u) => ({
            id: u.id,
            username: u.username,
            primary: u.rating,
            secondary: `${u.stats.wins}W · ${u.stats.losses}L`,
          }));
        case 'weekly':
          return (await fetchWeeklyLeaderboard()).map((w) => ({
            id: w.id,
            username: w.username,
            primary: w.wins,
            secondary: `Rating ${w.rating}`,
          }));
        case 'friends':
          return (await fetchFriendsLeaderboard(uid)).map((u) => ({
            id: u.id,
            username: u.username,
            primary: u.rating,
            secondary: `${u.stats.wins}W · ${u.stats.losses}L`,
          }));
      }
    };
    load()
      .then((r) => !cancelled && setRows(r))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tab, uid]);

  const unit = tab === 'weekly' ? 'wins' : 'rating';

  return (
    <div className="page">
      <TopBar title="Leaderboards" />
      <div className="segmented" role="tablist">
        {(['global', 'weekly', 'friends'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'global' ? 'Global' : t === 'weekly' ? 'This week' : 'Friends'}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        {tab === 'global' && 'All players, ranked by rating.'}
        {tab === 'weekly' && 'Most wins this week (Monday to Sunday, UTC).'}
        {tab === 'friends' && 'You and everyone you have played, ranked by rating.'}
      </p>

      {error && <Alert>{error}</Alert>}
      {rows === null && !error && <Spinner />}
      {rows && rows.length === 0 && (
        <Empty
          title={tab === 'friends' ? 'No opponents yet' : 'Nobody here yet'}
          message={tab === 'friends' ? 'Finish a game against a friend and they will show up here.' : 'Finish a game to appear on the board.'}
        />
      )}
      {rows && rows.length > 0 && (
        <ol className="list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r, i) => (
            <li key={r.id} className={`list-item${r.id === uid ? ' list-item--attention' : ''}`}>
              <span className={`rank${r.id === uid ? ' me' : ''}`}>{i + 1}</span>
              <span className="avatar">{r.username.slice(0, 1).toUpperCase()}</span>
              <span className="grow">
                <div style={{ fontWeight: 700 }}>
                  {r.username}
                  {r.id === uid && <span className="muted"> (you)</span>}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {r.secondary}
                </div>
              </span>
              <span style={{ textAlign: 'right' }}>
                <b style={{ fontSize: 18 }}>{r.primary}</b>
                <div className="muted" style={{ fontSize: 11 }}>
                  {unit}
                </div>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
