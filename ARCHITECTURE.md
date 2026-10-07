# Broadside architecture

## Runtime and state

The browser client is a React 19 and TypeScript single-page app built with Vite. Firebase Authentication
provides email/password and Google sign-in. Firestore is the source of truth for profiles, games,
private boards, matchmaking, challenges, chat, and reactions. The client reads through Firestore
listeners and sends mutations through callable Cloud Functions; it does not write game documents
directly.

`SessionProvider` follows Firebase Auth and the signed-in user's profile document, exposing loading,
signed-out, needs-username, and ready states. `ActiveGamesProvider` listens for that user's active
games and challenges and derives turn attention for the home screen. `GamePage` owns the selected
game's public-game and owner-only private-board listeners. Its view is selected from the current
Firestore status: waiting, placing, active, or finished. There is no separate client-side game store.

Firebase Hosting serves `web/dist`. Firebase Authentication and Firestore provide identity and
persistence; Cloud Functions v2 hosts authenticated callable APIs and Firestore triggers; Firebase
Cloud Messaging delivers optional web push notifications. A Cloud Scheduler trigger runs stale-game
cleanup daily. In-app Firestore listeners remain the reliable source of current game and turn state;
push is an additional notification path.

## Source layout

- `web/src/pages/` contains routed screens; `web/src/pages/game/` contains waiting, placement,
  active-play, results, and replay views.
- `web/src/components/` contains shared UI, the accessible board, game chat, reactions, and artwork.
- `web/src/state/` contains the session and active-game providers.
- `web/src/lib/api.ts` wraps callable Functions; `web/src/lib/firestore.ts` maps snapshots into
  browser types; `web/src/lib/firebase.ts` initializes Firebase and local emulators.
- `web/src/game/` contains browser-side board placement, marks, replay, visual effects, and the
  Firestore-to-core event diff.
- `functions/src/index.ts` exports callable Functions and trigger entry points.
- `functions/src/handlers/` implements callable operations; `functions/src/triggers/` handles
  notifications and scheduled cleanup.
- `functions/src/game/engine.ts` contains shared pure fleet and shot rules, also imported by the web
  client through Vite's `@shared` alias. `functions/src/game/core/` defines the reducer-facing
  contract, events, seeded RNG, and headless simulation.
- `functions/src/lib/` contains Firestore references, the core adapter, and game-finalization logic.
- `ios/` is a separate SwiftUI client generated with XcodeGen.

## Turn flow

1. `ActiveGameView` lets the current player choose a target and calls `fireShot` from
   `web/src/lib/api.ts`.
2. The wrapper invokes the authenticated `fireShot` callable exported by `functions/src/index.ts`.
   The handler validates membership, game phase, turn, and repeat shots inside a Firestore
   transaction, then reads the game and both private boards.
3. `coreStateFromGame` adapts those documents to `CoreState`; the pure `reduce` function resolves
   the shot using the shared engine. In bot games the same transaction also chooses and reduces the
   bot reply.
4. The handler writes shot-array additions, player counters, sunk-ship metadata, private hit cells,
   current turn and turn number. A completed game is passed to `finishGame` with the existing stats
   inputs and revealed fleets.
5. Firestore listeners update `GamePage` and `ActiveGamesProvider`. The game view renders the new
   state; the client also diffs each game snapshot into core events for consumers.

## Core contract

`functions/src/game/core/schema.ts` defines classic settings, ship definitions, board cell states,
phases, and the complete `CoreState`. Persisted `mode` is optional for old documents and defaults to
`classic`. `reducer.ts` returns a new state and ordered events for fleet placement, shots, resignation,
and timeout claims without importing Firebase or browser APIs. Its shots retain the existing
`result`, `sunkShip`, `sunkPlacement`, and timestamp fields.

`events.ts` defines `shotFired`, `shotResolved`, `shipSunk`, `turnChanged`, and `gameOver` plus an
isolating event bus. The web's `game/events.ts` derives those events from growth in Firestore shot
arrays and turn/status changes. GamePage emits each diff from the game listener; a development or
`?debugEvents` sink listener logs ship-sink events. The existing sound, toast, and strike effects are
not driven by this new stream.

Bot games store a uint32 `rngSeed` on the bot's owner-only private board, not on the public game
document. Fleet and shot streams derive from that seed using separate labels and shot indices.
Existing bot boards without a seed continue to use the prior nondeterministic shot selection.

## Current visual effects and sound

`web/src/pages/game/ActiveGameView.tsx` currently owns targeting feedback, strike/incoming-shot
animations, toast messages, and sound calls. The reusable strike sequences are in
`web/src/components/art/StrikeOverlay.tsx` and related art components; their CSS animations are in
`web/src/index.css`. Sound playback and mute preference live in `web/src/lib/sound.ts`.
`ResultsView.tsx` plays the win/loss sound and result animation. These current consumers are
intentionally separate from the Phase 0 event bus.

## Verification surfaces

Functions unit tests and reducer coverage run from `functions/`; `npm run sim` runs seeded
headless games. `functions/test/` contains emulator-backed handler tests. Web unit tests run under
Vitest's Node environment. `web/e2e/` contains Playwright emulator flows and committed screenshot
baselines at mobile and desktop viewports.
