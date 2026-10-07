/** Keyboard and focus rules for the in-game chat drawer (audit R15). */

/** Marks the control that receives focus when the chat panel opens. */
export const CHAT_INITIAL_FOCUS_ATTR = 'data-chat-initial-focus';

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export type ChatKeyAction = 'close' | null;

/** Escape closes an open panel; every other key is left to the browser. */
export function chatKeyAction(key: string, open: boolean): ChatKeyAction {
  return open && (key === 'Escape' || key === 'Esc') ? 'close' : null;
}

/** The marked control if it can take focus, otherwise the first focusable control in the panel. */
export function chatInitialFocusTarget(panel: ParentNode): HTMLElement | null {
  const marked = panel.querySelector<HTMLElement>(`[${CHAT_INITIAL_FOCUS_ATTR}]`);
  if (marked && !marked.matches(':disabled')) return marked;
  return panel.querySelector<HTMLElement>(FOCUSABLE);
}
