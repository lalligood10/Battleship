/**
 * Session = Firebase Auth user + realtime listener on users/{uid}.
 *   loading       → still resolving auth on page load
 *   signedOut     → show sign-in
 *   needsUsername → signed in but no profile yet (first run)
 *   ready         → profile loaded
 */
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, db } from '../lib/firebase';
import { errorMessage } from '../lib/errors';
import type { UserProfile } from '../lib/types';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'needsUsername'; user: User }
  | { kind: 'ready'; user: User; profile: UserProfile };

interface SessionContextValue {
  state: SessionState;
  /** Convenience: uid when signed in. */
  uid: string | null;
  profile: UserProfile | null;
  error: string | null;
  clearError: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function profileFromData(id: string, data: Record<string, unknown>): UserProfile {
  return {
    id,
    username: String(data.username ?? ''),
    usernameLower: String(data.usernameLower ?? ''),
    rating: Number(data.rating ?? 0),
    stats: data.stats as UserProfile['stats'],
    isBot: data.isBot === true,
    botStats: (data.botStats as UserProfile['botStats']) ?? undefined,
    createdAt: (data.createdAt as UserProfile['createdAt']) ?? null,
    updatedAt: (data.updatedAt as UserProfile['updatedAt']) ?? null,
    lastGameAt: (data.lastGameAt as UserProfile['lastGameAt']) ?? null,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth(), (u) => setUser(u)), []);

  useEffect(() => {
    if (!user) {
      setProfile(undefined);
      return;
    }
    setProfile(undefined);
    return onSnapshot(
      doc(db(), 'users', user.uid),
      (snap) => setProfile(snap.exists() ? profileFromData(snap.id, snap.data()) : null),
      (err) => setError(errorMessage(err)),
    );
  }, [user]);

  const state: SessionState = useMemo(() => {
    if (user === undefined) return { kind: 'loading' };
    if (user === null) return { kind: 'signedOut' };
    if (profile === undefined) return { kind: 'loading' };
    if (profile === null) return { kind: 'needsUsername', user };
    return { kind: 'ready', user, profile };
  }, [user, profile]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      uid: user?.uid ?? null,
      profile: profile ?? null,
      error,
      clearError: () => setError(null),
      signOut: async () => {
        try {
          await fbSignOut(auth());
        } catch (err) {
          setError(errorMessage(err));
        }
      },
    }),
    [state, user, profile, error],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useUid(): string {
  const { uid } = useSession();
  if (!uid) throw new Error('Not signed in');
  return uid;
}
