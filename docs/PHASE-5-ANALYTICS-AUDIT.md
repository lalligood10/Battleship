# Phase 5 prep: analytics and retention audit

Preparation only. Nothing here changes gameplay, the game record schema, the reducer, Firestore
rules or writes. The audit was taken on `devin/phase-5-prep-analytics`, which branches from
`origin/devin/1791339229-phase-2-game-types` at `019a9e4`. The in-flight Phase 2 branches were
read with `git show` and not edited.

The only code added is one pure, read-only helper and its tests:
`functions/src/game/analytics/gameRecord.ts` and `gameRecord.test.ts`. Nothing imports the
helper yet.

## 1. What already exists

### Stats, profile and leaderboards (on `main` / the Phase 2 base)

| Area | Where | What it does |
| --- | --- | --- |
| Lifetime stats | `functions/src/game/scoring.ts` (`PlayerStats`, `applyGameToStats`, `winPercentage`, `accuracyPercentage`) | `users/{uid}.stats` holds wins, losses, gamesPlayed, shotsFired, hits, currentStreak and longestStreak. Bot games go to `users/{uid}.botStats` instead. |
| Rating | `scoring.ts` (`applyElo`, `samePairKMultiplier`) | Elo, K=32, floor 100. K is halved after 3 rated games between the same pair within 24 h. There is one rating for all modes. |
| Write path | `functions/src/lib/finishGame.ts` | Runs inside the gameplay transaction. Writes the finished game, Elo and stats for both users, `weeklyWins/{weekId}/players/{uid}` and both `users/{uid}/opponents/{opp}` docs. Bot games only update the human's `botStats` and `lastGameAt`. |
| Weekly window | `scoring.ts` `weekId` | ISO week, starting Monday 00:00 UTC. |
| Profile page | `web/src/pages/ProfilePage.tsx` | Shows Wins, Losses, Played, Win %, Accuracy and Best streak, plus game history (`fetchHistory`, last 50 finished games) with Replay and Challenge buttons. |
| Leaderboards | `web/src/pages/LeaderboardsPage.tsx`, `web/src/lib/firestore.ts` | Global (rating), Weekly (wins this ISO week) and Friends (opponents plus you). Bots, suspended users and hidden users (`leaderboardVisible`) are filtered out on the client. |
| Admin | `functions/src/handlers/admin.ts` | Lists users with wins and losses. No game-level analytics. |
| iOS | `ios/Broadside/Models/UserModels.swift` | `PlayerStats` and `WeeklyWins` are Codable mirrors. New optional fields are safe; renaming or removing fields breaks decoding. |

### Replay and events

| Area | Where | Notes |
| --- | --- | --- |
| Replay | `web/src/game/replay.ts` (`replayTimeline`, `shotsUpTo`, `hasReplay`), `web/src/pages/game/ReplayView.tsx` | Rebuilt from `game.shots` only, ordered by `at`, with `volley` breaking ties. Ability uses that fire no shots (sonar, relocate) don't appear in replay. |
| Core events | `functions/src/game/core/events.ts` | `shotFired`, `shotResolved`, `shipSunk`, `salvoResolved`, `abilityUsed`, `turnChanged`, `gameOver`. The reducer emits all of them. |
| Web event bus | `web/src/game/events.ts` `diffGameEvents` | Rebuilds events by diffing game snapshots. It currently emits **only** `shotFired`, `shotResolved`, `shipSunk`, `turnChanged` and `gameOver`. It never emits `salvoResolved` or `abilityUsed` (see R1). |

### Playtest analytics (`origin/devin/phase-2-playtest-analytics`, not merged)

- `web/src/analytics/types.ts` defines `PlaytestRecord` (mode, turns, durationMs, winner,
  endReason, winnerShipsRemaining, shotsByPlayer, and abilities as `{player, abilityId, turnNumber}[]`),
  `ModeSummary` and `AbilitySummary`.
- `recorder.ts` `createGameRecorder` builds one record per game from the live `CoreEvent` bus.
- `summary.ts` `summarizeByMode` gives per-mode games, average turns, average duration, average
  winner ships remaining, and ability uses with their average turn.
- `storage.ts` stores up to 500 records in localStorage (`broadside.playtest.v1`). It is opt-in
  outside dev (`broadside.playtest.enabled`).
- `DevPlaytestPage.tsx` shows a table, JSON export and clear.
- Nothing on that branch, or on the Phase 2 base, calls `startGameAnalytics` or routes to
  `DevPlaytestPage`. That wiring belongs to `GamePage.tsx` and `App.tsx`, which the lead owns.

**This covers the per-game aggregation the brief asks for: mode, turns, duration, winner ships
remaining, and ability usage by type and turn. I didn't rebuild it.**

### Not present anywhere

- Product analytics or telemetry: no Firebase Analytics, gtag or `logEvent`.
- Achievements and daily challenges: no code, collections or copy.
- Server-side per-game analytics, and any aggregation across games beyond lifetime `stats`.
- Per-mode stats or per-mode leaderboards.
- Day-based activity streaks. `currentStreak` counts wins, not days played.

## 2. Gaps

1. **Live recorder only.** `PlaytestRecord` is produced only on the device that watched the game,
   only while playtest is enabled, and only into localStorage. There's no way to build analytics
   from games that already finished (`fetchHistory`, or a future admin or server aggregate).
   *Filled by the new helper (section 3).*
2. **Ability usage never reaches the web recorder.** `diffGameEvents` emits no `abilityUsed` or
   `salvoResolved` events. The web `Game` type has no `abilityLog`, and `gameFromSnapshot` doesn't
   map it. In real play, `PlaytestRecord.abilities` will always be `[]` (see R1 and R2).
3. **`game.turnNumber` can't be used to count turns at game end.** The Classic winning shot doesn't
   write `turnNumber` (`functions/src/handlers/games.ts:400`, the destroyed branch reuses
   `gameUpdate` without an increment). The Salvo path writes core's post-increment value
   (`games.ts:634`), and bot replies add 2 (`games.ts:486`). The new helper counts turns from
   `shots` and `abilityLog` instead (see R3).
4. **No Abilities persistence path yet.** The game doc has `abilityLog`, but this base has no
   handler that writes it. On the base the abilities reducer is a stub; the real one is on
   `phase-2-abilities`.
5. **`summarizeByMode` takes `PlaytestRecord[]`** even though it only reads mode, turns,
   durationMs, winnerShipsRemaining and abilities (see R4).
6. **One set of stats and one rating across modes.** `finishGame` applies Classic, Salvo and
   Abilities results to the same `stats` and `rating`.

## 3. What this branch adds

`functions/src/game/analytics/gameRecord.ts` is pure, has no Firebase imports, and isn't wired in.
It lives under `functions/src/game`, so it's shared with web as `@shared/analytics/gameRecord`.

```ts
gameAnalyticsRecord(gameId: string, game: FinishedGameSource): GameAnalyticsRecord | null
turnsTaken(game): number
```

- `FinishedGameSource` is a structural subset of the server `GameDoc` and the web `Game`. Both
  are accepted without casts. Timestamps are anything with `toMillis()`.
- `GameAnalyticsRecord` has the same fields as `PlaytestRecord` minus `myUid`, plus `isBotGame`.
  `{ ...record, myUid }` is a valid `PlaytestRecord` and can go straight into `summarizeByMode`.
- It returns `null` unless the game is `finished` and has a winner, an end reason, `startedAt`
  and `finishedAt`. That excludes games that never reached the turn loop.
- `turns` counts each Classic shot (no `volley`) as one turn, plus each distinct
  `(player, volley)` and `(player, abilityLog.turnNumber)`. Airstrike shots carry
  `volley = turnNumber`, so they share a key with their log entry; sonar and relocate count
  through the log. On reducer-driven games this equals core's final `turnNumber - 1`, which is
  also the recorder's `max(turnNumber)`.
- `winnerShipsRemaining` is 5 minus the distinct entries in `players[winner].sunkShips`.
- `abilities` is `abilityLog` in order, as `{player, abilityId, turnNumber}`.

The tests in `gameRecord.test.ts` drive real Classic and Salvo games and a resignation through
`createCoreState`/`reduce`. Because the abilities reducer is a stub on this base, the Abilities
case uses a hand-built `abilityLog` in the Phase 2 shape. Other cases cover null returns, legacy
docs with no mode, duration clamping, no input mutation, de-duplicated sunk ships, and a
compile-time check that `GameDoc` is assignable.

## 4. Proposed Phase 5 data contract (documentation only)

None of this is implemented. It's meant to be picked up once Phase 2 merges.

### 4.1 Per-game analytics record

- **Writer:** a new Firestore trigger on `games/{gameId}` that fires on the transition to
  `finished` (`before.status !== 'finished' && after.status === 'finished'`). It goes alongside the
  existing `onGameWritten` (`functions/src/index.ts:115`). It should **not** run inside
  `finishGame`: retention data isn't authoritative, and adding writes to the gameplay transaction
  adds contention and latency to every winning shot.
- **Doc:** `gameAnalytics/{gameId}` = `GameAnalyticsRecord & { playerUids: string[];
  finishedAt: Timestamp; rated: boolean; botDifficulty: BotDifficulty | null }`.
- **Idempotency:** triggers are at-least-once, so write with `create()` and treat
  `ALREADY_EXISTS` as already processed. Every downstream counter update runs in a transaction
  that first creates or reads `gameAnalytics/{gameId}`, so a retried trigger can't double-count.
- **Rules:** `allow read, write: if false`. Reads go through an admin callable.
- **Index:** `gameAnalytics` on `(mode ASC, finishedAt DESC)` for admin windows.
- **Admin aggregate:** `adminAnalyticsSummary({ sinceMs, mode? })` returns
  `Record<GameMode, ModeSummary>`. It should reuse `summarizeByMode`, which would first move to
  `functions/src/game/analytics/` so both client and server can call it.

### 4.2 Achievements

- **Definitions:** a code constant (draft below) with `id`, `label`, `description`, and a pure
  `earned(record, uid, statsAfter)` predicate. All of them evaluate against `GameAnalyticsRecord`
  plus `PlayerStats`.
- **Storage:** `users/{uid}/achievements/{achievementId}` = `{ unlockedAt: Timestamp, gameId: string }`.
  The owner can read; only Functions write.
- **Evaluation:** in the same finished-game trigger, after the analytics record is created. Never
  in the reducer or `finishGame`.

### 4.3 Daily challenges

- **Definition doc:** `dailyChallenges/{YYYY-MM-DD}` (UTC) = `{ challengeId, params }`. Any
  signed-in user can read; it's written by a scheduled function or picked deterministically from
  the date with the existing `deriveRng`.
- **Progress:** `users/{uid}/dailyProgress/{YYYY-MM-DD}` =
  `{ challengeId, progress: number, target: number, completedAt: Timestamp | null }`. The owner can
  read; only Functions write. It's updated by the same trigger.
- **iOS:** new subcollections and docs don't affect existing Codable decoding.

### 4.4 Draft achievement definitions (not wired)

| id | Label | Earned when (perspective `uid`) | Data needed |
| --- | --- | --- | --- |
| `first-win` | First Victory | `winner === uid` and `stats.wins === 1` | record + stats |
| `streak-3` / `streak-5` | Hot Streak / Unstoppable | `stats.currentStreak >= 3 / 5` | stats |
| `flawless` | Flawless Admiral | `winner === uid && endReason === 'all_sunk' && winnerShipsRemaining === 5` | record |
| `last-ship` | Last Ship Standing | `winner === uid && endReason === 'all_sunk' && winnerShipsRemaining === 1` | record |
| `sharpshooter` | Sharpshooter | Classic win with `shotsByPlayer[uid] <= 40` (threshold TBD) | record |
| `salvo-sweep` | Broadside! | Salvo win in `turns <= 30` (threshold TBD) | record |
| `full-arsenal` | Full Arsenal | Abilities game where `uid` used all 3 abilities | record |
| `three-modes` | Fleet Admiral | At least one win in each of Classic, Salvo and Abilities | needs per-mode win counts (open decision D3) |
| `admiral-slayer` | Admiral Slayer | Win against the hard (Admiral) bot | needs `botDifficulty` on the analytics doc (4.1) |

### 4.5 Draft daily challenge definitions (not wired)

| challengeId | Text | Progress per finished game | Target |
| --- | --- | --- | --- |
| `win-any` | Win a game | +1 if `winner === uid` | 1 |
| `play-three` | Finish 3 games | +1 per finished game | 3 |
| `win-salvo` | Win a Salvo game | +1 if Salvo and won | 1 |
| `quick-win` | Win in 35 turns or fewer | +1 if won and `turns <= 35` | 1 |
| `keep-fleet` | Win with 3+ ships afloat | +1 if won and `winnerShipsRemaining >= 3` | 1 |
| `use-abilities` | Use 2 abilities in one game | +1 if 2 or more `abilities` entries by `uid` | 1 |

## 5. Recommendations for files I couldn't touch

None of these were made on this branch.

- **R1** `web/src/game/events.ts:6` (`diffGameEvents`): diff `next.abilityLog` against
  `prev.abilityLog` and emit `abilityUsed`. Optionally, emit `salvoResolved` once per
  `(shooter, volley)` group. Without this, the recorder's `abilityUsed` and `salvoResolved` cases
  (`web/src/analytics/recorder.ts:40,46` on the playtest branch) never fire in real play.
- **R2** `web/src/lib/types.ts:55` (`Game`): add `abilityLog?: AbilityLogEntry[]`. In
  `web/src/lib/firestore.ts:25` (`gameFromSnapshot`), map `d.abilityLog ?? []`. This is needed for
  R1, the new helper on web, and an ability-aware replay.
- **R3** `functions/src/handlers/games.ts:400`: the Classic winning-shot branch leaves
  `turnNumber` unchanged, while Salvo (`:634`) writes core's incremented value. Either write
  `afterHuman.turnNumber` there too, or document that `turnNumber` isn't meaningful once a game is
  finished. Analytics no longer depend on it.
- **R4** `web/src/analytics/summary.ts:8` (playtest branch): change the input type to
  `Pick<PlaytestRecord, 'mode' | 'turns' | 'durationMs' | 'winnerShipsRemaining' | 'abilities'>[]`,
  then move it to `functions/src/game/analytics/` so the server can use it.
- **R5** `web/src/analytics/types.ts` (playtest branch): once both branches merge, define
  `PlaytestRecord` as `Omit<GameAnalyticsRecord, 'isBotGame'> & { myUid: string }` (or keep
  `isBotGame`), so the client and server records can't drift apart.
- **R6** When the Abilities handler lands (`functions/src/handlers/games.ts`), persist
  `abilityLog` with `FieldValue.arrayUnion` in the same update as the airstrike shots.

## 6. Open product decisions

1. **D1 Server analytics store.** Add `gameAnalytics/{gameId}` (4.1), or keep analytics
   client-only (localStorage playtest) through Phase 5?
2. **D2 Bot games.** Should they count toward achievements and daily challenges? They already
   count toward `botStats` but not rating or weekly wins.
3. **D3 Per-mode stats and leaderboards.** Keep one rating and one set of stats, or add
   `users/{uid}.modeStats.{mode}` (an optional field, safe for iOS)? `three-modes` needs at least
   per-mode win counts.
4. **D4 Daily reset time zone.** UTC, matching the weekly leaderboard, or the player's local
   midnight (needs a stored time zone)?
5. **D5 Activity streaks.** Add a "days played in a row" streak? It needs a `lastActiveDay` field.
   Today's `currentStreak` counts wins only.
6. **D6 Resign and timeout wins.** Should they count for achievements and dailies? Counting them
   lets friends farm by resigning on purpose.
7. **D7 Backfill.** Grant achievements retroactively from existing finished games? The helper can
   process them, but `abilityLog` is missing on older games.
8. **D8 Thresholds and copy.** The numbers in 4.4 and 4.5 are placeholders. They need playtest
   data (`summarizeByMode` averages per mode) before they're fixed.
9. **D9 Retention period and privacy** for `gameAnalytics` docs, which contain uids.
10. **D10 Product telemetry.** Funnel events such as sign-up to first game, or placement
    abandonment, need a separate decision (Firebase Analytics or not). Nothing exists today.

## 7. Checks

Run at `87c48a8` (helper and tests):

- Functions: `npm run lint && npm run typecheck && npm test` passed (15 files, 122 tests).
- Web: `npm run lint && npm run typecheck && npm test && npm run build` passed (17 files, 126
  tests). Lint and build print warnings that don't fail the run; the base branch prints them too.
- Compatibility: in a scratch worktree, this branch merged with
  `origin/devin/phase-2-playtest-analytics` without conflicts. A throwaway file that builds
  `gameAnalyticsRecord(g.id, g)` from a web `Game`, spreads it into a `PlaytestRecord` with
  `myUid`, and passes it to `summarizeByMode` type-checks with `tsc -b`. The file wasn't committed.
- Emulator tests weren't run: nothing here touches Firestore.
