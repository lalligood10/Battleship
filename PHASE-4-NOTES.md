# Phase 4 — Look, polish & accessibility

Art direction: **naval command**. A dark navy console, radar green and amber accents, Saira Stencil One display type, IBM Plex Mono for numbers, and a crisp grid. The tokens and their rationale are in `docs/PHASE-4-TOKENS.md`. No gameplay rules changed. No Phase 5 work was started.

## What shipped

### Foundation (tag `phase-4-tokens`)
- **Design tokens** in `web/src/styles/tokens.css` for both dark and light themes: palette, sea and marker colours, type scale, spacing, radii, motion durations, layers and `--tap-min: 44px`. `index.css` imports `tokens`, then `base`, `game`, `home` and `screens`. A unit test (`styles/tokens.test.ts`) checks that every text/background pairing meets WCAG AA.
- **Markers that don't depend on colour:**
  - Miss: a ring.
  - Hit: ✕ on amber.
  - Sunk: ✕ on red with a diagonal hatch.
- **Shared primitives:** buttons are at least 44px, including `.btn--outline-danger`. Inputs, panels and modals are restyled, and focus rings use a white outer ring with a dark inner ring.
- **Vibration follows the mute button.**
- **Merged the earlier accessibility audit branch:**
  - Modal focus trap.
  - Live region for toasts.
  - `aria-selected` on the sign-in tabs.

### Placement and gameplay
- **Placement:**
  - Drag and drop with snap-to-grid.
  - Tap a placed ship to rotate it.
  - **Randomize**, which uses the server's own `randomFleet` through `@shared`.
  - Invalid placement shows a hatch and red outline, an inline reason such as "Overlaps Battleship" or "Off the board", and an `aria-live` message.
  - Keyboard placement: arrows move the ship, R rotates it, Enter places it.
- **`StatusBar`:**
  - Whose turn it is, plus the turn timer in timed games.
  - Ships still afloat on each side.
  - Sunk enemy ships shown by name and silhouette, with strikethrough and a ✕.
  - In Salvo, the number of shots this volley.
- **Focus after a shot:** focus returns to the fired cell, or to the grid's roving cell (audit R1). This also works after Salvo and ability actions.
- **Board accessibility:** the column-label row is hidden from assistive tech (R2).
- **Unexplored enemy water is darker than open sea,** so it can't be mistaken for ships.
- **Resign is now an outline button.**

### Home, game over and replay
- **Home is laid out as a "Mission select" console.** These behave exactly as before:
  - Mode descriptions and How to play.
  - Guest restrictions.
  - Quick Match resume.
  - The timer picker, which appears for friend games only.
- **Accessible names start with the visible text (R12).** For example, the difficulty buttons are now named "Easy — Cadet Bot …".
- **End-of-game reveal:**
  - Both boards with both fleets revealed.
  - A shot heatmap for each player, with a toggle between "Your shots" and "Their shots".
  - Four headline numbers: accuracy, turns taken, shots fired and ships lost.
- **The heatmap doesn't depend on colour.** Each cell shows its shot order, five bands have different patterns as well as colours, and the legend can be read in grayscale. Each cell also has a label such as "C4: 3rd shot, hit".
- **Statistics come from the game document** (`game/resultStats.ts`, `game/heatmap.ts`):
  - A Classic shot is one turn.
  - A Salvo volley is one turn, grouped by `shot.volley`.
  - Each ability use is one turn, from `abilityLog`. Airstrike shots share their turn's volley number, so they aren't counted twice.

### Other screens and the accessibility QA harness
- **Restyled screens:** sign-in, username, profile (including the guest card), leaderboards, join, waiting, setup, admin, abandon controls, chat and reactions.
- **Landmarks:** a skip link and a `<main>` landmark on every screen, and the sign-in brand is now an `h1` (R11).
- **Chat (R15):**
  - Focus moves into the panel when it opens.
  - Escape closes it and returns focus to the toggle.
  - The toggle is hidden while a dialog is open (R9).
- **Reaction announcements** go through a live region that is always mounted (R16).
- **`npm run a11y-qa`** runs three specs:
  - `a11y.spec.ts`.
  - `a11y-sweep.spec.ts`: axe at WCAG 2.0/2.1 A and AA on every route and the main game states (waiting, placement, active, chat open, resign dialog, results), at 375px and 1280px in dark and light. It fails on any serious or critical violation, and on any visible control under 44×44 outside the board.
  - `colorblind.spec.ts`: screenshots with simulated protanopia, deuteranopia and tritanopia, plus grayscale. It asserts that miss, hit and sunk differ by shape.

## Decisions for review
- **Board cells are about 32px at 375px, not 44px.** Ten 44px cells plus labels don't fit on that screen. Aim-then-Fire guards against mis-taps, and keyboard play is available.
- **Accuracy counts every cell an airstrike hits as a shot.**
- **Turns taken doesn't count turns skipped by the timer.**
- **Removed the decorative clouds and burning wrecks around the board** in favour of console scanlines and corner brackets. All shot and sink FX are unchanged.

## Verification
Run on `b9ca135` against the `demo-broadside` emulators. Emulator tests and visual QA ran one after the other.

| Check | Result |
|---|---|
| Functions lint, typecheck | Pass |
| Functions unit tests | 234 / 234 (20 files) |
| Emulator suite | 207 / 207 (11 files) |
| Web lint | Pass (21 warnings, all present before Phase 4) |
| Web typecheck, build | Pass (bundle-size warning, present before Phase 4) |
| Web unit tests | 318 / 318 (46 files) |
| `npm run a11y-qa` | 9 / 9. Axe found 0 serious or critical violations across every route and game state at 375/1280 in dark/light. 0 controls under 44px outside the board. `KNOWN_ISSUES` is empty. |
| Full web Playwright suite | 15 / 15, including keyboard placement and firing, invalid-placement feedback, focus return, reconnect and Quick Match resume |
| Screenshot spec | 3 dark + 3 light, with hit/miss/sunk marker capture |

Reviewed by eye:
- Home, placement, gameplay and game-over at 375 and 1280 in dark and light.
- The other screens: sign-in, profile, leaderboards, waiting and chat.
- Grayscale, protanopia, deuteranopia and tritanopia renders of a live board. In all of them, miss, hit and sunk stay distinct by shape and hatch.

## Known issues / deferred
- **The floating Commentary/Chat toggle covers part of the board while you scroll at 375px.** It's a fixed tab. Pages now have enough bottom padding to scroll the last control clear of it. Making it an icon-only button on phones is a possible follow-up.
- Bundle-size warning on build. This was already present before Phase 4.
- iOS is unchanged.
- The visual-QA CI job doesn't compare screenshots against stored baselines, so the screenshots were reviewed by eye.
- Screenshot runs show reaction emoji as empty boxes, because the headless Chromium has no emoji font. This doesn't affect real browsers.
