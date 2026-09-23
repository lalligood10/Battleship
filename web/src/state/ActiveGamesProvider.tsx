/**
 * Realtime list of the user's unfinished games. This is the reliable, in-app "it's your turn" mechanism:
 * the tab badge, the browser tab title and the Home list all derive from `attentionCount`.
 * Browser push (lib/push.ts) is a nice-to-have layered on top and never required.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/errors';
import { listenActiveGames } from '../lib/firestore';
import { needsMyAction, type Game } from '../lib/types';
import { Toast } from '../components/ui';

interface ActiveGamesValue {
  games: Game[];
  loaded: boolean;
  error: string | null;
  attentionCount: number;
}

const Ctx = createContext<ActiveGamesValue | null>(null);

export function ActiveGamesProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const previousTurns = useRef<Set<string> | null>(null);

  useEffect(() => {
    setLoaded(false);
    previousTurns.current = null;
    return listenActiveGames(
      uid,
      (list) => {
        setGames(list);
        setLoaded(true);
        setError(null);
        // Announce games that just became my turn (skip the very first snapshot so we don't toast on load).
        const nowMine = new Set(list.filter((g) => needsMyAction(g, uid)).map((g) => g.id));
        const prev = previousTurns.current;
        if (prev) {
          const fresh = list.filter((g) => nowMine.has(g.id) && !prev.has(g.id) && g.status === 'active');
          const first = fresh[0];
          if (first && !location.pathname.startsWith(`/game/${first.id}`)) {
            const opponent = Object.entries(first.players).find(([id]) => id !== uid)?.[1]?.username ?? 'Opponent';
            setToast(`Your turn against ${opponent}`);
          }
        }
        previousTurns.current = nowMine;
      },
      (err) => {
        setLoaded(true);
        setError(errorMessage(err));
      },
    );
  }, [uid]);

  const attentionCount = useMemo(() => games.filter((g) => needsMyAction(g, uid)).length, [games, uid]);

  useEffect(() => {
    document.title = attentionCount > 0 ? `(${attentionCount}) Broadside` : 'Broadside';
  }, [attentionCount]);

  const value = useMemo(() => ({ games, loaded, error, attentionCount }), [games, loaded, error, attentionCount]);
  const clearToast = useCallback(() => setToast(null), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Toast message={toast} onDone={clearToast} />
    </Ctx.Provider>
  );
}

export function useActiveGames(): ActiveGamesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useActiveGames must be used inside ActiveGamesProvider');
  return v;
}
