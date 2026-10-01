import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { refs } from '../lib/firestore';
import { setUsername } from './users';

export const ADMIN_EMAILS = new Set(['lalligood10@gmail.com']);

export interface AdminActor {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export interface AdminUser {
  uid: string;
  email: string | null;
  username: string;
  rating: number;
  wins: number;
  losses: number;
  leaderboardVisible: boolean;
  suspended: boolean;
  createdAt: string | null;
}

export function requireAdmin(actor: AdminActor): void {
  if (!actor.emailVerified || !actor.email || !ADMIN_EMAILS.has(actor.email.toLowerCase())) {
    throw new HttpsError('permission-denied', 'Administrator access required');
  }
}

export async function adminStatus(actor: AdminActor): Promise<{ isAdmin: boolean }> {
  return {
    isAdmin: Boolean(actor.emailVerified && actor.email && ADMIN_EMAILS.has(actor.email.toLowerCase())),
  };
}

export async function listUsers(actor: AdminActor): Promise<{ users: AdminUser[] }> {
  requireAdmin(actor);
  const snapshot = await refs.users().orderBy('createdAt', 'desc').limit(250).get();
  const humanDocs = snapshot.docs.filter((doc) => doc.data().isBot !== true);
  const authUsers = new Map<string, Awaited<ReturnType<ReturnType<typeof getAuth>['getUser']>>>();
  for (let offset = 0; offset < humanDocs.length; offset += 100) {
    const result = await getAuth().getUsers(humanDocs.slice(offset, offset + 100).map((doc) => ({ uid: doc.id })));
    for (const user of result.users) authUsers.set(user.uid, user);
  }

  return {
    users: humanDocs.map((doc) => {
      const profile = doc.data();
      const authUser = authUsers.get(doc.id);
      return {
        uid: doc.id,
        email: authUser?.email ?? null,
        username: profile.username,
        rating: profile.rating,
        wins: profile.stats.wins,
        losses: profile.stats.losses,
        leaderboardVisible: profile.leaderboardVisible !== false && profile.suspended !== true,
        suspended: profile.suspended === true || authUser?.disabled === true,
        createdAt: profile.createdAt?.toDate().toISOString() ?? null,
      };
    }),
  };
}

interface AdminUpdateInput {
  uid?: unknown;
  username?: unknown;
  leaderboardVisible?: unknown;
  suspended?: unknown;
}

export async function updateUser(actor: AdminActor, data: unknown): Promise<void> {
  requireAdmin(actor);
  const input = (data ?? {}) as AdminUpdateInput;
  if (typeof input.uid !== 'string' || !input.uid) throw new HttpsError('invalid-argument', 'User is required');

  const target = await refs.user(input.uid).get();
  const profile = target.data();
  if (!profile || profile.isBot) throw new HttpsError('not-found', 'User not found');

  if (input.username !== undefined) await setUsername(input.uid, { username: input.username });

  const updates: Partial<{ leaderboardVisible: boolean; suspended: boolean; updatedAt: Timestamp }> = {};
  if (typeof input.leaderboardVisible === 'boolean') updates.leaderboardVisible = input.leaderboardVisible;
  if (typeof input.suspended === 'boolean') {
    if (input.uid === actor.uid && input.suspended) {
      throw new HttpsError('failed-precondition', 'You cannot suspend your own administrator account');
    }
    updates.suspended = input.suspended;
    if (input.suspended) updates.leaderboardVisible = false;
    await getAuth().updateUser(input.uid, { disabled: input.suspended });
    if (input.suspended) await refs.quickMatch(input.uid).delete();
  }
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = Timestamp.now();
    await refs.user(input.uid).update(updates);
  }
}
