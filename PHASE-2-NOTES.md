# Phase 2 notes — Game modes (Classic, Salvo, Abilities)

Contract tag: `phase-2-contract`. Exact rules: [RULES.md](RULES.md).

## What shipped

- **Game Modes section** on Home: Classic, Salvo, Abilities, each with a one-line description and a "How to play" expander. Copy lives once in `GAME_MODE_OPTIONS` (`functions/src/game/core/schema.ts`). The choice is remembered and applies to Play vs Computer, friend games, Quick Match and challenges.
- **`mode` on the game record**, set at creation and never changed. Missing = Classic (older games). Join-by-code inherits the host's mode; Quick Match and challenges only pair the same mode; rematches keep it. The active mode badge is shown in the lobby, placement, in-game header and results.
- **ModeRules contract**: the reducer validates phase/turn, then delegates `fire` / `salvo` / `ability` to `modeRules(state.settings.mode)` (`functions/src/game/core/modes/`). New events: `salvoResolved`, `abilityUsed`.
- **Salvo**: volley queue (tap to add, tap again to remove), Fire enabled only at the exact count, server callable `fireSalvo`, bot volleys, staggered result FX with sinks last.
- **Abilities**: carrier airstrike, submarine sonar, destroyer relocate. Server callable `useAbility`; AbilityBar with airstrike-line / 3×3 sonar / relocate previews; persistent sonar markers; opponent ability toasts; bots use airstrike (Medium+) and sonar (Hard).
- **Tests and sim**: contract tests per mode written from RULES.md; headless sim plays 1,000 games per mode with invariant checks after every action and a player-view policy that cannot read the hidden fleet.
- **Playtest analytics** (dev only): `web/src/analytics/` records mode, turns, duration, winner ships remaining, shots, and ability use by type and turn; summary at `/dev/playtest`.

## Rules decided during implementation

All of these are also in RULES.md under "Decisions for review":

- Salvo near board exhaustion: the volley size is the smaller of surviving ships and remaining untried cells.
- Salvo resolves the whole volley even if an early shot sinks the last ship; sinking shots are ordered last.
- Sonar reports "ship present" if any ship cell is in the 3×3, including cells already hit.
- Airstrike must fit fully on the board; already-fired cells are skipped, at least one cell must be new.
- Relocate cannot overlap your ships or cover any cell the opponent has fired at; the opponent learns it moved, not where. Relocate is lost once the destroyer is hit.
- An ability is lost when its ship sinks. Using any ability ends the turn.
- Bots: Easy uses no abilities, Medium uses airstrike, Hard uses airstrike and sonar; bots never relocate.

## Verification

- Functions: lint, typecheck, 192 unit tests, coverage (statements 91.5%, branches 83.1%).
- Emulator: 120 tests, including one complete Salvo bot game, one complete Abilities bot game (all three abilities used), and server-side rejection of illegal Salvo and ability actions.
- Web: lint, typecheck, 161 tests, build.
- Headless sim, 1,000 games per mode with per-action invariants: Classic 116.6 avg turns; Salvo 43.6 avg volleys (172.0 shots); Abilities 117.0 avg turns with 1,970 airstrikes, 1,938 sonar scans, 1,784 relocations.
- Classic: no pre-existing Classic assertion changed; `sim.test.ts` now loops over all modes with the same Classic checks.
- Visual QA flow at 375 and 1280 passes. Home differs from the committed baselines because of the Game Modes section; baselines were not regenerated.
- Browser smoke at 375 and 1280: Game Modes section, Classic aim, Salvo queue, Abilities sonar marker + airstrike preview, relocate placement.

## Open issues

- iOS app is unchanged: it only creates Classic games and asks users to open Salvo/Abilities games on the web.
- Deploy to broadside-dev happens on merge to main (repo workflow); the PR preview channel is the pre-merge dev deploy.
- Ratings (Elo) are shared across modes.
- The existing Commentary tab overlaps the right edge of the board at 375px (pre-existing, unchanged).
- Classic winning shot doesn't update `turnNumber` on the game doc (pre-existing); analytics don't rely on it.
- Main web bundle is ~970 kB (existing large-chunk warning).
- "Turns" in playtest analytics counts both players' turns (the game's `turnNumber`).
- Prep audits for Phases 3–5 are on separate unmerged branches; Phase 3–5 work has not started.
