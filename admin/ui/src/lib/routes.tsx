import { Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactElement } from 'react';
import { PageBoundary } from '../components/PageBoundary';
import type { AuthUser } from '../../../shared/types';
const CrystalTickets = lazy(() => import('../pages/CrystalTickets'));
const Dashboard = lazy(() => import('../pages/Dashboard'));
const GlobalWorkReview = lazy(() => import('../pages/GlobalWorkReview'));
const GlobalWorks = lazy(() => import('../pages/GlobalWorks'));
const Harmonizer = lazy(() => import('../pages/Harmonizer'));
const NovaSubmissions = lazy(() => import('../pages/NovaSubmissions'));
const NovaVodSubmissions = lazy(() => import('../pages/NovaVodSubmissions'));
const Pipeline = lazy(() => import('../pages/Pipeline'));
const SongDetail = lazy(() => import('../pages/SongDetail'));
const SongsList = lazy(() => import('../pages/SongsList'));
const StampEditor = lazy(() => import('../pages/StampEditor'));
const StreamDetailPage = lazy(() => import('../pages/StreamDetail'));
const StreamsList = lazy(() => import('../pages/StreamsList'));
const SubmitSong = lazy(() => import('../pages/SubmitSong'));
const SubmitStream = lazy(() => import('../pages/SubmitStream'));
const VodExport = lazy(() => import('../pages/VodExport'));
const VodExportRepair = lazy(() => import('../pages/VodExportRepair'));

export interface AdminRoute {
  /** Path as react-router matches it. */
  path: string;
  /** The page itself; `user` reaches only the pages that ask for it. */
  render: (user: AuthUser) => ReactElement;
  /** Sidebar entry. A route without one is reachable but not listed. */
  label?: string;
  /** Curator-only: a contributor is sent back to the dashboard. */
  curatorOnly?: boolean;
  /** Rendered in the prism visual vocabulary (gradient page, glass shell). */
  prismShell?: boolean;
}

/**
 * Every page of the Admin, described once. The routes, the sidebar order, who
 * may open what and which pages wear the prism shell used to be four lists that
 * had to be edited together; they are all read from this one now.
 */
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { path: '/', label: 'Dashboard', render: () => <Dashboard /> },
  { path: '/songs', label: 'Songs', render: (user) => <SongsList user={user} /> },
  { path: '/works', label: 'Global Library', curatorOnly: true, render: () => <GlobalWorks /> },
  { path: '/works/review', label: 'Work Review', curatorOnly: true, render: () => <GlobalWorkReview /> },
  { path: '/songs/:id', render: (user) => <SongDetail user={user} /> },
  { path: '/streams', label: 'Streams', render: (user) => <StreamsList user={user} /> },
  { path: '/streams/:id', render: (user) => <StreamDetailPage user={user} /> },
  { path: '/submit/song', label: 'Submit Song', render: () => <SubmitSong /> },
  { path: '/submit/stream', label: 'Submit Stream', render: () => <SubmitStream /> },
  { path: '/stamp', label: 'Stamp Editor', render: (user) => <StampEditor user={user} /> },
  { path: '/pipeline', label: 'Pipeline', render: () => <Pipeline /> },
  { path: '/harmonizer', label: 'Harmonizer', render: () => <Harmonizer /> },
  { path: '/nova', label: 'Nova', prismShell: true, render: (user) => <NovaSubmissions user={user} /> },
  {
    path: '/nova/vods',
    label: 'Nova VODs',
    prismShell: true,
    render: (user) => <NovaVodSubmissions user={user} />,
  },
  { path: '/crystal', label: 'Crystal', prismShell: true, render: (user) => <CrystalTickets user={user} /> },
  { path: '/vod-export', label: 'VOD Export', curatorOnly: true, render: (user) => <VodExport user={user} /> },
  {
    path: '/vod-export/repair/:entity/:rowId',
    curatorOnly: true,
    render: (user) => <VodExportRepair user={user} />,
  },
];

/** Curator gate for a route element: anyone else lands back on the dashboard. */
function RequireCurator({ user, children }: { user: AuthUser; children: ReactElement }) {
  return user.role === 'curator' ? children : <Navigate to="/" replace />;
}

/** The page element for one manifest entry, gated when the entry says so. */
export function routeElement(route: AdminRoute, user: AuthUser): ReactElement {
  const page = (
    <PageBoundary key={route.path}>
      <Suspense fallback={<p role="status" className="p-6 text-slate-500">Loading page...</p>}>
        {route.render(user)}
      </Suspense>
    </PageBoundary>
  );
  return route.curatorOnly ? <RequireCurator user={user}>{page}</RequireCurator> : page;
}

const PRISM_SHELL_PATHS = new Set(
  ADMIN_ROUTES.flatMap((route) => (route.prismShell ? [route.path] : [])),
);

/** Whether the shell around this path is the prism one rather than the slate default. */
export function usesPrismShell(pathname: string): boolean {
  return PRISM_SHELL_PATHS.has(pathname);
}
