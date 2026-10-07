---
name: testing-local-battleship
description: Run Broadside browser tests against matching Firebase emulators and verify real gameplay, retention progression, and privacy.
---

## Local services
- Requires Node 22 and Java 21. Install both workspaces with root `npm run setup`.
- Start root `npm run emulators`; it builds Functions and explicitly uses `demo-broadside`.
- Start `npm run dev:local -- --host 0.0.0.0` in `web/`.
- Keep the frontend and emulator project IDs aligned. The Functions `serve` script may use the default cloud project instead; prefer the root emulator script.
- Auth, Firestore, and Functions run on ports 9099, 8080, and 5001. Open the Vite URL and create an emulator-only account through the UI, then choose a username.
- If sign-in reports a connectivity error, check emulator readiness and project alignment before trying production.

## Devin Secrets Needed
None for local Firebase emulator testing. Use a disposable local account; do not reuse production credentials.

## Computer-game flow
- Home → Play vs Computer → difficulty → place/rotate ships → Lock in fleet.
- Select a target on the opponent board, then click the coordinate-specific Fire button.
- The small own-fleet board is deliberately disabled; tapping it must not change the target.
- For deterministic sink coverage, read-only inspection of the local emulator's `games/{gameId}/private/{botUid}` fleet can guide real UI shots. Never mutate game state or mock responses as evidence.
- If unauthenticated emulator REST reads are denied by rules, use a local read-only Admin SDK helper for that permitted bot guidance; do not bypass rules to inspect Daily fleets.
- To observe incoming sinks, leave enemy ships alive and fire water targets until the computer sinks a player ship.

## Visual and pointer evidence
- Capture drag state while the pointer is held, not only after release.
- At 375px width inspect both board shells, document overflow, and edge-cell target labels.
- Record animation start/end and DOM removal times when checking CSS/JavaScript lifetime alignment. Include transient screenshots; DOM existence alone does not prove visibility.
- Track incoming jet node identity across the bot's delayed result reveal, not only the final overlay's cleanup. One response can otherwise look correct while mounting a second jet at the pending-to-result transition.
- Report measured last-frame animation time and opacity separately from `animationend`: a JavaScript timeout matching a CSS duration can remove a nearly transparent final frame before the browser dispatches the end event.
- Carrier effects are skipped by any pointerdown while active. Avoid clicking during the non-skipped sequence; separately tap outside the board to test skip.
- A carrier sink used as the final winning shot may be replaced by the results view. Sink the carrier before the last remaining ship when testing its full sequence.
- If CDP pointer coordinates disagree with native placement visuals, use native computer pointer actions and capture the held preview, released board, and subsequent Rotate action.
- Scroll changes can settle after the input call resolves. Use native Ctrl+Home for a top-of-page capture, then allow rendering to settle before taking the screenshot.

## Profile responsive and progression checks
- Check root, body, and visible content-container clientWidth/scrollWidth separately. Root scrollWidth alone can miss a body scrollbar. Exclude intentionally clipped screen-reader-only elements and intentional internal scrollers.
- Scroll Profile through Service record, achievements, Appearance, and Game history. Include a history row with both Replay and Challenge, since the extra controls can expose narrow flex-row overflow.
- Use the actual Light/Dark Appearance radios, not storage/console mutation. Capture pixels and verify persistence after reload.
- Game-end progression is asynchronous: wait for the H2H game ID, Results unlock strip, or dated shelf entry rather than assuming the Victory headline means every consumer has applied.
- Resignations count toward match records/H2H but do not prove First Victory. Earn at least one genuine all-sunk win through UI shots.
- Track computer and player buckets separately, then reload and reselect each bucket to verify exact counts.

## Daily challenge privacy and ranking
- Enter from the Home card. Fire the same coordinates for two users, including a hit; compare resolved outcomes and reload persistence.
- Do not inspect the server-private Daily board to speed a clear. Scan through actual aim/Fire UI interactions if full-clear coverage is needed.
- Inspect public metadata, owner run, and callable responses for full fleet/seed fields. Attempt the private Daily document and another user's run with the browser's normal authenticated Firestore SDK; expect permission-denied.
- A resolved sunk shot can include `sunkPlacement`. This is not automatically a hidden-fleet leak: verify that every cell in that placement was already fired and hit at the response's shot index.
- Compare email and guest completion: same board/score, email scoreboard row, guest not-ranked message and no guest score document.
- A displayed 00:00 UTC reset/countdown does not by itself test an actual midnight rollover; distinguish label checks from rollover coverage.
