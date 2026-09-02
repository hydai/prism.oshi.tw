import type { AuthUser } from '../../../shared/types';
import { ADMIN_ROUTES } from './routes';

interface NavigationItem {
  to: string;
  label: string;
}

/**
 * The sidebar, read off the route manifest: a route with a label is listed, in
 * manifest order, and a curator-only one only for curators. A link can never
 * point at a route that does not exist.
 */
export function getVisibleNavItems(user: AuthUser): NavigationItem[] {
  const visibleItems: NavigationItem[] = [];

  for (const { path, label, curatorOnly } of ADMIN_ROUTES) {
    if (label !== undefined && (!curatorOnly || user.role === 'curator')) {
      visibleItems.push({ to: path, label });
    }
  }

  return visibleItems;
}
