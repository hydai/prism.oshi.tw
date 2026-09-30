import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  HarmonizeArtistEntry,
  HarmonizeArtistsResponse,
  HarmonizeMergeResponse,
  HarmonizeSongEntry,
  HarmonizeSongsResponse,
  SimilarityGroup,
} from '../../shared/types';
import { click, installDom, mount, press, settle, typeInto } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

/**
 * The Harmonizer page: the tab `Segmented` and the active tab's scan controls in the header, both
 * tabs mounted, and each tab a review queue over a stubbed server. Similar songs: the scan, the list
 * and the detail, Skip and the detail's previous / next, the confirmed merge that drops its group
 * and selects the next one, J typed into the threshold, and a trip to the other tab and back.
 * Similar artists: the scan, the list and the detail, the canonical name (J typed there stays a
 * letter), Apply that drops its group and selects the next one, and Apply All Reviewed, which asks
 * first. With both tabs scanned, J and K move only the shown tab's queue.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installLocalStorage(): void {
  const storage = new Map<string, string>([['prism_admin_streamer', 'mizuki']]);
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

// --- Fixtures: four groups, one of each kind the queue shows ---

function song(id: string, fields: Omit<HarmonizeSongEntry, 'id' | 'createdAt'>): HarmonizeSongEntry {
  return { id, createdAt: '2026-09-01 00:00:00', ...fields };
}

/** Two approved spellings on two work IDs, and an extracted copy: a global work merge (8 performances). */
const FLY: SimilarityGroup<HarmonizeSongEntry> = {
  normalizedKey: 'fly me to the moon',
  matchType: 'exact',
  items: [
    song('fly-1', { workId: 'work-fly', title: 'Fly Me To The Moon', originalArtist: 'Bart Howard', status: 'approved', performanceCount: 4 }),
    song('fly-2', { workId: 'work-fly-2', title: 'fly me to the moon', originalArtist: 'Frank Sinatra', status: 'approved', performanceCount: 3 }),
    song('fly-3', { workId: 'work-fly', title: 'Fly Me To The Moon', originalArtist: 'Bart Howard', status: 'extracted', performanceCount: 1 }),
  ],
};

/** Both songs on one work ID: a local merge (3 performances). */
const SING: SimilarityGroup<HarmonizeSongEntry> = {
  normalizedKey: 'sing my pleasure',
  matchType: 'exact',
  items: [
    song('sing-1', { workId: 'work-sing', title: 'Sing My Pleasure', originalArtist: 'Vaundy', status: 'approved', performanceCount: 2 }),
    song('sing-2', { workId: 'work-sing', title: 'sing my pleasure', originalArtist: 'vaundy', status: 'pending', performanceCount: 1 }),
  ],
};

/** Matched by work ID; the canonical is the song with more performances (3 in all). */
const KOI: SimilarityGroup<HarmonizeSongEntry> = {
  normalizedKey: '錦鯉抄',
  matchType: 'work_id',
  items: [
    song('koi-1', { workId: 'work-koi', title: '錦鯉抄', originalArtist: '銀臨', status: 'approved', performanceCount: 1 }),
    song('koi-2', { workId: 'work-koi', title: '锦鲤抄', originalArtist: '銀臨', status: 'approved', performanceCount: 2 }),
  ],
};

/** A fuzzy match with an unlinked song: its merge is blocked. */
const BLUE: SimilarityGroup<HarmonizeSongEntry> = {
  normalizedKey: 'blue',
  matchType: 'fuzzy',
  items: [
    song('blue-1', { workId: 'work-blue', title: 'BLUE', originalArtist: 'Vaundy', status: 'approved', performanceCount: 1 }),
    song('blue-2', { workId: null, title: 'Blue', originalArtist: 'Vaundy', status: 'pending', performanceCount: 1 }),
  ],
};

const SCAN: HarmonizeSongsResponse = {
  groups: [FLY, SING, KOI, BLUE],
  stats: { totalSongs: 40, groupCount: 4, affectedSongs: 9 },
  revision: 7,
};

// --- Artist fixtures: four groups; each suggests its most-used spelling ---

function artist(originalArtist: string, songIds: string[]): HarmonizeArtistEntry {
  return { originalArtist, songCount: songIds.length, songIds };
}

/** Three spellings; Vaundy (3 songs) is suggested, so vaundy and VAUNDY (3 songs between them) change. */
const VAUNDY: SimilarityGroup<HarmonizeArtistEntry> = {
  normalizedKey: 'vaundy',
  matchType: 'exact',
  items: [artist('vaundy', ['s-1']), artist('Vaundy', ['s-2', 's-3', 's-4']), artist('VAUNDY', ['s-5', 's-6'])],
};

/** A fuzzy match: Yoasobi (1 song) becomes YOASOBI. */
const YOASOBI: SimilarityGroup<HarmonizeArtistEntry> = {
  normalizedKey: 'yoasobi',
  matchType: 'fuzzy',
  items: [artist('YOASOBI', ['y-1', 'y-2']), artist('Yoasobi', ['y-3'])],
};

/** aimer (1 song) becomes Aimer. */
const AIMER: SimilarityGroup<HarmonizeArtistEntry> = {
  normalizedKey: 'aimer',
  matchType: 'exact',
  items: [artist('Aimer', ['a-1', 'a-2']), artist('aimer', ['a-3'])],
};

/** 米津 玄師 (1 song) becomes 米津玄師. */
const KENSHI: SimilarityGroup<HarmonizeArtistEntry> = {
  normalizedKey: '米津玄師',
  matchType: 'exact',
  items: [artist('米津玄師', ['k-1', 'k-2', 'k-3']), artist('米津 玄師', ['k-4'])],
};

const ARTIST_SCAN: HarmonizeArtistsResponse = {
  groups: [VAUNDY, YOASOBI, AIMER, KENSHI],
  stats: { totalArtists: 9, groupCount: 4, affectedEntries: 9 },
};

// --- The stubbed server: each request takes the next reply queued for its route ---

interface Reply {
  status: number;
  body: unknown;
}

type Route = 'songs' | 'merge' | 'artists' | 'apply';

interface Call {
  route: Route;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}

const server = {
  calls: [] as Call[],
  unexpected: [] as string[],
  replies: { songs: [], merge: [], artists: [], apply: [] } as Record<Route, Array<Reply | Promise<Reply>>>,
};

function resetServer(): void {
  server.calls = [];
  server.unexpected = [];
  server.replies = { songs: [], merge: [], artists: [], apply: [] };
}

function routeOf(method: string, path: string): Route | null {
  if (method === 'GET' && path === '/api/harmonize/songs') return 'songs';
  if (method === 'POST' && path === '/api/harmonize/merge') return 'merge';
  if (method === 'GET' && path === '/api/harmonize/artists') return 'artists';
  if (method === 'POST' && path === '/api/harmonize/apply') return 'apply';
  return null;
}

function installServer(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      const route = routeOf(method, url.pathname);
      const next = route === null ? undefined : server.replies[route].shift();
      if (route === null || next === undefined) {
        server.unexpected.push(`${method} ${url.pathname}${url.search}`);
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
      }
      server.calls.push({
        route,
        params: url.searchParams,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      });
      const reply = await next;
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function callsTo(route: Route): Call[] {
  return server.calls.filter((call) => call.route === route);
}

function scanReply(): Reply {
  return { status: 200, body: SCAN };
}

function artistScanReply(): Reply {
  return { status: 200, body: ARTIST_SCAN };
}

function applyReply(updated: number): Reply {
  return { status: 200, body: { ok: true, updated } };
}

function mergeReply(mergedSongs: number, revision: number): Reply {
  const body: HarmonizeMergeResponse = {
    ok: true,
    canonicalSongId: 'kept',
    canonicalWorkId: 'kept-work',
    mergedSongs,
    movedPerformances: 0,
    mergedWorks: 0,
    relinkedSongs: 0,
    revision,
  };
  return { status: 200, body };
}

/** A reply the test sends when it chooses: the request waits for `release`. */
function held(): { reply: Promise<Reply>; release: (reply: Reply) => Promise<void> } {
  let resolve: (reply: Reply) => void = () => undefined;
  const reply = new Promise<Reply>((settleWith) => {
    resolve = settleWith;
  });
  return {
    reply,
    release: async (value) => {
      await act(async () => {
        resolve(value);
      });
      await settle();
    },
  };
}

// --- DOM lookups ---

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? '';
}

function classesOf(node: Element | null | undefined): string[] {
  return (node?.getAttribute('class') ?? '').split(/\s+/);
}

/** A button by its accessible name: its `aria-label`, or else its text. */
function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.getAttribute('aria-label') ?? textOf(button).trim()) === name,
  );
}

function headerOf(root: ParentNode): HTMLElement {
  const header = root.querySelector<HTMLElement>('header');
  assert(header !== null, 'the page opens with its header');
  return header;
}

function sectionOf(root: ParentNode, label: 'Similar songs' | 'Similar artists'): HTMLElement {
  const section = root.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  assert(section !== null, `the page renders the ${label} tab`);
  return section;
}

function viewButtons(root: ParentNode): HTMLButtonElement[] {
  const group = headerOf(root).querySelector('[role="group"][aria-label="Harmonizer view"]');
  assert(group !== null, 'the header holds the Harmonizer view tabs');
  return [...group.querySelectorAll<HTMLButtonElement>('button')];
}

function viewButton(root: ParentNode, label: 'Similar songs' | 'Similar artists'): HTMLButtonElement {
  const button = viewButtons(root).find((option) => textOf(option).startsWith(label));
  assert(button !== undefined, `the Harmonizer view offers ${label}`);
  return button;
}

function modeButton(root: ParentNode, label: 'Exact' | 'Fuzzy'): HTMLButtonElement {
  const group = headerOf(root).querySelector('[role="group"][aria-label="Match mode"]');
  assert(group !== null, 'the header holds the Match mode');
  const button = buttonNamed(group, label);
  assert(button !== undefined, `the Match mode offers ${label}`);
  return button;
}

function thresholdOf(root: ParentNode, id = 'song-harmonizer-threshold'): HTMLInputElement | null {
  return headerOf(root).querySelector<HTMLInputElement>(`input#${id}`);
}

/** Which tab's queue a list lookup reads; the songs one unless a call says otherwise. */
type Queue = 'songs' | 'artists';

const LIST_LABEL: Record<Queue, string> = {
  songs: 'Similar song groups',
  artists: 'Similar artist groups',
};

function groupsList(root: ParentNode, queue: Queue = 'songs'): HTMLUListElement {
  const list = root.querySelector<HTMLUListElement>(`ul[aria-label="${LIST_LABEL[queue]}"]`);
  assert(list !== null, `the ${queue} queue renders its group list`);
  return list;
}

function rowButtons(root: ParentNode, queue: Queue = 'songs'): HTMLButtonElement[] {
  return [...groupsList(root, queue).querySelectorAll<HTMLButtonElement>('li > button')];
}

/** Each row's first line: its group key. */
function rowKeys(root: ParentNode, queue: Queue = 'songs'): string[] {
  return rowButtons(root, queue).map((row) => textOf(row.children[0]));
}

function rowFor(root: ParentNode, key: string, queue: Queue = 'songs'): HTMLButtonElement {
  const row = rowButtons(root, queue).find((button) => textOf(button.children[0]) === key);
  assert(row !== undefined, `the ${queue} list has the ${key} row`);
  return row;
}

/** The pills on a row, as text. */
function rowPills(row: HTMLButtonElement): string[] {
  return [...(row.children[1]?.children ?? [])].map((pill) => textOf(pill));
}

function rowPill(row: HTMLButtonElement, text: string): Element | undefined {
  return [...(row.children[1]?.children ?? [])].find((pill) => textOf(pill) === text);
}

/** The selected row's group key, or '' while none is selected. */
function selectedKey(root: ParentNode, queue: Queue = 'songs'): string {
  return textOf(groupsList(root, queue).querySelector('button[aria-current="true"]')?.children[0]);
}

/** The first "Selected group" under `root`: pass a tab's section to read that tab's detail. */
function detailOf(root: ParentNode): HTMLElement {
  const detail = root.querySelector<HTMLElement>('section[aria-label="Selected group"]');
  assert(detail !== null, 'the queue shows the selected group');
  return detail;
}

function artistDetail(root: ParentNode): HTMLElement {
  return detailOf(sectionOf(root, 'Similar artists'));
}

/** The artists detail's canonical-name label: a visible short text and a hidden long one. */
function canonicalLabel(root: ParentNode): HTMLLabelElement {
  const label = artistDetail(root).querySelector<HTMLLabelElement>('label');
  assert(label !== null, 'the artists detail labels its canonical name');
  return label;
}

/** The field the canonical-name label names. */
function canonicalField(root: ParentNode): HTMLInputElement {
  const field = document.getElementById(canonicalLabel(root).getAttribute('for') ?? '');
  assert(field !== null && field.tagName === 'INPUT', 'the canonical-name label names its field');
  return field as HTMLInputElement;
}

/** The artists detail's variants, one per table body row: Artist Name / Songs / Preview. */
function artistRows(root: ParentNode): HTMLTableRowElement[] {
  return [...artistDetail(root).querySelectorAll<HTMLTableRowElement>('tbody > tr')];
}

/** The variant `name`'s "Use this as canonical" button. */
function spellingButton(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...artistDetail(root).querySelectorAll<HTMLButtonElement>('tbody button')].find(
    (candidate) => textOf(candidate) === name,
  );
  assert(button !== undefined, `the variants table offers ${name}`);
  return button;
}

/** A variant row's preview: its struck-through old name and its whole text. */
function previewOf(row: HTMLTableRowElement | undefined): { struck: string; text: string } {
  const cell = row?.children[2];
  return { struck: textOf(cell?.querySelector('.line-through')), text: textOf(cell) };
}

/** The detail's variants, one per table body row: `[cells' text…]`. */
function variantRows(root: ParentNode): HTMLTableRowElement[] {
  return [...detailOf(root).querySelectorAll<HTMLTableRowElement>('tbody > tr')];
}

function radioOf(root: ParentNode, songId: string): HTMLInputElement {
  const radio = detailOf(root).querySelector<HTMLInputElement>(`input[type="radio"][aria-label^="Use record ${songId}:"]`);
  assert(radio !== null, `the variants table offers ${songId} as the canonical`);
  return radio;
}

function openDialog(root: ParentNode): HTMLDialogElement | null {
  return root.querySelector<HTMLDialogElement>('dialog[open]');
}

function toastText(root: ParentNode): string {
  return textOf(root.querySelector('section[aria-label="Notifications"]'));
}

// happy-dom lays nothing out. For the scroll checks every list row (an <li> of a <ul>) is 60 px
// tall, stacked from the top of its list, and every list shows 130 px: two rows and a bit.
const ROW_HEIGHT = 60;
const LIST_HEIGHT = 130;
const LAYOUT_GETTERS = ['offsetTop', 'offsetHeight', 'clientHeight'] as const;

/** Installs that layout over happy-dom's own getters; the returned function puts them back. */
function stubListLayout(): () => void {
  const proto = window.HTMLElement.prototype;
  const saved = LAYOUT_GETTERS.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  const own = (name: (typeof LAYOUT_GETTERS)[number], element: HTMLElement): number => {
    const getter = saved.find(([savedName]) => savedName === name)?.[1]?.get;
    return getter ? Number(getter.call(element)) : 0;
  };
  const rowIndex = (element: HTMLElement): number => {
    const list = element.parentElement;
    return element.tagName === 'LI' && list?.tagName === 'UL' ? Array.from(list.children).indexOf(element) : -1;
  };
  Object.defineProperty(proto, 'offsetTop', {
    get(this: HTMLElement) {
      const index = rowIndex(this);
      return index === -1 ? own('offsetTop', this) : index * ROW_HEIGHT;
    },
    configurable: true,
  });
  Object.defineProperty(proto, 'offsetHeight', {
    get(this: HTMLElement) {
      return rowIndex(this) === -1 ? own('offsetHeight', this) : ROW_HEIGHT;
    },
    configurable: true,
  });
  Object.defineProperty(proto, 'clientHeight', {
    get(this: HTMLElement) {
      return this.tagName === 'UL' ? LIST_HEIGHT : own('clientHeight', this);
    },
    configurable: true,
  });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  };
}

async function main(): Promise<void> {
  installLocalStorage();
  installDom();
  installServer();

  const { default: Harmonizer } = await import('../src/pages/Harmonizer');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');
  const { mergeConfirmationMessage } = await import('../src/lib/harmonizer-presentation');
  const { getWorkAwareMergeBatch, getWorkMergePlan } = await import('../src/lib/harmonizer-work-merge');

  /** Static markup as a DOM tree, to read it the way the page shows it. */
  const parse = (html: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  };

  /** What the merge confirm says for `group` with `canonicalId` kept. */
  const expectedConfirmBody = (group: SimilarityGroup<HarmonizeSongEntry>, canonicalId: string): string => {
    const batch = getWorkAwareMergeBatch(group.items, canonicalId);
    const plan = getWorkMergePlan(batch.items, canonicalId);
    const canonical = group.items.find((item) => item.id === canonicalId);
    assert(canonical !== undefined, `${canonicalId} is in ${group.normalizedKey}`);
    return mergeConfirmationMessage(canonical, batch, plan, batch.items.length - 1);
  };

  // Toasts stay up until dismissed, so every one can be read, and no real timer outlives the test.
  const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };
  const openPage = () =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <ConfirmProvider>
          <Harmonizer />
        </ConfirmProvider>
      </ToastProvider>,
    );
  const assertNoStrayRequests = () => {
    assert(server.unexpected.length === 0, `the page made only the requests the test expects (also: ${server.unexpected.join(', ')})`);
  };

  {
    // --- The first render: the header, both tabs mounted, the songs tab's empty state ---
    const html = renderToStaticMarkup(<Harmonizer />);
    const page = parse(html);
    const root = page.firstElementChild;
    assert(root?.firstElementChild?.tagName === 'HEADER', 'the page header is the page root first child (the one measured)');
    const header = headerOf(page);
    assert(textOf(header.querySelector('h1')) === 'Harmonizer', 'the header title is Harmonizer');
    assert(textOf(header).startsWith('LIBRARY'), 'the header crumb is LIBRARY');
    const views = viewButtons(page);
    assert(
      JSON.stringify(views.map((option) => textOf(option))) === JSON.stringify(['Similar songs', 'Similar artists']),
      `the Harmonizer view offers Similar songs / Similar artists, with no count before a scan (got ${views.map((option) => textOf(option)).join(' / ')})`,
    );
    assert(
      views[0]?.getAttribute('aria-pressed') === 'true' && views[1]?.getAttribute('aria-pressed') === 'false',
      'Similar songs is the tab shown first',
    );
    assert(
      header.querySelector('[role="group"][aria-label="Match mode"]') === null,
      'the scan controls are portalled into the header only once the page has mounted',
    );

    const songs = sectionOf(page, 'Similar songs');
    const artists = sectionOf(page, 'Similar artists');
    assert(!songs.hasAttribute('hidden'), 'the songs tab is shown');
    assert(artists.hasAttribute('hidden'), 'the artists tab is mounted but hidden');
    for (const section of [songs, artists]) {
      const display = classesOf(section).filter((utility) => ['flex', 'grid', 'block', 'inline-flex'].includes(utility));
      assert(display.length === 0, `a tab container carries no display utility, which would beat hidden (got ${display.join(' ')})`);
    }
    assert(textOf(songs).includes('Find duplicate songs'), 'before the first scan the songs tab says what a scan finds');
    assert(buttonNamed(songs, 'Scan now') !== undefined, 'and offers Scan now');
    assert(!NO_RAW_PALETTE.test(header.outerHTML + songs.outerHTML), 'the header and the songs tab use no raw Tailwind palette class');
    assert(textOf(artists).includes('Find artist name variants'), 'before its first scan the artists tab says what a scan finds');
    assert(buttonNamed(artists, 'Scan now') !== undefined, 'and offers Scan now');
    assert(!NO_RAW_PALETTE.test(artists.outerHTML), 'the artists tab uses no raw Tailwind palette class');
  }
  console.log(
    '✓ harmonizer: LIBRARY / Harmonizer header with the view tabs; both tabs mounted, artists hidden; Find duplicate songs and Find artist name variants before a scan',
  );

  {
    // --- The scan: controls in the header, the queue, the summary, the tab count ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    assert(server.calls.length === 0, 'nothing is scanned on mount');
    assert(modeButton(container, 'Exact').getAttribute('aria-pressed') === 'true', 'Exact is the mode at first');
    assert(modeButton(container, 'Fuzzy').getAttribute('aria-pressed') === 'false', 'Fuzzy is the other mode');
    assert(thresholdOf(container) === null, 'Exact takes no threshold');
    const headerScan = buttonNamed(headerOf(container), 'Scan');
    assert(headerScan !== undefined && !headerScan.disabled, 'the header offers Scan before the first scan');
    assert(!textOf(headerOf(container)).includes('songs in'), 'no summary before the first scan');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs', 'no group count before the first scan');

    server.replies.songs.push(scanReply());
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'Scan now');
    assert(callsTo('songs').length === 1, 'Scan now scans once');
    const params = callsTo('songs')[0]?.params;
    assert(
      params?.get('mode') === 'exact' && !params.has('threshold') && params.get('streamer') === 'mizuki',
      `an exact scan of the current streamer sends no threshold (got ${params?.toString()})`,
    );

    const header = headerOf(container);
    assert(
      textOf(header).includes('9 songs in 4 groups · scanned just now'),
      `the header sums the scan up (got ${textOf(header)})`,
    );
    assert(buttonNamed(header, 'Scan again') !== undefined, 'the header scan button reads Scan again after a scan');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs4', 'the songs tab shows its group count');
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists', 'the artists tab shows none (it has not scanned)');
    assert(!textOf(sectionOf(container, 'Similar songs')).includes('Find duplicate songs'), 'the empty state gives way to the queue');

    assert(
      JSON.stringify(rowKeys(container)) === JSON.stringify(['fly me to the moon', 'sing my pleasure', '錦鯉抄', 'blue']),
      `the list shows each group key, in scan order (got ${rowKeys(container).join(' / ')})`,
    );
    const pills = rowButtons(container).map(rowPills);
    assert(
      JSON.stringify(pills)
        === JSON.stringify([
          ['3 variants', 'Exact', 'Global merge'],
          ['2 variants', 'Exact'],
          ['2 variants', 'Work ID'],
          ['2 variants', 'Fuzzy'],
        ]),
      `each row counts its variants, names its match type and flags a global merge (got ${JSON.stringify(pills)})`,
    );
    const fly = rowFor(container, 'fly me to the moon');
    assert(classesOf(rowPill(fly, 'Exact')).includes('bg-tone-ok-bg'), 'Exact is an ok pill');
    assert(classesOf(rowPill(fly, 'Global merge')).includes('bg-tone-warn-bg'), 'Global merge is a warn pill');
    assert(classesOf(rowPill(rowFor(container, 'blue'), 'Fuzzy')).includes('bg-tone-warn-bg'), 'Fuzzy is a warn pill');
    assert(classesOf(rowPill(rowFor(container, '錦鯉抄'), 'Work ID')).includes('bg-tone-info-bg'), 'Work ID is an info pill');
    assert(selectedKey(container) === 'fly me to the moon', 'the first group is selected as the scan lands');
    const listCard = groupsList(container).closest('.glass-card');
    assert(textOf(listCard).startsWith('Groups4'), 'the list card is titled Groups, with the count');
    assert(textOf(listCard).includes('next / previous group'), 'the list footer names what J / K walk');

    // The detail: the notice, the variants, the performances kept, Skip and the merge.
    const detail = detailOf(container);
    assert(textOf(detail.querySelector('h2')) === 'fly me to the moon', 'the detail is headed by the group key');
    assert(
      textOf(detail).includes(
        'Global work merge required. The selected canonical workId is work-fly. Merging will retire work-fly-2 and repoint every linked song across all VTubers.',
      ),
      'the detail shows the work merge notice',
    );
    const heads = [...detail.querySelectorAll('thead th')].map((head) => textOf(head));
    assert(
      JSON.stringify(heads) === JSON.stringify(['Use', 'Title', 'Artist', 'Work ID', 'Status', 'Perf.']),
      `the variants table heads read Use / Title / Artist / Work ID / Status / Perf. (got ${heads.join(' / ')})`,
    );
    assert(!classesOf(detail.querySelector('thead')).some((utility) => utility.includes('sticky')), 'the variants head does not stick');
    const rows = variantRows(container);
    assert(rows.length === 3, 'one table row per variant');
    assert(radioOf(container, 'fly-1').checked, 'the suggested canonical (approved, most performances) is chosen');
    assert(
      radioOf(container, 'fly-1').getAttribute('aria-label')
        === 'Use record fly-1: Fly Me To The Moon by Bart Howard as canonical; work work-fly; 4 performances',
      'each USE radio keeps its full accessible name',
    );
    assert(classesOf(rows[0]).includes('bg-selected') && !classesOf(rows[1]).includes('bg-selected'), 'the canonical row is tinted');
    const struck = (cell: Element | undefined) => textOf(cell?.querySelector('.line-through'));
    const [, titleCell, artistCell, workCell, statusCell, perfCell] = [...(rows[1]?.children ?? [])];
    assert(
      struck(titleCell) === 'fly me to the moon' && textOf(titleCell).endsWith('Fly Me To The Moon'),
      `a variant's title is struck, the canonical title beside it (got ${textOf(titleCell)})`,
    );
    assert(struck(artistCell) === 'Frank Sinatra' && textOf(artistCell).endsWith('Bart Howard'), 'so is its artist');
    assert(textOf(workCell) === 'work-fly-2', 'the Work ID column shows the work ID');
    assert(textOf(statusCell) === 'Approved' && textOf(perfCell) === '3', 'and the status and performance count');
    assert(textOf(rows[2]?.children[4]) === 'Extracted', 'the extracted copy says so');
    assert(textOf(rows[2]?.children[2]) === 'Bart Howard' && struck(rows[2]?.children[2]) === '', 'a same artist is not struck');
    assert(textOf(detail).includes('Merging keeps all 8 performances.'), 'the detail says the merge keeps every performance');
    assert(buttonNamed(detail, 'Skip') !== undefined, 'the detail offers Skip');
    const merge = buttonNamed(detail, 'Merge Songs + Global Works');
    assert(merge !== undefined && !merge.disabled, 'a global group offers Merge Songs + Global Works');
    assert(buttonNamed(detail, 'Previous group')?.disabled === true, 'Previous group waits at the first group');
    assert(buttonNamed(detail, 'Next group')?.disabled === false, 'Next group is available');
    assert(
      !NO_RAW_PALETTE.test(headerOf(container).outerHTML + sectionOf(container, 'Similar songs').outerHTML),
      'the header controls, the list and the detail use no raw Tailwind palette class',
    );

    // Choosing another canonical re-reads the plan.
    await click(radioOf(container, 'fly-2'), 'the fly-2 radio');
    assert(radioOf(container, 'fly-2').checked, 'a click chooses another canonical');
    assert(
      textOf(detailOf(container)).includes('The selected canonical workId is work-fly-2. Merging will retire work-fly'),
      'the notice follows the canonical',
    );
    assert(classesOf(variantRows(container)[1]).includes('bg-selected'), 'and so does the tint');
    await click(radioOf(container, 'fly-1'), 'the fly-1 radio');

    // --- Skip, the detail's previous / next, J / K ---
    await click(buttonNamed(detailOf(container), 'Skip'), 'Skip');
    assert(selectedKey(container) === 'sing my pleasure', 'Skip selects the next group');
    assert(rowKeys(container).length === 4 && rowKeys(container)[0] === 'fly me to the moon', 'and keeps the skipped group in the list');
    await click(buttonNamed(detailOf(container), 'Next group'), 'Next group');
    assert(selectedKey(container) === '錦鯉抄', 'Next group selects the next group');
    await click(buttonNamed(detailOf(container), 'Previous group'), 'Previous group');
    assert(selectedKey(container) === 'sing my pleasure', 'Previous group selects the previous one');
    await press(document.body, 'j');
    assert(selectedKey(container) === '錦鯉抄', 'J selects the next group');
    await press(document.body, 'k');
    assert(selectedKey(container) === 'sing my pleasure', 'K selects the previous group');
    await click(rowFor(container, 'blue'), 'the blue row');
    assert(selectedKey(container) === 'blue', 'a click selects its row');
    assert(buttonNamed(detailOf(container), 'Next group')?.disabled === true, 'Next group waits at the last group');
    await click(buttonNamed(detailOf(container), 'Skip'), 'Skip');
    assert(selectedKey(container) === 'fly me to the moon', 'Skip on the last group starts over at the top');

    // --- Review Focus 1: J typed into the fuzzy threshold stays a letter ---
    await click(modeButton(container, 'Fuzzy'), 'the Fuzzy mode');
    const threshold = thresholdOf(container);
    assert(threshold !== null && threshold.type === 'number', 'Fuzzy shows the threshold in the header');
    assert(threshold.value === '0.85', 'the threshold starts at 0.85');
    threshold.focus();
    const typed = await press(threshold, 'j');
    assert(!typed.defaultPrevented, 'J pressed in the threshold is not cancelled');
    assert(selectedKey(container) === 'fly me to the moon', 'J pressed in the threshold leaves the selection alone');
    await typeInto(threshold, '0.3');
    assert(textOf(headerOf(container)).includes('Enter 0.5–1'), 'an out-of-range threshold says what it takes');
    assert(threshold.getAttribute('aria-invalid') === 'true', 'and is marked invalid');
    assert(buttonNamed(headerOf(container), 'Scan again')?.disabled === true, 'no scan runs with it');
    assert(
      !NO_RAW_PALETTE.test(headerOf(container).outerHTML),
      'the threshold and its error use no raw Tailwind palette class',
    );
    await typeInto(threshold, '0.9');
    assert(!textOf(headerOf(container)).includes('Enter 0.5–1'), 'a threshold in range clears the error');
    await press(document.body, 'j');
    assert(selectedKey(container) === 'sing my pleasure', 'J anywhere else moves the queue');

    // A fresh scan starts the queue over at its first group.
    server.replies.songs.push(scanReply());
    await click(buttonNamed(headerOf(container), 'Scan again'), 'Scan again');
    const fuzzy = callsTo('songs')[1]?.params;
    assert(
      fuzzy?.get('mode') === 'fuzzy' && fuzzy.get('threshold') === '0.9',
      `a fuzzy scan sends its threshold (got ${fuzzy?.toString()})`,
    );
    assert(selectedKey(container) === 'fly me to the moon', 'a fresh scan selects its first group');
    await click(modeButton(container, 'Exact'), 'the Exact mode');
    assert(thresholdOf(container) === null, 'Exact hides the threshold again');
    assert(callsTo('songs').length === 2, 'switching the mode does not scan');

    // --- A merge asks first; the merged group leaves and the one after it is selected ---
    await click(rowFor(container, 'sing my pleasure'), 'the sing my pleasure row');
    const localMerge = buttonNamed(detailOf(container), 'Merge Local Duplicates');
    assert(localMerge !== undefined && !localMerge.disabled, 'a one-work group offers Merge Local Duplicates');
    await click(localMerge, 'Merge Local Duplicates');
    let dialog = openDialog(container);
    assert(dialog !== null, 'the merge asks through the confirm dialog');
    assert(textOf(dialog.querySelector('h2')) === 'Merge Local Duplicates?', 'the confirm is titled with the action, as a question');
    // The merge keeps its danger confirm (red tile, focus on Cancel) but draws the kit's merge icon, not a trash can.
    const mergeTile = dialog.querySelector('h2')?.previousElementSibling;
    assert(mergeTile?.classList.contains('bg-danger-solid') === true, 'the merge is a danger confirm: a red tile above its title');
    assert(
      mergeTile.querySelector('svg path[d="m8 6 4-4 4 4"]') !== null && mergeTile.querySelector('svg path[d="M3 6h18"]') === null,
      'and the tile draws the kit merge icon, not a trash can',
    );
    assert(document.activeElement === buttonNamed(dialog, 'Cancel'), 'and focus starts on Cancel');
    const description = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    const body = description?.firstElementChild;
    assert(
      textOf(body) === expectedConfirmBody(SING, 'sing-1'),
      `the confirm body is the merge confirmation message (got ${JSON.stringify(textOf(body))})`,
    );
    assert(classesOf(body).includes('whitespace-pre-line'), 'its line breaks show');
    await click(buttonNamed(dialog, 'Cancel'), 'the confirm Cancel button');
    assert(openDialog(container) === null && callsTo('merge').length === 0, 'Cancel merges nothing');
    assert(selectedKey(container) === 'sing my pleasure', 'and leaves the selection');

    server.replies.merge.push(mergeReply(1, 8));
    await click(buttonNamed(detailOf(container), 'Merge Local Duplicates'), 'Merge Local Duplicates');
    dialog = openDialog(container);
    assert(dialog !== null, 'the merge asks again');
    const confirmButton = buttonNamed(dialog, 'Merge Local Duplicates');
    assert(confirmButton !== undefined, "the confirm button reads the action's label");
    await click(confirmButton, 'the confirm Merge Local Duplicates button');
    assert(callsTo('merge').length === 1, 'confirming sends one merge');
    const first = callsTo('merge')[0]?.body;
    assert(
      first?.canonicalSongId === 'sing-1'
        && JSON.stringify(first.sourceSongIds) === JSON.stringify(['sing-2'])
        && first.revision === 7
        && first.workMergeConfirmation === undefined,
      `a local merge sends the canonical, its source and the scanned revision (got ${JSON.stringify(first)})`,
    );
    assert(
      JSON.stringify(rowKeys(container)) === JSON.stringify(['fly me to the moon', '錦鯉抄', 'blue']),
      `the merged group leaves the list (got ${rowKeys(container).join(' / ')})`,
    );
    assert(
      selectedKey(container) === '錦鯉抄',
      `the group after the merged one is selected, not the list's first (got ${selectedKey(container)})`,
    );
    assert(toastText(container).includes('Merged 1 song record; all 3 performances kept.'), `a toast reports the merge (got ${toastText(container)})`);
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs3', 'the tab count follows the list');
    assert(
      textOf(headerOf(container)).includes('7 songs in 3 groups · scanned just now'),
      `and so does the header summary, beside it (got ${textOf(headerOf(container))})`,
    );

    // Merges are serialized: while one runs, no other can start, and moving on keeps the selection.
    const inFlight = held();
    server.replies.merge.push(inFlight.reply);
    await click(buttonNamed(detailOf(container), 'Merge Local Duplicates'), 'Merge Local Duplicates');
    dialog = openDialog(container);
    assert(dialog !== null, 'the next merge asks too');
    await click(buttonNamed(dialog, 'Merge Local Duplicates'), 'the confirm Merge Local Duplicates button');
    const second = callsTo('merge')[1]?.body;
    assert(
      second?.canonicalSongId === 'koi-2' && second.revision === 8,
      `the next merge sends the revision the previous merge returned (got ${JSON.stringify(second)})`,
    );
    const merging = buttonNamed(detailOf(container), 'Merging...');
    assert(merging !== undefined && merging.disabled, 'the running merge reads Merging... and waits');
    await click(rowFor(container, 'fly me to the moon'), 'the fly me to the moon row');
    const waiting = buttonNamed(detailOf(container), 'Merge Songs + Global Works');
    assert(waiting !== undefined && waiting.disabled, "another group's merge waits for the running one");
    assert(
      waiting.getAttribute('title') === 'Wait for the in-flight merge to finish; the next merge needs the revision it returns',
      'and says why',
    );
    await inFlight.release(mergeReply(1, 9));
    assert(
      JSON.stringify(rowKeys(container)) === JSON.stringify(['fly me to the moon', 'blue']),
      'the merged group leaves the list',
    );
    assert(selectedKey(container) === 'fly me to the moon', 'the group chosen while the merge ran stays selected');
    assert(toastText(container).includes('Merged 1 song record; all 3 performances kept.'), 'the merge is toasted');

    // A global merge carries its work merge confirmation.
    server.replies.merge.push(mergeReply(2, 10));
    await click(buttonNamed(detailOf(container), 'Merge Songs + Global Works'), 'Merge Songs + Global Works');
    dialog = openDialog(container);
    assert(dialog !== null && textOf(dialog.querySelector('h2')) === 'Merge Songs + Global Works?', 'the global merge asks too');
    assert(
      textOf(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.firstElementChild)
        === expectedConfirmBody(FLY, 'fly-1'),
      'with the global merge confirmation message',
    );
    await click(buttonNamed(dialog, 'Merge Songs + Global Works'), 'the confirm Merge Songs + Global Works button');
    const third = callsTo('merge')[2]?.body;
    assert(
      third?.canonicalSongId === 'fly-1'
        && JSON.stringify(third.sourceSongIds) === JSON.stringify(['fly-2', 'fly-3'])
        && third.revision === 9
        && JSON.stringify(third.workMergeConfirmation)
          === JSON.stringify({ canonicalWorkId: 'work-fly', sourceWorkIds: ['work-fly-2'] }),
      `a global merge confirms the work IDs it keeps and retires (got ${JSON.stringify(third)})`,
    );
    assert(JSON.stringify(rowKeys(container)) === JSON.stringify(['blue']), 'the merged group leaves the list');
    assert(selectedKey(container) === 'blue', 'the remaining group is selected');
    assert(toastText(container).includes('Merged 2 song records; all 8 performances kept.'), 'the merge is toasted');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs1', 'the tab count follows the list');

    // A group with an unlinked song cannot be merged.
    const blocked = detailOf(container);
    assert(
      textOf(blocked).includes(
        'Merge blocked: 1 selected song record(s) do not have a workId. Link every song to a global work before merging.',
      ),
      'an unlinked group says the merge is blocked',
    );
    assert(textOf(variantRows(container)[1]?.children[3]) === 'UNLINKED', 'the unlinked song shows UNLINKED');
    const blockedMerge = buttonNamed(blocked, 'Merge Local Duplicates');
    assert(blockedMerge !== undefined && blockedMerge.disabled, 'its merge waits');
    assert(blockedMerge.getAttribute('title') === 'Link every selected song to a workId before merging', 'and says why');
    assert(
      buttonNamed(blocked, 'Previous group')?.disabled === true && buttonNamed(blocked, 'Next group')?.disabled === true,
      'a lone group has no previous or next',
    );
    await click(buttonNamed(blocked, 'Skip'), 'Skip');
    assert(selectedKey(container) === 'blue', 'Skip on a lone group keeps it selected');

    assert(callsTo('songs').length === 2, 'no merge rescanned');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    '✓ harmonizer songs queue: scan controls and summary in the header; rows with variants, match type and Global merge; the detail with notice, variants, Skip and previous / next; J types in the threshold; a confirmed merge drops its group and selects the next',
  );

  {
    // --- A failed first scan, then Review Focus 3: a trip to the artists tab and back ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    server.replies.songs.push({ status: 500, body: { error: 'Scan exploded' } });
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'Scan now');
    const alert = sectionOf(container, 'Similar songs').querySelector('[role="alert"]');
    assert(textOf(alert).includes('Scan exploded'), 'a failed scan says why');
    assert(textOf(sectionOf(container, 'Similar songs')).includes('Find duplicate songs'), 'and the empty state stays');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs', 'a failed scan shows no count');

    server.replies.songs.push(scanReply());
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'Scan now');
    assert(sectionOf(container, 'Similar songs').querySelector('[role="alert"]') === null, 'a scan that lands clears the error');
    assert(rowKeys(container).length === 4, 'the queue shows the scan');

    const restoreLayout = stubListLayout();
    try {
      // Rows sit at 0–60, 60–120, 120–180 and 180–240; the list shows 130 px from its scrollTop.
      await click(rowFor(container, 'blue'), 'the blue row');
      const list = groupsList(container);
      assert(selectedKey(container) === 'blue' && list.scrollTop === 110, 'the last row (180–240) is scrolled into view');

      await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
      assert(sectionOf(container, 'Similar songs').hasAttribute('hidden'), 'the songs tab is hidden, not unmounted');
      assert(!sectionOf(container, 'Similar artists').hasAttribute('hidden'), 'the artists tab is shown');
      assert(viewButton(container, 'Similar artists').getAttribute('aria-pressed') === 'true', 'Similar artists is pressed');
      assert(
        buttonNamed(headerOf(container), 'Scan again') === undefined && !textOf(headerOf(container)).includes('songs in'),
        "the songs tab's controls leave the header with it",
      );
      assert(
        buttonNamed(headerOf(container), 'Scan') !== undefined,
        "the artists tab's own controls take their place: Scan, as it has not scanned",
      );
      // K, not only J: from the last row a J would stay put even on a queue that still listened.
      await press(document.body, 'k');
      assert(selectedKey(container) === 'blue', 'K with the artists tab shown leaves the songs selection alone');
      await press(document.body, 'j');
      assert(selectedKey(container) === 'blue', 'and so does J');
      // A list inside a `hidden` tab loses its scroll offset. happy-dom keeps it, so the test drops it.
      list.scrollTop = 0;

      await click(viewButton(container, 'Similar songs'), 'the Similar songs tab');
      assert(!sectionOf(container, 'Similar songs').hasAttribute('hidden'), 'the songs tab is shown again');
      assert(callsTo('songs').length === 2, 'coming back scans nothing: the failed scan and the one that landed');
      assert(rowKeys(container).length === 4, 'the scan result is still there');
      assert(selectedKey(container) === 'blue', 'the selected group is still selected');
      assert(groupsList(container).scrollTop === 110, 'and the list scrolls back to it');
      assert(
        buttonNamed(headerOf(container), 'Scan again') !== undefined
          && textOf(headerOf(container)).includes('9 songs in 4 groups · scanned just now'),
        'the songs controls and summary are back in the header',
      );
      assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs4', 'the count stayed');
    } finally {
      restoreLayout();
    }
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    '✓ harmonizer: a failed scan shows its error; a trip to the artists tab and back keeps the scan, the selection and the list scroll, with no second scan',
  );

  {
    // --- A merge the server refuses: an error toast; the group, the selection and the revision stay ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    server.replies.songs.push(scanReply());
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'Scan now');
    await click(rowFor(container, 'sing my pleasure'), 'the sing my pleasure row');

    const refusal = 'The catalog changed since this scan. Scan again.';
    server.replies.merge.push({ status: 409, body: { error: refusal } });
    await click(buttonNamed(detailOf(container), 'Merge Local Duplicates'), 'Merge Local Duplicates');
    let dialog = openDialog(container);
    assert(dialog !== null, 'the merge asks first');
    await click(buttonNamed(dialog, 'Merge Local Duplicates'), 'the confirm Merge Local Duplicates button');
    assert(
      callsTo('merge').length === 1 && callsTo('merge')[0]?.body?.revision === 7,
      'the merge went out with the scanned revision',
    );
    const errors = container.querySelector<HTMLElement>('section[aria-label="Notifications"] ul[aria-live="assertive"]');
    assert(
      textOf(errors).includes(refusal),
      `a refused merge is an error toast with the server's message, wherever the page is scrolled (got ${JSON.stringify(textOf(errors))})`,
    );
    assert(errors !== null && buttonNamed(errors, 'Retry') === undefined, 'with no Retry: a merge is not idempotent');
    assert(
      JSON.stringify(rowKeys(container)) === JSON.stringify(['fly me to the moon', 'sing my pleasure', '錦鯉抄', 'blue']),
      'the refused group stays in the list',
    );
    assert(selectedKey(container) === 'sing my pleasure', 'and stays selected');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs4', 'the tab count is unchanged');
    const retry = buttonNamed(detailOf(container), 'Merge Local Duplicates');
    assert(retry !== undefined && !retry.disabled, 'the merge can be asked for again');

    server.replies.merge.push(mergeReply(1, 8));
    await click(retry, 'Merge Local Duplicates');
    dialog = openDialog(container);
    assert(dialog !== null, 'the merge asks again');
    await click(buttonNamed(dialog, 'Merge Local Duplicates'), 'the confirm Merge Local Duplicates button');
    assert(
      callsTo('merge')[1]?.body?.revision === 7,
      "the next merge still sends the scan's revision: the refused one adopted none",
    );
    assert(!rowKeys(container).includes('sing my pleasure'), 'once the merge lands, the group leaves');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs3', 'and the tab count follows');
    assert(callsTo('songs').length === 1, 'nothing rescanned');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    "✓ harmonizer: a refused merge is an error toast with no Retry; the group stays selected, the count unchanged, and the next merge sends the scan's revision",
  );

  {
    // --- The songs tab runs one request at a time, like the artists tab: no scan during a merge, no merge during a scan ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    const scanButton = () => buttonNamed(headerOf(container), 'Scan again');
    server.replies.songs.push(scanReply());
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'Scan now');
    await click(rowFor(container, 'sing my pleasure'), 'the sing my pleasure row');

    const merging = held();
    server.replies.merge.push(merging.reply);
    await click(buttonNamed(detailOf(container), 'Merge Local Duplicates'), 'Merge Local Duplicates');
    const dialog = openDialog(container);
    assert(dialog !== null, 'the merge asks first');
    await click(buttonNamed(dialog, 'Merge Local Duplicates'), 'the confirm Merge Local Duplicates button');
    assert(callsTo('merge').length === 1, 'the merge went out');
    assert(scanButton()?.disabled === true, 'no scan starts while a merge runs');
    await merging.release(mergeReply(1, 8));
    assert(scanButton()?.disabled === false, 'Scan is back once the merge has landed');
    assert(selectedKey(container) === '錦鯉抄', 'the group after the merged one is selected');

    const scanning = held();
    server.replies.songs.push(scanning.reply);
    await click(scanButton(), 'Scan again');
    assert(buttonNamed(headerOf(container), 'Scanning...') !== undefined, 'the scan runs');
    const waiting = buttonNamed(detailOf(container), 'Merge Local Duplicates');
    assert(waiting !== undefined && waiting.disabled, 'no merge starts while a scan runs');
    await scanning.release(scanReply());
    assert(selectedKey(container) === 'fly me to the moon', 'the scan that landed starts the queue over');
    const ready = buttonNamed(detailOf(container), 'Merge Songs + Global Works');
    assert(ready !== undefined && !ready.disabled, 'a merge can start once the scan has landed');
    assert(callsTo('songs').length === 2 && callsTo('merge').length === 1, 'one scan after the merge, no second merge');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ harmonizer: the songs tab runs one request at a time: Scan waits for a merge and Merge for a scan');

  {
    // --- While a scan runs, the mode and the threshold wait with Scan, on both tabs ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    /** Exact, Fuzzy and the threshold: the scan settings the active tab shows in the header. */
    const assertSettings = (thresholdId: string, disabled: boolean, when: string) => {
      const threshold = thresholdOf(container, thresholdId);
      assert(threshold !== null, `the header shows the ${thresholdId} field ${when}`);
      const settings = [modeButton(container, 'Exact'), modeButton(container, 'Fuzzy'), threshold];
      for (const control of settings) {
        const name = control.getAttribute('id') ?? textOf(control);
        assert(control.disabled === disabled, `${name} is ${disabled ? 'disabled' : 'enabled'} ${when}`);
      }
    };

    // Songs: the first scan, a fuzzy one, held.
    await click(modeButton(container, 'Fuzzy'), 'the Fuzzy mode');
    assertSettings('song-harmonizer-threshold', false, 'before the songs scan');
    const songsScan = held();
    server.replies.songs.push(songsScan.reply);
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'the songs Scan now');
    assert(buttonNamed(headerOf(container), 'Scanning...') !== undefined, 'the songs scan runs');
    assertSettings('song-harmonizer-threshold', true, 'while the songs scan runs');
    await songsScan.release(scanReply());
    const songsParams = callsTo('songs')[0]?.params;
    assert(
      songsParams?.get('mode') === 'fuzzy' && songsParams.get('threshold') === '0.85',
      `the songs scan asked for what the header showed (got ${songsParams?.toString()})`,
    );
    assertSettings('song-harmonizer-threshold', false, 'once the songs scan has landed');

    // Artists: a fuzzy scan again, held.
    await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
    server.replies.artists.push(artistScanReply());
    await click(buttonNamed(sectionOf(container, 'Similar artists'), 'Scan now'), 'the artists Scan now');
    await click(modeButton(container, 'Fuzzy'), 'the Fuzzy mode');
    const artistsScan = held();
    server.replies.artists.push(artistsScan.reply);
    await click(buttonNamed(headerOf(container), 'Scan again'), 'the artists Scan again');
    assert(buttonNamed(headerOf(container), 'Scanning...') !== undefined, 'the artists scan runs');
    assertSettings('artist-harmonizer-threshold', true, 'while the artists scan runs');
    await artistsScan.release(artistScanReply());
    const artistsParams = callsTo('artists')[1]?.params;
    assert(
      artistsParams?.get('mode') === 'fuzzy' && artistsParams.get('threshold') === '0.85',
      `the artists scan asked for what the header showed (got ${artistsParams?.toString()})`,
    );
    assertSettings('artist-harmonizer-threshold', false, 'once the artists scan has landed');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ harmonizer: while a scan runs, Exact / Fuzzy and the threshold wait with Scan, on both tabs');

  {
    // --- A scan that finds nothing: the list says so, and the detail says what to try ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    const hint = 'Try Fuzzy mode, or a lower threshold, to catch looser matches.';

    server.replies.songs.push({ status: 200, body: { groups: [], stats: { totalSongs: 40, groupCount: 0, affectedSongs: 0 }, revision: 7 } });
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'the songs Scan now');
    const songs = sectionOf(container, 'Similar songs');
    assert(songs.querySelector('ul[aria-label="Similar song groups"]') === null, 'no group list without groups');
    const songsEmpty = songs.querySelector('h4');
    assert(textOf(songsEmpty) === 'No similar song titles found.', `the detail names the empty result (got "${textOf(songsEmpty)}")`);
    assert(textOf(songsEmpty?.parentElement).includes(hint), 'and suggests a looser scan');
    assert(textOf(headerOf(container)).includes('0 songs in 0 groups · scanned just now'), 'the header sums the empty scan up');
    assert(!NO_RAW_PALETTE.test(songs.outerHTML), 'the empty result uses no raw Tailwind palette class');

    await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
    server.replies.artists.push({ status: 200, body: { groups: [], stats: { totalArtists: 9, groupCount: 0, affectedEntries: 0 } } });
    await click(buttonNamed(sectionOf(container, 'Similar artists'), 'Scan now'), 'the artists Scan now');
    const artistsEmpty = sectionOf(container, 'Similar artists').querySelector('h4');
    assert(textOf(artistsEmpty) === 'No similar artist names found.', `the artists detail names its empty result (got "${textOf(artistsEmpty)}")`);
    assert(textOf(artistsEmpty?.parentElement).includes(hint), 'and suggests a looser scan too');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ harmonizer: a scan that finds nothing shows an EmptyState in the detail with what to try, on both tabs');

  {
    // --- Similar artists: the scan, the queue, the detail, Apply and Apply All Reviewed ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    const header = () => headerOf(container);
    const artists = () => sectionOf(container, 'Similar artists');
    const applyAll = () => buttonNamed(header(), 'Apply All Reviewed');
    const apply = () => buttonNamed(artistDetail(container), 'Apply');

    await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
    assert(!artists().hasAttribute('hidden'), 'the artists tab is shown');
    assert(modeButton(container, 'Exact').getAttribute('aria-pressed') === 'true', "the artists tab's Match mode starts on Exact");
    assert(buttonNamed(header(), 'Scan') !== undefined, 'the header offers Scan before the first scan');
    assert(applyAll() === undefined, 'Apply All Reviewed waits for groups');

    server.replies.artists.push(artistScanReply());
    await click(buttonNamed(artists(), 'Scan now'), 'Scan now');
    assert(callsTo('artists').length === 1 && callsTo('songs').length === 0, 'Scan now scans the artists once, and no songs');
    const params = callsTo('artists')[0]?.params;
    assert(
      params?.get('mode') === 'exact' && !params.has('threshold') && params.get('streamer') === 'mizuki',
      `an exact artist scan of the current streamer sends no threshold (got ${params?.toString()})`,
    );
    assert(
      textOf(header()).includes('9 artist names in 4 groups · scanned just now'),
      `the header sums the artist scan up (got ${textOf(header())})`,
    );
    assert(buttonNamed(header(), 'Scan again') !== undefined, 'the header scan button reads Scan again after a scan');
    assert(applyAll() !== undefined && applyAll()?.disabled === false, 'the header offers Apply All Reviewed once there are groups');
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists4', 'the artists tab shows its group count');
    assert(textOf(viewButton(container, 'Similar songs')) === 'Similar songs', 'the songs tab shows none (it has not scanned)');
    assert(!textOf(artists()).includes('Find artist name variants'), 'the empty state gives way to the queue');

    // The list: each artist key with its variant count and match type.
    assert(
      JSON.stringify(rowKeys(container, 'artists')) === JSON.stringify(['vaundy', 'yoasobi', 'aimer', '米津玄師']),
      `the list shows each artist key, in scan order (got ${rowKeys(container, 'artists').join(' / ')})`,
    );
    const pills = rowButtons(container, 'artists').map(rowPills);
    assert(
      JSON.stringify(pills)
        === JSON.stringify([['3 variants', 'Exact'], ['2 variants', 'Fuzzy'], ['2 variants', 'Exact'], ['2 variants', 'Exact']]),
      `each row counts its variants and names its match type (got ${JSON.stringify(pills)})`,
    );
    assert(classesOf(rowPill(rowFor(container, 'vaundy', 'artists'), 'Exact')).includes('bg-tone-ok-bg'), 'Exact is an ok pill');
    assert(classesOf(rowPill(rowFor(container, 'yoasobi', 'artists'), 'Fuzzy')).includes('bg-tone-warn-bg'), 'Fuzzy is a warn pill');
    assert(selectedKey(container, 'artists') === 'vaundy', 'the first group is selected as the scan lands');
    const listCard = groupsList(container, 'artists').closest('.glass-card');
    assert(textOf(listCard).startsWith('Groups4'), 'the list card is titled Groups, with the count');
    assert(textOf(listCard).includes('next / previous group'), 'the list footer names what J / K walk');

    // The detail: the canonical name, the variants with their preview, Apply.
    const detail = artistDetail(container);
    assert(textOf(detail.querySelector('h2')) === 'vaundy', 'the detail is headed by the artist key');
    assert(textOf(detail).includes('3 variants'), 'with its variant count');
    const label = canonicalLabel(container);
    assert(textOf(label.querySelector('[aria-hidden="true"]')) === 'Canonical name', 'the field reads Canonical name');
    assert(textOf(label.querySelector('.sr-only')) === 'Canonical name for vaundy', 'and keeps its long label for screen readers');
    assert(canonicalField(container).value === 'Vaundy', 'the most-used spelling is suggested');
    const heads = [...detail.querySelectorAll('thead th')].map((head) => textOf(head));
    assert(
      JSON.stringify(heads) === JSON.stringify(['Artist Name', 'Songs', 'Preview']),
      `the variants table heads read Artist Name / Songs / Preview (got ${heads.join(' / ')})`,
    );
    assert(!classesOf(detail.querySelector('thead')).some((utility) => utility.includes('sticky')), 'the variants head does not stick');
    const rows = artistRows(container);
    assert(rows.length === 3, 'one table row per variant');
    assert(
      rows.every((row) => {
        const button = row.children[0]?.querySelector('button');
        return button?.getAttribute('title') === 'Use this as canonical' && button.getAttribute('type') === 'button';
      }),
      'each spelling is a button titled Use this as canonical',
    );
    assert(
      JSON.stringify(rows.map((row) => textOf(row.children[0]))) === JSON.stringify(['vaundy', 'Vaundy', 'VAUNDY'])
        && JSON.stringify(rows.map((row) => textOf(row.children[1]))) === JSON.stringify(['1', '3', '2']),
      'each row names its spelling and counts its songs',
    );
    assert(
      previewOf(rows[0]).struck === 'vaundy' && previewOf(rows[0]).text.endsWith('Vaundy'),
      `another spelling is struck, the canonical name after it (got ${previewOf(rows[0]).text})`,
    );
    assert(previewOf(rows[1]).text === 'no change', 'the canonical spelling reads no change');
    assert(previewOf(rows[2]).struck === 'VAUNDY' && previewOf(rows[2]).text.endsWith('Vaundy'), 'as does the third spelling');
    assert(classesOf(rows[1]).includes('bg-selected') && !classesOf(rows[0]).includes('bg-selected'), 'the canonical row is tinted');
    assert(apply() !== undefined && apply()?.disabled === false, 'the detail offers Apply');
    assert(buttonNamed(detail, 'Previous group')?.disabled === true, 'Previous group waits at the first group');
    assert(buttonNamed(detail, 'Next group')?.disabled === false, 'Next group is available');
    assert(
      !NO_RAW_PALETTE.test(header().outerHTML + artists().outerHTML),
      'the header controls, the list and the detail use no raw Tailwind palette class',
    );

    // A spelling's button makes it the canonical name; a typed name need be no spelling at all.
    await click(spellingButton(container, 'VAUNDY'), 'the VAUNDY button');
    assert(canonicalField(container).value === 'VAUNDY', 'Use this as canonical fills in the name');
    assert(previewOf(artistRows(container)[2]).text === 'no change', 'the chosen spelling reads no change');
    assert(
      previewOf(artistRows(container)[1]).struck === 'Vaundy' && previewOf(artistRows(container)[1]).text.endsWith('VAUNDY'),
      'the others preview the new name',
    );
    assert(classesOf(artistRows(container)[2]).includes('bg-selected'), 'and the tint follows');
    await typeInto(canonicalField(container), 'Vaundy (バウンディ)');
    assert(
      artistRows(container).every((row) => previewOf(row).struck !== '' && previewOf(row).text.endsWith('Vaundy (バウンディ)')),
      'a typed name previews on every spelling',
    );
    assert(!artistRows(container).some((row) => classesOf(row).includes('bg-selected')), 'and tints none');
    await typeInto(canonicalField(container), '   ');
    assert(apply()?.disabled === true, 'a blank name cannot be applied');
    assert(
      artistRows(container).every((row) => previewOf(row).struck !== '' && previewOf(row).text === previewOf(row).struck),
      'a blank name previews no replacement',
    );
    await typeInto(canonicalField(container), 'Vaundy');
    assert(apply()?.disabled === false, 'with a name again, Apply is back');

    // --- Review Focus 1: J and K typed into the canonical name stay letters ---
    const field = canonicalField(container);
    field.focus();
    const typedJ = await press(field, 'j');
    assert(!typedJ.defaultPrevented, 'J pressed in the canonical name is not cancelled');
    assert(selectedKey(container, 'artists') === 'vaundy', 'J pressed in the canonical name leaves the selection alone');
    const typedK = await press(field, 'k');
    assert(!typedK.defaultPrevented && selectedKey(container, 'artists') === 'vaundy', 'and so does K');
    await typeInto(field, 'Vaundyj');
    assert(
      canonicalField(container).value === 'Vaundyj' && selectedKey(container, 'artists') === 'vaundy',
      'J typed into the canonical name lands in the name',
    );
    await typeInto(canonicalField(container), 'Vaundy');
    await press(document.body, 'j');
    assert(selectedKey(container, 'artists') === 'yoasobi', 'J anywhere else selects the next group');
    await press(document.body, 'k');
    assert(selectedKey(container, 'artists') === 'vaundy', 'K selects the previous group');
    await click(buttonNamed(artistDetail(container), 'Next group'), 'Next group');
    assert(selectedKey(container, 'artists') === 'yoasobi', 'Next group selects the next group');
    await click(buttonNamed(artistDetail(container), 'Previous group'), 'Previous group');
    assert(selectedKey(container, 'artists') === 'vaundy', 'Previous group selects the previous one');
    await click(rowFor(container, '米津玄師', 'artists'), 'the 米津玄師 row');
    assert(selectedKey(container, 'artists') === '米津玄師', 'a click selects its row');
    assert(buttonNamed(artistDetail(container), 'Next group')?.disabled === true, 'Next group waits at the last group');

    // The artists tab's own threshold, and a fuzzy scan that starts the queue over.
    await click(modeButton(container, 'Fuzzy'), 'the Fuzzy mode');
    const threshold = thresholdOf(container, 'artist-harmonizer-threshold');
    assert(threshold !== null && threshold.value === '0.85', 'Fuzzy shows the artists threshold, at 0.85');
    assert(thresholdOf(container) === null, "the songs tab's threshold is not in the header");
    await typeInto(threshold, '0.3');
    assert(
      textOf(header()).includes('Enter 0.5–1') && buttonNamed(header(), 'Scan again')?.disabled === true,
      'an out-of-range threshold says what it takes, and no scan runs with it',
    );
    assert(!NO_RAW_PALETTE.test(header().outerHTML), 'the threshold and its error use no raw Tailwind palette class');
    await typeInto(threshold, '0.9');
    server.replies.artists.push(artistScanReply());
    await click(buttonNamed(header(), 'Scan again'), 'Scan again');
    const fuzzy = callsTo('artists')[1]?.params;
    assert(
      fuzzy?.get('mode') === 'fuzzy' && fuzzy.get('threshold') === '0.9',
      `a fuzzy artist scan sends its threshold (got ${fuzzy?.toString()})`,
    );
    assert(selectedKey(container, 'artists') === 'vaundy', 'a fresh scan selects its first group');
    await click(modeButton(container, 'Exact'), 'the Exact mode');

    // --- Apply: the group leaves, and the one after it in the list as it stood is selected ---
    await click(rowFor(container, 'yoasobi', 'artists'), 'the yoasobi row');
    assert(canonicalField(container).value === 'YOASOBI', 'yoasobi suggests YOASOBI');
    const inFlight = held();
    server.replies.apply.push(inFlight.reply);
    await click(apply(), 'Apply');
    assert(callsTo('apply').length === 1, 'Apply sends one request');
    assert(
      JSON.stringify(callsTo('apply')[0]?.body) === JSON.stringify({ updates: [{ songId: 'y-3', originalArtist: 'YOASOBI' }] }),
      `Apply renames the songs of every other spelling (got ${JSON.stringify(callsTo('apply')[0]?.body)})`,
    );
    const applying = buttonNamed(artistDetail(container), 'Applying...');
    assert(applying !== undefined && applying.disabled, 'the running apply reads Applying... and waits');
    assert(buttonNamed(header(), 'Scan again')?.disabled === true, 'no scan starts while an apply runs');
    assert(applyAll()?.disabled === true, 'nor Apply All Reviewed');
    await inFlight.release(applyReply(1));
    assert(
      JSON.stringify(rowKeys(container, 'artists')) === JSON.stringify(['vaundy', 'aimer', '米津玄師']),
      `the applied group leaves the list (got ${rowKeys(container, 'artists').join(' / ')})`,
    );
    assert(
      selectedKey(container, 'artists') === 'aimer',
      `the group after the applied one is selected, not the list's first (got ${selectedKey(container, 'artists')})`,
    );
    assert(toastText(container).includes('Updated 1 song.'), `a toast reports the songs updated (got ${toastText(container)})`);
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists3', 'the tab count follows the list');
    assert(
      textOf(header()).includes('7 artist names in 3 groups · scanned just now'),
      `and so does the header summary, beside it (got ${textOf(header())})`,
    );
    assert(buttonNamed(header(), 'Scan again')?.disabled === false, 'Scan is back once the apply has landed');

    // --- Apply All Reviewed asks first; a blank name is left out; Cancel sends nothing ---
    await click(rowFor(container, 'vaundy', 'artists'), 'the vaundy row');
    await typeInto(canonicalField(container), '');
    await click(applyAll(), 'Apply All Reviewed');
    let dialog = openDialog(container);
    assert(dialog !== null, 'Apply All Reviewed asks through the confirm dialog');
    assert(
      textOf(dialog.querySelector('h2')) === 'Apply 2 canonical artist names?',
      `the confirm counts the names it applies, leaving the blank one out (got ${textOf(dialog.querySelector('h2'))})`,
    );
    assert(textOf(dialog).includes('Renames the artist on 2 songs.'), 'and says how many songs it renames');
    await click(buttonNamed(dialog, 'Cancel'), 'the confirm Cancel button');
    // No reply is queued yet, so a request sent anyway would land in `server.unexpected`.
    assert(
      openDialog(container) === null && callsTo('apply').length === 1 && server.unexpected.length === 0,
      `Cancel sends nothing (also: ${server.unexpected.join(', ')})`,
    );
    assert(rowKeys(container, 'artists').length === 3, 'and keeps every group');

    server.replies.apply.push(applyReply(2));
    await click(applyAll(), 'Apply All Reviewed');
    dialog = openDialog(container);
    assert(dialog !== null, 'Apply All Reviewed asks again');
    await click(buttonNamed(dialog, 'Apply All Reviewed'), 'the confirm Apply All Reviewed button');
    assert(callsTo('apply').length === 2, 'confirming sends one request');
    assert(
      JSON.stringify(callsTo('apply')[1]?.body)
        === JSON.stringify({
          updates: [
            { songId: 'a-3', originalArtist: 'Aimer' },
            { songId: 'k-4', originalArtist: '米津玄師' },
          ],
        }),
      `one request carries the renames of every group applied (got ${JSON.stringify(callsTo('apply')[1]?.body)})`,
    );
    assert(
      JSON.stringify(rowKeys(container, 'artists')) === JSON.stringify(['vaundy']),
      'the applied groups leave the list; the blank one stays',
    );
    assert(selectedKey(container, 'artists') === 'vaundy', 'and is selected');
    assert(toastText(container).includes('Updated 2 songs.'), 'a toast reports the songs updated');
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists1', 'the tab count follows the list');
    assert(applyAll()?.disabled === true, 'with only a blank name left, Apply All Reviewed has nothing to apply');

    await typeInto(canonicalField(container), 'Vaundy');
    server.replies.apply.push(applyReply(3));
    await click(applyAll(), 'Apply All Reviewed');
    dialog = openDialog(container);
    assert(dialog !== null && textOf(dialog.querySelector('h2')) === 'Apply 1 canonical artist name?', 'one group is one name');
    await click(buttonNamed(dialog, 'Apply All Reviewed'), 'the confirm Apply All Reviewed button');
    assert(
      JSON.stringify(callsTo('apply')[2]?.body)
        === JSON.stringify({
          updates: [
            { songId: 's-1', originalArtist: 'Vaundy' },
            { songId: 's-5', originalArtist: 'Vaundy' },
            { songId: 's-6', originalArtist: 'Vaundy' },
          ],
        }),
      `the last group's renames go out (got ${JSON.stringify(callsTo('apply')[2]?.body)})`,
    );
    assert(
      artists().querySelector('ul[aria-label="Similar artist groups"]') === null
        && textOf(artists()).includes('No similar artist names found.'),
      'with every group applied, the list says so',
    );
    assert(toastText(container).includes('Updated 3 songs.'), 'a toast reports the songs updated');
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists0', 'the tab count follows the list');
    assert(applyAll() === undefined, 'Apply All Reviewed leaves with the last group');
    assert(callsTo('artists').length === 2 && callsTo('songs').length === 0, 'no apply rescanned');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    '✓ harmonizer artists queue: controls with Apply All Reviewed in the header; rows with variants and match type; the detail with the canonical name, Artist Name / Songs / Preview and Apply; J types in the canonical name; Apply drops its group and selects the next; Apply All Reviewed asks first',
  );

  {
    // --- The canonical name is used trimmed: compared, previewed and sent; its field keeps what is typed ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    const apply = () => buttonNamed(artistDetail(container), 'Apply');
    const applyAll = () => buttonNamed(headerOf(container), 'Apply All Reviewed');
    /** A variant row's replacement, exactly: what its cell reads after the struck-through old name. */
    const rewrittenTo = (row: HTMLTableRowElement | undefined) => previewOf(row).text.slice(previewOf(row).struck.length);

    await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
    server.replies.artists.push(artistScanReply());
    await click(buttonNamed(sectionOf(container, 'Similar artists'), 'Scan now'), 'Scan now');
    assert(selectedKey(container, 'artists') === 'vaundy', 'the first group is selected as the scan lands');

    // Spaces around a spelling that exists: the field keeps them, the card reads the name trimmed.
    await typeInto(canonicalField(container), ' Vaundy ');
    assert(canonicalField(container).value === ' Vaundy ', 'the field keeps exactly what is typed, its spaces too');
    const rows = artistRows(container);
    assert(
      previewOf(rows[1]).text === 'no change' && classesOf(rows[1]).includes('bg-selected'),
      'the Vaundy spelling reads as the canonical one, tinted, not as a variant to rename',
    );
    assert(
      previewOf(rows[0]).struck === 'vaundy' && rewrittenTo(rows[0]) === 'Vaundy'
        && previewOf(rows[2]).struck === 'VAUNDY' && rewrittenTo(rows[2]) === 'Vaundy',
      `the others preview Vaundy, without the spaces (got ${rewrittenTo(rows[0])} / ${rewrittenTo(rows[2])})`,
    );
    assert(!classesOf(rows[0]).includes('bg-selected') && !classesOf(rows[2]).includes('bg-selected'), 'and are not tinted');
    assert(apply()?.disabled === false, 'Apply is offered: two spellings have songs to rename');

    // A space typed after a word stays in the field, for the word that follows.
    await typeInto(canonicalField(container), 'Vaundy ');
    assert(canonicalField(container).value === 'Vaundy ', 'a space typed after a word stays in the field');
    assert(previewOf(artistRows(container)[1]).text === 'no change', 'while the card still reads the trimmed name');
    await typeInto(canonicalField(container), 'Vaundy Two');
    assert(canonicalField(container).value === 'Vaundy Two', 'and the next word lands after it');
    await typeInto(canonicalField(container), ' Vaundy ');

    // Apply sends the songs of the other spellings only, each renamed to the trimmed name.
    server.replies.apply.push(applyReply(3));
    await click(apply(), 'Apply');
    assert(callsTo('apply').length === 1, 'Apply sends one request');
    assert(
      JSON.stringify(callsTo('apply')[0]?.body)
        === JSON.stringify({
          updates: [
            { songId: 's-1', originalArtist: 'Vaundy' },
            { songId: 's-5', originalArtist: 'Vaundy' },
            { songId: 's-6', originalArtist: 'Vaundy' },
          ],
        }),
      `Apply renames the songs of the other spellings to Vaundy, spaces trimmed, and leaves the Vaundy songs alone (got ${JSON.stringify(callsTo('apply')[0]?.body)})`,
    );
    assert(selectedKey(container, 'artists') === 'yoasobi', 'the applied group leaves and the next one is selected');

    // Apply All Reviewed sends trimmed names too; a name of spaces alone is left out, and sends nothing.
    await typeInto(canonicalField(container), '  YOASOBI ');
    await click(rowFor(container, 'aimer', 'artists'), 'the aimer row');
    await typeInto(canonicalField(container), 'Aimer  ');
    await click(rowFor(container, '米津玄師', 'artists'), 'the 米津玄師 row');
    await typeInto(canonicalField(container), '   ');
    assert(canonicalField(container).value === '   ', 'a name of spaces alone stays in the field as typed');
    assert(apply()?.disabled === true, 'a name of spaces alone cannot be applied');
    assert(
      artistRows(container).every((row) => previewOf(row).struck !== '' && previewOf(row).text === previewOf(row).struck),
      'and previews no replacement',
    );
    await click(applyAll(), 'Apply All Reviewed');
    const dialog = openDialog(container);
    assert(
      dialog !== null && textOf(dialog.querySelector('h2')) === 'Apply 2 canonical artist names?',
      `the confirm counts the names it applies, the spaces-only one left out (got ${textOf(dialog?.querySelector('h2'))})`,
    );
    assert(
      textOf(dialog).includes('Renames the artist on 2 songs.'),
      `and counts only the songs of the spellings that change (got ${textOf(dialog)})`,
    );
    server.replies.apply.push(applyReply(2));
    await click(buttonNamed(dialog, 'Apply All Reviewed'), 'the confirm Apply All Reviewed button');
    assert(callsTo('apply').length === 2, 'confirming sends one request, and none for the spaces-only name');
    assert(
      JSON.stringify(callsTo('apply')[1]?.body)
        === JSON.stringify({
          updates: [
            { songId: 'y-3', originalArtist: 'YOASOBI' },
            { songId: 'a-3', originalArtist: 'Aimer' },
          ],
        }),
      `Apply All Reviewed renames to the trimmed names (got ${JSON.stringify(callsTo('apply')[1]?.body)})`,
    );
    assert(
      JSON.stringify(rowKeys(container, 'artists')) === JSON.stringify(['米津玄師']),
      'the applied groups leave the list; the spaces-only one stays',
    );
    assert(applyAll()?.disabled === true, 'with only a name of spaces left, Apply All Reviewed has nothing to apply');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    '✓ harmonizer artists queue: the canonical name is compared, previewed and sent trimmed, in Apply and in Apply All Reviewed, while its field keeps what is typed; a name of spaces alone sends nothing',
  );

  {
    // --- An apply the server refuses: an error toast; the groups, the selection and the count stay ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
    server.replies.artists.push(artistScanReply());
    await click(buttonNamed(sectionOf(container, 'Similar artists'), 'Scan now'), 'Scan now');
    await click(rowFor(container, 'yoasobi', 'artists'), 'the yoasobi row');
    const errors = () => container.querySelector<HTMLElement>('section[aria-label="Notifications"] ul[aria-live="assertive"]');

    server.replies.apply.push({ status: 500, body: { error: 'The rename could not be saved.' } });
    await click(buttonNamed(artistDetail(container), 'Apply'), 'Apply');
    assert(callsTo('apply').length === 1, 'the apply went out');
    assert(
      textOf(errors()).includes('The rename could not be saved.'),
      `a refused apply is an error toast with the server's message (got ${JSON.stringify(textOf(errors()))})`,
    );
    const region = errors();
    assert(region !== null && buttonNamed(region, 'Retry') === undefined, 'with no Retry: an apply is not idempotent');
    assert(
      sectionOf(container, 'Similar artists').querySelector('[role="alert"]') === null,
      'and no note above the queue, which is for scans',
    );
    assert(
      rowKeys(container, 'artists').length === 4 && selectedKey(container, 'artists') === 'yoasobi',
      'the refused group stays in the list, selected',
    );
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists4', 'the tab count is unchanged');
    assert(buttonNamed(artistDetail(container), 'Apply')?.disabled === false, 'Apply can be asked for again');

    server.replies.apply.push({ status: 500, body: { error: 'The renames could not be saved.' } });
    await click(buttonNamed(headerOf(container), 'Apply All Reviewed'), 'Apply All Reviewed');
    const dialog = openDialog(container);
    assert(dialog !== null && textOf(dialog.querySelector('h2')) === 'Apply 4 canonical artist names?', 'Apply All Reviewed asks');
    await click(buttonNamed(dialog, 'Apply All Reviewed'), 'the confirm Apply All Reviewed button');
    assert(callsTo('apply').length === 2, 'the Apply All request went out');
    assert(textOf(errors()).includes('The renames could not be saved.'), 'a refused Apply All is an error toast with the message');
    assert(
      rowKeys(container, 'artists').length === 4 && selectedKey(container, 'artists') === 'yoasobi',
      'every group stays, and so does the selection',
    );
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists4', 'the tab count is unchanged');

    // An apply that lands after the curator has moved on keeps the curator's choice.
    const inFlight = held();
    server.replies.apply.push(inFlight.reply);
    await click(buttonNamed(artistDetail(container), 'Apply'), 'Apply');
    await click(rowFor(container, '米津玄師', 'artists'), 'the 米津玄師 row');
    await inFlight.release(applyReply(1));
    assert(
      JSON.stringify(rowKeys(container, 'artists')) === JSON.stringify(['vaundy', 'aimer', '米津玄師']),
      'once the apply lands, the group leaves',
    );
    assert(selectedKey(container, 'artists') === '米津玄師', 'the group chosen while the apply ran stays selected');
    assert(textOf(viewButton(container, 'Similar artists')) === 'Similar artists3', 'and the tab count follows');
    assert(callsTo('artists').length === 1, 'nothing rescanned');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    '✓ harmonizer: a refused apply or Apply All is an error toast with no Retry; the groups, the selection and the count stay; an apply that lands keeps a selection moved meanwhile',
  );

  {
    // --- Both tabs scanned: J and K move only the shown tab's queue ---
    resetServer();
    const app = await openPage();
    const { container } = app;
    server.replies.songs.push(scanReply());
    await click(buttonNamed(sectionOf(container, 'Similar songs'), 'Scan now'), 'the songs Scan now');
    await click(rowFor(container, 'sing my pleasure'), 'the sing my pleasure row');
    await click(viewButton(container, 'Similar artists'), 'the Similar artists tab');
    server.replies.artists.push(artistScanReply());
    await click(buttonNamed(sectionOf(container, 'Similar artists'), 'Scan now'), 'the artists Scan now');
    await click(rowFor(container, 'yoasobi', 'artists'), 'the yoasobi row');
    assert(
      textOf(viewButton(container, 'Similar songs')) === 'Similar songs4'
        && textOf(viewButton(container, 'Similar artists')) === 'Similar artists4',
      'each tab shows its own group count',
    );
    assert(
      textOf(headerOf(container)).includes('9 artist names in 4 groups') && !textOf(headerOf(container)).includes('songs in'),
      'the header sums up the shown tab only',
    );

    // Both selections sit mid-list, so J and K would each move a queue that still listened.
    await press(document.body, 'j');
    assert(selectedKey(container, 'artists') === 'aimer', 'with the artists tab shown, J moves the artists queue');
    assert(selectedKey(container) === 'sing my pleasure', 'and leaves the songs selection unchanged');
    await press(document.body, 'k');
    assert(selectedKey(container, 'artists') === 'yoasobi', 'K moves the artists queue back');
    assert(selectedKey(container) === 'sing my pleasure', 'and leaves the songs selection unchanged too');

    await click(viewButton(container, 'Similar songs'), 'the Similar songs tab');
    assert(
      buttonNamed(headerOf(container), 'Apply All Reviewed') === undefined
        && !textOf(headerOf(container)).includes('artist names in')
        && textOf(headerOf(container)).includes('9 songs in 4 groups'),
      "the artists tab's controls leave the header and the songs tab's come back",
    );
    await press(document.body, 'j');
    assert(selectedKey(container) === '錦鯉抄', 'with the songs tab shown, J moves the songs queue');
    assert(selectedKey(container, 'artists') === 'yoasobi', 'and leaves the artists selection unchanged');
    await press(document.body, 'k');
    assert(selectedKey(container) === 'sing my pleasure', 'K moves the songs queue back');
    assert(selectedKey(container, 'artists') === 'yoasobi', 'and leaves the artists selection unchanged too');
    assert(callsTo('songs').length === 1 && callsTo('artists').length === 1, 'switching tabs scans nothing');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log(
    "✓ harmonizer: with both tabs scanned, J and K move only the shown tab's queue, in either direction, and each tab keeps its count",
  );
}

await main();
