# Bugs found and fixed

Broadside was built in small PRs, and every PR was tested in a real browser against the Firebase
emulators before merge. This page lists the real defects that turned up along the way: what the
symptom was, why it happened, how it was fixed, and how the fix was checked. Every entry links to
the commit or PR, so you can check it against the code.

| Area | Bugs | Status |
| --- | --- | --- |
| Deploy / live site (web ahead of backend, CI secrets) | 3 | 2 fixed in code; 1 still open, needs an IAM role granted by the owner (#1) |
| Game server & stats (rematch notifications, percentages) | 2 | Fixed, with unit tests |
| Game UI & animation (jet passes, carrier strike, results timing, mobile toast) | 5 | Fixed, checked in the browser |

The three most interesting are first.

---

## 1. The live site calls server functions that were never deployed

**Symptom.** On https://broadside-dev.web.app, "Play vs Computer" first failed completely
([PR #10](https://github.com/lalligood10/Battleship/pull/10)). Later, while I was
smoke-testing for this write-up, **Play again** on the results screen failed with "Something went
wrong on the server". The browser console shows a CORS preflight error for `requestRematch`.

**Root cause.** Hosting and the backend deploy separately. Every merge to `main` redeploys the web
bundle. The Cloud Functions and Firestore rules/indexes only change when someone deploys the
backend, so the web app can end up calling functions that don't exist yet. A missing callable
returns a 404 without CORS headers, and the browser reports that as a CORS failure:

```
OPTIONS …/createBotGame  -> 204   (deployed)
OPTIONS …/requestRematch -> 404   (added in PR #18, never deployed)
OPTIONS …/sendReaction   -> 404   (added in PR #21, never deployed)
```

**Fix.**
- [PR #10](https://github.com/lalligood10/Battleship/pull/10) added
  `.github/workflows/firebase-deploy-backend.yml`, which deploys functions and rules on merge. It
  also maps `functions/not-found` to a friendly "server is running an older version" message.
- **Still open.** Every run of that workflow has failed on permissions. The first run (Sept 24)
  failed on `iam.serviceAccounts.ActAs`. The runs for PRs #16, #18, #21 and #23 (Sept 28) all
  failed with `403 The caller does not have permission` on
  `firestore.googleapis.com/…/collectionGroups/reactions/indexes`. The CI service account was
  created for Hosting only. The fix is an IAM grant (Cloud Datastore Index Admin, plus the roles
  listed in README §3f) followed by a re-run of the workflow. This PR adds the missing role to
  README §3f and MANUAL_STEPS.

**How it was verified.** I sent `curl -X OPTIONS` requests to each callable on the live project
(results above), read the failed Actions logs (`gh run view --log-failed`), and reproduced the
failure in the recorded smoke test for this PR.

## 2. The inbound jet restarted mid-flight on every computer shot

**Symptom.** Every time the computer fired, two jet passes appeared on your board. The first one
was cut off at about 1.0 s and a new one started.

**Root cause.** It was a React identity bug. For vs-computer games, the computer's reply is held
back for 1000 ms while an "inbound" overlay plays. That overlay (`key="p{n}"`) and the result
overlay (no key) were different component instances. The result state was also set by a second
effect that ran one render later. So the overlay unmounted for one frame and mounted again, which
restarted the 1.1 s jet animation.

**Fix.** [e0bd695](https://github.com/lalligood10/Battleship/commit/e0bd695)
([PR #22](https://github.com/lalligood10/Battleship/pull/22)). The reveal and the result fx are
now set together in one batched `reveal()`, and both overlays are keyed by the target cell. The
same instance changes phase instead of remounting.

**How it was verified.** I found it while re-testing merged `main` against the emulators. After
the fix, I checked against real computer replies that the jet flies once and the splash or burst
appears underneath it.

## 3. A second rematch request never notified the opponent

**Symptom.** If a rematch invite expired or was cancelled and the player asked again, the
opponent got no "X wants a rematch" notification.

**Root cause.** In `functions/src/triggers/notifications.ts`, the trigger only fired when
`rematch` went from *unset* to *set* (`!before.rematch && after.rematch`). A new request replaces
an existing `rematch` pointer with a new `gameId`, so the condition was false.

**Fix.** [f25487d](https://github.com/lalligood10/Battleship/commit/f25487d)
([PR #18](https://github.com/lalligood10/Battleship/pull/18)). The trigger now notifies whenever
`after.rematch.gameId !== before.rematch?.gameId`. Updates that keep the same pointer still send
nothing, and bots are never notified.

**How it was verified.** A new case in `notifications.test.ts` replaces the pointer and expects
one notification. The existing "same pointer → no notification" assertion still passes.

---

## 4. Win / accuracy percentages above 100%

- **Symptom:** When stats were inconsistent (for example `hits > shotsFired`), the profile could
  show accuracy like 120% ([issue #14](https://github.com/lalligood10/Battleship/issues/14)).
- **Root cause:** `winPercentage` and `accuracyPercentage` divided without clamping. They only
  handled a denominator of exactly 0.
- **Fix:** [d58e03d](https://github.com/lalligood10/Battleship/commit/d58e03d)
  ([PR #16](https://github.com/lalligood10/Battleship/pull/16)) added a shared
  `percent(n, d)` in `functions/src/game/scoring.ts`. It returns 0 for non-positive or NaN
  denominators and clamps the result to 0..100. The web app imports the same file (`@shared`),
  and iOS has the same clamp.
- **Verified:** New unit tests cover clamping, rounding (2/3 → 66.7), zero and negative
  denominators, and negative numerators.

## 5. The victory flypast was cut off before it finished

- **Symptom:** On the win screen, the jet disappeared partway across.
- **Root cause:** PR #11 slowed the results flypast from 1.6 s to 2.6 s, but `ResultsView.tsx`
  still removed the fx after 2000 ms.
- **Fix:** [c69c0ba](https://github.com/lalligood10/Battleship/commit/c69c0ba)
  ([PR #11](https://github.com/lalligood10/Battleship/pull/11)) changed the timeout to 2700 ms.
- **Verified:** In the browser, before the fix the fx was removed at 2018 ms while still at
  opacity 1. After the fix, `animationend` fired at 2.6 s and the fx was removed at 2714 ms at
  opacity 0.

## 6. The strike jet missed its target column

- **Symptom:** The jet that flies to the targeted cell stopped in the wrong column, and the error
  changed with board size.
- **Root cause:** The keyframes used `translateX(%)` on a 34 px-wide jet element. Percentages in
  `translateX` are relative to the element itself, not the board.
- **Fix:** [44f5251](https://github.com/lalligood10/Battleship/commit/44f5251)
  ([PR #7](https://github.com/lalligood10/Battleship/pull/7)). The animation now runs on a
  full-width `.strike-jet-path` track, so percentages are relative to the board. The jet is
  positioned with `margin-left: calc(var(--tx) - 6%)`.
- **Verified:** Screenshots at 390 px width against the emulators show the jet centred on the
  target column at the 55% keyframe.

## 7. Carrier strike: wrong layering, flipped vertical axis, early sink

- **Symptom:** The sinking carrier was drawn on top of the bomb and jet. On vertical carriers the
  jet flew down the wrong side of the board. The hull started sinking before the bomb landed.
- **Root cause:** `<SinkingShip>` was rendered after the strike layers, so it painted on top. The
  vertical rig used `rotate(90deg)`, which put the track's `top` on the mirrored column. The sink
  delay (0.9 s) came before the burst (0.8 s + 0.5 s).
- **Fix:** [62213ab](https://github.com/lalligood10/Battleship/commit/62213ab)
  ([PR #9](https://github.com/lalligood10/Battleship/pull/9)). The ship now renders first, the
  vertical rig uses `rotate(-90deg)`, and the timeline is burst at 0.75 s, then sink at 1.0 s.
- **Verified:** Browser recordings against the emulators, sinking a horizontal carrier (the
  computer's) and a vertical one (mine).

## 8. PR checks failed before the deploy secret existed

- **Symptom:** Before the Firebase service-account secret was added, every PR showed a red X with
  `Input required and not supplied: firebaseServiceAccount`.
- **Fix:** [176da63](https://github.com/lalligood10/Battleship/commit/176da63)
  ([PR #2](https://github.com/lalligood10/Battleship/pull/2)). The hosting workflows (and later
  the backend deploy) check the secret first. If it's missing they skip the deploy and log a
  warning that links to the setup docs. [d1e2711](https://github.com/lalligood10/Battleship/commit/d1e2711)
  updated the troubleshooting doc to match.

## 9. On phones, the "Computer fired at …" toast covered the Fire button

- **Symptom:** In the reviewer smoke test at 375×667, the toast announcing the computer's shot
  appeared right on top of the Fire / aim button, exactly when it became your turn again. The
  recording shows only that the toast was in the way. That it could block taps comes from the CSS
  below.
- **Root cause:** `.toast` is a fixed-position layer (`z-index: 20`) 96 px above the bottom of the
  screen. It still received pointer events, so a tap on the part of the button it covered went to
  the toast instead.
- **Fix:** In this PR, `.toast` is now `pointer-events: none`. Toasts are only there to be read,
  so taps pass through to the button underneath.
- **Verified:** Screenshot from the recorded smoke test (in the PR). Web lint, typecheck, tests
  and build all pass.

---

## Designed out before merge

These came up during design or review, so they never shipped. They're listed because they are
game-integrity issues rather than cosmetic ones:

- **Forfeit exploit via rematch** ([PR #18](https://github.com/lalligood10/Battleship/pull/18)).
  If a human rematch went straight to ship placement, the requester could `claimTimeoutWin` a
  *rated* game against an opponent who never agreed to play. Rematches now start as `waiting`
  until the other player accepts, and only the invited uid can join.
- **Quick Match that never pairs** ([PR #23](https://github.com/lalligood10/Battleship/pull/23)).
  With rating bands, two waiting players more than 100 points apart would never be matched,
  because pairing only happens when someone calls `joinQuickMatch`. Tickets now keep their
  original `createdAt`, so the band keeps widening, and the client calls again every 15 s. Cancel
  waits for any call still in flight, so it can't recreate the ticket.
- **Reaction rate limit** ([PR #21](https://github.com/lalligood10/Battleship/pull/21)). Storing
  `lastReactionAt` on `private/{uid}` would have created that document before ships were placed,
  and the web app treats any snapshot of it as the player's board. The rate limit uses a query on
  the reactions subcollection instead.

## Known limitations / next steps

- **Web and backend deploys aren't linked.** Until the CI service account has the missing IAM
  role, Rematch/Play again, quick-chat reactions and rating-banded Quick Match exist in the web
  bundle but not on the live server. Next step: grant the role, re-run *Deploy Cloud Functions
  and Firestore rules*, and consider making the Hosting deploy wait for a successful backend
  deploy.
- **A missing function shows a generic error.** Because a missing callable fails as a CORS
  error, the browser SDK reports `functions/internal`, not `not-found`. Users see "Something went
  wrong on the server" instead of the "older version" message.
- **Games against the computer don't affect your rating (by design).** Your rating stays at 1000
  and the results go into a separate `botStats`. The Profile page doesn't show `botStats`, so after
  beating the computer a new player sees 0 wins, 0 played and 0% accuracy next to a "W" in their
  history. Next step: label those totals "Rated", or add a row for games against the computer.
- **Sign-in is required before playing.** There is no guest mode.
- **iOS app (`ios/`) is on hold.** It isn't compiled in CI because it can't build on Linux.
- **The web bundle is one chunk of about 900 kB (270 kB gzipped).** Code splitting would make
  the first load faster on phones.
