/** Shown when no Firebase config is present, so a fresh deploy explains itself instead of crashing. */
export function SetupPage() {
  return (
    <main className="app page page--center setup">
      <div className="card stack setup__card">
        <p className="panel-title">
          <span className="setup__status" aria-hidden="true" />
          Systems offline
        </p>
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
        <div className="setup__vars">
          <p className="panel-title">Variables expected</p>
          <ul className="mono small">
            <li>VITE_FIREBASE_API_KEY</li>
            <li>VITE_FIREBASE_AUTH_DOMAIN</li>
            <li>VITE_FIREBASE_PROJECT_ID</li>
            <li>VITE_FIREBASE_APP_ID</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
