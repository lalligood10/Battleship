# Phase 5 — Retention and meta-progression

## What shipped

- Per-mode stats for Classic, Salvo and Abilities, with a vs players / vs computer toggle on Profile.
- Head-to-head records on the Friends leaderboard, waiting-rematch screen and Results.
- Seven achievements, including a live Profile shelf and a Results unlock strip.
- The daily challenge at `/daily`, a Home card, and a top-10 scoreboard.

## Decisions for review

### Counting rules

| Case | Per-mode stats | Head-to-head | Achievements |
|---|---|---|---|
| Win or loss by sinking the fleet | Counted | Counted | Eligible |
| Resignation | Counted: win for the opponent, loss for the player who resigned | Counted | Not eligible for win achievements |
| Timeout (3 skipped turns, or a 3-day inactivity claim) | Counted: win for the opponent, loss for the inactive player | Counted | Not eligible for win achievements |
| Cancelled, or never started | Not counted | Not counted | No |
| vs computer | `bot` bucket (separate from `pvp`) | Not counted | Eligible; Admiral Slayer requires it |
| Guest players | Counted; history is kept when the guest upgrades (same uid) | Counted | Eligible |
| Unrated human games | `pvp` bucket | Counted | Eligible |

- **Average turns to win** = `sinkWinTurns / sinkWins`. Only wins by sinking the fleet are included, so resignations don't distort the average. A turn is one Classic shot, one Salvo volley, or one ability turn.
- **Ratings stay global.** No per-mode ratings or per-mode leaderboards are added in Phase 5.
- **No backfill.** Phase 5 stats start at deploy time, and the profile labels them "since Phase 5". Lifetime totals in `users/{uid}.stats` remain the source of truth for overall W/L.

### Achievements

- The seven achievements are listed in `contract.ts`. Each unlock is written once with `create()` to `users/{uid}/achievements/{id}`. If the document already exists, the unlock is a no-op, so every achievement fires exactly once per player.
- The rules are pure functions of `AchievementInput`, and `daily-clear` is awarded by `fireDailyShot`.
- Bot players never receive achievements; human players can earn achievements in games against bots.
- The achievement simulation runs 120 seeded games per mode by default to stay under the 10-second test timeout. `ACHIEVEMENT_SIM_GAMES=200` runs the full 200.

### Daily challenge

- **Reset:** 00:00 UTC (`dailyDateKey`).
- **Seed:** the first call of the day creates the seed with `crypto.randomInt` in a transaction and stores `{ seed, fleet: dailyFleet(seed, dateKey) }` at `dailyChallengesPrivate/{dateKey}`, which is server-only. Every player that day therefore plays the same board, and the fleet can't be derived from the public repo.
- **Format:** solo. You fire at the hidden fleet until everything is sunk. Score = shots taken, and lower is better. Each player gets one run per day. A run persists across reloads and can be resumed any time that UTC day.
- **Callables:** `getDailyChallenge()` returns a `DailyView`. `fireDailyShot({ dateKey, row, col })` returns a `DailyView`. It rejects stale `dateKey`s, repeated cells and completed runs. The client only ever sees its own resolved shots.
- **Scores:** written to `dailyScores/{dateKey}/players/{uid}` when a run clears. Guests can play, but they are left off the daily scoreboard until they upgrade, consistent with the other leaderboards.
- A guest, or a signed-in player without a `users/{uid}` profile, still receives the daily completion and `daily-clear` achievement but no score row. Guests are told they aren't ranked.
- The daily top-10 uses a collection-scoped index on `dailyScores/{dateKey}/players`, ordered by `shots` ascending and `completedAtMs` ascending.
- If `fireDailyShot` rejects a stale-day shot after 00:00 UTC or a duplicate cell fired from another tab, the page shows the error and reloads today's board.
- The daily page reuses the shot sound, not the live-game strike or sink visual effects.

### Access and compatibility

- Public to signed-in users: `playerStats/{uid}`, `users/{uid}/achievements/*`, `dailyChallenges/{dateKey}`, and `dailyScores/{dateKey}/players/*`.
- Owner only: `users/{uid}/dailyRuns/*`.
- The two players only: `headToHead/{pair}`.
- Server only: `gameEnds/*` and `dailyChallengesPrivate/*`.
- All writes go through Functions. Every new field and collection is additive, so iOS Codable models stay compatible.

## Verification

| Check | Result |
|---|---|
| Functions lint and typecheck | Passed |
| Functions unit tests | **25 files, 290 tests passed** |
| Functions emulator tests | **14 files, 227 tests passed** |
| Achievement simulation (`ACHIEVEMENT_SIM_GAMES=200`) | **1 file, 3 tests passed** |
| Web lint and typecheck | Passed; lint emitted existing warnings |
| Web unit tests | **53 files, 355 tests passed** |
| Web build | Passed |
| Full Browser visual QA | **15 tests passed in 197 seconds** |
| Final screenshot sweep | **5 tests passed in 115 seconds** |

Achievement simulation output (qualifying player-games; first unlocks):

- Classic: `{"first-victory":165,"last-ship-standing":101,"admiral-slayer":8}`; `{"first-victory":2,"last-ship-standing":2,"admiral-slayer":1}`.
- Salvo: `{"first-victory":165,"flawless":31,"one-volley-sink":7,"admiral-slayer":16,"last-ship-standing":13}`; `{"first-victory":2,"flawless":2,"one-volley-sink":2,"admiral-slayer":1,"last-ship-standing":2}`.
- Abilities: `{"first-victory":168,"last-ship-standing":104,"full-arsenal":286,"admiral-slayer":10}`; `{"first-victory":2,"last-ship-standing":2,"full-arsenal":2,"admiral-slayer":1}`.

Results and Profile were captured and visually inspected at 375px and 1280px in dark and light themes. No content overlap or contrast issue was found. The full-page screenshot capture hides the fixed tab bar and focus-only skip link so they do not obscure the screens being reviewed; the accessibility assertions run before capture.

## Known limitations / deferred

- No backfill; per-mode leaderboards are not included.
- The daily challenge has no streaks or sharing.
- The `gameEnds` record uses a non-transactional get/set. Its content is deterministic, so concurrent duplicate writes produce identical payloads; each consumer's writes and marker remain transactional.
- Hosting previews omit the new callables; test the daily challenge against emulators.
- iOS is unchanged.
