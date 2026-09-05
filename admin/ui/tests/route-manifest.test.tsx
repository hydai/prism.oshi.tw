import { renderToStaticMarkup, renderToReadableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}

/** Oracle: every path App.tsx routed before the manifest existed (catch-all aside). */
const ROUTED_PATHS = [
  '/',
  '/songs',
  '/works',
  '/works/review',
  '/songs/:id',
  '/streams',
  '/streams/:id',
  '/submit/song',
  '/submit/stream',
  '/stamp',
  '/pipeline',
  '/harmonizer',
  '/nova',
  '/nova/vods',
  '/crystal',
  '/vod-export',
  '/vod-export/repair/:entity/:rowId',
];

/** Oracle: the sidebar navigation.ts listed, in order. */
const CURATOR_NAV = [
  ['/', 'Dashboard'],
  ['/songs', 'Songs'],
  ['/works', 'Global Library'],
  ['/works/review', 'Work Review'],
  ['/streams', 'Streams'],
  ['/submit/song', 'Submit Song'],
  ['/submit/stream', 'Submit Stream'],
  ['/stamp', 'Stamp Editor'],
  ['/pipeline', 'Pipeline'],
  ['/harmonizer', 'Harmonizer'],
  ['/nova', 'Nova'],
  ['/nova/vods', 'Nova VODs'],
  ['/crystal', 'Crystal'],
  ['/vod-export', 'VOD Export'],
];

/** Oracle: the curator-only entries — hidden from the sidebar and blocked at the route. */
const CURATOR_ONLY_PATHS = ['/works', '/works/review', '/vod-export', '/vod-export/repair/:entity/:rowId'];

/** Oracle: Layout's PRISM_STYLED_PATHS. */
const PRISM_SHELL_PATHS = ['/nova', '/nova/vods', '/crystal'];

/** A concrete URL per curator-only route, and a string only that page renders. */
const CURATOR_ROUTE_PROBES = [
  { url: '/works', marker: 'Global Song Library' },
  { url: '/works/review', marker: 'Global Work Review' },
  { url: '/vod-export', marker: 'Publication workflow' },
  { url: '/vod-export/repair/song/12', marker: 'VOD export source record' },
];

async function main(): Promise<void> {
  installLocalStorage();

  const { ADMIN_ROUTES, usesPrismShell } = await import('../src/lib/routes');
  const { getVisibleNavItems } = await import('../src/lib/navigation');
  const { AppRoutes } = await import('../src/App');

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

  // --- One manifest, and it still describes exactly the app that existed ---

  const paths = ADMIN_ROUTES.map((route) => route.path);
  assert(paths.length === new Set(paths).size, 'no path is declared twice');
  assert(
    JSON.stringify([...paths].sort()) === JSON.stringify([...ROUTED_PATHS].sort()),
    'the manifest routes exactly the paths the app routed before',
  );

  const declaredCuratorOnly = ADMIN_ROUTES.filter((route) => route.curatorOnly).map((route) => route.path);
  assert(
    JSON.stringify([...declaredCuratorOnly].sort()) === JSON.stringify([...CURATOR_ONLY_PATHS].sort()),
    'the same routes are curator-only',
  );

  // --- The sidebar is derived from it, and every label leads somewhere ---

  const curatorNav = getVisibleNavItems(curator);
  assert(
    JSON.stringify(curatorNav.map((item) => [item.to, item.label])) === JSON.stringify(CURATOR_NAV),
    'curators see the same navigation, in the same order',
  );
  for (const item of curatorNav) {
    assert(paths.includes(item.to), `navigation entry ${item.to} has a route`);
  }

  const contributorNav = getVisibleNavItems(contributor);
  const contributorExpected = CURATOR_NAV.filter(([to]) => !CURATOR_ONLY_PATHS.includes(to as string));
  assert(
    JSON.stringify(contributorNav.map((item) => [item.to, item.label])) === JSON.stringify(contributorExpected),
    'contributors see the same navigation minus the curator-only entries',
  );

  // --- So is the prism shell ---

  for (const path of PRISM_SHELL_PATHS) {
    assert(usesPrismShell(path), `${path} keeps the prism shell`);
  }
  for (const path of paths.filter((candidate) => !PRISM_SHELL_PATHS.includes(candidate))) {
    assert(!usesPrismShell(path), `${path} keeps the default shell`);
  }

  // --- A curator-only route renders nothing at all for a contributor ---

  for (const { url, marker } of CURATOR_ROUTE_PROBES) {
    const allowed = await renderLoadedPage(
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes user={curator} />
      </MemoryRouter>,
    );
    assert(allowed.includes(marker), `curators reach ${url}`);

    const denied = renderToStaticMarkup(
      <MemoryRouter initialEntries={[url]}>
        <AppRoutes user={contributor} />
      </MemoryRouter>,
    );
    assert(denied === '', `contributors are redirected away from ${url} before the page renders`);
  }

  // --- A route open to everyone stays open ---

  const contributorSongs = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/songs']}>
      <AppRoutes user={contributor} />
    </MemoryRouter>,
  );
  assert(contributorSongs !== '', 'contributors still reach the pages that were never gated');

  // --- An unknown path still falls back to the dashboard ---

  const unknown = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/nope']}>
      <AppRoutes user={curator} />
    </MemoryRouter>,
  );
  assert(unknown === '', 'an unknown path redirects instead of rendering a page');

  console.log('✓ one manifest drives the routes, the sidebar and the prism shell');
}

await main();

async function renderLoadedPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}
