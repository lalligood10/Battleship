# How to test the app using preview links

This guide is written for someone with zero software experience. You do not need
to know how to code, and after one short setup you will never need to open a
terminal again.

---

## 1. What is a "preview link"?

Every time a change is proposed to the app, a temporary copy of the app is put
online at its own web address. That address is a **preview link**.

- It is a normal web link. You click it and the app opens in your browser.
- It is a *copy*. Anything you do there cannot break the real app.
- It expires on its own after a while. Nothing to clean up.

## 2. The routine, start to finish

1. **Devin proposes a change.** On GitHub this is called a "pull request" (PR).
   Think of it as "here is a suggested change, please look at it."
2. **A robot comment appears on that page**, usually within a couple of minutes.
   It says something like:

   > Visit the preview URL for this PR (updated for commit abc1234):
   > https://broadside-dev--pr-12-abc123.web.app

3. **You click the link.** The app opens. Try it out like a regular user.
4. **You reply.** On the pull request page, scroll to the bottom, type your
   thoughts in the comment box, and press "Comment".
   - Happy with it? Say so, or click the green **Merge pull request** button to
     make the change real.
   - Something wrong? Describe what you saw and what you expected. Devin will
     push a fix, and **the same preview link updates automatically** — just
     refresh the page in your browser.

That's the whole loop: open PR → preview link appears → you click and try it →
you approve or ask for changes.

---

## 3. The one-time setup you must do yourself

This part has to be done by you, because it requires logging into **your own
Google / Firebase account**. Devin cannot log in as you.

You are giving GitHub permission to publish previews to your Firebase project
(`broadside-dev`). That permission is stored as a "secret" in your GitHub
repository. It is stored encrypted; nobody can read it back, not even you.

You only need **one** of the two options below.

### Option A (easiest): let the Firebase tool do it for you

This runs a single command that opens your browser, asks you to log in, and then
creates the GitHub secret for you automatically.

1. Open the Terminal app on your Mac (press `Cmd` + `Space`, type "Terminal",
   press Enter). On Windows, open "PowerShell" from the Start menu instead —
   the commands are the same.
2. Install the Firebase tool (only needed once). Copy and paste this line, press
   Enter, and wait for it to finish:

   ```
   npm install -g firebase-tools
   ```

3. Go into the project folder. If the project is in your Documents folder and is
   called `Battleship`, that is:

   ```
   cd ~/Documents/Battleship
   ```

4. Log in to Firebase (this opens your browser — pick your Google account):

   ```
   firebase login
   ```

5. Run the setup:

   ```
   firebase init hosting:github
   ```

   It will ask you a few questions:
   - "For which GitHub repository...?" → type `lalligood10/Battleship`
   - "Set up the workflow to run a build script before every deploy?" → answer
     **No**
   - "Set up automatic deployment to your site's live channel when a PR is
     merged?" → answer **No** (that part is already set up in this project)
   - If it asks whether to overwrite any existing workflow file, answer **No**.

   When it finishes, it will have created the GitHub secret for you. It is named
   `FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV`. You can skip Option B.

### Option B (manual): create the key yourself and paste it into GitHub

Use this only if Option A did not work.

**Step 1 — get the key file from Google:**

1. Go to https://console.firebase.google.com/ and open the **broadside-dev**
   project.
2. Click the gear icon (top-left, next to "Project Overview") → **Project
   settings**.
3. Click the **Service accounts** tab.
4. Click **Generate new private key**, then **Generate key** to confirm.
5. A `.json` file downloads to your computer. Open it with TextEdit and select
   **all** of the text (`Cmd` + `A`), then copy it (`Cmd` + `C`).
   Keep this file private — it is like a password. Delete it once you are done.

**Step 2 — paste it into GitHub as a secret:**

1. Go to https://github.com/lalligood10/Battleship
2. Click the **Settings** tab (top of the page, on the right).
3. In the left-hand menu, click **Secrets and variables**, then click
   **Actions** underneath it.
4. Click the green **New repository secret** button (top right).
5. In the **Name** box, type exactly:

   ```
   FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV
   ```

   (Spelling and capitals must match exactly.)
6. In the **Secret** box, paste the whole contents of the `.json` file you
   copied.
7. Click **Add secret**.

Done. You should now see `FIREBASE_SERVICE_ACCOUNT_BROADSIDE_DEV` listed on that
page.

---

## 4. After that, you're finished with the technical bits

You never have to touch a terminal again. From now on it is just:
**click the preview link → try the app → leave a comment.**

If a preview comment never shows up on a pull request, it almost always means
the secret above is missing or was pasted incompletely. Click the **Actions**
tab at the top of the GitHub repository page, open the latest run, and look for
a yellow warning saying the secret is not set. Redoing section 3 fixes it.
