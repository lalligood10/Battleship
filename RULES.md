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

## Decisions for review

- Salvo near board exhaustion uses the number of remaining legal targets when that is lower than the surviving-ship count. This prevents an unwinnable state where an exact-size volley cannot be submitted.
- Salvo resolves every queued shot even if an earlier shot sinks the final ship. Game over is emitted after the complete volley.
- Sinking Salvo results are recorded after non-sinking results, preserving order within each group, so Phase 1 effects land sinks last.
- Sonar's “ship present” result includes any ship cell in the 3x3 area, whether previously hit or not.
- Airstrike orientation is chosen before submission; all in-bounds cells in its three-cell line resolve, and the target is rejected if the line would leave the board.
- Relocation cannot overlap another friendly ship or any cell the opponent has already fired at. The opponent learns that relocation occurred, not the new position.
- An ability is unavailable after its ship sinks. Using any ability ends the turn.

## Parallel work allowlists

The requested conceptual folders map to this repository as follows. Child sessions must not edit `functions/src/game/core/reducer.ts`, `functions/src/game/core/modes/types.ts`, or this file.

- **Tests and simulation:** `functions/src/game/core/*.test.ts`, `functions/src/game/core/sim.ts`, `functions/test/`, `web/src/**/*.test.ts`.
- **Abilities:** `functions/src/game/core/modes/abilities/`, `web/src/components/AbilityBar/`.
- **Game Modes section:** `web/src/pages/HomePage.tsx`, `web/src/components/GameModePicker.tsx`, `web/src/components/ModeBadge.tsx`, `web/src/state/gameMode.ts`, and mode fields in game-creation writes only.
- **Instrumentation:** `web/src/analytics/` and one dev-only route under `web/src/pages/`.
