# Manual steps — things only you (the owner) can do

Tick these off in order. Details for each are in the matching README section.

## Firebase (once, ~20 min)
- [ ] Create a Firebase project; try to make the **Project ID** `broadside-dev`. *(README §3a)*
- [ ] Authentication → enable **Email/Password** and **Google**. *(§3b)*
- [ ] Create the **Firestore** database (production mode). *(§3b)*
- [ ] Hosting → *Get started*. *(§3b)*
- [ ] Upgrade to the **Blaze** plan and set a budget alert. *(§3b)*
- [ ] Register a **Web app**, ticking *Also set up Firebase Hosting*. Keep the `firebaseConfig` values handy. *(§3c)*
- [ ] Only if the Project ID is not `broadside-dev`: edit `.firebaserc` and add the GitHub variable
      `FIREBASE_PROJECT_ID`. *(§3d)*

## Deploy the game server (once, then whenever server code changes)
- [ ] Install Node.js 22, then in the repo folder run `npm run setup`. *(§2)*
- [ ] `npm run firebase:login`, then `npm run deploy:backend`. *(§3f)*
- [ ] After the `FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV` secret exists, server deploys happen on
      merge instead — grant that service account the *Cloud Functions Admin*, *Service Account
      User*, *Firebase Rules Admin* and *Artifact Registry Administrator* roles in Google Cloud
      → IAM. *(§3f)*

## Preview links + automatic live site (once, ~10 min)
- [ ] Follow **docs/TESTING_PREVIEWS.md** to create the GitHub secret
      `FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV`. *(§4)*
- [ ] Open the PR's preview link on your phone and play a game against yourself
      (two browsers / one private window). *(§4)*
- [ ] Merge the PR → the live link `https://<project-id>.web.app` goes live. Share it. *(§5)*

## Optional / later
- [ ] Browser push notifications: Firebase → Project settings → Cloud Messaging → *Web Push
      certificates* → Generate key pair. Add it as a GitHub repository **variable** named
      `VITE_FIREBASE_VAPID_KEY` (Settings → Secrets and variables → Actions → Variables) and
      locally in `web/.env.local`. A "Notifications" section then appears on the Profile tab.
      (In-app "your turn" indicators already work without this.)
- [ ] Custom domain: Hosting → *Add custom domain*, then add it to Authorized domains too.
- [ ] Change rules (ships may touch, timeout, Elo K-factor) in `functions/src/game/*.ts`,
      then merge (the deploy workflow ships them) or run `npm run deploy:backend`. *(§6)*
- [ ] Native iPhone app (on hold): see `ios/README.md` — needs a Mac, Xcode and an Apple
      Developer account.
