import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MAIN_ID } from './a11y/landmarks';
import { Alert, Spinner, TabBar } from './components/ui';
import { isConfigured } from './lib/firebase';
import { AdminPage } from './pages/AdminPage';
import { DailyPage } from './pages/DailyPage';
import { GamePage } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { LeaderboardsPage } from './pages/LeaderboardsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SetupPage } from './pages/SetupPage';
import { SignInPage } from './pages/SignInPage';
import { UsernamePage } from './pages/UsernamePage';
import { ActiveGamesProvider, useActiveGames } from './state/ActiveGamesProvider';
import { SessionProvider, useSession } from './state/SessionProvider';
import { useTheme } from './state/theme';

const DevPlaytestPage = import.meta.env.DEV ? lazy(() => import('./pages/DevPlaytestPage')) : null;

export default function App() {
  useTheme();
  if (!isConfigured()) return <SetupPage />;
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </BrowserRouter>
  );
}

function Shell() {
  const { state, error, clearError, signOut } = useSession();
  const location = useLocation();

  if (state.kind === 'loading') {
    return (
      <AppFrame>
        <div className="page page--center">
          <Spinner label="Loading…" />
        </div>
      </AppFrame>
    );
  }

  if (state.kind === 'signedOut') {
    return (
      <AppFrame>
        {error && <Alert onDismiss={clearError}>{error}</Alert>}
        <Routes>
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="*" element={<SignInPage />} />
        </Routes>
      </AppFrame>
    );
  }

  if (state.kind === 'needsUsername') {
    return (
      <AppFrame>
        {error && <Alert onDismiss={clearError}>{error}</Alert>}
        <UsernamePage />
      </AppFrame>
    );
  }

  if (state.profile.suspended) {
    return (
      <AppFrame>
        <div className="page page--center">
          <div className="card stack center">
            <h1 className="title">Account suspended</h1>
            <p className="muted">This account cannot play or appear on the leaderboards.</p>
            <button className="btn btn--secondary" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      </AppFrame>
    );
  }

  const hideTabs = location.pathname.startsWith('/game/');
  return (
    <ActiveGamesProvider uid={state.user.uid}>
      <AppFrame footer={!hideTabs && <TabBarWithBadge />}>
        {error && <Alert onDismiss={clearError}>{error}</Alert>}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/game/:gameId" element={<GamePage />} />
          <Route path="/leaderboards" element={<LeaderboardsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/daily" element={<DailyPage />} />
          <Route path="/admin" element={<AdminPage />} />
          {import.meta.env.DEV && DevPlaytestPage && (
            <Route
              path="/dev/playtest"
              element={
                <Suspense fallback={<Spinner label="Loading playtest analytics…" />}>
                  <DevPlaytestPage />
                </Suspense>
              }
            />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppFrame>
    </ActiveGamesProvider>
  );
}

/** App chrome: a skip link, the routed content as the `main` landmark, then any navigation. */
export function AppFrame({ children, footer }: { children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="app">
      <a className="skip-link" href={`#${MAIN_ID}`}>
        Skip to content
      </a>
      <main id={MAIN_ID} className="app-main" tabIndex={-1}>
        {children}
      </main>
      {footer}
    </div>
  );
}

function TabBarWithBadge() {
  const { attentionCount } = useActiveGames();
  return <TabBar attention={attentionCount} />;
}
