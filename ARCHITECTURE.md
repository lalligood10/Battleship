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
- `web/src/feel/`, `web/src/audio/`, and `web/src/fx/` contain the cue timeline and its audio and
  visual-effects consumers.
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

1. `ActiveGameView` lets the current player choose one target in Classic or queue a full volley in
   Salvo, then calls `fireShot` or `fireSalvo` from `web/src/lib/api.ts`.
2. The wrapper invokes the corresponding authenticated callable exported by `functions/src/index.ts`.
   The handler validates membership, game phase, turn, and targets inside a Firestore transaction,
   then reads the game and both private boards.
3. `coreStateFromGame` adapts those documents to `CoreState`; the pure reducer resolves the shot or
   volley using the shared engine. Bot replies are selected and reduced in the same transaction.
4. The handler writes shot-array additions, player counters, sunk-ship metadata, private hit cells,
   current turn and turn number. A completed game is passed to `finishGame` with the existing stats
   inputs and revealed fleets.
5. Firestore listeners update `GamePage` and `ActiveGamesProvider`. The game view renders the new
   state; the client also diffs each game snapshot into core events for consumers.

## Core contract

`functions/src/game/core/schema.ts` defines game settings, ship definitions, board cell states,
phases, and the complete `CoreState`. Persisted `mode` is optional for old documents and defaults to
`classic`. `reducer.ts` returns a new state and ordered events for fleet placement, shots, resignation,
and timeout claims without importing Firebase or browser APIs. Timeout claims use `lastProgressAt`
and the game's configured abandonment window. Shots retain the existing `result`, `sunkShip`,
`sunkPlacement`, and timestamp fields; Salvo shots also carry their pre-volley core turn in `volley`.

`events.ts` defines `shotFired`, `shotResolved`, `shipSunk`, `turnChanged`, and `gameOver` plus an
isolating event bus. The web's `game/events.ts` derives those events from growth in Firestore shot
arrays and turn/status changes. GamePage emits each diff from the game listener; a development or
`?debugEvents` sink listener logs ship-sink events.

Bot games store a uint32 `rngSeed` on the bot's owner-only private board, not on the public game
document. Fleet and shot streams derive from that seed using separate labels and shot indices.
Existing bot boards without a seed continue to use the prior nondeterministic shot selection.

## Phase 1 hooks

`GamePage` creates one `FeelDirector` from the first non-null snapshot for a game and subscribes it
to the core event bus. Initial snapshot history is counted as already revealed, so it produces no
retroactive effects. In `feel/config.ts`, timing is shared and read-only; audio and haptics settings
belong to audio work, and `fx` belongs to visual-FX work.

`feel/director.ts` schedules wind-up, impact, sink, and game-over cues and advances board-mark
reveals only when impacts play. `ActiveGameView` consumes those cues for toasts and revealed marks.
`audio/` owns cue-to-sound routing and the optional vibration helper; mute preference and sound
playback remain in `web/src/lib/sound.ts`. `fx/FxLayer.tsx` owns the board strike overlay and
`FxStage.tsx` wraps the active-game page. A finished game keeps `ActiveGameView` mounted until the
director settles its final impact and sink hold, then switches to `ResultsView`.

The reusable strike sequences remain in `web/src/components/art/StrikeOverlay.tsx` and related art
components, with CSS animations in `web/src/index.css`. `ResultsView` owns the result screen and
animation but no longer plays a second win/loss sound.

## Phase 2a game modes and Salvo

`GAME_MODE_OPTIONS` in the shared core schema is the source of truth for the Classic and Salvo
labels and descriptions shown by the pre-match picker. The web stores the selected mode under
`broadside.gameMode`; absent or invalid local values and legacy games, tickets, and challenges
default to Classic. New games, Quick Match tickets, and challenges carry the selected mode, while
joining a game by code inherits its host's mode. Matchmaking and challenge duplicate/reverse-pending
checks are mode-aware, and source-game rematches retain that game's mode.

Classic uses the single-target `fire` action. Salvo uses `fireSalvo`: at the start of a volley, its
size is the minimum of the player's afloat ships and the opponent's cells that player has not fired
at yet. A ship sunk during a volley reduces only the next volley. Every submitted target is resolved,
even if the fleet is already destroyed before the last target. The core records non-sinking shots
first and sinking shots last, preserving order within each group, and emits shot events in that
recorded order. `fire` rejects Salvo games and `fireSalvo` rejects Classic games; callable writes,
including bot volleys, remain transaction-backed.

The web `diffGameEvents` groups consecutive shots from one shooter with the same `volley` as one
turn and emits `turnChanged` only between volleys. Classic shots omit `volley` and remain individual
turns. Salvo replay still steps through shots individually while using volley numbers to keep a
same-timestamp volley together. The active Salvo view queues unique, unfired targets up to current
firepower and enables Fire only when the queue is full.

## Verification surfaces

Functions unit tests and reducer coverage run from `functions/`; `npm run sim` runs seeded
headless games. `functions/test/` contains emulator-backed handler tests. Web unit tests run under
Vitest's Node environment. `web/e2e/` contains Playwright emulator flows and committed screenshot
baselines at mobile and desktop viewports.
