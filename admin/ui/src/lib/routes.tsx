import { Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactElement } from 'react';
import { PageBoundary } from '../components/PageBoundary';
import { Skeleton } from '../components/ui/Display';
import type { IconName } from '../components/ui/Icon';
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

/** A sidebar section, in the order it is presented. */
export type NavGroupId = 'overview' | 'catalog' | 'timestamps' | 'library' | 'inbox' | 'publish';

export const NAV_GROUPS: readonly { id: NavGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'timestamps', label: 'Timestamps' },
  { id: 'library', label: 'Library' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'publish', label: 'Publish' },
];

export interface AdminRoute {
  /** Path as react-router matches it. */
  path: string;
  /** The page itself; `user` reaches only the pages that ask for it. */
  render: (user: AuthUser) => ReactElement;
  /** Sidebar entry. A route without one is reachable but not listed. */
  label?: string;
  /** Curator-only: a contributor is sent back to the dashboard. */
  curatorOnly?: boolean;
  /** Sidebar section this route belongs to. A route without one is not in the grouped nav. */
  group?: NavGroupId;
  /** Icon for the sidebar entry / "+ New" menu entry. */
  icon?: IconName;
  /** Lists this route in the "+ New" menu. */
  newMenu?: { description: string; icon: IconName };
}

/**
 * Every page of the Admin, described once. The routes, the sidebar groups,
 * the "+ New" menu and who may open what used to be lists that had to be
 * edited together; they are all read from this one now.
 */
export const ADMIN_ROUTES: readonly AdminRoute[] = [
  {
    path: '/',
    label: 'Dashboard',
    group: 'overview',
    icon: 'dashboard',
    render: (user) => <Dashboard user={user} />,
  },
  {
    path: '/songs',
    label: 'Songs',
    group: 'catalog',
    icon: 'music',
    render: (user) => <SongsList user={user} />,
  },
  { path: '/songs/:id', render: (user) => <SongDetail user={user} /> },
  {
    path: '/streams',
    label: 'Streams',
    group: 'catalog',
    icon: 'radio',
    render: (user) => <StreamsList user={user} />,
  },
  { path: '/streams/:id', render: (user) => <StreamDetailPage user={user} /> },
  {
    path: '/stamp',
    label: 'Stamp Editor',
    group: 'timestamps',
    icon: 'timer',
    render: (user) => <StampEditor user={user} />,
  },
  {
    path: '/pipeline',
    label: 'Pipeline',
    group: 'timestamps',
    icon: 'workflow',
    render: () => <Pipeline />,
  },
  {
    path: '/works',
    label: 'Global Library',
    curatorOnly: true,
    group: 'library',
    icon: 'library',
    render: () => <GlobalWorks />,
  },
  {
    path: '/works/review',
    label: 'Work Review',
    curatorOnly: true,
    group: 'library',
    icon: 'gitCompare',
    render: () => <GlobalWorkReview />,
  },
  {
    path: '/harmonizer',
    label: 'Harmonizer',
    curatorOnly: true,
    group: 'library',
    icon: 'merge',
    render: () => <Harmonizer />,
  },
  {
    path: '/nova',
    label: 'Nova',
    curatorOnly: true,
    group: 'inbox',
    icon: 'nova',
    render: (user) => <NovaSubmissions user={user} />,
  },
  {
    path: '/nova/vods',
    label: 'Nova VODs',
    curatorOnly: true,
    group: 'inbox',
    icon: 'film',
    render: (user) => <NovaVodSubmissions user={user} />,
  },
  {
    path: '/crystal',
    label: 'Crystal',
    curatorOnly: true,
    group: 'inbox',
    icon: 'crystal',
    render: (user) => <CrystalTickets user={user} />,
  },
  {
    path: '/submit/song',
    label: 'Submit Song',
    newMenu: { description: 'Title, artist and optional performances', icon: 'music' },
    render: () => <SubmitSong />,
  },
  {
    path: '/submit/stream',
    label: 'Submit Stream',
    newMenu: { description: 'Paste a YouTube URL; the ID fills itself in', icon: 'radio' },
    render: () => <SubmitStream />,
  },
  {
    path: '/vod-export',
    label: 'VOD Export',
    curatorOnly: true,
    group: 'publish',
    icon: 'package',
    render: (user) => <VodExport user={user} />,
  },
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

/**
 * The page element for one manifest entry, gated when the entry says so. A page fills `<main>`
 * itself, so while its chunk loads the Suspense skeleton brings the page gutter. The gate wraps the
 * page, so a redirected contributor gets nothing at all.
 */
export function routeElement(route: AdminRoute, user: AuthUser): ReactElement {
  const page = (
    <PageBoundary key={route.path}>
      <Suspense
        fallback={
          <div className="p-4 lg:px-5">
            <Skeleton rows={6} label="Loading page..." />
          </div>
        }
      >
        {route.render(user)}
      </Suspense>
    </PageBoundary>
  );
  return route.curatorOnly ? <RequireCurator user={user}>{page}</RequireCurator> : page;
}
