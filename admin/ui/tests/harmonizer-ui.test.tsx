import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  HarmonizeMergeResponse,
  HarmonizeSongEntry,
  HarmonizeSongsResponse,
  SimilarityGroup,
} from '../../shared/types';
import { click, installDom, mount, press, settle, typeInto } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

/**
 * The Harmonizer page: the tab `Segmented` and the active tab's scan controls in the header, both
 * tabs mounted, and Similar songs as a review queue over a stubbed server — the scan, the list and
 * the detail, Skip and the detail's previous / next, the confirmed merge that drops its group and
 * selects the next one, J typed into the threshold, and a trip to the other tab and back.
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

// --- The stubbed server: each request takes the next reply queued for its route ---

interface Reply {
  status: number;
  body: unknown;
}

type Route = 'songs' | 'merge';

interface Call {
  route: Route;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}

const server = {
  calls: [] as Call[],
  unexpected: [] as string[],
  replies: { songs: [], merge: [] } as Record<Route, Array<Reply | Promise<Reply>>>,
};

function resetServer(): void {
  server.calls = [];
  server.unexpected = [];
  server.replies = { songs: [], merge: [] };
}

function routeOf(method: string, path: string): Route | null {
  if (method === 'GET' && path === '/api/harmonize/songs') return 'songs';
  if (method === 'POST' && path === '/api/harmonize/merge') return 'merge';
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

function thresholdOf(root: ParentNode): HTMLInputElement | null {
  return headerOf(root).querySelector<HTMLInputElement>('input#song-harmonizer-threshold');
}

function groupsList(root: ParentNode): HTMLUListElement {
  const list = root.querySelector<HTMLUListElement>('ul[aria-label="Similar song groups"]');
  assert(list !== null, 'the queue renders its group list');
  return list;
}

function rowButtons(root: ParentNode): HTMLButtonElement[] {
  return [...groupsList(root).querySelectorAll<HTMLButtonElement>('li > button')];
}

/** Each row's first line: its group key. */
function rowKeys(root: ParentNode): string[] {
  return rowButtons(root).map((row) => textOf(row.children[0]));
}

function rowFor(root: ParentNode, key: string): HTMLButtonElement {
  const row = rowButtons(root).find((button) => textOf(button.children[0]) === key);
  assert(row !== undefined, `the list has the ${key} row`);
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
function selectedKey(root: ParentNode): string {
  return textOf(groupsList(root).querySelector('button[aria-current="true"]')?.children[0]);
}

function detailOf(root: ParentNode): HTMLElement {
  const detail = root.querySelector<HTMLElement>('section[aria-label="Selected group"]');
  assert(detail !== null, 'the queue shows the selected group');
  return detail;
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
  }
  console.log('✓ harmonizer: LIBRARY / Harmonizer header with the view tabs; both tabs mounted, artists hidden; Find duplicate songs before a scan');

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
        headerOf(container).querySelector('[role="group"][aria-label="Match mode"]') === null
          && buttonNamed(headerOf(container), 'Scan again') === undefined
          && !textOf(headerOf(container)).includes('songs in'),
        "the songs tab's controls leave the header with it",
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
}

await main();
