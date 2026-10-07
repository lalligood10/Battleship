import { FirebaseError } from 'firebase/app';
import { describe, expect, it } from 'vitest';
import { errorMessage } from '../lib/errors';
import {
  GUEST_ACCOUNT_EXISTS_MESSAGE,
  GUEST_SIGN_OUT_WARNING,
  guestUpgradeErrorMessage,
  needsGuestUpgradeFinish,
} from './guest';

describe('guest helpers', () => {
  it('shows the guest-profile preservation message for already-used credentials', () => {
    expect(guestUpgradeErrorMessage(new FirebaseError('auth/credential-already-in-use', 'used'))).toBe(
      GUEST_ACCOUNT_EXISTS_MESSAGE,
    );
    expect(guestUpgradeErrorMessage(new FirebaseError('auth/email-already-in-use', 'used'))).toBe(
      GUEST_ACCOUNT_EXISTS_MESSAGE,
    );
  });

  it('uses the standard error message for other failures', () => {
    const error = new FirebaseError('auth/network-request-failed', 'offline');
    expect(guestUpgradeErrorMessage(error)).toBe(errorMessage(error));
  });

  it('identifies an authenticated guest whose account link needs server completion', () => {
    expect(needsGuestUpgradeFinish({ isGuest: true }, { isAnonymous: false })).toBe(true);
    expect(needsGuestUpgradeFinish({ isGuest: true }, { isAnonymous: true })).toBe(false);
    expect(needsGuestUpgradeFinish({ isGuest: false }, { isAnonymous: false })).toBe(false);
    expect(needsGuestUpgradeFinish(null, { isAnonymous: false })).toBe(false);
  });

  it('keeps the guest sign-out warning copy stable', () => {
    expect(GUEST_SIGN_OUT_WARNING).toBe(
      "You're playing as a guest. If you sign out, this guest profile and its games can't be recovered. Sign out anyway?",
    );
  });
});
