import { FirebaseError } from 'firebase/app';
import { errorMessage } from '../lib/errors';
import type { UserProfile } from '../lib/types';

export const GUEST_ACCOUNT_EXISTS_MESSAGE =
  'That account already exists. Sign in to it instead — guest games stay on this guest profile.';

export function guestUpgradeErrorMessage(err: unknown): string {
  if (
    err instanceof FirebaseError &&
    (err.code === 'auth/credential-already-in-use' || err.code === 'auth/email-already-in-use')
  ) {
    return GUEST_ACCOUNT_EXISTS_MESSAGE;
  }
  return errorMessage(err);
}

export const GUEST_SIGN_OUT_WARNING =
  "You're playing as a guest. If you sign out, this guest profile and its games can't be recovered. Sign out anyway?";

export function needsGuestUpgradeFinish(
  profile: Pick<UserProfile, 'isGuest'> | null | undefined,
  user: Pick<{ isAnonymous: boolean }, 'isAnonymous'> | null | undefined,
): boolean {
  return profile?.isGuest === true && user?.isAnonymous === false;
}
