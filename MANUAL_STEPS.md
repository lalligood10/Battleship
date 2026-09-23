# Manual steps — things only you (the owner) can do

Tick these off in order. Details for each are in the matching README section.

## Accounts & tools (once)
- [ ] Get a Mac with macOS 14+ and install **Xcode 15+** from the Mac App Store. *(README §2)*
- [ ] Join the **Apple Developer Program** ($99/yr) at developer.apple.com. *(§2)*
- [ ] Install Homebrew, then `brew install node@22` and `npm install -g firebase-tools`. *(§2)*

## Firebase (once)
- [ ] Create a Firebase project; note the **Project ID**. *(§3a)*
- [ ] Authentication → enable **Apple** and **Email/Password**. *(§3b)*
- [ ] Create the **Firestore** database (production mode). *(§3b)*
- [ ] Upgrade to the **Blaze** plan and set a budget alert. *(§3b)*
- [ ] Register the iOS app with bundle ID `com.broadside.app`, download **GoogleService-Info.plist**,
      save it as `ios/Broadside/Config/GoogleService-Info.plist`. Never commit it. *(§3c)*
- [ ] Replace `broadside-dev` in `.firebaserc` and `YOUR-FIREBASE-PROJECT-ID` in
      `ios/project.yml` and `ios/Broadside/Features/Game/GameScreen.swift` with your Project ID. *(§3d)*
- [ ] `firebase login`, then `firebase deploy` from the repo folder. *(§3e)*

## First run
- [ ] `cd ios && ./generate.sh`, open `Broadside.xcodeproj`, wait for packages, press Run. *(§4)*
- [ ] Signing & Capabilities → tick *Automatically manage signing* → choose your **Team**. *(§5)*
- [ ] Copy your **Team ID** into `hosting/public/.well-known/apple-app-site-association`
      (replace `TEAMID`) and run `firebase deploy --only hosting`. *(§5)*
- [ ] On your iPhone enable **Developer Mode**, plug in, Run, then trust the developer profile. *(§5)*

## Push notifications
- [ ] Create an **APNs key** (.p8) at developer.apple.com, download it once, keep it safe. *(§5a)*
- [ ] Upload the .p8 (with Key ID + Team ID) in Firebase → Project settings → Cloud Messaging. *(§5a)*

## Sharing with friends
- [ ] Create the app record in **App Store Connect** (bundle `com.broadside.app`). *(§6)*
- [ ] Xcode → Product → **Archive** → Distribute → TestFlight. *(§6)*
- [ ] Add testers' Apple ID emails under TestFlight → Internal Testing. *(§6)*

## Optional / later
- [ ] Google sign-in: enable in Firebase Auth, add `GoogleSignIn` package + URL scheme (not wired up yet).
- [ ] Change rules (ships may touch, timeout, Elo K-factor) in `functions/src/game/*.ts` and redeploy. *(§7)*
