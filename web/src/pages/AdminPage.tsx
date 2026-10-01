import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert, Empty, Spinner, TopBar } from '../components/ui';
import { adminListUsers, adminUpdateUser, type AdminUser } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useUid } from '../state/SessionProvider';

export function AdminPage() {
  const currentUid = useUid();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setUsers((await adminListUsers()).users);
    } catch (err) {
      setError(errorMessage(err));
      setUsers([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!users || !needle) return users;
    return users.filter(
      (user) =>
        user.username.toLowerCase().includes(needle) ||
        user.email?.toLowerCase().includes(needle) ||
        user.uid.toLowerCase().includes(needle),
    );
  }, [query, users]);

  return (
    <div className="page page--wide">
      <TopBar title="Manage players" back="/profile" />
      <p className="muted small">Rename players, control leaderboard visibility, or suspend access.</p>
      <input
        className="input"
        type="search"
        placeholder="Search username or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <Alert>{error}</Alert>}
      {users === null && !error && <Spinner />}
      {filtered?.length === 0 && !error && <Empty title="No players found" />}
      {filtered && filtered.length > 0 && (
        <div className="stack">
          {filtered.map((user) => (
            <AdminUserCard key={user.uid} user={user} isCurrentUser={user.uid === currentUid} onUpdated={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdminUserCard({
  user,
  isCurrentUser,
  onUpdated,
}: {
  user: AdminUser;
  isCurrentUser: boolean;
  onUpdated: () => Promise<void>;
}) {
  const [name, setName] = useState(user.username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(user.username), [user.username]);

  const update = async (changes: Parameters<typeof adminUpdateUser>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await adminUpdateUser(changes);
      await onUpdated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const username = name.trim();
    if (username && username !== user.username) void update({ uid: user.uid, username });
  };

  const toggleSuspension = () => {
    const next = !user.suspended;
    if (next && !window.confirm(`Suspend ${user.username}? They will be unable to play or appear on leaderboards.`)) return;
    void update({ uid: user.uid, suspended: next });
  };

  return (
    <article className="card stack">
      <div className="row row--between">
        <div className="grow">
          <b>{user.username}{isCurrentUser ? ' (you)' : ''}</b>
          <div className="muted small">{user.email ?? user.uid}</div>
        </div>
        <div className="small" style={{ textAlign: 'right' }}>
          <b>{user.rating}</b>
          <div className="muted">{user.wins}W · {user.losses}L</div>
        </div>
      </div>
      {error && <Alert onDismiss={() => setError(null)}>{error}</Alert>}
      <form className="row" onSubmit={rename}>
        <input
          className="input grow"
          aria-label={`Username for ${user.username}`}
          maxLength={16}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="btn btn--secondary btn--sm" type="submit" disabled={busy || name.trim() === user.username}>
          Rename
        </button>
      </form>
      <div className="row">
        <button
          className="btn btn--secondary btn--sm grow"
          type="button"
          disabled={busy || user.suspended}
          onClick={() => void update({ uid: user.uid, leaderboardVisible: !user.leaderboardVisible })}
        >
          {user.leaderboardVisible ? 'Hide from leaderboards' : 'Show on leaderboards'}
        </button>
        <button
          className={`btn btn--sm grow ${user.suspended ? 'btn--secondary' : 'btn--danger'}`}
          type="button"
          disabled={busy || isCurrentUser}
          onClick={toggleSuspension}
        >
          {user.suspended ? 'Restore access' : 'Suspend access'}
        </button>
      </div>
    </article>
  );
}
