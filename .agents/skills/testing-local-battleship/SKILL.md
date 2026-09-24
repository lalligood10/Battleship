---
name: testing-local-battleship
description: Run Broadside browser tests against matching Firebase emulators and verify real computer-game visual effects.
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
- To observe incoming sinks, leave enemy ships alive and fire water targets until the computer sinks a player ship.

## Visual and pointer evidence
- Capture drag state while the pointer is held, not only after release.
- At 375px width inspect both board shells, document overflow, and edge-cell target labels.
- Record animation start/end and DOM removal times when checking CSS/JavaScript lifetime alignment. Include transient screenshots; DOM existence alone does not prove visibility.
- Carrier effects are skipped by any pointerdown while active. Avoid clicking during the non-skipped sequence; separately tap outside the board to test skip.
- A carrier sink used as the final winning shot may be replaced by the results view. Sink the carrier before the last remaining ship when testing its full sequence.
