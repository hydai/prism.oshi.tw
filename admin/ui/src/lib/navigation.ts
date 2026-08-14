import type { AuthUser } from '../../../shared/types';

interface NavigationItem {
  to: string;
  label: string;
}

interface ConfiguredNavigationItem extends NavigationItem {
  curatorOnly?: boolean;
}

const navItems: readonly ConfiguredNavigationItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/songs', label: 'Songs' },
  { to: '/works', label: 'Global Library', curatorOnly: true },
  { to: '/works/review', label: 'Work Review', curatorOnly: true },
  { to: '/streams', label: 'Streams' },
  { to: '/submit/song', label: 'Submit Song' },
  { to: '/submit/stream', label: 'Submit Stream' },
  { to: '/stamp', label: 'Stamp Editor' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/harmonizer', label: 'Harmonizer' },
  { to: '/nova', label: 'Nova' },
  { to: '/nova/vods', label: 'Nova VODs' },
  { to: '/crystal', label: 'Crystal' },
  { to: '/vod-export', label: 'VOD Export', curatorOnly: true },
];

export function getVisibleNavItems(user: AuthUser): NavigationItem[] {
  const visibleItems: NavigationItem[] = [];

  for (const { to, label, curatorOnly } of navItems) {
    if (!curatorOnly || user.role === 'curator') {
      visibleItems.push({ to, label });
    }
  }

  return visibleItems;
}
