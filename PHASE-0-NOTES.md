# Phase 0 — foundation and guardrails

## Shipped

- Added a pure core schema, state reducer, ordered event types and listener-isolating event bus on
  top of the existing shared fleet/shot engine.
- Adapted `fireShot` to reduce the human shot and bot reply while leaving Firestore transaction
  writes, stats, finish-game handling, validation ordering, and existing callable errors intact.
- Added optional classic game mode data and private-board-only bot seeds for repeatable fleet and
  shot RNG streams. Older bot games retain their random-shot fallback.
- Added the web snapshot-to-event diff and wired it at `GamePage`; existing FX, sound, and toast
  behavior remains unchanged.
- Added reducer, event, schema, and RNG tests, coverage enforcement, seeded simulation, and a
  Playwright sign-up-to-game visual flow with mobile and desktop screenshot captures.
- Updated the pull-request CI coverage/simulation steps, added the visual-QA job, and documented
  the architecture and current event/FX boundaries.

## Deliberately cut

- No player-visible rules, flow, or presentation changes; no edits to `ios/`.
- No migration of existing strike effects, sounds, or toasts to the new event stream.
- No new state-management framework or persisted public event collection.
- Fleet-placement callable validation remains on the existing `validateFleet` path; reducer
  placement uses the same validator, but the transaction flow did not need refactoring.
- No pixel-diff gate: the fleet placement is randomized and these screenshots are review baselines.

## Simpler-option decisions

- The reducer composes existing pure validation and shot-resolution functions instead of
  reimplementing game rules.
- The web event stream is derived from successive game snapshots and remains in memory; Firestore
  shot arrays continue to be the persisted event history.
- Bot randomness uses domain-separated streams from one private seed, avoiding public-game schema
  changes or additional RNG persistence.
- Simulation mixes legal random and AI-selected shots and periodically verifies rejected actions
  leave state unchanged.

## Open issues and follow-ups

- Future rules modes (salvo and abilities) are reserved in the core settings contract but are not
  implemented.
- Visual QA captures screenshots for human review but intentionally does not compare pixels.
- Later phases can migrate FX and sound consumers onto core events without changing the Firestore
  document contract.

After this branch is merged, tag the merge commit `phase-0-contract` so later phase work can target a
stable contract.
