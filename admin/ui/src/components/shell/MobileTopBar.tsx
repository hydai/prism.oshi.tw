import type { Ref } from 'react';
import { useLocation } from 'react-router-dom';
import { currentNavLabel, matchAdminRoute } from '../../lib/navigation';
import { IconButton } from '../ui/Button';
import { StreamerSwitcher } from './StreamerSwitcher';

/**
 * The bar above `<main>` below 1024 px, where the sidebar lives in the drawer: the drawer button,
 * the page's name from the route manifest — on a detail page, the section the sidebar marks
 * current there — and the selected streamer's avatar, which opens the streamer switcher.
 * `relative z-[25]`, like the desktop sidebar: the bar is a glass layer, and its
 * switcher panel has to open over the page's sticky header (z-20).
 *
 * Its glass is `.glass-header-host` (src/index.css): the glass-header surface on a `::before`
 * layer, so the bar itself has no `backdrop-filter` and is not the backdrop root of the switcher
 * panel it opens — that panel's blur reaches the page behind it. `before:border-x-0
 * before:border-t-0`: the layer draws a border on all four sides, but the bar is a bottom hairline
 * only, the same as PageHeader.
 */
export function MobileTopBar({
  menuOpen,
  onOpenMenu,
  menuButtonRef,
}: {
  menuOpen: boolean;
  onOpenMenu: () => void;
  menuButtonRef?: Ref<HTMLButtonElement>;
}) {
  const { pathname } = useLocation();
  const title = matchAdminRoute(pathname)?.label ?? currentNavLabel(pathname) ?? 'Prism Admin';

  return (
    <header className="glass-header-host relative z-[25] flex h-14 shrink-0 items-center gap-2.5 before:border-x-0 before:border-t-0 px-3.5 lg:hidden">
      <IconButton
        ref={menuButtonRef}
        label="Open navigation"
        icon="menu"
        tooltipSide="bottom"
        aria-expanded={menuOpen}
        aria-controls="app-drawer"
        onClick={onOpenMenu}
        className="border border-field-line bg-field"
      />
      <p className="min-w-0 flex-1 truncate text-base font-[750] tracking-[-0.01em] text-fg">{title}</p>
      <StreamerSwitcher variant="avatar" />
    </header>
  );
}
