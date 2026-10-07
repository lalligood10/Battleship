# Phase 3 QA — integration and regression (Child D)

Branch `devin/phase-3-d-qa`, cut from tag `phase-3-contract` (`e2e6eea`). Tests and docs only; no production code changed.

## Baseline on `phase-3-contract`

| Suite | Command | Result |
| --- | --- | --- |
| Functions unit + coverage | `cd functions && npx vitest run --coverage` | 19 files, 209 passed. Coverage: statements 91.63% (843/920), branches 83.33% (495/594), functions 98.6% (212/215), lines 95.24% (681/715). Gate passes. |
| Functions emulator | `cd functions && npm run test:emulator` | 6 files, 136 passed, 0 failed |
| Web unit | `cd web && npx vitest run` | 25 files, 167 passed |
| Headless sim | `cd functions && npm run sim` | 1 file, 4 passed |

Simulation per mode (1,000 games each):

| Mode | Avg turns | Avg shots | Rejected illegal actions | Notes |
| --- | --- | --- | --- | --- |
| Classic | 116.62 | 116.62 | 11,821 | |
| Salvo | 43.61 | 172.03 | 4,378 | |
| Abilities | 116.99 | 116.98 | 11,702 | ability uses: carrier-airstrike 1,970, submarine-sonar 1,938, destroyer-relocate 1,784 |

## After this branch

| Suite | Result |
| --- | --- |
| Functions lint / typecheck | clean (`npm run lint`, `npm run typecheck`; typecheck includes `test/`) |
| Functions unit + coverage | 19 files, 209 passed; coverage unchanged (new file is emulator-only) |
| Functions emulator (all) | 7 files, 181 tests: 164 passed, 17 failed. The 17 failures are all in `phase3.integration.test.ts` and all marked `// depends on Child X` (below). The existing 136 still pass. |
| `phase3.integration.test.ts` alone | 45 tests: 28 passed, 17 failed (expected) |
| Web lint / typecheck / build | clean (lint has only pre-existing `set-state-in-effect` warnings) |
| Web unit | 28 files, 187 passed (167 existing + 20 new) |

Emulator runs for this branch used `firebase emulators:exec --only firestore --project demo-broadside` with `GCLOUD_PROJECT=demo-broadside`, calling vitest directly with `--config vitest.emulator.config.mts`.

No existing test file changed: `git diff --stat phase-3-contract` lists only the new files below. Classic, Salvo, and Abilities tests and sims are untouched and pass.

## New files

- `functions/test/phase3.integration.test.ts` (emulator; real handler calls)
- `web/src/lib/firestore.phase3.test.ts`: legacy/Phase 3 game, challenge, and profile mapping for all three modes
- `web/src/game/events.phase3.test.ts`: skipped turns emit only `turnChanged`, timer bookkeeping emits nothing, timeout forfeit emits one `gameOver`, reconnect replays nothing
- `web/src/lib/api.phase3.test.ts`: callable names and payloads (`createGame`, `createChallenge`, `joinQuickMatch`, `claimTurnTimeout`, `claimTimeoutWin`, `completeGuestUpgrade`)

## Integration coverage (passing on the contract branch)

- Challenges: create → accept keeps mode and `turnTimerMs` for each mode/timer pair; players, invite, and placement state are correct; decline creates no game or join code; responding again after decline is rejected; cancel is honoured.
- Quick Match: only same-mode tickets pair; a different-mode ticket keeps waiting; the paired game is untimed even when a timer is sent.
- Rematch: keeps mode, `turnTimerMs`, and opponent for invite, challenge, and Quick Match sources.
- Reconnect/idempotency: re-reading the game and both private boards mid-game gives identical docs and an equal core state; a duplicate `fireShot` is rejected and changes no shots, turn, deadline, or streak.
- Timeouts: untimed games are never skipped; 3-day `claimTimeoutWin` still works on timed and untimed games; a missing `abandonTimeoutMs` falls back to 3 days.
- Notifications (`notificationsForChange` / `notificationForChallenge` on before/after docs read around real handler calls): join, ready, battle start, turn change, finish, and rematch recipients and `gameId`; challenge creation recipient and `challengeId`; no body contains a coordinate that isn't already public.
- Guests: guest games are written with `isRated: false`; resign and all-sunk finishes leave both ratings unchanged, update stats, and write no weekly wins or opponent history.

## Expected failures (depend on Child A/B/C)

These fail on `phase-3-contract` because the handler is a stub. They are not skipped.

| Test (`phase3.integration.test.ts`) | Depends on | Failure on contract |
| --- | --- | --- |
| reconnect and idempotency > a repeated turn-timeout claim skips the turn only once | C | `claimTurnTimeout` unimplemented |
| turn timeouts > an expired turn is skipped: turn passes, deadline restarts, no shot is recorded | C | unimplemented |
| turn timeouts > does not skip a turn before deadline + grace | C | unimplemented (expects `failed-precondition`) |
| turn timeouts > the third consecutive skip forfeits a rated game with endReason timeout | C | unimplemented |
| turn timeouts > a move by the stalling player resets their streak | C | unimplemented |
| turn timeouts > skips work the same in salvo | C | unimplemented |
| turn timeouts > skips work the same in abilities | C | unimplemented |
| turn timeouts > the scheduled sweep skips expired timed turns and ignores untimed games | C | `sweepTurnTimeouts` returns 0 |
| guest games are unrated > a timeout forfeit involving a guest is unrated | C | unimplemented |
| notification-triggering transitions > a skipped turn pushes the new shooter without describing a stale shot | A + C | unimplemented |
| notification-triggering transitions > a Salvo volley sends one turn push that summarises the whole volley | A | body describes only the last shot (`fired at H10 and missed.`) |
| notification-triggering transitions > an Abilities sonar turn pushes the opponent without describing a shot | A | body is `fired at  and missed.` (empty coordinate) |
| notification-triggering transitions > an accepted challenge pushes the challenger with the new game | A | `notificationsForChallengeUpdate` returns `[]` |
| notification-triggering transitions > a declined challenge pushes the challenger with no game | A | returns `[]` |
| notification-triggering transitions > sends at most one 24 h reminder per pending untimed turn | A | `sendTurnReminders` returns 0 |
| guest games are unrated > a guest cannot join Quick Match | B | no guest guard; call succeeds |
| guest games are unrated > a guest cannot send a challenge | B | no guest guard; call succeeds |

Once A, B, and C land, all 45 tests in the file should pass.

## Findings and deviations

- Existing defect: on an Abilities turn (sonar) the turn push body reads `P3Alice fired at  and missed.` because there is no new shot to describe. This is in `functions/src/triggers/notifications.ts`, which belongs to Child A. Covered by the Abilities notification test above.
- `npm run test:emulator` uses the `.firebaserc` default project (`broadside-dev`) against the local emulator, and `functions/test/setup.ts` defaults `GCLOUD_PROJECT` to `broadside-dev`. The baseline emulator count came from that script. All runs of the new tests used `demo-broadside` explicitly. No production credentials were used. If the lead wants `demo-broadside` everywhere, the script and setup need changing, and both are outside this allowlist.
- Assumptions in the Child C tests that the lead should confirm: skip rejection before deadline + grace is `failed-precondition`; a non-player calling `claimTurnTimeout` gets `permission-denied` or `not-found`; a skip returns `{ skipped: true, forfeited: false }` and the third returns `{ skipped: true, forfeited: true }`.
- Guest guard tests accept any `HttpsError` code, because the contract doesn't fix one.
