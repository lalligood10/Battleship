/**
 * Pure logic for the push opt-in prompt shown on the results screen. Kept separate from the
 * component so it can be unit tested without a DOM.
 */
export const PUSH_PROMPT_KEY = 'broadside.pushPrompt.v1';

export interface PushPromptInput {
  /** The game being viewed is finished — we only ask once a full game is done. */
  gameFinished: boolean;
  /** Browser push is supported and configured (pushAvailable()). */
  available: boolean;
  permission: NotificationPermission | 'unsupported';
  /** A token is already registered for this device. */
  pushOn: boolean;
  /** The user already dismissed the prompt. */
  dismissed: boolean;
}

export function shouldOfferPushPrompt(input: PushPromptInput): boolean {
  return (
    input.gameFinished &&
    input.available &&
    input.permission === 'default' &&
    !input.pushOn &&
    !input.dismissed
  );
}

export function isPromptDismissed(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(PUSH_PROMPT_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissPrompt(storage: Pick<Storage, 'setItem'>): void {
  try {
    storage.setItem(PUSH_PROMPT_KEY, '1');
  } catch {
    // Storage may be unavailable (private mode); the prompt just shows again next time.
  }
}
