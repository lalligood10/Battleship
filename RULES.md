# Broadside game modes

Every game stores one immutable `mode`: `classic`, `salvo`, or `abilities`. The core reducer delegates turn actions to that mode's `ModeRules` implementation. Shared placement, resignation, and timeout behavior remains mode-independent.

## Classic

- A player fires one shot per turn.
- A target must be on the board and must not have been fired at before.
- A hit marks the cell; sinking every enemy ship wins.

## Salvo

- Shots per turn equal the number of the firing player's surviving ships at the start of the turn.
- If fewer legal untried cells remain, the volley uses that smaller number.
- Targets are queued and submitted together. They must be distinct, on-board, and previously untried.
- All shots resolve together. Ships sunk during the salvo reduce the next turn's count, not the current one.
- Results animate in sequence, with sinking results last. The server records one `salvoResolved` event for the volley.

## Abilities

Each ability is tied to its ship, can be used once per game, and replaces the player's normal shot that turn.

- **Carrier airstrike:** hits three contiguous cells in a horizontal or vertical line.
- **Submarine sonar:** scans a 3x3 area and reports whether at least one enemy ship cell is present. It deals no damage and marks no cells.
- **Destroyer relocate:** moves the destroyer once, only while it is undamaged, to another legal placement.

## Abilities contract (shared by all Phase 2 work)

Types live in `functions/src/game/core/modes/types.ts` (`ABILITY_DEFINITIONS`, `AbilityAction`, `AbilityResult`, `AbilityLogEntry`, `AbilityStatus`).

- Actions: `{ type: 'ability', player, abilityId, target, at }`. In Abilities games a normal shot is still `{ type: 'fire', ... }`.
  - `carrier-airstrike`: target `{ row, col, horizontal }` is the start cell; the line covers 3 cells to the right (horizontal) or downward (vertical). The whole line must be on the board (`off_board`). Cells already fired at are skipped; at least one cell must be untried (`already_fired`).
  - `submarine-sonar`: target `{ row, col }` is the centre of a 3×3 area, clipped at board edges. Centre must be on the board.
  - `destroyer-relocate`: target `{ row, col, horizontal }` is the new destroyer placement on the actor's own board. It must be on the board, differ from the current placement, not overlap another friendly ship, and not cover any cell the opponent has fired at (`illegal_relocation`).
- Availability is derived, never stored separately: an ability is `used` if `abilityLog` has an entry for that player and ability; otherwise `lost` if its ship is sunk (or, for relocate, the destroyer has any hit); otherwise `ready`. Using a non-ready ability fails with `ability_used` (used) or `invalid_ability` (lost).
- Events: airstrike emits `shotFired` / `shotResolved` / `shipSunk` per resolved cell (sinking cells last, as in Salvo; recorded shots carry `volley` = turn number), then `abilityUsed`; sonar and relocate emit only `abilityUsed`. Then exactly one `turnChanged`, or `gameOver`.
- `state.abilityLog` gets one public `AbilityLogEntry` per use. Relocation's entry and event never include the new position; the new placement is only written to the actor's private fleet.

## Decisions for review

- Salvo near board exhaustion uses the number of remaining legal targets when that is lower than the surviving-ship count. This prevents an unwinnable state where an exact-size volley cannot be submitted.
- Salvo resolves every queued shot even if an earlier shot sinks the final ship. Game over is emitted after the complete volley.
- Sinking Salvo results are recorded after non-sinking results, preserving order within each group, so Phase 1 effects land sinks last.
- Sonar's “ship present” result includes any ship cell in the 3x3 area, whether previously hit or not.
- Airstrike's line must fit fully on the board; cells already fired at are skipped rather than rejecting the whole strike.
- Abilities are lost when their ship sinks; relocate is also lost once the destroyer takes any hit.
- Relocation cannot overlap another friendly ship or any cell the opponent has already fired at. The opponent learns that relocation occurred, not the new position.
- An ability is unavailable after its ship sinks. Using any ability ends the turn.

## Parallel work allowlists

The requested conceptual folders map to this repository as follows. Child sessions must not edit `functions/src/game/core/reducer.ts`, `functions/src/game/core/modes/types.ts`, or this file.

- **Tests and simulation:** `functions/src/game/core/*.test.ts`, `functions/src/game/core/sim.ts`, `functions/test/`, `web/src/**/*.test.ts`.
- **Abilities:** `functions/src/game/core/modes/abilities.ts` (keep this entry file), helpers/tests under `functions/src/game/core/modes/abilities/`, and `web/src/components/AbilityBar/`.
- **Game Modes section:** `web/src/pages/HomePage.tsx`, `web/src/components/GameModePicker.tsx`, `web/src/components/ModeBadge.tsx`, `web/src/state/gameMode.ts`, and mode fields in game-creation writes only.
- **Instrumentation:** `web/src/analytics/` and one dev-only route under `web/src/pages/`.
