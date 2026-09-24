# Broadside

Broadside is a web game you open in any browser — on your phone or your computer — where you and
a friend each hide a fleet of five ships on a 10×10 grid and take turns firing at each other's
waters. Games are played over the internet, turn by turn: you don't both need to be online at
once, and the app shows you which games are waiting on you. Every finished game updates your
rating, and there are Global, Weekly and Friends leaderboards.

This README is written for the product owner (no coding experience needed). It explains what
you're looking at, which accounts you need, and every step you have to do by hand. The short
version of those hand-steps is in **[MANUAL_STEPS.md](MANUAL_STEPS.md)** — use it as your
checklist.

> Naming note: the GitHub repo is called "Battleship", but the app is deliberately named
> **Broadside** and uses its own artwork so it doesn't infringe Hasbro's trademark.

---

## 1. What's in this repo

```
web/            The web app (React + TypeScript). Works on phones and desktops.
functions/      The game server (Firebase Cloud Functions, TypeScript) – validates every move
functions/src/game/   Pure game rules (board, placement, hit/miss/sunk, Elo). Shared by server AND web app.
firestore.rules       Database security rules (this is what keeps ships hidden from cheaters)
firestore.indexes.json  Database indexes the leaderboards/history need
firebase.json / .firebaserc   Firebase project configuration (hosting, functions, emulators)
.github/workflows/    Automation: tests on every change, preview link on every PR, deploy on merge
docs/TESTING_PREVIEWS.md   How preview links work and the one-time setup for them
ios/            The native iPhone app – ON HOLD. Same backend; see ios/README.md
```

### How the anti-cheat works (plain English)

- Your ship positions are saved in a private record that **only you** can read. The database
  rules literally refuse to hand that record to anyone else — including your opponent's browser.
- When you fire, your browser doesn't check the shot itself. It asks the server "I'm firing at
  B7", and the server looks at the opponent's hidden fleet and answers only
  *hit*, *miss* or *sunk*.
- The server also checks that it's actually your turn, that the cell is on the board, and that
  you haven't fired there before. A tampered-with browser can't cheat its way around any of that.
- Ratings, stats and leaderboards are only ever written by the server, never by browsers.

### Technology choices (for the curious)

| Piece | Choice | Why |
| --- | --- | --- |
| Web app | React + TypeScript, built with Vite | The most widely used web UI stack; fast to build, easy to hire for |
| Backend | Firebase (Auth, Firestore, Cloud Functions) | Realtime sync, generous free tier, callable functions fit the "hidden board + server-validated moves" design directly |
| Hosting | Firebase Hosting | Same account as the backend; a live link that updates itself when the code changes and a preview link for every proposed change |
| Rating | Elo, start 1000, K=32 | Industry standard; all the maths is in one file (`functions/src/game/scoring.ts`) |
| "Your turn" alerts | In-app first (active-games list, tab badge, toast) | Browser push notifications are unreliable on phones, so they're optional extra, never required |

---

## 2. Prerequisites (things you need before anything works)

1. **A Google account** for Firebase. The free "Spark" plan is fine to start; Cloud Functions
   require the "Blaze" pay-as-you-go plan, which still has a large free quota — expect $0/month
   at friends-and-family scale, but a card must be on file.
2. **A GitHub account** (you have one — this repo lives there).
3. To run things on your own computer (optional — you can do everything via GitHub + the web):
   **Node.js 22** from https://nodejs.org (pick the "LTS" download) and **Java 21** (only needed
   for the local Firebase emulator, e.g. https://adoptium.net). Then, in a terminal, from the
   repo folder: `npm run setup`.

No Mac, Xcode or Apple Developer account is needed for the web version.

---

## 3. Set up the Firebase project (one-time, ~20 minutes)

### 3a. Create the project

1. Go to https://console.firebase.google.com and click **Add project**.
2. Name it `broadside`. Firebase shows a **Project ID** underneath the name (e.g.
   `broadside-1a2b3`); you can click it to edit. Try `broadside-dev` — if it's available, the
   rest of the repo already matches it. Google Analytics can be turned **off**. Click **Create**.
3. If you ended up with a different Project ID, see the table in §3d.

### 3b. Turn on the pieces we use

1. **Build → Authentication** → *Get started* → **Sign-in method** tab:
   - Enable **Email/Password**.
   - Enable **Google** (pick a support email when asked).
2. **Build → Firestore Database** → *Create database* → choose **Production mode** → pick a
   region close to you (`us-central1` matches where the functions run) → *Enable*.
3. **Build → Hosting** → *Get started* → click through the wizard (you can skip the commands it
   shows). This gives you your live web address: `https://<project-id>.web.app`.
4. **Upgrade to the Blaze plan** (bottom-left "Upgrade") — required for Cloud Functions.
   Set a budget alert (e.g. $5) so you'd be emailed if anything unexpected happened.

### 3c. Register the web app

1. Project settings (gear icon) → *Your apps* → click the **</>** (Web) icon.
2. Nickname: `Broadside web`. Tick **Also set up Firebase Hosting** and pick the site that was
   created in 3b. Click *Register app*.
3. Firebase shows a block of code containing `firebaseConfig = { apiKey: "...", ... }`. Keep this
   tab open — those are the values used in the next step. (They are *not* secret passwords;
   they identify your project. Access is protected by the security rules.)
4. Skip the remaining wizard steps — the code already has them.

### 3d. Tell the code your project ID

Only needed if your Project ID is **not** `broadside-dev`:

| Where | Change |
| --- | --- |
| `.firebaserc` | replace `broadside-dev` with your Project ID |
| GitHub → repo **Settings → Secrets and variables → Actions → Variables** tab | add a variable `FIREBASE_PROJECT_ID` = your Project ID |

### 3e. Put the Firebase config where the app can read it

- **Live site on Firebase Hosting:** nothing to do — Firebase Hosting hands the config to the app
  automatically.
- **Running on your own computer against the real cloud project:** copy `web/.env.example` to
  `web/.env.local` and fill in the values from 3c (`apiKey` → `VITE_FIREBASE_API_KEY`,
  `authDomain` → `VITE_FIREBASE_AUTH_DOMAIN`, `projectId` → `VITE_FIREBASE_PROJECT_ID`,
  `appId` → `VITE_FIREBASE_APP_ID`). This file is git-ignored on purpose.

If the config is missing, the app shows a friendly "Broadside needs its Firebase settings" page
instead of crashing.

### 3f. Deploy the server (rules, indexes, Cloud Functions)

Once the `FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV` secret exists (§4), GitHub deploys the server
for you: merging a change under `functions/` or to the Firestore rules runs the **Deploy Cloud
Functions and Firestore rules** workflow. You can also run it by hand from the *Actions* tab →
that workflow → *Run workflow*. The service account needs the *Cloud Functions Admin*, *Service
Account User*, *Firebase Rules Admin* and *Artifact Registry Administrator* roles; if the run
fails with a permission error, add them in the Google Cloud console → IAM.

To deploy from your own machine instead — the same three commands every time the server code
changes, from the repo folder:

```
npm run setup                                     # first time only: installs everything
npm run firebase:login                            # opens a browser; sign in with the Google account from 3a
npm run deploy:backend                            # uploads rules, indexes and functions (3–5 min first time)
```

> The website itself is deployed automatically by GitHub (§5). If you'd rather push it by hand:
> `npm run deploy:hosting`.

---

## 4. Testing while it's being built (preview links)

Every pull request (proposed change) gets its own temporary web address, posted as a comment on
the PR within a few minutes, e.g. `https://broadside-dev--pr-12-abc123.web.app`. Click it on your
phone or computer and play. When a fix is pushed, the same link updates — just refresh.

This needs a one-time permission so GitHub may publish to your Firebase project. Follow
**[docs/TESTING_PREVIEWS.md](docs/TESTING_PREVIEWS.md)** (10 minutes, guided). Until that's done,
the PR shows a yellow warning instead of a link.

### Trying it with no Firebase project at all (developer preview)

The app can run entirely on your computer against a fake, local copy of Firebase — no accounts,
no cloud, nothing to pay for. Open two terminals in the repo folder:

```
npm run emulators      # terminal 1 – local Auth/Firestore/Functions (needs Java 21)
npm run web            # terminal 2 – the web app at http://localhost:5173
```

Open `http://localhost:5173` in two different browsers (or one normal + one private window) to
play against yourself. Anyone on your Wi-Fi can open the "Network" address the second command
prints, so you can test on your phone too. Data is wiped when the emulator stops.

---

## 5. The live link (automatic deployment)

Once §3 and the preview setup in §4 are done, the live site is fully automatic:

- **Merging a PR into `main`** → GitHub builds the web app and publishes it to
  `https://<project-id>.web.app` (also `https://<project-id>.firebaseapp.com`). Share that link
  with friends; it never changes.
- **Opening a PR** → GitHub publishes a preview link for that change only (§4).
- **Every change** also runs the automated tests (`CI` in the GitHub *Actions* tab). A red ✗ next
  to a commit means something is broken and shouldn't be merged.

Google sign-in works on the `.web.app` address out of the box. If you add a custom domain later
(Hosting → *Add custom domain*), also add it under Authentication → Settings → **Authorized
domains**.

---

## 6. How to play (what your testers will see)

1. Open the link → **Create account** with email + password, or *Continue with Google*.
2. Pick a unique username — checked live against the server, with a profanity filter.
3. **Start a game with a friend** → you get a 6-letter code and *Copy link* / *Share* buttons.
   Your friend enters the code under **Join with a code** or opens the link (they'll be asked to
   sign in first and then land straight in the game).
4. Both players **place ships**: drag them with a mouse, or on a phone tap a ship then tap where
   it should go. *Rotate* turns the selected ship, *Shuffle* gives a random legal layout. Press
   **Lock in fleet**.
5. Take turns: tap a cell on the enemy grid (top), then **Fire**. Hits, misses and sunk ships are
   shown and announced with sound (mute button top-right). The other player's board updates live.
6. First to sink all five ships wins. Ratings update immediately and the results screen reveals
   both fleets. Game history lives on the **Profile** tab.
7. The **Play** tab lists your games; anything waiting on you is marked **Your turn** / **Place
   your fleet**, and the tab badge and browser tab title `(2) Broadside` count them.
8. **Resign** is at the bottom of the board. If an opponent goes silent for 3 days (configurable),
   a **Claim win** button appears for the waiting player. Games nobody joined disappear after 7 days.
9. **Quick Match** pairs you with whoever else is waiting in the queue.

Changeable game settings live in `functions/src/game/config.ts` (board size, whether ships may
touch, inactivity timeout) and `functions/src/game/scoring.ts` (Elo constants). The web app reads
the same files, so change them once, then `npm run deploy:backend` and merge to `main`.

---

## 7. For developers

```
npm run setup            # install web + functions dependencies
npm test                 # all unit tests (server engine/Elo/rules-helpers + web placement/marks/scoring)

cd functions
npm run test:emulator    # integration tests against the Firestore emulator (needs Java 21)
npm run lint && npm run typecheck && npm run build

cd web
npm run dev              # dev server against the cloud project in web/.env.local
npm run dev:local        # dev server against the local emulators (npm run emulators first)
npm run lint && npm run typecheck && npm run build
```

Layout notes: `web/src/lib/` wraps Firebase (all writes go through callable functions in
`api.ts`; `firestore.ts` is read-only listeners), `web/src/state/` holds session and active-game
providers, `web/src/game/` is browser-side pure logic that imports the shared engine from
`functions/src/game` via the `@shared` alias, and `web/src/pages/` are the screens.

---

## 8. Costs and limits to be aware of

- Firebase Blaze: free quota is ~2M function calls, 50k document reads and 20k writes **per day**,
  and 10 GB/month of hosting bandwidth. A game is roughly 100 reads/writes total, so hundreds of
  games a day are free.
- Preview links expire after 7 days (each new commit refreshes them).

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Broadside needs its Firebase settings" page | Locally: the four `VITE_FIREBASE_*` values are missing from `web/.env.local` (§3e). On Firebase Hosting: make sure the web app was registered with *Also set up Firebase Hosting* (§3c). |
| "Missing or insufficient permissions" or a leaderboard tab never loads | Run `npm run deploy:backend` — rules or indexes not deployed. Indexes take a few minutes to build; Firebase console → Firestore → Indexes shows progress. |
| Sign-in fails with *unauthenticated* / functions fail | Make sure Email/Password and Google are enabled in Authentication (§3b) and the functions were deployed (§3f). |
| A new feature (e.g. *Play vs Computer*) says it isn't available yet | The website updated but the server didn't. Run the **Deploy Cloud Functions and Firestore rules** workflow from the *Actions* tab, or `npm run deploy:backend` (§3f). |
| Google sign-in popup says "unauthorized domain" | Add the site's hostname under Authentication → Settings → Authorized domains (§5). |
| No preview link comment on a PR | The `FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV` secret is missing — see docs/TESTING_PREVIEWS.md. Check the *Actions* tab for a yellow warning. |
| Preview/deploy fails with "project not found" | Your Project ID isn't `broadside-dev`; set the `FIREBASE_PROJECT_ID` repository variable (§3d). |
| `npm run emulators` fails mentioning Java | Install Java 21 (https://adoptium.net) and reopen the terminal. |
