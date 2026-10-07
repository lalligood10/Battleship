# Phase 3 audit — async multiplayer, notifications, invites, reconnect, rematch, timers

Preparation only. Audited on `devin/phase-3-prep-audit`, branched from
`origin/devin/1791339229-phase-2-game-types` at `019a9e4`. No production code changed.
Line numbers refer to that base.

Phase 3 scope (from the build brief's phase table): async multiplayer, notifications,
invites, reconnect, rematch, optional timers. Its target weakness: "async games stall
when nobody remembers it's their move."

## 1. What already exists

| Requirement | Status | Implementation |
|---|---|---|
| Async, server-authoritative turns | Done | Callables in `functions/src/handlers/games.ts` run in Firestore transactions; clients only read (`web/src/lib/firestore.ts`, `firestore.rules`). |
| Invites (join code / link) | Done | `createGame` / `joinGame` (`games.ts:141`, `:161`); `WaitingView` share link + code. `joinGame` is idempotent for existing members. |
| Direct challenges | Done | `functions/src/handlers/challenges.ts` (create / respond / cancel, mode-aware, reverse-challenge accept, 48 h TTL); `ChallengeButton.tsx`; incoming/outgoing lists in `ActiveGamesProvider`. |
| Quick Match | Done | `functions/src/handlers/quickMatch.ts` (`quickMatch/{uid}` tickets, widening rating band, mode match, anti-farming); `QuickMatchModal` in `HomePage.tsx:357`. |
| Rematch | Done | `requestRematch` (`games.ts:196`) writes `game.rematch` and a linked waiting game; invitee accepts by calling it too. `ResultsView` reads `game.rematch`. |
| Push notifications | Done | `functions/src/triggers/notifications.ts` (pure mapping + `deliver`), triggers `onGameWritten` / `onChallengeCreated` (`functions/src/index.ts:104`, `:115`). Web: `web/src/lib/push.ts`, `web/public/push-sw.js`. iOS: `PushService.swift`. Bots filtered. Dead tokens pruned. |
| In-app "your move" signals | Done | `ActiveGamesProvider`: `attentionCount`, `(N) Broadside` tab title, "Your turn against X" toast (skips the first snapshot so reloads don't toast). |
| Reconnect / read-after-reload | Done (by design) | All state lives in Firestore. `GamePage` re-subscribes (`listenGame`, `listenPrivateBoard`) on mount; `diffGameEvents(null, g)` emits nothing; `FeelDirector` gets `initialShots` = current counts so history is not replayed; `gameFromSnapshot` defaults legacy fields. |
| Abandonment timeout | Done | `claimTimeoutWin` (`games.ts:830`), 3-day `ABANDON_TIMEOUT_MS` (`functions/src/game/config.ts:18`), `AbandonControls.tsx` countdown + "Claim the win"; core `claimTimeout` action in `reducer.ts`. |
| Stale cleanup | Done | `cleanupStale` / `cleanupStaleGames` (daily): unjoined games (7 d), Quick Match tickets (10 min), pending challenges (48 h). |
| Optional per-turn timers | **Not built** | See §5. |

## 2. Existing test coverage

- `functions/test/handlers.test.ts` (emulator): create/join/cancel, placement, Classic and
  Salvo firing, resign, timeout claims (active + placing, bot exemption), Quick Match
  (queueing, mode, rating band, anti-farming, re-poll returns matched game), rematch
  (both paths, idempotent request), challenges (lifecycle, expiry, mode), bots, chat,
  reactions, cleanup.
- `functions/test/rules.test.ts`: game/private-board/chat/reaction/push/Quick Match/challenge
  read/write rules, including "players can list only their own games".
- `functions/src/triggers/notifications.test.ts`: every game/challenge copy path, bot filtering.
- `web/src/game/events.test.ts`, `web/src/feel/director.test.ts`: first snapshot is a
  baseline; `initialShots` treats history as revealed.

### Added in this branch (tests only)

Reconnect/retry behavior was implemented but not pinned by tests:

- `functions/test/reconnect.test.ts` (emulator): resume from fresh reads of game + private
  boards (incl. `coreStateFromGame`); retrying a shot or Salvo volley after a lost response
  does not fire twice; guest re-opening the join link gets the same game; accepting a
  challenge twice yields one game; invitee retrying rematch acceptance gets the same game;
  every accepted move/placement refreshes `lastMoveAt` (the clock timers will build on).
- `web/src/game/reload.test.ts`: `gameFromSnapshot` round-trip + legacy defaults; no events
  on the reload snapshot, only new ones afterwards; `FeelDirector` with `initialShots`
  starts settled and reveals only new shots.

## 3. Gaps found (not fixed — Phase 2 files are read-only)

1. **Salvo "Your turn" push describes only the last shot of a volley.**
   `notifications.ts:90-98` uses `shots[opp].at(-1)`. Recommend a volley summary
   (copy in §4) built from the shots added between `before` and `after`.
2. **Challenge pushes don't deep-link.** `deliver` sends `{ challengeId }`
   (`notifications.ts:131`), but `push-sw.js:32-33` and `PushService.swift:49-51` only read
   `gameId`, so taps open `/` (Home shows the challenge, so this is usable). Recommend
   routing `challengeId` to Home with the challenge highlighted (iOS change is out of scope here).
3. **Quick Match queue UI doesn't survive a reload.** `quickMatching` is local state
   (`HomePage.tsx:35`); the ticket lives on for up to 10 min. If a match lands while away the
   game appears in "Your games", but there is no "still searching" state on return.
   Recommend reading `quickMatch/{uid}` on Home mount to resume the modal (touches
   `HomePage.tsx`, Phase 2-owned).
4. **No "your move" reminder.** Push fires once per turn change; nothing nudges a player who
   ignored it before the 3-day forfeit. This is the brief's core Phase 3 weakness (§4, §5).
5. **`abandonTimeoutMs` has no fallback.** `gameFromSnapshot` defaults it to `0` and
   `claimTimeoutWin` compares against the raw field (`games.ts:850-852`). All games created
   by `newGameDoc` (`games.ts:104`) set it, so this only matters for hand-made/legacy docs;
   recommend `?? GAME_CONFIG.ABANDON_TIMEOUT_MS` when timers land.
6. **Browser-level reconnect is untested.** Web tests run in Node without a DOM, so listener
   re-subscription in `GamePage` / `ActiveGamesProvider` is covered only via pure modules.
   Recommend one Playwright emulator flow: fire, reload, verify board + turn + no replayed FX.

## 4. Notification event → copy mapping (draft, not wired)

Existing (keep): rematch request, opponent joined, opponent ready, battle stations, your
turn, fleet destroyed, victory (resign), game forfeited (timeout), challenge received.

Proposed additions:

| Event (source) | Recipient | Title | Body | Data |
|---|---|---|---|---|
| Salvo turn change (`onGameWritten`, shots added this write) | next shooter | `Your turn` | `{opp} fired {n} shots: {hits} hit{, sank your {ship}}.` | `gameId` |
| Turn reminder (scheduled, idle ≥ 24 h) | `currentTurnUid` | `{opp} is waiting` | `Your move — {timeLeft} before they can claim the win.` | `gameId` |
| Timeout warning (scheduled, ≤ 12 h left) | `currentTurnUid` | `Last call` | `Move within {timeLeft} or {opp} can claim the win.` | `gameId` |
| Opponent can now claim (deadline passed) | waiting player | `You can claim the win` | `{opp} hasn't moved in {days} days.` | `gameId` |
| Placement reminder (scheduled, opponent ready, idle ≥ 24 h) | unready player | `{opp} is ready` | `Place your fleet — {timeLeft} left.` | `gameId` |
| Challenge accepted (`challenges` update → accepted) | challenger | `{opp} accepted` | `Place your fleet to begin.` | `gameId` |
| Challenge declined | challenger | `{opp} declined` | `Try Quick Match or challenge someone else.` | — |
| Rematch accepted (`requestRematch` by invitee) | requester | `{opp} accepted the rematch` | `Place your fleet to begin.` | `gameId` (new) |
| Per-turn timer expired (only if §5 enabled) | both | `Time's up` | `{loser} ran out of time.` | `gameId` |

Rules: never push bots; reminders at most once per turn (store `remindedAt` per turn);
respect quiet hours if/when user timezone is stored; `apns.thread-id` stays `gameId`.

## 5. Optional timers — exact files and hooks

Existing inputs: `game.lastMoveAt` (set at create/join/place/fire: `games.ts:109,121,310,487,530,632`),
`game.abandonTimeoutMs`, `game.currentTurnUid`, `players.*.ready`.

To add an optional per-turn timer without touching turn mutation:

- **Config:** `functions/src/game/config.ts` — allowed presets (e.g. off / 24 h / 72 h).
- **Record field:** `turnTimeoutMs` (or reuse `abandonTimeoutMs` with a per-game value) in
  `functions/src/types.ts` `GameDoc` and `newGameDoc` (`games.ts:~100`) — Phase 2/lead-owned; needs the final game-record shape.
- **Create paths:** `createGame`, `acceptInTx` in `challenges.ts:51`, `requestRematch`
  (copy from source game), `joinQuickMatch` (default only).
- **Enforcement:** keep claim-based forfeits by reusing `claimTimeoutWin` (`games.ts:830`)
  with the per-game value; for auto-forfeit add a scheduled function next to
  `cleanupStaleGames` (`functions/src/index.ts:123`) that queries active games with
  `lastMoveAt < now - timeout` and calls the existing `endGameByRule(..., 'timeout')` in a
  transaction — no reducer change; the core `claimTimeout` action already models it.
- **Reminders:** same scheduled function emits §4 reminders via `deliver`.
- **Index:** composite index on `games(status, lastMoveAt)` in `firestore.indexes.json`.
- **UI:** `AbandonControls.tsx` already computes the remaining time (refreshes every 60 s);
  timer badge in `ActiveGameView` / `gameRowStatus` (`web/src/lib/types.ts`) — both read-only now.
- **Tests:** emulator tests mirroring `handlers.test.ts` timeout cases with backdated `lastMoveAt`.

## 6. Open decisions

1. Per-turn timer: off by default? Presets? Claim-based (current) vs automatic forfeit?
2. Should an automatic timer forfeit be rated like today's claim (`endGameByRule` → `finishGame` applies Elo to human games)?
3. Reminder cadence and quiet hours (no user timezone is stored today).
4. Guest play for invites (brief decision still open; today a username is required).
5. Should challenge/rematch acceptance pushes be added, or is the in-app list enough?
6. Which Phase 2 record fields (mode, abilities state) must carry into rematch/timer games.

## 7. Dependencies on Phase 2 integration

Timers need the final `GameDoc` shape (`functions/src/types.ts`) and `newGameDoc`. Gaps 1–3
touch `notifications.ts` (shared), `HomePage.tsx`, `push-sw.js` — schedule after Phase 2 lands.
