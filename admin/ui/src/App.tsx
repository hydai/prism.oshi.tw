import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { AuthUser } from '../../shared/types';
import { api } from './api/client';
import Layout from './components/Layout';
import { ConfirmProvider } from './components/ui/confirm';
import { EmptyState, Skeleton } from './components/ui/Display';
import { ThemeProvider } from './components/ui/theme';
import { ToastProvider } from './components/ui/toast';
import { useCurrentStreamer } from './hooks/useCurrentStreamer';
import { ADMIN_ROUTES, routeElement } from './lib/routes';

/** The routed pages, straight from the manifest — nothing to keep in sync here. */
export function AppRoutes({ user }: { user: AuthUser }) {
  return (
    <Routes>
      {ADMIN_ROUTES.map((route) => (
        <Route key={route.path} path={route.path} element={routeElement(route, user)} />
      ))}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * Every page loads its streamer's data once, when it mounts. Keying the routed
 * subtree by the selection therefore makes a streamer switch replace all of
 * them, instead of leaving a page showing the streamer you just left.
 */
export function StreamerScopedRoutes({ streamer, user }: { streamer: string; user: AuthUser }) {
  return <AppRoutes key={streamer} user={user} />;
}

/** Who is signed in decides what renders: a skeleton while asking, the reason if nobody is. */
function AuthGate() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const streamer = useCurrentStreamer();

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to authenticate');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-64">
          <Skeleton rows={3} />
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <EmptyState icon="lock" title="Authentication Required" body={error ?? 'Unable to verify identity.'} />
      </div>
    );
  }

  return (
    <Layout user={user}>
      <StreamerScopedRoutes streamer={streamer} user={user} />
    </Layout>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthGate />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
