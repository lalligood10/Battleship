# Phase 4 prep — accessibility and responsive audit

Base: `origin/devin/1791339229-phase-2-game-types` (019a9e4). Branch: `devin/phase-4-prep-a11y-audit`.

Scope: keyboard/focus, ARIA names and live regions, colour contrast, reduced motion, and 375px overflow
on the web client. Preparation only: no Phase 4 features, no visual FX or board redesign, no baseline changes.

## Method

- Code review of `web/src/feel/`, `web/src/audio/`, `web/src/fx/`, `web/src/index.css`,
  `web/src/components/Board.tsx`, `web/src/pages/game/`, `web/src/components/ui.tsx`, `GameChat.tsx`, and the existing tests
  (`web/e2e/screenshots.spec.ts`, `src/game/boardNav.test.ts`, `src/fx/fx.test.ts`).
- Live run against the Firebase emulators (`demo-broadside`) with Playwright + axe-core 4 (WCAG 2.0/2.1 A/AA + best-practice).
  The Playwright + axe script was a one-off run outside the repo, so axe is not a project dependency. Matrix: 375×812 and 1280×800, light and
  dark theme, `prefers-reduced-motion: reduce` and `no-preference`. Screens: sign-in, username, home, Play vs Computer
  dialog, placement, gameplay (before and after a real hit, aimed by reading the bot's private board read-only), chat
  open, resign dialog, game over, profile, leaderboards.
- Token contrast pairs calculated directly from the `:root` / `[data-theme='dark']` values in `index.css`.

## Existing coverage (already done, not rebuilt)

| Area | Where | Verified |
| --- | --- | --- |
| Board keyboard play | `Board.tsx` roving tabindex + `game/boardNav.ts` (`moveFocus`, `isInteractive`), tested in `boardNav.test.ts` | Tab reaches the opponent grid in 3 stops; arrows, Home/End, Ctrl+Home/End, Enter/Space select; Tab reaches "Fire at XN" in one stop |
| Cell names | `aria-label="B2 hit"`, `, queued shot N`, `aria-disabled` on non-targetable cells, `aria-readonly` on disabled boards | Labels update after the shot resolves |
| Focus ring on cells | `.cell:focus-visible` 3px `--text` outline | Present in both themes |
| Reduced motion | `fx/motion.ts` `prefersReducedMotion()` read at cue time; `particleCount`/`shakeFor` return 0/null (tested in `fx/fx.test.ts`); CSS block at the end of `index.css` swaps motion for short fades and hides jets, ripples, particles and `.board-water` | Measured on a real hit: reduce → 0 shake animations, 0 particles, `.board-water` hidden, sea swell `animation: none`; no-preference → 2 shake animations, 8–16 particles |
| Sink announcements | `FxStage` `.fx-banner-region` is `aria-live="polite"` `aria-atomic` | Present |
| Turn status | `ActiveGameView` turn banner `role="status"` | "Your turn — pick a target" / "Incoming fire…" |
| Mute | `audio/MuteToggle.tsx` with "Mute sounds"/"Unmute sounds" names, persisted in `broadside.muted` | Present |
| Dialogs | `ui.tsx` `Modal`: `role="dialog"`, `aria-modal`, initial focus, Escape closes, focus restored to opener | Escape → focus back on "Play vs Computer" |
| Chat panel | `GameChat.tsx` toggle `aria-expanded`/`aria-controls`; closed panel is `aria-hidden` + `inert`; messages `aria-live="polite"` | Closed panel is not tabbable |
| 375px layout | `.board` `--cell` clamps to viewport width | **No horizontal document overflow on any screen at 375px or 1280px, either theme** |

## Fixes in this branch (isolated, non-visual)

1. **Dialog focus trap** — `web/src/components/ui.tsx` `Modal`. Before: Tab from the last dialog button left the dialog
   (to the tab bar, then `<body>`, then the page behind the backdrop). Now Tab / Shift+Tab wrap inside the dialog,
   and initial focus skips disabled and `tabindex="-1"` elements. Pure helper `web/src/components/focusTrap.ts`
   (`trapTabIndex`, `FOCUSABLE_SELECTOR`). Applies to every `Modal` user (Play vs Computer, resign, Quick Match search,
   challenge mode choice) without editing those files.
2. **Toast announced** — `Toast` in `ui.tsx` is now `role="status" aria-live="polite" aria-atomic="true"`. Before, the
   bot's return-fire toast ("Cadet Bot fired at B3 — hit"), the WaitingView copy toast, and ActiveGamesProvider toasts were
   silent to screen readers. No CSS change.
3. **Sign-in tabs** — `web/src/pages/SignInPage.tsx` "Sign in" / "Create account" `role="tab"` buttons now set
   `aria-selected`. Before, both reported `aria-selected=null`.

None of these change pixels, so there are no new screenshots and no baseline changes.

### Tests added

- `web/src/components/focusTrap.test.ts` (6): wrap, reverse wrap, inner moves, focus outside, single element, empty dialog.
- `web/src/components/a11y.test.ts` (9, `react-dom/server` static markup, so it works in the node Vitest env): Board grid
  semantics (100 gridcells, a single roving tab stop that starts on `lastShot`, coordinate+state names, `aria-disabled` while
  targeting, queued-shot names, `aria-readonly`, decorative layers `aria-hidden`), Toast live region, Modal dialog semantics.
- `web/e2e/a11y.spec.ts` (Playwright, emulators, 375 and 1280px; writes no screenshots): no horizontal overflow on
  sign-in/home/placement/gameplay/game-over, sign-in `aria-selected`, dialog focus trap in both directions with Escape restoring
  focus, keyboard-only shot (Tab into the grid → Ctrl+Home → arrows → Enter → Tab to "Fire at B2" → Enter), cell name and
  `aria-disabled` after the shot, toast role. Confirmed it fails without the fixes (aria-selected assertion).
  Run: `npx playwright test e2e/a11y.spec.ts` (note `npm run visual-qa` now runs this spec as well as the screenshot spec).

## Gaps → recommendations (not fixed: files are Phase 2-owned or read-only)

### High

| # | Issue | Measured | File:line | Suggested fix |
| --- | --- | --- | --- | --- |
| R1 | Focus is lost after firing: the Fire button becomes disabled/relabelled, so focus falls to `<body>` and keyboard users must Tab back into the grid every turn | `activeElement` = BODY after every shot, all 4 configs | `web/src/pages/game/ActiveGameView.tsx:84-96` (`fire`), `:166` | After the shot resolves, return focus to the fired cell (or the grid's roving cell). Needs a small Board imperative focus API or a `focusCell` prop |
| R2 | Board header row (column labels) is a `role="row"` with only `aria-hidden` children → axe `aria-required-children` (critical) on every board | All game screens | `web/src/components/Board.tsx:171` (also row label cells at `:111`) | Mark the header row `aria-hidden`, or use `role="columnheader"`/`rowheader` for labels |
| R3 | Fleet chips have no text colour, so dark mode shows black text on `--card-2` | 1.36:1 | `web/src/index.css:1042` `.fleet-chip` | Add `color: var(--text)` |
| R4 | Primary buttons and chat toggle: white on accent | light 4.43:1, dark 3.19:1 (needs 4.5) | `index.css:254` `.btn--primary`, `:535` `.game-chat-toggle`, dark `--accent` `:35` | Darken `--accent` for fills (e.g. light `#0b5fe0`, dark fills `#2f6fe0`) or dark text on the dark accent |
| R5 | "Your turn" success banner text | light 3.04:1, dark 4.17:1 | `index.css:359` `.alert--success` | Darker `--success` for text (light ~`#167a42`) |
| R6 | Danger text (Resign, error alerts) | light 4.29:1 on bg / 4.01:1 in alert; dark 3.51–3.9:1 | `index.css:262` `.btn--danger`, `:344` `.alert` | Separate `--danger-text` token per theme |
| R7 | Ghost buttons / active tab-bar link in light mode | 3.97:1 on `--bg`, 4.43:1 on card | `index.css:267` `.btn--ghost`, tab bar `.active` | Same darker accent text token as R4 |
| R8 | Board coordinate labels in light mode use `--muted` on the dark sea frame | 2.36–3.16:1 (calc.) | `index.css:812` `.board .label` | Use a fixed light label colour on the sea frame (e.g. `#c9d6e5`) |
| R9 | Commentary/chat toggle sits above open dialogs at 375px (z-index 31 > backdrop 30) and overlaps "Yes, resign"; it is also outside the trap's reach but still clickable | Screenshot, 375 dark | `index.css:537` vs `:1148` | Lower the toggle's z-index below `.modal-backdrop`, or hide it while a dialog is open |

### Medium

| # | Issue | File:line | Suggested fix |
| --- | --- | --- | --- |
| R10 | `.modal` reuses `toast-in`, whose `translate(-50%, 12px)` slides the dialog half off-screen to the left during the 200ms entry (seen at 375px with motion on: modal left edge at −143px). Not an overflow at rest | `index.css:1165`, keyframe `:687` | Give the modal its own `translateY`-only keyframe |
| R11 | No `<main>` landmark and no skip link → axe `landmark-one-main`/`region` on every page; sign-in has no `<h1>` (`.brand` is a div) | `web/src/App.tsx` (router), `SignInPage.tsx:66` | Wrap routed content in `<main>`; make `.brand` an `h1` (needs a style check) |
| R12 | Accessible name doesn't contain the visible label (axe `label-content-name-mismatch`): rating badge "Your rating" vs the number; difficulty buttons "Play vs computer on easy" vs "Easy …" | `HomePage.tsx:91`, `:221` | Start the aria-label with the visible text, e.g. "Easy — play vs computer", or drop the aria-label |
| R13 | Non-text contrast of cell marks against water (WCAG 1.4.11, 3:1): miss dot 1.40 (light) / 1.30 (dark); hit 2.10 (light); sunk 1.20 (dark). Focus ring on sunk (light) 1.67 and on hit/ship (dark) 2.4–2.7 | `index.css:873-890` cell marks, `:868` `.cell:focus-visible` | Add a contrasting stroke/glyph to miss/hit/sunk; use a two-tone focus ring (outline + inner shadow) |
| R14 | Buttons/links have no explicit `:focus-visible` style (only `.input`, `.cell`, `.game-mode-option`); they rely on the browser's default ring | `index.css` (~`:227` `.btn`) | Add `.btn:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px }` |
| R15 | Opening chat doesn't move focus into the panel, and Escape doesn't close it | `GameChat.tsx:72-135` | Focus the close button or input on open; Escape closes and returns focus to the toggle. Not Phase 2-owned, but held back as a behaviour change for lead review |
| R16 | Toast is mounted with its text, which some screen readers don't announce reliably | `ui.tsx` `Toast` + `index.css:473` | Render a persistent empty live region and swap text into it (needs a CSS wrapper) |
| R17 | Input borders 1.35:1 against card | `index.css:288` `.input` | Use `--muted` for input borders |

### Low / informational

- Haptics are not gated by reduced motion or mute (`audio/index.ts:49-60`). Vibration isn't motion, so this is fine under WCAG,
  but see open decision D2.
- Placement by keyboard works through the same Enter → `onCellTap` path (select a ship chip, then Enter on water). There is no
  keyboard rotate shortcut; the "Rotate …" button is reachable by Tab.
- Fog of war keeps cell names accurate (names come from `markOf`, not from the fog layer).

## Open decisions for the lead

- **D1** Contrast token changes (R4–R8) change every screen's pixels and so need a planned visual-baseline refresh. Do them in one Phase 4 pass after Phase 2 lands in `index.css`?
- **D2** Should haptics follow mute and/or reduced motion, or get their own toggle?
- **D3** For R1, which is preferred: return focus to the fired cell, or keep focus on the Fire button and leave it enabled-but-inert while busy?
- **D4** Should `e2e/a11y.spec.ts` stay in the default `npm run visual-qa` run, or move behind its own script (e.g. `npm run a11y-qa`)?
