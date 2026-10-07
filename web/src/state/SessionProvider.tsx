/**
 * Session = Firebase Auth user + realtime listener on users/{uid}.
 *   loading       → still resolving auth on page load
 *   signedOut     → show sign-in
 *   needsUsername → signed in but no profile yet (first run)
 *   ready         → profile loaded
 */
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as api from '../lib/api';
import { auth, db } from '../lib/firebase';
import { errorMessage } from '../lib/errors';
import type { UserProfile } from '../lib/types';
import { needsGuestUpgradeFinish } from './guest';

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
  isGuest: boolean;
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
    leaderboardVisible: data.leaderboardVisible !== false,
    suspended: data.suspended === true,
    isBot: data.isBot === true,
    isGuest: data.isGuest === true,
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
  const uid = user?.uid ?? null;
  const uidRef = useRef<string | null>(null);
  const guestUpgradeAttempts = useRef(new Set<string>());

  useEffect(() => onAuthStateChanged(auth(), (u) => setUser(u)), []);

  useEffect(() => {
    uidRef.current = uid;
    if (!uid) {
      setProfile(undefined);
      return;
    }
    setProfile(undefined);
    return onSnapshot(
      doc(db(), 'users', uid),
      (snap) => {
        if (uidRef.current === uid) setProfile(snap.exists() ? profileFromData(snap.id, snap.data()) : null);
      },
      (err) => {
        if (uidRef.current === uid) setError(errorMessage(err));
      },
    );
  }, [uid]);

  const state: SessionState = useMemo(() => {
    if (user === undefined) return { kind: 'loading' };
    if (user === null) return { kind: 'signedOut' };
    if (profile === undefined) return { kind: 'loading' };
    if (profile === null) return { kind: 'needsUsername', user };
    return { kind: 'ready', user, profile };
  }, [user, profile]);

  useEffect(() => {
    if (
      state.kind !== 'ready' ||
      !needsGuestUpgradeFinish(state.profile, state.user) ||
      guestUpgradeAttempts.current.has(state.user.uid)
    ) {
      return;
    }
    guestUpgradeAttempts.current.add(state.user.uid);
    void api.completeGuestUpgrade().catch((err: unknown) => setError(errorMessage(err)));
  }, [state]);

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      uid,
      profile: profile ?? null,
      isGuest: profile?.isGuest === true,
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
    [state, uid, profile, error],
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
