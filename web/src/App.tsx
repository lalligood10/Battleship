import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Alert, Spinner, TabBar } from './components/ui';
import { isConfigured } from './lib/firebase';
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
  const { state, error, clearError } = useSession();
  const location = useLocation();

  if (state.kind === 'loading') {
    return (
      <div className="app page page--center">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (state.kind === 'signedOut') {
    return (
      <div className="app">
        {error && <Alert onDismiss={clearError}>{error}</Alert>}
        <Routes>
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="*" element={<SignInPage />} />
        </Routes>
      </div>
    );
  }

  if (state.kind === 'needsUsername') {
    return (
      <div className="app">
        {error && <Alert onDismiss={clearError}>{error}</Alert>}
        <UsernamePage />
      </div>
    );
  }

  const hideTabs = location.pathname.startsWith('/game/');
  return (
    <ActiveGamesProvider uid={state.user.uid}>
      <div className="app">
        {error && <Alert onDismiss={clearError}>{error}</Alert>}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/game/:gameId" element={<GamePage />} />
          <Route path="/leaderboards" element={<LeaderboardsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {!hideTabs && <TabBarWithBadge />}
      </div>
    </ActiveGamesProvider>
  );
}

function TabBarWithBadge() {
  const { attentionCount } = useActiveGames();
  return <TabBar attention={attentionCount} />;
}
