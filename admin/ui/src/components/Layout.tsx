import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { AuthUser } from '../../../shared/types';
import { CanvasBackground } from './shell/CanvasBackground';
import { Drawer } from './shell/Drawer';
import { InboxCountsProvider } from './shell/InboxCounts';
import { MobileTopBar } from './shell/MobileTopBar';
import { Sidebar } from './shell/Sidebar';
import { StreamersProvider } from './shell/Streamers';

/** Tailwind's `lg`: from here up the sidebar is an `<aside>`, below it the top bar and the drawer. */
const SIDEBAR_QUERY = '(min-width: 1024px)';

/**
 * The glass shell: the prism canvas, the sidebar (a 224 px `<aside>` from 1024 px up; below that
 * the top bar and the drawer) and `<main>`, the one scroll container. Nothing between `<main>` and
 * a page blurs, transforms or filters, so a page's fixed layers (the bulk bar) stay on the
 * viewport and its sticky ones (the page header) stick to `<main>`. The sidebar sits above the
 * page's sticky header (z-20) so its popovers can open over the page.
 *
 * The sidebar's glass is `.glass-sidebar-host` (src/index.css): the glass-sidebar surface on a
 * `::before` layer, so the `<aside>` itself has no `backdrop-filter` and is not the backdrop root
 * of the streamer switcher / New menu panels it opens — their blur reaches the page behind them.
 * `before:border-y-0 before:border-l-0`: the layer draws a border on all four sides, but the
 * sidebar sits at the page edge and only shows its right one.
 */
export default function Layout({ user, children }: { user: AuthUser; children: ReactNode }) {
  const location = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Any navigation closes the drawer: a link in it, the streamer switcher falling back to a list,
  // the dashboard fallback, the browser's Back button. Adjusted while rendering, not in an effect.
  const [drawerLocationKey, setDrawerLocationKey] = useState(location.key);
  if (drawerLocationKey !== location.key) {
    setDrawerLocationKey(location.key);
    setDrawerOpen(false);
  }
  const closeDrawer = () => setDrawerOpen(false);

  // Widened past the breakpoint with the drawer open: the sidebar takes over. Focus moves to its
  // current link first — the top bar's menu button, where closing would send it, is hidden now.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const media = window.matchMedia(SIDEBAR_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      const aside = asideRef.current;
      (aside?.querySelector<HTMLElement>('a[aria-current="page"]') ?? aside?.querySelector<HTMLElement>('a[href]'))?.focus();
      setDrawerOpen(false);
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [drawerOpen]);

  return (
    // The inbox lists are curators' only: for anyone else the provider requests none of them.
    <InboxCountsProvider isCurator={user.role === 'curator'}>
      <StreamersProvider>
        {/* 100dvh where supported, so a phone's browser bars never cover the end of <main>. (A
            plain `h-screen h-dvh` would not do: Tailwind emits .h-dvh before .h-screen.) */}
        <div className="isolate flex h-screen supports-[height:100dvh]:h-dvh">
          <CanvasBackground />
          <aside
            ref={asideRef}
            className="glass-sidebar-host relative z-[25] hidden w-[224px] shrink-0 flex-col before:border-y-0 before:border-l-0 lg:flex"
          >
            <Sidebar user={user} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileTopBar menuOpen={drawerOpen} onOpenMenu={() => setDrawerOpen(true)} menuButtonRef={menuButtonRef} />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
          </div>
          <Drawer open={drawerOpen} onClose={closeDrawer} returnFocusRef={menuButtonRef}>
            <Sidebar user={user} onNavigate={closeDrawer} onClose={closeDrawer} />
          </Drawer>
        </div>
      </StreamersProvider>
    </InboxCountsProvider>
  );
}
