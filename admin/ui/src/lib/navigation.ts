import { matchPath } from 'react-router-dom';
import type { AuthUser } from '../../../shared/types';
import type { IconName } from '../components/ui/Icon';
import { ADMIN_ROUTES, NAV_GROUPS, type AdminRoute, type NavGroupId } from './routes';

interface NavigationItem {
  to: string;
  label: string;
}

interface NavGroupItem extends NavigationItem {
  icon: IconName;
}

interface NavGroup {
  id: NavGroupId;
  label: string;
  items: NavGroupItem[];
}

interface NewMenuItem extends NavGroupItem {
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
  const groups: NavGroup[] = [];

  for (const { id, label } of NAV_GROUPS) {
    const items: NavGroupItem[] = [];
    for (const route of ADMIN_ROUTES) {
      if (route.group === id && route.label !== undefined && route.icon !== undefined && isVisible(route, user)) {
        items.push({ to: route.path, label: route.label, icon: route.icon });
      }
    }
    if (items.length > 0) {
      groups.push({ id, label, items });
    }
  }

  return groups;
}

/**
 * The sidebar, flattened: a route with a `group` is listed, grouped in
 * `NAV_GROUPS` order and in manifest order within a group, curator filter as
 * today. A link can never point at a route that does not exist.
 */
export function getVisibleNavItems(user: AuthUser): NavigationItem[] {
  return getNavGroups(user).flatMap((group) => group.items.map(({ to, label }) => ({ to, label })));
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
