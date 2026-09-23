/** Shown when no Firebase config is present, so a fresh deploy explains itself instead of crashing. */
export function SetupPage() {
  return (
    <div className="app page page--center">
      <div className="card stack">
        <h1 className="title">Broadside needs its Firebase settings</h1>
        <p className="muted">
          This copy of the app hasn't been connected to a Firebase project yet, so it can't sign anyone in.
        </p>
        <p>
          Open the project's <b>README.md</b> and follow <b>Step 3 – Set up the Firebase project</b>. When running on
          your own computer, paste your Firebase web config into <span className="mono">web/.env.local</span>. On
          Firebase Hosting the config is picked up automatically once a web app is registered with{' '}
          <i>Also set up Firebase Hosting</i> ticked.
        </p>
        <p className="muted small">
          Variables expected: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
          VITE_FIREBASE_APP_ID.
        </p>
      </div>
    </div>
  );
}
