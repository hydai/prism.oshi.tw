import type { AuthUser } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Oracle: getNavGroups(curator) — every group, in NAV_GROUPS order, manifest order within each. */
const CURATOR_GROUPS = [
  ['overview', 'Overview', [['/', 'Dashboard', 'dashboard']]],
  ['catalog', 'Catalog', [
    ['/songs', 'Songs', 'music'],
    ['/streams', 'Streams', 'radio'],
  ]],
  ['timestamps', 'Timestamps', [
    ['/stamp', 'Stamp Editor', 'timer'],
    ['/pipeline', 'Pipeline', 'workflow'],
  ]],
  ['library', 'Library', [
    ['/works', 'Global Library', 'library'],
    ['/works/review', 'Work Review', 'gitCompare'],
    ['/harmonizer', 'Harmonizer', 'merge'],
  ]],
  ['inbox', 'Inbox', [
    ['/nova', 'Nova', 'nova'],
    ['/nova/vods', 'Nova VODs', 'film'],
    ['/crystal', 'Crystal', 'crystal'],
  ]],
  ['publish', 'Publish', [['/vod-export', 'VOD Export', 'package']]],
];

/**
 * Oracle: listRouteFor — a detail/sub path collapses to its list with no query; any other location
 * keeps its path and query minus the streamer-bound params (streamer, stream, performance).
 */
const LIST_ROUTE_CASES: [string, string][] = [
  ['/stamp?stream=s1&performance=p1', '/stamp'],
  ['/streams/abc', '/streams'],
  ['/songs/42?x=1', '/songs'],
  ['/vod-export/repair/song/12', '/vod-export'],
  ['/works', '/works'],
  ['/nova?status=pending', '/nova?status=pending'],
  ['/streams?streamer=mizuki&status=pending', '/streams?status=pending'],
  ['/stamp?stream=s1&performance=p1&x=1', '/stamp?x=1'],
];

async function main(): Promise<void> {
  const { currentNavLabel, getNavGroups, listRouteFor, matchAdminRoute } = await import('../src/lib/navigation');

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

  // --- getNavGroups: a curator sees every group, in order, with its routes ---

  const curatorGroups = getNavGroups(curator);
  assert(
    JSON.stringify(
      curatorGroups.map((group) => [
        group.id,
        group.label,
        group.items.map((item) => [item.to, item.label, item.icon]),
      ]),
    ) === JSON.stringify(CURATOR_GROUPS),
    'curators see the six nav groups, in order, each holding its routes in manifest order',
  );

  // --- getNavGroups: a contributor drops the groups whose every route is curator-only ---

  const contributorGroups = getNavGroups(contributor);
  assert(
    !contributorGroups.some((group) => group.id === 'publish'),
    'contributors have no Publish group: its only route (VOD Export) is curator-only',
  );
  assert(
    !contributorGroups.some((group) => group.id === 'library'),
    'contributors have no Library group: Global Library, Work Review and Harmonizer are all curator-only',
  );
  assert(
    !contributorGroups.some((group) => group.id === 'inbox'),
    'contributors have no Inbox group: Nova, Nova VODs and Crystal are all curator-only',
  );

  // --- listRouteFor: detail/sub paths collapse to their list; other pages keep all but the streamer-bound params ---

  for (const [location, expected] of LIST_ROUTE_CASES) {
    assert(listRouteFor(location) === expected, `listRouteFor(${location}) is ${expected}`);
  }

  // --- matchAdminRoute: first manifest match, or none ---

  assert(matchAdminRoute('/streams/abc')?.path === '/streams/:id', 'a detail path matches its manifest entry');
  assert(matchAdminRoute('/nope') === undefined, 'an unrouted path matches nothing');

  // --- currentNavLabel: the listed route the sidebar marks current, as NavLink does ---

  for (const [pathname, expected] of [
    ['/streams/abc', 'Streams'],
    ['/songs/song-1', 'Songs'],
    ['/vod-export/repair/song/12', 'VOD Export'],
    ['/works', 'Global Library'],
    ['/works/review', 'Work Review'],
    ['/', 'Dashboard'],
    ['/nope', undefined],
    ['/streamsx', undefined],
  ] as const) {
    assert(currentNavLabel(pathname) === expected, `currentNavLabel(${pathname}) is ${expected}`);
  }

  console.log('✓ grouped navigation, list-route collapsing, route matching and the current section');
}

await main();
