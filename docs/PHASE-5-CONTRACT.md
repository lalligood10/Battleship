# Phase 5 contract: retention and meta-progression

Tag: `phase-5-schema`. Types and pure helpers: `functions/src/game/analytics/contract.ts` (web imports it as `@shared/analytics/contract`). Pipeline: `functions/src/triggers/gameEnd/`.

## Pipeline

1. `onGameFinished` (Firestore `onDocumentUpdated('games/{gameId}')`) fires only on the transition to `status: 'finished'`.
2. `gameEndRecord(gameId, game)` builds one `GameEndRecord`. It returns `null` when there is no winner, end reason, start time or finish time, so cancelled games and games that never started are ignored. The record is stored at `gameEnds/{gameId}`, which is server-only.
3. Consumers (`stats`, `headToHead`, `achievements`) each run in their own transaction. The consumer's writes and the marker `gameEnds/{gameId}/applied/{consumer}` are created in the same transaction. A marker that already exists means the consumer is skipped. This makes processing idempotent across retries, duplicate events and manual replays. A failure in one consumer is logged and doesn't block the others.
4. `finishGame` and the reducer are unchanged. Existing `users/{uid}.stats`, `botStats`, ratings, `opponents` and weekly wins keep working exactly as before.

## Counting rules

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

## Achievements

`ACHIEVEMENTS` in `contract.ts` lists the seven achievements. Each unlock is written once with `create()` to `users/{uid}/achievements/{id}`. If the document already exists, the unlock is a no-op, so every achievement fires exactly once per player. The rules are pure functions of `AchievementInput`, and `daily-clear` is awarded by `fireDailyShot`. Bot players never receive achievements.

## Daily challenge

- **Reset:** 00:00 UTC (`dailyDateKey`).
- **Seed:** the first call of the day creates the seed with `crypto.randomInt` in a transaction and stores `{ seed, fleet: dailyFleet(seed, dateKey) }` at `dailyChallengesPrivate/{dateKey}`, which is server-only. Every player that day therefore plays the same board, and the fleet can't be derived from the public repo.
- **Format:** solo. You fire at the hidden fleet until everything is sunk. Score = shots taken, and lower is better. Each player gets one run per day. A run persists across reloads and can be resumed any time that UTC day.
- **Callables:** `getDailyChallenge()` returns a `DailyView`. `fireDailyShot({ dateKey, row, col })` returns a `DailyView`. It rejects stale `dateKey`s, repeated cells and completed runs. The client only ever sees its own resolved shots.
- **Scores:** written to `dailyScores/{dateKey}/players/{uid}` when a run clears. Guests can play, but they are left off the daily scoreboard until they upgrade, consistent with the other leaderboards.

## Access rules

- Public to signed-in users: `playerStats/{uid}`, `users/{uid}/achievements/*`, `dailyChallenges/{dateKey}`, `dailyScores/{dateKey}/players/*`.
- Owner only: `users/{uid}/dailyRuns/*`.
- The two players only: `headToHead/{pair}`.
- Server only: `gameEnds/*`, `dailyChallengesPrivate/*`.

All writes go through Functions. Every new field and collection is additive, so iOS Codable models stay compatible.
