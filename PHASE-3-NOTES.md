# Phase 3 notes: async multiplayer

Contract tag: `phase-3-contract` ([docs/PHASE-3-CONTRACT.md](docs/PHASE-3-CONTRACT.md)). Audit: [docs/PHASE-3-AUDIT.md](docs/PHASE-3-AUDIT.md). QA matrix: [docs/PHASE-3-QA.md](docs/PHASE-3-QA.md).

## What shipped

- **Turn timer (optional, server-authoritative).**
  - Off by default. Friend games and challenges can pick 60 s or 2 min at creation, and rematches copy the setting. Bot games and Quick Match never have a timer.
  - The server stores `turnDeadline`. When it passes (plus a 2 s grace period), the turn is skipped through the core `skipTurn` action.
  - Skips are triggered by `claimTurnTimeout`, which either client calls when its countdown expires. As a backstop, `sweepExpiredTurns` runs every 5 minutes.
  - Both paths are transactional and idempotent: calls that arrive too early, or more than once, do nothing.
  - Three consecutive skips by the same player forfeits with `endReason: 'timeout'`. Any real move resets that player's streak.
  - The countdown in the game header is display-only. It corrects for clock skew using server timestamps, turns urgent under 10 s, announces 30 s and 10 s through `aria-live`, and recalculates when the tab regains focus.
  - Timed games hide the 3-day "Inactive opponent" claim. Untimed games keep it.
- **Guest play (Firebase Anonymous Auth).**
  - Invite links offer "Play as guest". The guest picks a username and plays.
  - The server decides guest status from the Auth record, never from the client: `isGuest: true`, `leaderboardVisible: false`.
  - Guests can play bots, join and create friend games, accept challenges and rematch. The server rejects guests for Quick Match and for sending challenges, and the UI hides both.
  - Any human game that involves a guest is unrated: Elo, weekly wins and opponent history don't change.
  - Profile has a "Save your account" option (email/password or Google). It links the credential to the same UID, then `completeGuestUpgrade` clears `isGuest` and restores leaderboard visibility unless the account is suspended.
  - Credential conflicts show a clear message.
  - Signing out as a guest asks for confirmation first, because the guest profile can't be recovered afterwards.
- **Notifications.**
  - Every game push in Salvo or Abilities gets a mode suffix. Classic copy is unchanged.
  - Salvo pushes summarise the whole volley ("fired 4 shots: 2 hits, sank your Cruiser").
  - Ability pushes describe only public results: airstrike hits and misses, "scanned near C4", "moved a ship". They never reveal fleets or relocate destinations.
  - Other pushes: timer skips ("ran out of time"), a forfeit on the third skip, and challenge accepted or declined (sent to the challenger).
  - The service worker routes `gameId` pushes to the game, and challenge-only pushes to Home.
- **Turn reminders.**
  - At most one reminder per pending turn, for active human games without a timer, sent after 24 h idle.
  - `turnReminders` runs hourly and re-checks each game in a transaction that sets `remindedTurn`. It pushes only after the transaction commits, and skips players with no push token.
- **Push opt-in prompt.** Shown on the results screen of a finished game, only when push is available, permission hasn't been decided and push isn't already on. "Not now" is remembered.
- **Reconnect and session recovery.**
  - Reloading or reopening a tab resumes waiting, placing, active and finished games with the same board and turn.
  - Listeners are scoped to the current user, so there are no duplicate toasts, sounds or sink banners.
  - Reopening a finished game more than 5 s after it ended doesn't replay the results animation or the end sound.
  - An in-progress Quick Match search comes back after a reload. If a match was already found, the player goes straight to the game.
- **Invites.** Share text names the mode and timer for non-Classic or timed games.
- **Local test safety.** Emulator tests default to the `demo-broadside` project and start the Auth and Firestore emulators.

## Reused, not rebuilt

Existing push delivery (`deliver`, FCM tokens, `enablePush`), challenge and rematch flows, the 3-day abandon claim, `endGameByRule` and the rating pipeline, the Phase 0 core reducer (new `skipTurn` action only), Phase 1 FX and audio, Phase 2 mode badges and pickers, and the security rules that hide fleets.

## Decisions

- Email fallback is deferred. No email provider was added.
- No manual "nudge" button. The nudge is the automatic 24 h reminder. The 3-day claim remains for untimed games.
- Anonymous-account auto clean-up in Firebase is left off, so returning guests can still upgrade.
- A timer forfeit returns `{ skipped: true, forfeited: true }`.
- The sonar push names the scan area but not the yes/no result.

## Limitations

- On a timer forfeit, `timeoutStreak` for the losing player stays at 2, because `endGameByRule` doesn't write extra fields. `endReason: 'timeout'` is authoritative.
- If neither client is open, a timed turn can run up to about 5 minutes past its deadline before the sweep skips it.
- The push opt-in prompt and real push delivery can't be exercised under emulators, because `pushAvailable()` is false there. They're covered by unit tests only.
- Google account linking was tested in unit tests and by code review only. Email/password linking was tested in a browser.
- CI doesn't run the Functions emulator suite. It runs locally with `npm --prefix functions run test:emulator`, which needs Java 21.
- iOS is unchanged.

## Deferred

Email fallback, Phase 4 (accessibility and responsive work), and Phase 5 (stats and retention).

## Verification

- **Functions:** lint, typecheck, and 234 unit tests with the coverage gate passing (92.1% statements, 83.5% branches).
- **Emulator** (Auth + Firestore, `demo-broadside`): 207 tests, 0 failures. Includes the Phase 3 integration suite (challenges, Quick Match partitioning, rematch mode and timer, timer skip, idempotency, three-skip forfeit, guest guards, unrated guest games, notification transitions, one reminder per turn) and all Phase 2 Classic, Salvo and Abilities tests unchanged.
- **Web:** lint, typecheck, 219 unit tests and build.
- **Playwright** `web/e2e/reconnect.spec.ts`: 2 passing.
  - Reload and tab close/reopen across lifecycle states.
  - Quick Match search resumes after reload, and stays closed after cancel and reload.
- **Browser acceptance on emulators**, at 1280px with two players and at 375px for guests:
  - Timed Salvo friend game with invite join, several volleys, countdown, expiry skip and three-skip forfeit.
  - Rematch keeps Salvo and the 60 s timer.
  - Reloading a finished game doesn't replay FX or the end sound.
  - Guest join, restrictions, unrated result, email upgrade keeping UID and history, and the duplicate-email message.
  - The opponent's fleet is unreadable, and the relocate destination isn't exposed.
  - Home pickers fit at 375px and 1280px.
  - Found on the first run and fixed in `4011cb9`: Quick Match resume after reload broke under React StrictMode. Re-verified by the Playwright case above.
