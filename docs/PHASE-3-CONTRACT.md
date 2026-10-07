# Phase 3 contract — async multiplayer

Source of truth for Phase 3 sessions. Tagged `phase-3-contract`. Builds on `phase-2-complete`.

## Decisions (Luke, 2026-10-07)

- **Guest play: yes.** An invite link offers "Play as guest" (Firebase anonymous auth). A guest picks a username and plays. They can upgrade later (link email/password or Google), which keeps the same uid and therefore their history.
  - Guests are hidden from leaderboards.
  - Guests cannot use Quick Match or send challenges.
  - Games involving a guest are **unrated**: stats are recorded, but rating, weekly wins and the opponents list are not touched.
- **Turn timer:** off by default.
  - 60 s or 120 s, chosen when creating a friend game or challenge. Rematches copy it. Bot and Quick Match games never have one.
  - On expiry the turn is **skipped**. 3 consecutive skips by the same player forfeits the game (`endReason: 'timeout'`).
  - Untimed (async) games keep the existing 3-day claim, plus **one** reminder push per pending turn after 24 h idle.
- **Email fallback: deferred.** Push only for now.

## Data

`functions/src/types.ts`; mirror in `web/src/lib/types.ts`, read with defaults in the web mappers. All new fields are optional so old docs and iOS keep decoding. `EndReason` is unchanged.

```ts
UserDoc.isGuest?: boolean              // true while the auth account is anonymous
GamePlayer.isGuest?: boolean           // copied from UserDoc when the player is added
GameDoc.isRated?: boolean              // set when the 2nd player joins; absent ⇒ rated unless isBotGame
GameDoc.turnTimerMs?: number | null    // null/absent = off; one of TURN_TIMER_OPTIONS_MS; immutable
GameDoc.turnDeadline?: Timestamp | null// active + timer on: lastMoveAt + turnTimerMs; else null
GameDoc.timeoutStreak?: Record<string, number> // consecutive skipped turns; reset when that uid moves
GameDoc.remindedTurn?: number | null   // turnNumber for which the 24 h reminder was sent
ChallengeDoc.turnTimerMs?: number | null
```

`GAME_CONFIG` additions:

```ts
TURN_TIMER_OPTIONS_MS: [60_000, 120_000]
TURN_TIMEOUT_FORFEIT_STREAK: 3
TURN_TIMEOUT_GRACE_MS: 2_000
TURN_REMINDER_AFTER_MS: 24 * 60 * 60 * 1000
```

## Pure helpers — `functions/src/game/timers.ts`

```ts
parseTurnTimerInput(v: unknown): { ok: true; value: number | null } | { ok: false }  // undefined/null → null
turnDeadlineFor(turnTimerMs: number | null | undefined, now: Timestamp): Timestamp | null
isTurnExpired(game: Pick<GameDoc, 'status' | 'turnDeadline'>, nowMs: number): boolean   // active && now >= deadline + grace
```

## Core

The reducer gains one action that doesn't depend on mode:

```ts
{ type: 'skipTurn'; player: string }
```

- Requires `phase === 'playing'`.
- Requires `currentTurn === player` and `player` not a bot.
- Effect: the turn passes to the opponent, `turnNumber + 1`, and a `turnChanged` event is emitted.
- Streaks and the forfeit are handled by the server handler, not the core.

## Server write sites

- `newGameDoc(..., opts.turnTimerMs)` initialises the timer fields as follows:

  | Field | Initial value |
  |---|---|
  | `turnTimerMs` | `?? null` |
  | `turnDeadline` | `null` |
  | `timeoutStreak` | `{}` |
  | `remindedTurn` | `null` |
- `playerEntry` copies `isGuest`.
- `joinUpdate` sets `isRated = !game.isBotGame && !hostEntry.isGuest && !user.isGuest`.
- Where the timer value comes from:
  - `createGame` and `createChallenge` accept `turnTimerMs`. Invalid → `invalid-argument`.
  - Challenge accept passes it through.
  - `requestRematch` copies it from the source game (null for bot games).
  - Quick Match and bots: null.
- Every write of `currentTurnUid` on an active game also writes `turnDeadline = turnDeadlineFor(game.turnTimerMs, now)`. Every fire, salvo or ability by `uid` writes `timeoutStreak.<uid> = 0`.
- `finishGame` writes `turnDeadline: null`.
  - For a non-bot game with `isRated === false`: `ratingChanges: null`; both users get `stats` (via `applyGameToStats`) and `lastGameAt`; no rating, weekly-wins or opponents writes.
- `claimTimeoutWin` uses `game.abandonTimeoutMs ?? GAME_CONFIG.ABANDON_TIMEOUT_MS`.
- `endGameByRule` is exported for the timer handler.

## Endpoints and schedules

Stubs and exports are in place; each child fills in its own.

| Export (`functions/src/index.ts`) | Implementation | Owner |
|---|---|---|
| `claimTurnTimeout = active(...)` | `handlers/timers.ts` `claimTurnTimeout(uid, { gameId })` → `{ skipped, forfeited }` | C |
| `sweepExpiredTurns` (every 5 min) | `handlers/timers.ts` `sweepTurnTimeouts(now?)` → count | C |
| `turnReminders` (every 60 min) | `triggers/reminders.ts` `sendTurnReminders(now?)` → count | A |
| `completeGuestUpgrade = authed(...)` | `handlers/guests.ts` `completeGuestUpgrade(uid)` → `{ isGuest }` | B |
| `onChallengeUpdated = onDocumentUpdated('challenges/{challengeId}')` | `triggers/notifications.ts` `notificationsForChallengeUpdate(id, before, after): Notification[]` (stub returns `[]`), then `deliver()` | A |

Web API (`web/src/lib/api.ts`):
- `createGame(mode, turnTimerMs?)`
- `createChallenge(..., turnTimerMs?)`
- `claimTurnTimeout(gameId)`
- `completeGuestUpgrade()`

## Indexes

`games (status ASC, turnDeadline ASC)` and `games (status ASC, lastMoveAt ASC)`.

## Security rules

No rule changes. Anonymous users count as `signedIn()`, and every rule keys on the uid. Rules tests cover an anonymous-auth player: they can read their own game and their own private board, but never the opponent's private board.

## Manual step

Firebase console → Authentication → enable **Anonymous** for broadside-dev (see MANUAL_STEPS.md). The emulators need nothing.

## Ownership

Four child sessions, per Luke's split from 2026-10-07. Each child works on its own branch from `phase-3-contract`, adds tests, and merges nothing.

**Nobody edits:** the reducer, `modes/`, `events.ts`, this file, `RULES.md`, `functions/src/types.ts`, `GAME_CONFIG`, `games.ts`, `finishGame.ts`, `index.ts`, `ActiveGameView.tsx`, `GamePage.tsx`, rules, iOS, workflows, or visual baselines.

**Lead:** this contract and the integration work:
- wiring `TurnTimer` into `ActiveGameView`
- adding `TurnTimerPicker` to Home's friend-game creation
- the two-browser invite → play → nudge → rematch test
- the 375 px and desktop smoke checks
- `PHASE-3-NOTES.md`

**A — Notifications and invitations**
- Files:
  - `triggers/notifications.ts` (+test)
  - `triggers/reminders.ts` (+test)
  - `functions/test/reminders.test.ts`, `functions/test/notifications.emulator.test.ts`
  - `web/public/push-sw.js`
  - `web/src/lib/push.ts`
  - new `web/src/components/PushOptIn*`
  - `web/src/pages/game/ResultsView.tsx` (mounting the prompt only)
  - `web/src/pages/game/WaitingView.tsx` (invite share copy only)
- Mode label in game pushes.
- Turn pushes for Salvo, Abilities and turn skips.
- Challenge accepted and declined pushes.
- Challenge pushes open Home.
- 24 h reminder, at most one per turn.
- Opt-in prompt after the first finished game.

**B — Reconnect, session recovery and guests**
- Files:
  - `handlers/users.ts`, `handlers/guests.ts`
  - guest guards in `handlers/quickMatch.ts` and in `handlers/challenges.ts` (`createChallenge` sender only)
  - `functions/test/guests.test.ts`
  - `web/src/state/SessionProvider.tsx`, `web/src/state/ActiveGamesProvider.tsx`
  - `web/src/pages/{SignInPage,JoinPage,UsernamePage,ProfilePage,HomePage}.tsx`
  - `web/src/pages/game/{WaitingView,PlacementView}.tsx` (listener and resume fixes only)
  - new `web/src/state/guest*` and `web/src/state/resume*`
  - new `web/e2e/reconnect.spec.ts`
- Resume works after a reload in every state: waiting, placing, active, finished.
- No duplicate listeners, sounds or toasts after a reconnect.
- Quick Match search resumes after a reload.
- Guest sign-in, upgrade and guards.
- Hide Quick Match for guests.

**C — Turn timer**
- Files:
  - `handlers/timers.ts`, `functions/test/timers.test.ts`
  - new `web/src/components/TurnTimer*`, `web/src/components/TurnTimerPicker*`, `web/src/game/turnTimer*`
  - `web/src/components/ChallengeButton.tsx`, `web/src/components/AbandonControls.tsx`
- `claimTurnTimeout` and the sweep.
- A countdown for display only, driven by `turnDeadline` and corrected for clock skew.
- A clear visual difference between the turn timer, the 3-day abandon timer and a finished game.
- Pickers.
- Hide challenges for guests.

**D — Integration and regression QA**
- Files: new `functions/test/phase3.integration.test.ts`, new `web/src/**/*.phase3.test.ts(x)`, `docs/PHASE-3-QA.md`.
- Tests only, covering:
  - challenge create, accept and decline with the mode preserved
  - Quick Match split by mode
  - rematch keeps mode and timer
  - reconnect and resume
  - timeout behaviour
  - transitions that should trigger a notification
- Baseline counts.
- Tests written against the contract may fail until A, B and C land.
