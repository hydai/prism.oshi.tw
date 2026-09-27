import { matchPath } from 'react-router-dom';
import type { AuthUser } from '../../../shared/types';
import type { IconName } from '../components/ui/Icon';
import { ADMIN_ROUTES, NAV_GROUPS, type AdminRoute, type NavGroupId } from './routes';

export interface NavGroupItem {
  to: string;
  label: string;
  icon: IconName;
  /**
   * Current only on this exact path: `/`, and a path another listed item nests under
   * (`/works` next to `/works/review`), so a parent never lights up with its child. Every other
   * item stays current on its detail pages (`/streams` on `/streams/:id`).
   */
  end: boolean;
}

interface NavGroup {
  id: NavGroupId;
  label: string;
  items: NavGroupItem[];
}

interface NewMenuItem {
  to: string;
  label: string;
  icon: IconName;
  description: string;
}

/** Whether `user` may see this route at all (the curator gate `routeElement` also enforces). */
function isVisible(route: AdminRoute, user: AuthUser): boolean {
  return !route.curatorOnly || user.role === 'curator';
}

/**
 * The sidebar, grouped: each `NAV_GROUPS` section in order, holding the
 * routes that declare it, in manifest order, filtered to what `user` may
 * open. A section with nothing visible in it is dropped.
 */
export function getNavGroups(user: AuthUser): NavGroup[] {
  const listed: Array<{ group: NavGroupId; to: string; label: string; icon: IconName }> = [];
  for (const route of ADMIN_ROUTES) {
    if (route.group !== undefined && route.label !== undefined && route.icon !== undefined && isVisible(route, user)) {
      listed.push({ group: route.group, to: route.path, label: route.label, icon: route.icon });
    }
  }
  const hasNestedItem = (to: string) => listed.some((item) => item.to.startsWith(`${to}/`));

  const groups: NavGroup[] = [];
  for (const { id, label } of NAV_GROUPS) {
    const items: NavGroupItem[] = [];
    for (const item of listed) {
      if (item.group === id) {
        items.push({ to: item.to, label: item.label, icon: item.icon, end: item.to === '/' || hasNestedItem(item.to) });
      }
    }
    if (items.length > 0) {
      groups.push({ id, label, items });
    }
  }

  return groups;
}

/** The "+ New" menu: every route that can be created from it, in manifest order. */
export function getNewMenuItems(user: AuthUser): NewMenuItem[] {
  const items: NewMenuItem[] = [];

  for (const route of ADMIN_ROUTES) {
    if (route.newMenu !== undefined && route.label !== undefined && isVisible(route, user)) {
      items.push({
        to: route.path,
        label: route.label,
        description: route.newMenu.description,
        icon: route.newMenu.icon,
      });
    }
  }

  return items;
}

/** The manifest entry whose path matches `pathname`, first match in manifest order. */
export function matchAdminRoute(pathname: string): AdminRoute | undefined {
  return ADMIN_ROUTES.find((route) => matchPath(route.path, pathname) !== null);
}

/** Query parameters that name one streamer's records: they cannot follow a switch to another streamer. */
const STREAMER_BOUND_PARAMS = ['streamer', 'stream', 'performance'];

/**
 * Where a streamer switch leaves you (`location` is a path plus query, no hash): a detail/sub path
 * collapses to its list, with no query; any other page stays, keeping its query (filters, search)
 * minus the streamer-bound params. With none of those present, the location comes back unchanged.
 */
export function listRouteFor(location: string): string {
  const queryIndex = location.indexOf('?');
  const path = queryIndex === -1 ? location : location.slice(0, queryIndex);

  if (matchPath('/songs/:id', path) !== null) return '/songs';
  if (matchPath('/streams/:id', path) !== null) return '/streams';
  if (matchPath('/vod-export/repair/*', path) !== null) return '/vod-export';

  if (queryIndex === -1) return location;
  const params = new URLSearchParams(location.slice(queryIndex + 1));
  if (!STREAMER_BOUND_PARAMS.some((name) => params.has(name))) return location;
  for (const name of STREAMER_BOUND_PARAMS) params.delete(name);
  const query = params.toString();
  return query === '' ? path : `${path}?${query}`;
}
