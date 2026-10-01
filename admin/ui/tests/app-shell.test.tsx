import { readFileSync } from 'node:fs';
import { act, StrictMode, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { AuthUser, StreamerInfo } from '../../shared/types';
import { click, installDom, mount, press, settle, typeInto } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

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

const GROUP_LABELS = ['Overview', 'Catalog', 'Timestamps', 'Library', 'Inbox', 'Publish'];

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

const STREAMERS: StreamerInfo[] = [
  { slug: 'mizuki', displayName: '浠Mizuki' },
  { slug: 'aozora', displayName: 'Aozora Ch.' },
];

// --- fetch stub: a status + JSON body per request path (query string ignored), or a request that
// never answers; every requested path is logged, and a path with no stub is recorded as unexpected
// (and answered 404) instead of throwing inside a component's load. ---

type Stub = { status: number; body: unknown } | 'hang';

const responses = new Map<string, Stub>();
let requestLog: string[] = [];
let requestUrls: string[] = [];
let unexpected: string[] = [];

function callsTo(path: string): number {
  return requestLog.filter((entry) => entry === path).length;
}

function resetRequests(): void {
  requestLog = [];
  requestUrls = [];
  unexpected = [];
}

function installFetchStub(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      requestLog.push(path);
      requestUrls.push(path + url.search);
      const stub = responses.get(path);
      if (stub === 'hang') return new Promise<Response>(() => {});
      if (stub === undefined) {
        unexpected.push(path);
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
      }
      return new Response(JSON.stringify(stub.body), {
        status: stub.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function stubInboxes(): void {
  // Only `status` matters to the counts; the other fields are irrelevant to this suite.
  responses.set('/api/nova/submissions', {
    status: 200,
    body: { data: [{ id: 'n1', status: 'pending' }, { id: 'n2', status: 'pending' }, { id: 'n3', status: 'approved' }], total: 3 },
  });
  responses.set('/api/nova/vods', { status: 200, body: { data: [{ id: 'v1', status: 'pending' }], total: 1 } });
  responses.set('/api/crystal/tickets', { status: 200, body: { data: [{ id: 'c1', status: 'replied' }], total: 1 } });
}

type MediaChangeListener = (event: { matches: boolean; media: string }) => void;

/**
 * A controllable `window.matchMedia`: every query starts out not matching, `setMatches` changes one
 * and fires its `change` listeners, and `listenerCount` shows what is still subscribed.
 */
function installMatchMedia(win: object): {
  setMatches: (query: string, matches: boolean) => void;
  listenerCount: (query: string) => number;
} {
  const lists = new Map<string, { matches: boolean; listeners: Set<MediaChangeListener> }>();
  const listFor = (query: string) => {
    let list = lists.get(query);
    if (list === undefined) {
      list = { matches: false, listeners: new Set() };
      lists.set(query, list);
    }
    return list;
  };

  Object.defineProperty(win, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const list = listFor(query);
      return {
        media: query,
        get matches() {
          return list.matches;
        },
        addEventListener: (type: string, listener: MediaChangeListener) => {
          if (type === 'change') list.listeners.add(listener);
        },
        removeEventListener: (type: string, listener: MediaChangeListener) => {
          if (type === 'change') list.listeners.delete(listener);
        },
        addListener: (listener: MediaChangeListener) => list.listeners.add(listener),
        removeListener: (listener: MediaChangeListener) => list.listeners.delete(listener),
      };
    },
  });

  return {
    setMatches: (query, matches) => {
      const list = listFor(query);
      list.matches = matches;
      list.listeners.forEach((listener) => listener({ matches, media: query }));
    },
    listenerCount: (query) => listFor(query).listeners.size,
  };
}

/** Renders where the router is, and offers a navigation that does not come from the sidebar. */
function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output id="location">{location.pathname + location.search}</output>
      <output id="location-key">{location.key}</output>
      <button type="button" id="go-pipeline" onClick={() => navigate('/pipeline')}>
        Go to Pipeline
      </button>
      <button type="button" id="go-back" onClick={() => navigate(-1)}>
        Back
      </button>
    </div>
  );
}

function parse(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

function byId(root: ParentNode, id: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[id="${id}"]`);
  assert(element !== null, `an element with id="${id}" exists`);
  return element;
}

function textOf(element: Element | null | undefined): string {
  return element?.textContent ?? '';
}

/** Class tokens via the attribute: an SVG element's `className` is not a string. */
function classesOf(element: Element | null | undefined): string[] {
  return (element?.getAttribute('class') ?? '').split(/\s+/);
}

function activeElement(): Element | null {
  return document.activeElement;
}

function locationNow(): string {
  return textOf(document.getElementById('location'));
}

function locationKeyNow(): string {
  return textOf(document.getElementById('location-key'));
}

/** The panel a popover trigger controls (found through `aria-controls`). */
function panelFor(trigger: Element): HTMLElement {
  const id = trigger.getAttribute('aria-controls');
  assert(id !== null && id !== '', 'the trigger names its panel in aria-controls');
  return byId(document, id);
}

/** An icon button's tooltip: the `role="tooltip"` sibling inside its Tooltip wrapper. */
function tooltipOf(trigger: Element): HTMLElement {
  const tooltip = trigger.parentElement?.querySelector<HTMLElement>('[role="tooltip"]') ?? null;
  assert(tooltip !== null, `${trigger.getAttribute('aria-label') ?? 'the button'} has a tooltip`);
  return tooltip;
}

/** A concrete URL for a manifest path (`:param` segments filled in). */
function sampleUrl(path: string): string {
  return path.replace(/:[a-zA-Z]+/g, (param) => (param === ':entity' ? 'song' : '12'));
}

async function main(): Promise<void> {
  installLocalStorage();
  const win = installDom();
  const media = installMatchMedia(win);
  installFetchStub();

  const { default: Layout } = await import('../src/components/Layout');
  const { default: App } = await import('../src/App');
  const { ADMIN_ROUTES, routeElement } = await import('../src/lib/routes');
  const { PageBoundary } = await import('../src/components/PageBoundary');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { getCurrentStreamer, setCurrentStreamer } = await import('../src/api/client');

  function ssrShell(url: string, user: AuthUser): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[url]}>
        <Layout user={user}>
          <p>page body</p>
        </Layout>
      </MemoryRouter>,
    );
  }

  // --- SSR: the curator's shell at /works ---

  setCurrentStreamer('mizuki');
  const curatorWorksHtml = ssrShell('/works', curator);
  const curatorWorks = parse(curatorWorksHtml);

  const navs = curatorWorks.querySelectorAll('nav[aria-label="Primary"]');
  assert(navs.length === 1, 'SSR: exactly one nav[aria-label="Primary"] — the closed drawer mounts no second sidebar');
  const nav = navs[0];
  assert(nav !== undefined, 'the Primary nav renders');
  const navHtml = nav.innerHTML;
  const groupPositions = GROUP_LABELS.map((label) => navHtml.indexOf(`>${label}<`));
  groupPositions.forEach((position, index) => {
    assert(position !== -1, `the nav shows the ${GROUP_LABELS[index]} group label`);
  });
  assert(
    groupPositions.every((position, index) => index === 0 || position > (groupPositions[index - 1] ?? -1)),
    'the six groups are in NAV_GROUPS order',
  );

  const currentLinks = curatorWorks.querySelectorAll('[aria-current="page"]');
  assert(currentLinks.length === 1, 'SSR /works: exactly one element carries aria-current="page"');
  const currentLink = currentLinks[0];
  assert(
    currentLink?.tagName === 'A' && currentLink.getAttribute('href') === '/works' && textOf(currentLink).includes('Global Library'),
    'SSR /works: the Global Library link carries aria-current="page"',
  );
  assert(!navHtml.includes('href="/submit/song"'), 'the nav holds no Submit Song link');
  assert(!navHtml.includes('href="/submit/stream"'), 'the nav holds no Submit Stream link');
  assert(
    nav.querySelectorAll('a').length === 12,
    'a curator sees all twelve grouped routes in the nav',
  );

  const newTrigger = curatorWorks.querySelector('button[aria-label="New"]');
  assert(newTrigger !== null, 'the sidebar renders the New button');
  assert(newTrigger.getAttribute('aria-haspopup') === 'menu', 'New opens a menu');
  assert(newTrigger.getAttribute('aria-expanded') === 'false', 'the New menu starts closed');
  const newPanel = byId(curatorWorks, newTrigger.getAttribute('aria-controls') ?? '');
  assert(newPanel.hasAttribute('hidden'), 'the closed New menu panel is hidden');
  assert(
    textOf(newPanel).includes('Submit Song') && textOf(newPanel).includes('Submit Stream'),
    'Submit Song and Submit Stream sit in the (hidden) New menu',
  );
  assert(!nav.contains(newTrigger), 'the New menu is not part of the Primary nav');

  assert(curatorWorks.querySelector('[role="group"][aria-label="Theme"]') !== null, 'the sidebar footer holds the theme toggle');
  const emailLine = curatorWorks.querySelector('[title="curator@example.com"]');
  assert(textOf(emailLine) === 'curator@example.com', 'the footer shows the email, with the full text in title');
  assert(textOf(emailLine?.nextElementSibling) === 'curator', 'the footer shows the role under the email');

  const switcher = curatorWorks.querySelector('button[aria-haspopup="listbox"]');
  assert(switcher !== null, 'the sidebar renders the streamer switcher');
  assert(textOf(switcher).includes('mizuki'), 'SSR: before the list loads, the switcher shows the stored slug');

  const aside = curatorWorks.querySelector('aside');
  assert(aside !== null && aside.contains(nav), 'the desktop sidebar is an <aside> holding the nav');
  for (const token of ['w-[224px]', 'hidden', 'lg:flex']) {
    assert(classesOf(aside).includes(token), `the <aside> uses ${token}`);
  }
  assert(
    classesOf(aside).includes('glass-sidebar-host') && !classesOf(aside).includes('glass-sidebar'),
    'the sidebar wears the glass-sidebar surface as its host variant (on a ::before layer), so its switcher / New panels can blur the page',
  );
  assert(
    classesOf(aside).includes('before:border-y-0') && classesOf(aside).includes('before:border-l-0'),
    'the glass layer draws all 4 sides; the sidebar sits at the page edge and shows only its right one',
  );

  const main = curatorWorks.querySelector('main');
  assert(main !== null && textOf(main) === 'page body', '<main> holds the page');
  for (const token of ['min-w-0', 'flex-1', 'overflow-y-auto']) {
    assert(classesOf(main).includes(token), `<main> uses ${token}`);
  }
  assert(
    !/glass-|backdrop|blur|transform|translate|filter/.test(classesOf(main).join(' ')),
    '<main> creates no containing block for fixed layers (no blur, transform or filter)',
  );

  const menuButton = curatorWorks.querySelector('button[aria-label="Open navigation"]');
  assert(menuButton !== null, 'the mobile top bar renders the Open navigation button');
  assert(menuButton.getAttribute('aria-expanded') === 'false', 'the drawer starts closed (aria-expanded="false")');
  assert(menuButton.getAttribute('aria-controls') === 'app-drawer', 'the menu button controls #app-drawer');
  const topBar = menuButton.closest('header');
  assert(topBar !== null && textOf(topBar).includes('Global Library'), 'the top bar titles the page from the manifest');
  assert(classesOf(topBar).includes('lg:hidden'), 'the top bar is hidden from 1024 px up');
  assert(
    classesOf(topBar).includes('glass-header-host') && !classesOf(topBar).includes('glass-header'),
    'the top bar wears the glass-header surface as its host variant (on a ::before layer), so its switcher panel can blur the page',
  );
  assert(
    classesOf(topBar).includes('before:border-x-0') && classesOf(topBar).includes('before:border-t-0'),
    'the glass layer draws all 4 sides; the top bar is a bottom hairline only, like PageHeader',
  );

  const ssrDrawer = byId(curatorWorks, 'app-drawer');
  assert(ssrDrawer.hasAttribute('hidden'), 'SSR: the closed drawer is hidden');
  assert(!ssrDrawer.hasAttribute('data-overlay-open'), 'SSR: the closed drawer carries no data-overlay-open');
  assert(ssrDrawer.querySelector('nav') === null, 'SSR: the closed drawer holds no sidebar');

  const canvas = Array.from(curatorWorks.querySelectorAll('[aria-hidden="true"]')).find((element) =>
    classesOf(element).includes('[background:var(--canvas)]'),
  );
  assert(canvas !== undefined, 'a decorative canvas layer paints background: var(--canvas)');
  assert(classesOf(canvas).includes('fixed'), 'the canvas layer is fixed');
  for (const blob of ['bg-blob-1', 'bg-blob-2', 'bg-blob-3']) {
    assert(canvas.innerHTML.includes(blob), `the canvas holds the ${blob} disc`);
  }

  assert(!NO_RAW_PALETTE.test(curatorWorksHtml), 'the shell uses no raw Tailwind palette classes');

  console.log('✓ SSR: grouped nav, current link, hidden New menu, switcher, theme toggle, top bar, closed drawer, canvas');

  // --- SSR: a contributor sees neither curator-only route nor the empty Publish group ---

  const contributorHomeHtml = ssrShell('/', contributor);
  assert(!contributorHomeHtml.includes('Global Library'), 'contributors see no Global Library link');
  assert(!contributorHomeHtml.includes('VOD Export'), 'contributors see no VOD Export link');
  assert(!contributorHomeHtml.includes('>Publish<'), 'contributors see no Publish group');
  assert(!contributorHomeHtml.includes('>Inbox<'), 'contributors see no Inbox group');
  for (const href of ['/nova', '/nova/vods', '/crystal']) {
    assert(!contributorHomeHtml.includes(`href="${href}"`), `contributors see no link to ${href}`);
  }
  const contributorHome = parse(contributorHomeHtml);
  const contributorCurrent = contributorHome.querySelectorAll('[aria-current="page"]');
  assert(
    contributorCurrent.length === 1 && contributorCurrent[0]?.getAttribute('href') === '/',
    'at / only the Dashboard link is current (end match)',
  );
  assert(
    contributorHomeHtml.includes('Submit Song') && contributorHomeHtml.includes('Submit Stream'),
    'contributors keep both New menu entries',
  );

  // One current link on nested routes: a parent entry must not light up with its child.
  const nestedCases: Array<[string, string, string]> = [
    ['/works/review', '/works/review', 'Work Review'],
    ['/nova/vods', '/nova/vods', 'Nova VODs'],
    ['/streams/abc', '/streams', 'Streams'],
    ['/vod-export/repair/song/12', '/vod-export', 'VOD Export'],
  ];
  for (const [url, href, label] of nestedCases) {
    const current = parse(ssrShell(url, curator)).querySelectorAll('[aria-current="page"]');
    assert(current.length === 1, `SSR ${url}: exactly one current link`);
    assert(
      current[0]?.getAttribute('href') === href && textOf(current[0]).includes(label),
      `SSR ${url}: the ${label} link is the current one`,
    );
  }
  // The phone's top bar names the page: by its own manifest label, or on a detail page that has
  // none, by the section the sidebar marks current there. A path nothing names reads Prism Admin.
  for (const [url, title] of [
    ['/streams/abc', 'Streams'],
    ['/songs/song-1', 'Songs'],
    ['/vod-export/repair/song/12', 'VOD Export'],
    ['/works/review', 'Work Review'],
    ['/nowhere', 'Prism Admin'],
  ] as const) {
    const topBarTitle = textOf(
      parse(ssrShell(url, curator)).querySelector('button[aria-label="Open navigation"]')?.closest('header')?.querySelector('p'),
    );
    assert(topBarTitle === title, `SSR ${url}: the top bar reads ${title} (got "${topBarTitle}")`);
  }

  console.log('✓ SSR: contributor filtering, and exactly one current nav link on nested routes');

  // --- SSR: top-bar switcher, stacking, the drawer's own controls, group labels, avatars ---

  const { avatarGradient } = await import('../src/components/shell/avatar');
  const AVATAR_GRADIENTS = ['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3', 'bg-avatar-4', 'bg-avatar-5'];

  const topBarSwitcher = topBar.querySelector('button[aria-haspopup="listbox"]');
  assert(topBarSwitcher !== null, "the top bar's streamer avatar is a switcher trigger");
  assert(textOf(topBarSwitcher).includes('Streamer: mizuki'), 'the avatar trigger is named after the streamer');
  const topBarPanel = byId(curatorWorks, topBarSwitcher.getAttribute('aria-controls') ?? '');
  assert(classesOf(topBarPanel).includes('right-0'), 'the top-bar switcher opens aligned to its right edge');

  // The sidebar and the top bar sit above a page's sticky header (z-20), the drawer above both.
  assert(classesOf(aside).includes('z-[25]') && classesOf(topBar).includes('z-[25]'), 'the aside and the top bar are z-[25]');
  const ssrScrim = ssrDrawer.querySelector('.bg-scrim');
  assert(classesOf(ssrScrim).includes('z-40'), 'the drawer scrim is z-40, above the bulk bar (z-30)');
  const ssrSheet = ssrDrawer.querySelector('[role="dialog"]');
  assert(classesOf(ssrSheet).includes('z-50'), 'the drawer sheet is z-50, above its scrim');
  assert(
    classesOf(ssrSheet).includes('glass-pop') && !classesOf(ssrSheet).includes('glass-sidebar'),
    "the drawer sheet is the near-opaque glass-pop surface, so its labels stay legible over dark page content (the player), not the sidebar's 50 % glass",
  );
  assert(
    ssrSheet !== null && ssrSheet.getAttribute('data-popover-boundary') === '',
    "the sheet keeps an open popover's panel within it: it is its popovers' placement boundary (data-popover-boundary)",
  );

  // Every group is named for assistive tech; only Overview (the Dashboard alone) hides its heading.
  for (const label of GROUP_LABELS) {
    const heading = Array.from(nav.querySelectorAll('p')).find((element) => textOf(element) === label);
    assert(heading !== undefined, `the ${label} group has a heading`);
    assert(classesOf(heading).includes('sr-only') === (label === 'Overview'), `the ${label} heading is ${label === 'Overview' ? 'visually hidden' : 'visible'}`);
  }

  // "+ New" hangs from the brand row, not from its own button, and its tooltip opens downwards.
  const newWrapper = newPanel.parentElement;
  assert(newWrapper !== null && classesOf(newWrapper).includes('inline-flex'), 'the New popover renders its wrapper');
  assert(!classesOf(newWrapper).includes('relative'), 'the New popover anchors to its container (the wrapper is not positioned)');
  const brandRow = newWrapper.parentElement?.closest('.relative');
  assert(brandRow !== null && brandRow !== undefined && textOf(brandRow).includes('Prism'), 'the New panel hangs from the brand row');
  assert(classesOf(tooltipOf(newTrigger)).includes('top-full'), "the New button's tooltip opens below it");

  // Avatars take their gradient from the slug, whichever surface draws them.
  const sidebarAvatar = switcher.querySelector('[aria-hidden="true"]');
  assert(classesOf(sidebarAvatar).includes(avatarGradient('mizuki')), "the switcher avatar wears mizuki's gradient");
  assert(!classesOf(sidebarAvatar).includes('bg-accent'), 'the switcher avatar no longer uses the one accent gradient');

  const slugs = ['mizuki', 'aozora', 'earendel', 'seki', 'hibiki', 'gabu', 'cesium', 'nagi', 'inori', 'hoshi', 'sora', 'yuki', 'luna', 'miko', 'rin', 'kanade', 'hana', 'akari', 'nene', 'shiori'];
  for (const slug of slugs) {
    assert(AVATAR_GRADIENTS.includes(avatarGradient(slug)), `${slug} maps to one of the five avatar gradients`);
    assert(avatarGradient(slug) === avatarGradient(slug), `${slug} always maps to the same gradient`);
  }
  assert(new Set(slugs.map(avatarGradient)).size === AVATAR_GRADIENTS.length, 'twenty slugs spread over all five gradients');

  console.log('✓ SSR: top-bar switcher, z-order, group headings, New anchored to the brand row, slug-keyed avatar gradients');

  // --- routeElement: each page sits in the frame its manifest entry names, inside the curator gate ---

  function renderRoute(path: string, element: ReactElement): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[sampleUrl(path)]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>,
    );
  }

  for (const route of ADMIN_ROUTES) {
    const framed = renderRoute(route.path, routeElement(route, curator));
    if (route.frame === 'studio') {
      assert(framed !== '' && !framed.includes('legacy-frame'), `${route.path} (studio) fills <main> itself, with no LegacyFrame`);
    } else {
      assert(framed.startsWith('<div class="legacy-frame">'), `${route.path} renders inside LegacyFrame`);
    }
    if (route.curatorOnly) {
      assert(renderRoute(route.path, routeElement(route, contributor)) === '', `${route.path}: a contributor gets '' — the frame sits inside the gate`);
    }
  }
  const worksRoute = ADMIN_ROUTES.find((route) => route.path === '/works');
  assert(worksRoute !== undefined, 'the manifest has /works');
  const studioHtml = renderRoute('/works', routeElement({ ...worksRoute, frame: 'studio' }, curator));
  assert(!studioHtml.includes('legacy-frame'), "a frame: 'studio' route fills <main> itself, with no LegacyFrame");
  assert(
    renderRoute('/works', routeElement({ ...worksRoute, frame: 'studio' }, contributor)) === '',
    'a studio route keeps the curator gate',
  );

  // While its chunk loads, a page shows the Suspense skeleton: a legacy page's inside the frame,
  // which pads it; a studio page has no frame, so its skeleton brings the page gutter itself.
  function StillLoading(): never {
    throw new Promise<void>(() => {});
  }
  const loadingStudio = renderRoute('/works', routeElement({ ...worksRoute, frame: 'studio', render: () => <StillLoading /> }, curator));
  assert(
    loadingStudio.startsWith('<div class="p-4 lg:px-5"><div role="status"'),
    `a studio page's loading skeleton sits in the page gutter, not flush with <main> (got: ${loadingStudio.slice(0, 60)})`,
  );
  const loadingLegacy = renderRoute('/works', routeElement({ ...worksRoute, frame: 'legacy', render: () => <StillLoading /> }, curator));
  assert(
    loadingLegacy.startsWith('<div class="legacy-frame"><div role="status"'),
    `a legacy page's loading skeleton is padded by the frame alone (got: ${loadingLegacy.slice(0, 60)})`,
  );

  // --- index.css: inside .legacy-frame every Studio token keeps its light value ---

  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
  const lightStudioBlock = /\.legacy-frame,\s*:root\s*\{([^}]*)\}/.exec(css)?.[1];
  assert(lightStudioBlock !== undefined, '.legacy-frame shares the light Studio token block with :root');
  for (const declaration of [
    '--canvas: linear-gradient(135deg, #FFF0F5 0%, #F0F8FF 50%, #E6E6FA 100%);',
    '--fg: #1E293B;',
    '--tone-teal-line: #99F6E4;',
    '--tooltip-bg: #1E1B2E;',
    '--tooltip-fg: #FFFFFF;',
    '--scrim: rgba(30,27,46,.28);',
  ]) {
    assert(collapse(lightStudioBlock).includes(declaration), `.legacy-frame redeclares ${declaration}`);
  }
  assert(
    /@supports not \(backdrop-filter: blur\(1px\)\) \{\s*\.legacy-frame,\s*:root\s*\{/.test(css),
    'the no-blur fallback raises the glass alpha inside .legacy-frame too',
  );
  const frameRule = /\n\.legacy-frame\s*\{([^}]*)\}/.exec(css)?.[1];
  assert(frameRule !== undefined, 'index.css has its own .legacy-frame rule');
  for (const declaration of [
    'color-scheme: light;',
    'background: #F8FAFC;',
    'color: #0F172A;',
    'border-radius: 18px;',
    'padding: 24px;',
    'margin: 16px;',
  ]) {
    assert(collapse(frameRule).includes(declaration), `.legacy-frame sets ${declaration}`);
  }

  console.log('✓ routeElement wraps every legacy route in LegacyFrame and leaves studio routes unframed, inside the curator gate; .legacy-frame stays light');

  // --- Live: inbox badges, one streamers request, the switcher's navigation rule ---

  stubInboxes();
  responses.set('/api/streamers', { status: 200, body: { data: STREAMERS } });

  async function mountShell(url: string, user: AuthUser = curator) {
    resetRequests();
    const mounted = await mount(
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Layout user={user}>
            <LocationProbe />
          </Layout>
        </MemoryRouter>
      </ToastProvider>,
    );
    await settle();
    return mounted;
  }

  function desktopSwitcher(container: HTMLElement): HTMLButtonElement {
    const trigger = container.querySelector<HTMLButtonElement>('aside button[aria-haspopup="listbox"]');
    assert(trigger !== null, 'the desktop sidebar renders the streamer switcher');
    return trigger;
  }

  function optionTitled(panel: HTMLElement, title: string): HTMLElement {
    const option = Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.getAttribute('title') === title,
    );
    assert(option !== undefined, `the switcher lists ${title}`);
    return option;
  }

  async function switchTo(trigger: HTMLButtonElement, title: string): Promise<void> {
    await click(trigger, 'the streamer switcher');
    const panel = panelFor(trigger);
    assert(!panel.hasAttribute('hidden'), 'the switcher panel opens');
    await click(optionTitled(panel, title), `the ${title} option`);
    assert(panel.hasAttribute('hidden'), 'choosing a streamer closes the switcher');
  }

  setCurrentStreamer('mizuki');
  const detail = await mountShell('/streams/abc');

  const novaLink = detail.container.querySelector('aside a[href="/nova"]');
  assert(textOf(novaLink) === 'Nova2 pending', 'the Nova link shows its pending badge: 2');
  assert(textOf(detail.container.querySelector('aside a[href="/nova/vods"]')) === 'Nova VODs1 pending', 'the Nova VODs badge shows 1');
  assert(textOf(detail.container.querySelector('aside a[href="/crystal"]')) === 'Crystal', 'no badge while nothing is pending');
  assert(callsTo('/api/streamers') === 1, 'the shell loads the streamer list once');

  const detailSwitcher = desktopSwitcher(detail.container);
  assert(textOf(detailSwitcher).includes('浠Mizuki'), 'once loaded, the switcher shows the display name');
  await click(detailSwitcher, 'the streamer switcher');
  const detailPanel = panelFor(detailSwitcher);
  const options = Array.from(detailPanel.querySelectorAll('[role="option"]'));
  assert(options.length === 2, 'the switcher lists every streamer');
  assert(optionTitled(detailPanel, '浠Mizuki').getAttribute('aria-selected') === 'true', 'the current streamer is selected');
  assert(textOf(optionTitled(detailPanel, 'Aozora Ch.')).includes('aozora'), 'each option shows the slug too');

  const search = activeElement();
  assert(search instanceof window.HTMLInputElement && search.getAttribute('role') === 'combobox', 'opening the switcher focuses its search');
  await typeInto(search, 'AOZ');
  assert(
    Array.from(detailPanel.querySelectorAll('[role="option"]')).map((option) => option.getAttribute('title')).join('|') === 'Aozora Ch.',
    'the search matches slugs, ignoring case',
  );
  await typeInto(search, '浠');
  assert(
    Array.from(detailPanel.querySelectorAll('[role="option"]')).map((option) => option.getAttribute('title')).join('|') === '浠Mizuki',
    'the search matches display names',
  );
  await typeInto(search, 'zzz');
  assert(textOf(detailPanel).includes('No matching streamers'), 'a search with no match says so');
  await press(search, 'Escape');
  assert(detailPanel.hasAttribute('hidden'), 'Escape closes the switcher');
  await click(detailSwitcher, 'the streamer switcher');
  const reopenedSearch = activeElement();
  assert(
    reopenedSearch instanceof window.HTMLInputElement && reopenedSearch.value === '' &&
      detailPanel.querySelectorAll('[role="option"]').length === 2,
    'reopening the switcher starts from an empty search',
  );
  await press(activeElement() ?? detailSwitcher, 'Escape');

  await switchTo(detailSwitcher, 'Aozora Ch.');
  assert(getCurrentStreamer() === 'aozora', 'choosing a streamer stores the selection');
  assert(locationNow() === '/streams', 'switching on /streams/abc leaves the router at /streams');
  assert(textOf(detailSwitcher).includes('Aozora Ch.'), 'the switcher shows the new selection');
  assert(activeElement() === detailSwitcher, 'focus returns to the switcher');
  assert(callsTo('/api/streamers') === 1, 'switching does not reload the streamer list');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await detail.unmount();

  setCurrentStreamer('aozora');
  const stamp = await mountShell('/stamp?stream=x');
  await switchTo(desktopSwitcher(stamp.container), '浠Mizuki');
  assert(getCurrentStreamer() === 'mizuki', 'the switch from /stamp stores the selection');
  assert(locationNow() === '/stamp', 'switching on /stamp?stream=x leaves the router at /stamp');
  await stamp.unmount();

  setCurrentStreamer('mizuki');
  const same = await mountShell('/streams/abc');
  const sameKey = locationKeyNow();
  await switchTo(desktopSwitcher(same.container), '浠Mizuki');
  assert(getCurrentStreamer() === 'mizuki', 'choosing the current streamer keeps it');
  assert(locationNow() === '/streams/abc' && locationKeyNow() === sameKey, 'choosing the current streamer does not navigate');
  await same.unmount();

  setCurrentStreamer('mizuki');
  const list = await mountShell('/works');
  const listKey = locationKeyNow();
  await switchTo(desktopSwitcher(list.container), 'Aozora Ch.');
  assert(getCurrentStreamer() === 'aozora', 'the switch on a list page stores the selection');
  assert(locationNow() === '/works' && locationKeyNow() === listKey, 'on a page with no path parameter the switch does not navigate');
  await list.unmount();

  // The top bar's avatar opens the same switcher over the same list.
  setCurrentStreamer('mizuki');
  const phone = await mountShell('/nova?status=approved&search=abc');
  const phoneKey = locationKeyNow();
  const avatarTrigger = phone.container.querySelector<HTMLButtonElement>('header button[aria-haspopup="listbox"]');
  assert(avatarTrigger !== null, 'the top bar renders the avatar switcher');
  assert(textOf(avatarTrigger).includes('Streamer: 浠Mizuki'), 'once loaded, the avatar is named with the display name');
  await click(avatarTrigger, 'the top-bar avatar');
  const avatarPanel = panelFor(avatarTrigger);
  assert(!avatarPanel.hasAttribute('hidden'), 'the avatar opens the switcher');
  assert(avatarPanel.querySelectorAll('[role="option"]').length === 2, 'the avatar switcher lists every streamer');
  await click(optionTitled(avatarPanel, 'Aozora Ch.'), 'the Aozora option in the top bar');
  assert(getCurrentStreamer() === 'aozora', 'the avatar switcher stores the selection');
  assert(
    locationNow() === '/nova?status=approved&search=abc' && locationKeyNow() === phoneKey,
    "a page's own filters survive a switch: no navigation, the query stays",
  );
  assert(activeElement() === avatarTrigger, 'focus returns to the avatar');
  assert(callsTo('/api/streamers') === 1, 'the top-bar switcher shares the one streamer list load');
  await phone.unmount();

  console.log('✓ live: inbox badges, one streamers load, and the switch keeps the page or falls back to its list');

  // --- Live: the worker serves the three inbox lists to curators alone, so a contributor's shell
  // asks for none of them, and its sidebar has no Inbox group to hang a badge on ---

  setCurrentStreamer('mizuki');
  const contributorShell = await mountShell('/', contributor);
  assert(
    callsTo('/api/nova/submissions') === 0 && callsTo('/api/nova/vods') === 0 && callsTo('/api/crystal/tickets') === 0,
    `a contributor's shell requests none of the three inbox lists (got ${requestLog.join(', ')})`,
  );
  for (const href of ['/nova', '/nova/vods', '/crystal']) {
    assert(
      contributorShell.container.querySelector(`aside a[href="${href}"]`) === null,
      `a contributor's sidebar has no link to ${href}`,
    );
  }
  assert(
    Array.from(contributorShell.container.querySelectorAll('aside nav p')).every((heading) => textOf(heading) !== 'Inbox'),
    "a contributor's sidebar has no Inbox group heading",
  );
  assert(callsTo('/api/streamers') === 1, "a contributor's shell still loads the streamer list");
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await contributorShell.unmount();

  console.log("✓ live: a contributor's shell requests none of the curator-only inbox lists and lists no inbox link");

  // --- Live: a contributor who opens an inbox URL is sent to the dashboard, and the page never mounts ---

  for (const path of ['/nova', '/nova/vods', '/crystal']) {
    const route = ADMIN_ROUTES.find((entry) => entry.path === path);
    assert(route !== undefined, `the manifest has ${path}`);
    resetRequests();
    const sentAway = await mount(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path={path} element={routeElement(route, contributor)} />
          <Route path="/" element={<p id="dashboard-stand-in">the dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await settle();
    assert(locationNow() === '/', `a contributor opening ${path} lands on / (got ${locationNow()})`);
    assert(document.getElementById('dashboard-stand-in') !== null, `the route at / renders for a contributor sent from ${path}`);
    assert(requestLog.length === 0, `the ${path} page never mounts for a contributor (got ${requestLog.join(', ')})`);
    await sentAway.unmount();
  }

  console.log('✓ live: a contributor opening /nova, /nova/vods or /crystal lands on the dashboard');

  // --- Live: the auto-correction and a failed list load ---

  setCurrentStreamer('ghost');
  const corrected = await mountShell('/songs');
  assert(getCurrentStreamer() === 'mizuki', 'a stored streamer missing from the list falls back to the first one');
  assert(locationNow() === '/', 'the auto-correction lands on the dashboard');
  await corrected.unmount();

  responses.set('/api/streamers', { status: 500, body: { error: 'boom' } });
  setCurrentStreamer('mizuki');
  const failed = await mountShell('/songs');
  const notifications = failed.container.querySelector('section[aria-label="Notifications"]');
  assert(textOf(notifications).includes('Couldn’t load streamers'), 'a failed streamer list load shows an error toast');
  assert((textOf(notifications).match(/Couldn’t load streamers/g) ?? []).length === 1, 'the failure is reported once');
  const failedSwitcher = desktopSwitcher(failed.container);
  assert(textOf(failedSwitcher).includes('mizuki'), 'the switcher keeps the stored slug as its fallback');
  assert(getCurrentStreamer() === 'mizuki' && locationNow() === '/songs', 'a failed load changes neither the selection nor the page');
  await failed.unmount();

  // StrictMode mounts twice: the first mount's request is retired, so only one failure is reported.
  resetRequests();
  const strict = await mount(
    <StrictMode>
      <ToastProvider>
        <MemoryRouter initialEntries={['/songs']}>
          <Layout user={curator}>
            <LocationProbe />
          </Layout>
        </MemoryRouter>
      </ToastProvider>
    </StrictMode>,
  );
  await settle();
  const strictNotifications = strict.container.querySelector('section[aria-label="Notifications"]');
  assert(callsTo('/api/streamers') === 2, 'StrictMode ran the load effect twice');
  assert(
    (textOf(strictNotifications).match(/Couldn’t load streamers/g) ?? []).length === 1,
    'the retired first request reports nothing: one toast, not two',
  );
  await strict.unmount();

  // An empty list: nothing to pick, nothing to correct to.
  responses.set('/api/streamers', { status: 200, body: { data: [] } });
  setCurrentStreamer('mizuki');
  const empty = await mountShell('/songs');
  const emptySwitcher = desktopSwitcher(empty.container);
  await click(emptySwitcher, 'the streamer switcher');
  const emptyPanel = panelFor(emptySwitcher);
  assert(emptyPanel.querySelectorAll('[role="option"]').length === 0, 'an empty list offers no option');
  assert(textOf(emptyPanel).includes('No streamers'), 'an empty list says "No streamers"');
  assert(getCurrentStreamer() === 'mizuki' && locationNow() === '/songs', 'an empty list corrects nothing');
  await empty.unmount();
  responses.set('/api/streamers', { status: 200, body: { data: STREAMERS } });

  console.log('✓ live: the stored streamer is auto-corrected, and a failed list load toasts once and keeps the fallback');

  // --- Live: the New menu navigates ---

  setCurrentStreamer('mizuki');
  const creating = await mountShell('/');
  const liveNew = creating.container.querySelector<HTMLButtonElement>('aside button[aria-label="New"]');
  assert(liveNew !== null, 'the desktop sidebar renders New');
  await click(liveNew, 'the New button');
  const newMenu = panelFor(liveNew);
  const submitStream = Array.from(newMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) =>
    textOf(item).includes('Submit Stream'),
  );
  await click(submitStream, 'the Submit Stream item');
  assert(locationNow() === '/submit/stream', 'choosing Submit Stream opens /submit/stream');
  assert(newMenu.hasAttribute('hidden'), 'the New menu closes after a choice');
  await creating.unmount();

  // --- Live: the drawer ---

  setCurrentStreamer('mizuki');
  const shell = await mountShell('/streams/abc');
  const openButton = shell.container.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]');
  assert(openButton !== null, 'the top bar renders Open navigation');
  const drawer = byId(document, 'app-drawer');

  await act(async () => {
    openButton.focus();
  });
  await click(openButton, 'Open navigation');
  assert(!drawer.hasAttribute('hidden'), 'Open navigation shows the drawer');
  assert(drawer.getAttribute('data-overlay-open') === '', 'the open drawer carries data-overlay-open=""');
  assert(openButton.getAttribute('aria-expanded') === 'true', 'the menu button reports aria-expanded="true"');
  const sheet = drawer.querySelector('[role="dialog"]');
  assert(sheet !== null && sheet.getAttribute('aria-modal') === 'true', 'the drawer sheet is a modal dialog');
  assert(sheet.getAttribute('aria-label') === 'Navigation', 'the drawer sheet is labelled "Navigation"');
  assert(drawer.contains(activeElement()), 'opening the drawer moves focus into it');
  assert(drawer.querySelectorAll('nav[aria-label="Primary"]').length === 1, 'the drawer holds the sidebar');
  assert(document.querySelectorAll('nav[aria-label="Primary"]').length === 2, 'the desktop sidebar stays mounted behind it');
  assert(callsTo('/api/streamers') === 1, 'the drawer sidebar shares the one streamer list load');

  // Tab stays inside while open.
  const tabbables = Array.from(
    drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled]):not([tabindex="-1"])'),
  ).filter((element) => element.closest('[hidden]') === null);
  const firstTabbable = tabbables[0];
  const lastTabbable = tabbables[tabbables.length - 1];
  assert(firstTabbable !== undefined && lastTabbable !== undefined && firstTabbable !== lastTabbable, 'the drawer has tabbable controls');
  await act(async () => {
    lastTabbable.focus();
  });
  const wrapForward = await press(lastTabbable, 'Tab');
  assert(activeElement() === firstTabbable && wrapForward.defaultPrevented, 'Tab on the last control wraps to the first');
  const wrapBackward = await press(firstTabbable, 'Tab', { shiftKey: true });
  assert(activeElement() === lastTabbable && wrapBackward.defaultPrevented, 'Shift+Tab on the first control wraps to the last');

  // An Escape handled inside the drawer (an open switcher) closes only that.
  const drawerSwitcher = drawer.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  assert(drawerSwitcher !== null, 'the drawer sidebar has its own switcher');
  await click(drawerSwitcher, 'the drawer switcher');
  const drawerSwitcherPanel = panelFor(drawerSwitcher);
  assert(!drawerSwitcherPanel.hasAttribute('hidden'), 'the drawer switcher opens');
  await press(activeElement() ?? drawerSwitcher, 'Escape');
  assert(drawerSwitcherPanel.hasAttribute('hidden'), 'Escape closes the open switcher');
  assert(!drawer.hasAttribute('hidden'), '…and leaves the drawer open');
  assert(activeElement() === drawerSwitcher, 'focus goes back to the switcher inside the drawer');

  // IME keystrokes and already-handled Escapes are not the drawer's.
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await press(drawerSwitcher, 'Escape', init);
    assert(!drawer.hasAttribute('hidden'), `an IME Escape (${JSON.stringify(init)}) leaves the drawer open`);
  }
  const cancelInside = (event: Event) => event.preventDefault();
  sheet.addEventListener('keydown', cancelInside);
  await press(drawerSwitcher, 'Escape');
  sheet.removeEventListener('keydown', cancelInside);
  assert(!drawer.hasAttribute('hidden'), 'an Escape something inside already handled leaves the drawer open');

  const closingEscape = await press(drawerSwitcher, 'Escape');
  assert(drawer.hasAttribute('hidden'), 'Escape closes the drawer');
  assert(closingEscape.defaultPrevented, 'the drawer cancels the Escape it handles');
  assert(!drawer.hasAttribute('data-overlay-open'), 'the closed drawer drops data-overlay-open');
  assert(openButton.getAttribute('aria-expanded') === 'false', 'the menu button reports aria-expanded="false"');
  assert(activeElement() === openButton, 'closing the drawer returns focus to Open navigation');
  assert(document.querySelectorAll('nav[aria-label="Primary"]').length === 1, 'the closed drawer unmounts its sidebar');

  // A nav link in the drawer navigates and closes it.
  await click(openButton, 'Open navigation');
  const songsLink = drawer.querySelector<HTMLAnchorElement>('a[href="/songs"]');
  await click(songsLink, 'the Songs link in the drawer');
  assert(locationNow() === '/songs', 'the drawer link navigates');
  assert(drawer.hasAttribute('hidden'), 'following a drawer link closes the drawer');
  assert(activeElement() === openButton, 'focus returns to Open navigation after a drawer link');

  // The scrim closes it.
  await click(openButton, 'Open navigation');
  const scrim = Array.from(drawer.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).find((element) =>
    classesOf(element).includes('bg-scrim'),
  );
  assert(scrim !== undefined, 'the open drawer paints a bg-scrim scrim');
  await click(scrim, 'the drawer scrim');
  assert(drawer.hasAttribute('hidden'), 'a scrim click closes the drawer');

  // Any route change closes it — including one that does not come from the sidebar — and going
  // back to the entry it was opened on does not reopen it.
  await click(openButton, 'Open navigation');
  await click(shell.container.querySelector<HTMLButtonElement>('#go-pipeline'), 'a navigation from the page');
  assert(locationNow() === '/pipeline', 'the page navigated');
  assert(drawer.hasAttribute('hidden'), 'a route change closes the drawer');
  await click(shell.container.querySelector<HTMLButtonElement>('#go-back'), 'Back');
  assert(locationNow() === '/songs', 'Back returns to the entry the drawer was opened on');
  assert(drawer.hasAttribute('hidden'), 'going back does not reopen the drawer');

  // A visible way out that is not Escape or the pointer-only scrim: Close navigation.
  await click(openButton, 'Open navigation');
  const closeButton = drawer.querySelector<HTMLButtonElement>('button[aria-label="Close navigation"]');
  assert(closeButton !== null, "the drawer's brand row has Close navigation");
  assert(drawer.querySelector('button[aria-label="New"]') !== null, '…next to "+ New", which the drawer keeps');
  assert(classesOf(tooltipOf(closeButton)).includes('top-full'), "Close navigation's tooltip opens below it");
  await click(closeButton, 'Close navigation');
  assert(drawer.hasAttribute('hidden'), 'Close navigation closes the drawer');
  assert(activeElement() === openButton, 'Close navigation returns focus to Open navigation');
  assert(
    shell.container.querySelector('aside button[aria-label="Close navigation"]') === null,
    'the desktop sidebar has no Close navigation',
  );

  // The drawer's own "+ New" opens its page and closes the drawer.
  await click(openButton, 'Open navigation');
  const drawerNew = drawer.querySelector<HTMLButtonElement>('button[aria-label="New"]');
  await click(drawerNew, 'New in the drawer');
  const drawerNewMenu = panelFor(drawerNew as HTMLButtonElement);
  assert(!drawerNewMenu.hasAttribute('hidden') && drawer.contains(drawerNewMenu), 'the drawer opens its own New menu');
  const submitSong = Array.from(drawerNewMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) =>
    textOf(item).includes('Submit Song'),
  );
  await click(submitSong, 'Submit Song in the drawer');
  assert(locationNow() === '/submit/song', "the drawer's New menu opens /submit/song");
  assert(drawer.hasAttribute('hidden'), 'choosing from the New menu closes the drawer');
  assert(activeElement() === openButton, 'focus returns to Open navigation after the New menu');

  // Widening past 1024 px (the sidebar breakpoint) closes the drawer and hands focus to the sidebar.
  await click(shell.container.querySelector<HTMLButtonElement>('#go-back'), 'Back');
  assert(locationNow() === '/songs', 'back on /songs');
  const WIDE = '(min-width: 1024px)';
  assert(media.listenerCount(WIDE) === 0, 'nothing listens for the breakpoint while the drawer is closed');
  await click(openButton, 'Open navigation');
  assert(media.listenerCount(WIDE) === 1, 'the open drawer listens for the breakpoint');
  await act(async () => {
    media.setMatches(WIDE, true);
  });
  await settle();
  assert(drawer.hasAttribute('hidden'), 'crossing to 1024 px closes the drawer');
  assert(
    activeElement() === shell.container.querySelector('aside a[href="/songs"]'),
    "focus moves to the sidebar's current link, not to the now-hidden menu button",
  );
  assert(media.listenerCount(WIDE) === 0, 'the closed drawer stops listening');
  await act(async () => {
    media.setMatches(WIDE, false);
  });
  await settle();
  assert(drawer.hasAttribute('hidden'), 'narrowing again does not reopen the drawer');

  assert(callsTo('/api/streamers') === 1, 'still exactly one streamer list load after all of that');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await shell.unmount();

  console.log('✓ live: the drawer opens with focus inside, traps Tab, leaves inner and IME Escapes alone, and closes on Escape, links, the scrim and route changes');

  // --- PageBoundary: a failed page offers a reload ---

  function Thrower(): ReactNode {
    throw new Error('chunk failed');
  }
  const loggedErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args);
  };
  let boundary: Awaited<ReturnType<typeof mount>> | undefined;
  try {
    boundary = await mount(
      <PageBoundary>
        <Thrower />
      </PageBoundary>,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert(loggedErrors.length > 0, 'React reported the error the boundary caught');
  const alert = boundary.container.querySelector('[role="alert"]');
  assert(alert !== null, 'the boundary keeps role="alert"');
  assert(textOf(alert).includes('This page could not load.'), 'the boundary names the failure');
  assert(textOf(alert).includes('Reload to get the latest version.'), 'the boundary says how to recover');
  const reload = alert.querySelector('button');
  assert(reload !== null && textOf(reload) === 'Reload' && reload.getAttribute('type') === 'button', 'the boundary offers a Reload button');
  assert(classesOf(reload).includes('bg-accent'), 'Reload is the primary button');
  assert(!NO_RAW_PALETTE.test(boundary.container.innerHTML), 'the boundary uses no raw palette classes');
  await boundary.unmount();

  // --- App: the providers wrap the auth screens ---

  resetRequests();
  responses.set('/api/me', 'hang');
  const loading = await mount(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  const loadingStatus = loading.container.querySelector('[role="status"]');
  assert(textOf(loadingStatus).includes('Loading'), 'while /api/me loads, the app shows a Skeleton');
  assert(loading.container.querySelector('section[aria-label="Notifications"]') !== null, 'App mounts the ToastProvider');
  assert(loading.container.querySelector('dialog') !== null, 'App mounts the ConfirmProvider');
  await loading.unmount();

  responses.set('/api/me', { status: 401, body: { error: 'Missing Cloudflare Access identity' } });
  const denied = await mount(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
  assert(textOf(denied.container).includes('Authentication Required'), 'a failed /api/me shows Authentication Required');
  assert(textOf(denied.container).includes('Missing Cloudflare Access identity'), 'the error message is kept');
  assert(denied.container.querySelector('nav') === null, 'no shell without a user');
  assert(!NO_RAW_PALETTE.test(denied.container.innerHTML), 'the auth screens use no raw palette classes');
  await denied.unmount();

  console.log('✓ PageBoundary offers a primary Reload; App wraps the Skeleton / EmptyState auth screens in its providers');

  // --- App: a switch on a page whose URL names the old streamer (a VOD Export finding link) ---
  // The Streams page applies ?streamer= when it mounts; the switch must drop it from the URL before
  // the page remounts for the new streamer, or the old one comes straight back.

  await import('../src/pages/StreamsList');
  responses.set('/api/me', { status: 200, body: curator });
  responses.set('/api/streams', { status: 200, body: { data: [], total: 0 } });
  setCurrentStreamer('mizuki');
  resetRequests();
  const app = await mount(
    <MemoryRouter initialEntries={['/streams?streamer=mizuki&status=pending']}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
  await settle();
  assert(app.container.querySelector('[aria-label="Search streams by title or video ID"]') !== null, 'the Streams page is showing');
  assert(getCurrentStreamer() === 'mizuki', 'the page starts on the streamer its URL names');

  await switchTo(desktopSwitcher(app.container), 'Aozora Ch.');
  assert(locationNow() === '/streams?status=pending', 'the switch drops ?streamer= and keeps the status filter');
  assert(getCurrentStreamer() === 'aozora', 'the new streamer sticks: the remounted page no longer sees ?streamer=mizuki');
  await settle(20);
  assert(getCurrentStreamer() === 'aozora' && locationNow() === '/streams?status=pending', 'and it is still so after everything settles');
  const lastStreamsRequest = requestUrls.filter((url) => url.startsWith('/api/streams?')).pop() ?? '';
  const lastQuery = new URLSearchParams(lastStreamsRequest.slice(lastStreamsRequest.indexOf('?') + 1));
  assert(
    lastQuery.get('streamer') === 'aozora' && lastQuery.get('status') === 'pending',
    `the page reloads the new streamer's pending streams (last request ${lastStreamsRequest})`,
  );
  assert(callsTo('/api/streamers') === 1, 'one streamer list load for the whole app');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await app.unmount();

  console.log('✓ App: a switch on /streams?streamer=… drops the old streamer from the URL and the new one sticks');
}

await main();
