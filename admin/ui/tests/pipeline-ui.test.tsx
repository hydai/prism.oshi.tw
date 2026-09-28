/**
 * The Pipeline page, mounted live the way App.tsx mounts every page (ToastProvider > ConfirmProvider
 * > router) against a stubbed fetch: the two steps in the header — both stay mounted and the inactive
 * one is `hidden`, so a trip to the other step keeps each step's work — and the Discover step: its
 * empty states, the summary strip, the filter chips, the table with its pre-selected new rows, the
 * bulk bar, and the import with its toasts.
 */
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type {
  DiscoveredStream,
  DiscoverStreamsResponse,
  ImportStreamsResponse,
  ListResponse,
  Stream,
} from '../../shared/types';
import { inPrismLabel, newStreamIds, summarizeDiscovered, visibleDiscovered } from '../src/pages/pipeline-discover';
import { click, installDom, mount, settle } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- Fixtures ---

/** One channel scan, newest first: three new videos and two already in Prism, one of them linkable. */
const DISCOVERED: DiscoveredStream[] = [
  { videoId: 'vid-new-01', title: '【歌枠】秋の初歌枠✨初見さん大歓迎🎤', date: '2026-09-26', isNew: true },
  {
    videoId: 'vid-old-01',
    title: 'Saturday night karaoke',
    date: '2026-09-20',
    isNew: false,
    existingStreamId: 's-old',
    existingStatus: 'approved',
  },
  { videoId: 'vid-new-02', title: 'Noon karaoke', date: '2026-09-19', isNew: true },
  { videoId: 'vid-old-02', title: 'Endurance karaoke', date: '2026-09-13', isNew: false },
  // No title: its checkbox is named by the video ID instead.
  { videoId: 'vid-new-03', title: '', date: '2026-09-12', isNew: true },
];
const NEW_IDS = ['vid-new-01', 'vid-new-02', 'vid-new-03'];

/** The same scan once the three new videos are imported: nothing new is left. */
const AFTER_IMPORT: DiscoveredStream[] = DISCOVERED.map((stream) =>
  stream.isNew
    ? { ...stream, isNew: false, existingStreamId: `s-${stream.videoId}`, existingStatus: 'pending' }
    : stream,
);

function readyStream(id: string, title: string, date: string): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title,
    date,
    videoId: `${id}-video`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}-video`,
    credit: {},
    status: 'pending',
    submittedBy: null,
    reviewedBy: null,
    createdAt: `${date}T00:00:00.000Z`,
  };
}

/** The streams waiting for extraction, which the page loads for the Extract step on mount. */
const READY: Stream[] = [
  readyStream('ready-1', 'Ready stream one', '2026-09-01'),
  readyStream('ready-2', 'Ready stream two', '2026-08-25'),
];

/** A stream an import created: imported streams are pending, so they join the ready list. */
const IMPORTED_READY = readyStream('ready-new', 'Freshly imported stream', '2026-09-26');

// --- The pure helpers behind the summary, the chips and the pre-selection ---

const summary = summarizeDiscovered(DISCOVERED);
assert(
  summary.total === 5 && summary.fresh === 3 && summary.existing === 2,
  `a scan counts every video, the new ones and the ones in Prism (got ${JSON.stringify(summary)})`,
);
const emptySummary = summarizeDiscovered([]);
assert(
  emptySummary.total === 0 && emptySummary.fresh === 0 && emptySummary.existing === 0,
  'an empty scan counts nothing',
);
const ids = (streams: DiscoveredStream[]) => streams.map((stream) => stream.videoId).join(',');
assert(ids(visibleDiscovered(DISCOVERED, 'new')) === NEW_IDS.join(','), 'New shows the new videos, in scan order');
assert(
  ids(visibleDiscovered(DISCOVERED, 'existing')) === 'vid-old-01,vid-old-02',
  'Already in Prism shows the known videos, in scan order',
);
assert(ids(visibleDiscovered(DISCOVERED, 'all')) === ids(DISCOVERED), 'All shows every video, in scan order');
assert([...newStreamIds(DISCOVERED)].join(',') === NEW_IDS.join(','), "a scan's new video IDs, in scan order");
assert(newStreamIds(AFTER_IMPORT).size === 0, 'a scan with nothing new has no new IDs');
assert(inPrismLabel(DISCOVERED[1]!) === 'In Prism · Approved', 'a known video names its status, capitalised');
assert(inPrismLabel(DISCOVERED[3]!) === 'In Prism', 'a known video without a status reads In Prism');
assert(inPrismLabel(AFTER_IMPORT[0]!) === 'In Prism · Pending', 'a just-imported video reads In Prism · Pending');

console.log('✓ pipeline-discover: counts, filters and new IDs of a channel scan');

// --- fetch stub: the ready list, discover and import, each answered from what the test set up;
// every request is logged, and one nothing answers is recorded as unexpected (and gets a 404) ---

interface Reply {
  status: number;
  body: unknown;
}

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

let calls: Call[] = [];
let unexpected: string[] = [];
let readyReply: Reply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
/** One reply per discover request, in order. */
const discoverReplies: Reply[] = [];
/** One reply per import request, in order. */
const importReplies: Reply[] = [];
/** Holds the next discover request open until the test releases it. */
let discoverGate: Promise<void> | null = null;
/** Holds the next import request open until the test releases it. */
let importGate: Promise<void> | null = null;

function ok(body: unknown): Reply {
  return { status: 200, body };
}

function scan(streams: DiscoveredStream[]): Reply {
  return ok({ streams, total: streams.length } satisfies DiscoverStreamsResponse);
}

function imported(videoIds: string[]): Reply {
  return ok({ created: videoIds.length, imported: videoIds, skippedExisting: [] } satisfies ImportStreamsResponse);
}

function holdNextDiscover(): () => void {
  let release: () => void = () => undefined;
  discoverGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

function holdNextImport(): () => void {
  let release: () => void = () => undefined;
  importGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

function installFetchStub(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        path: url.pathname,
        params: url.searchParams,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      let reply: Reply | undefined;
      if (method === 'GET' && url.pathname === '/api/streams' && url.searchParams.get('status') === 'pending') {
        reply = readyReply;
      } else if (method === 'POST' && url.pathname === '/api/pipeline/discover') {
        const gate = discoverGate;
        discoverGate = null;
        if (gate) await gate;
        reply = discoverReplies.shift();
      } else if (method === 'POST' && url.pathname === '/api/pipeline/import-streams') {
        const gate = importGate;
        importGate = null;
        if (gate) await gate;
        reply = importReplies.shift();
      }
      if (reply === undefined) {
        unexpected.push(`${method} ${url.pathname}${url.search}`);
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
      }
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function requests(method: string, path: string): Call[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

function discoverRequests(): number {
  return requests('POST', '/api/pipeline/discover').length;
}

function importedIds(call: Call | undefined): string {
  const videoIds = (call?.body as { videoIds?: string[] } | null)?.videoIds ?? [];
  return [...videoIds].sort().join(',');
}

// --- DOM lookups ---

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? '';
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function pageHeader(container: HTMLElement): HTMLElement {
  const header = container.querySelector<HTMLElement>('header');
  assert(header !== null, 'the page renders its header');
  return header;
}

function stepSection(container: HTMLElement, name: 'Discover' | 'Extract'): HTMLElement {
  const section = container.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
  assert(section !== null, `the page renders the ${name} step`);
  return section;
}

function stepOption(container: HTMLElement, name: 'Discover' | 'Extract'): HTMLButtonElement {
  const group = pageHeader(container).querySelector('[role="group"][aria-label="Pipeline steps"]');
  assert(group !== null, 'the header renders the Pipeline steps');
  const option = [...group.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
    textOf(button).includes(name),
  );
  assert(option !== undefined, `the steps offer ${name}`);
  return option;
}

function buttonNamed(root: ParentNode | null, name: string): HTMLButtonElement | undefined {
  return [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (button) => textOf(button).trim() === name,
  );
}

/** A filter chip by its label (its count follows the label inside the button). */
function chip(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...stepSection(container, 'Discover').querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(
    (button) => button.firstChild?.textContent === label,
  );
  assert(found !== undefined, `the Discover step renders the ${label} chip`);
  return found;
}

function rows(container: HTMLElement): HTMLTableRowElement[] {
  return [...stepSection(container, 'Discover').querySelectorAll<HTMLTableRowElement>('tbody tr')];
}

/** The row's status pill (`New`, `In Prism`, `In Prism · Approved`): the first span of its last cell. */
function statusPill(row: HTMLTableRowElement | undefined): string {
  return textOf(row?.lastElementChild?.querySelector('span'));
}

function rowCheckbox(container: HTMLElement, name: string): HTMLInputElement | null {
  return stepSection(container, 'Discover').querySelector<HTMLInputElement>(`input[aria-label="Select stream ${name}"]`);
}

function selectAll(container: HTMLElement): HTMLInputElement {
  const box = stepSection(container, 'Discover').querySelector<HTMLInputElement>(
    'input[aria-label="Select all new streams"]',
  );
  assert(box !== null, 'the table head renders Select all new streams');
  return box;
}

function bulkBar(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="region"][aria-label="Bulk actions"]');
}

function notifications(container: HTMLElement): string {
  return textOf(container.querySelector('section[aria-label="Notifications"]'));
}

/** A `<span>` whose whole text is `text` — one stat of the summary strip. */
function hasStat(container: HTMLElement, text: string): boolean {
  return [...stepSection(container, 'Discover').querySelectorAll('span')].some((span) => textOf(span) === text);
}

/**
 * The page's markup without the Extract step. That step still renders its legacy slate body — it
 * is rebuilt on its own — so the raw-palette check covers the header and the Discover step.
 */
function withoutExtractStep(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement;
  copy.querySelector('section[aria-label="Extract"]')?.remove();
  return copy.innerHTML;
}

function checkedNewRows(container: HTMLElement): string[] {
  return DISCOVERED.filter((stream) => stream.isNew && rowCheckbox(container, stream.title || stream.videoId)?.checked)
    .map((stream) => stream.videoId);
}

function LocationProbe() {
  const location = useLocation();
  return <output id="location">{location.pathname}</output>;
}

// Toasts stay up until dismissed, so the test reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  const { default: Pipeline } = await import('../src/pages/Pipeline');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');

  const page = () => (
    <ToastProvider timers={NO_TIMERS}>
      <ConfirmProvider>
        <MemoryRouter initialEntries={['/pipeline']}>
          <Routes>
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/streams/:id" element={<p>Stream page</p>} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>
  );

  // --- The shell: the ready list loads on mount, Discover is the first step, Extract is hidden ---

  const app = await mount(page());
  const { container } = app;

  const readyLoads = requests('GET', '/api/streams');
  assert(readyLoads.length === 1, `the page loads the ready-to-extract list once, on mount (saw ${readyLoads.length})`);
  assert(
    readyLoads[0]?.params.get('status') === 'pending' && readyLoads[0]?.params.get('streamer') === 'mizuki',
    "the ready list is the current streamer's pending streams",
  );
  assert(discoverRequests() === 0, 'nothing is discovered on page load: each scan spends YouTube quota');

  const header = pageHeader(container);
  assert(textOf(header.querySelector('h1')) === 'Pipeline', 'the header is titled Pipeline');
  assert(textOf(header).startsWith('TIMESTAMPS'), 'the header crumb is TIMESTAMPS');
  assert(
    stepOption(container, 'Discover').getAttribute('aria-pressed') === 'true'
      && stepOption(container, 'Extract').getAttribute('aria-pressed') === 'false',
    'Discover is the step shown first',
  );
  assert(textOf(stepOption(container, 'Discover')) === '1Discover', 'Discover is step 1');
  assert(
    textOf(stepOption(container, 'Extract')) === '2Extract2',
    `Extract is step 2 and counts the streams ready for it (got "${textOf(stepOption(container, 'Extract'))}")`,
  );
  assert(!stepSection(container, 'Discover').hasAttribute('hidden'), 'the Discover step is visible');
  assert(stepSection(container, 'Extract').hasAttribute('hidden'), 'the Extract step is mounted but hidden');

  // --- Before the first run ---

  const discoverStep = stepSection(container, 'Discover');
  assert(textOf(discoverStep).includes('Find new karaoke streams'), 'before a run, the empty state invites a scan');
  assert(
    textOf(discoverStep).includes("Scans mizuki's YouTube channel for karaoke streams."),
    "the empty state names the streamer whose channel is scanned",
  );
  assert(discoverStep.querySelector('table') === null, 'no table before the first run');
  assert(buttonNamed(header, 'Discover streams') !== undefined, 'the header offers Discover streams before the first run');
  const emptyStateDiscover = buttonNamed(discoverStep, 'Discover streams');
  assert(emptyStateDiscover !== undefined, 'the empty state offers Discover streams');

  // A run that finds nothing. The header button is busy while the channel is scanned.
  const releaseScan = holdNextDiscover();
  discoverReplies.push(scan([]));
  await click(emptyStateDiscover, "the empty state's Discover streams");
  assert(discoverRequests() === 1, 'Discover streams scans the channel once');
  assert(
    buttonNamed(header, 'Discover streams')?.getAttribute('aria-busy') === 'true',
    'the header button is busy while the channel is scanned',
  );
  await act(async () => {
    releaseScan();
  });
  await settle();

  assert(textOf(stepSection(container, 'Discover')).includes('No videos found'), 'a run that finds nothing says so');
  assert(
    textOf(stepSection(container, 'Discover')).includes('Nothing on the channel looks like a karaoke stream yet.'),
    'the empty result explains itself',
  );
  assert(stepSection(container, 'Discover').querySelector('table') === null, 'an empty result shows no table');
  const discoverAgain = buttonNamed(header, 'Discover again');
  assert(discoverAgain !== undefined, 'after a run the header offers Discover again');
  assert(discoverAgain.getAttribute('aria-busy') === null, 'the header button is no longer busy once the run ends');

  // --- A run that finds five videos: three new, two already in Prism ---

  discoverReplies.push(scan(DISCOVERED));
  await click(discoverAgain, 'Discover again');
  assert(discoverRequests() === 2, 'Discover again scans the channel again');
  for (const stat of ['Scanned just now', '5 videos found', '3 new', '2 already in Prism']) {
    assert(hasStat(container, stat), `the summary strip reads "${stat}"`);
  }
  assert(
    chip(container, 'New').getAttribute('aria-pressed') === 'true' && textOf(chip(container, 'New')) === 'New3',
    'New is the default filter when a run found new videos, and carries their count',
  );
  assert(
    chip(container, 'Already in Prism').getAttribute('aria-pressed') === 'false'
      && textOf(chip(container, 'Already in Prism')) === 'Already in Prism2',
    'Already in Prism carries its count',
  );
  assert(textOf(chip(container, 'All')) === 'All5', 'All carries the total');
  assert(rows(container).length === 3, 'the New filter shows the three new videos');
  assert(
    rows(container).every((row) => textOf(row).includes('New')),
    'every row under New carries the New pill',
  );

  // The new rows are pre-selected, and the bulk bar counts them.
  assert(checkedNewRows(container).join(',') === NEW_IDS.join(','), 'a run pre-selects every new video');
  assert(rowCheckbox(container, 'vid-new-03') !== null, 'an untitled video is named by its video ID');
  assert(selectAll(container).checked, 'Select all new streams is checked while every new video is selected');
  assert(textOf(bulkBar(container)).includes('已選 3 部新影片'), 'the bulk bar counts the three selected videos');
  assert(buttonNamed(bulkBar(container), 'Import as pending streams') !== undefined, 'the bulk bar offers the import');
  assert(buttonNamed(bulkBar(container), 'Clear') !== undefined, 'the bulk bar offers Clear');
  assert(document.documentElement.hasAttribute('data-bulk-bar'), 'the page pads its end clear of the bulk bar');

  // The row itself: thumbnail, title, video ID link, date.
  const firstRow = rows(container)[0];
  assert(firstRow !== undefined, 'the first new video has a row');
  const thumbnail = firstRow.querySelector('img');
  assert(
    thumbnail?.getAttribute('src') === 'https://i.ytimg.com/vi/vid-new-01/mqdefault.jpg'
      && thumbnail.getAttribute('alt') === ''
      && thumbnail.getAttribute('width') === '64'
      && thumbnail.getAttribute('height') === '36'
      && thumbnail.getAttribute('loading') === 'lazy',
    'each row shows the video thumbnail as a lazy, decorative 64×36 image',
  );
  assert(textOf(firstRow).includes('【歌枠】秋の初歌枠✨初見さん大歓迎🎤'), 'the row shows the video title');
  const videoLink = firstRow.querySelector('a[href="https://www.youtube.com/watch?v=vid-new-01"]');
  assert(
    textOf(videoLink) === 'vid-new-01'
      && videoLink?.getAttribute('target') === '_blank'
      && videoLink.getAttribute('rel') === 'noopener noreferrer',
    'the video ID links out to YouTube in a new tab',
  );
  assert(textOf(firstRow).includes('2026-09-26'), 'the row shows the video date');

  // Unselecting one row: the bar recounts, and Select all is no longer checked.
  await click(rowCheckbox(container, 'Noon karaoke'), 'the Noon karaoke checkbox');
  assert(textOf(bulkBar(container)).includes('已選 2 部新影片'), 'the bulk bar recounts after a row is unselected');
  assert(!selectAll(container).checked, 'Select all is unchecked while a new video is left out');

  // Already in Prism: the known videos, no checkboxes, and Open where Prism has the stream.
  await click(chip(container, 'Already in Prism'), 'the Already in Prism chip');
  assert(rows(container).length === 2, 'Already in Prism shows the two known videos');
  assert(
    stepSection(container, 'Discover').querySelectorAll('tbody input[type="checkbox"]').length === 0,
    'known videos cannot be selected',
  );
  assert(
    statusPill(rows(container)[0]) === 'In Prism · Approved',
    `a known video's pill names its status (got "${statusPill(rows(container)[0])}")`,
  );
  assert(statusPill(rows(container)[1]) === 'In Prism', 'a known video without a status reads In Prism');
  const openLink = container.querySelector<HTMLAnchorElement>('a[href="/streams/s-old"]');
  assert(openLink !== null && textOf(openLink).startsWith('Open'), 'a known video with a stream links to it: Open');
  assert(
    rows(container)[1]?.querySelector('a[href^="/streams/"]') === null,
    'a known video without a stream ID has no Open link',
  );

  // Select all still means every new video, including the ones this filter hides.
  await click(selectAll(container), 'Select all new streams');
  assert(textOf(bulkBar(container)).includes('已選 3 部新影片'), 'Select all selects every new video, not only the visible rows');
  assert(selectAll(container).checked, 'Select all is checked once every new video is selected');
  await click(selectAll(container), 'Select all new streams');
  assert(bulkBar(container) === null, 'Select all again clears the selection, and the bulk bar goes');
  assert(!document.documentElement.hasAttribute('data-bulk-bar'), 'the page drops its bulk bar padding with the bar');
  await click(selectAll(container), 'Select all new streams');
  assert(textOf(bulkBar(container)).includes('已選 3 部新影片'), 'Select all selects every new video again');

  await click(chip(container, 'All'), 'the All chip');
  assert(chip(container, 'All').getAttribute('aria-pressed') === 'true', 'All is the filter now');
  assert(rows(container).length === 5, 'All shows every video');
  assert(checkedNewRows(container).join(',') === NEW_IDS.join(','), 'the selection holds across filters');

  // --- Switching to Extract and back keeps the scan and the selection, with no new scan ---

  await click(stepOption(container, 'Extract'), 'the Extract step');
  assert(stepOption(container, 'Extract').getAttribute('aria-pressed') === 'true', 'Extract is the step now');
  assert(stepSection(container, 'Discover').hasAttribute('hidden'), 'the Discover step is hidden, not unmounted');
  assert(!stepSection(container, 'Extract').hasAttribute('hidden'), 'the Extract step is shown');
  assert(
    textOf(pageHeader(container)).includes('Finds timestamp lists in comments and descriptions'),
    'on Extract, the header explains the step instead',
  );
  assert(buttonNamed(pageHeader(container), 'Discover again') === undefined, 'the Discover action stays with its step');
  assert(bulkBar(container) === null, 'the bulk bar stays with its step');
  assert(!document.documentElement.hasAttribute('data-bulk-bar'), 'no bulk bar padding on the Extract step');
  assert(
    textOf(stepSection(container, 'Extract')).includes('Ready stream one')
      && textOf(stepSection(container, 'Extract')).includes('Ready stream two'),
    'the Extract step lists the streams the page loaded',
  );

  await click(stepOption(container, 'Discover'), 'the Discover step');
  assert(!stepSection(container, 'Discover').hasAttribute('hidden'), 'the Discover step is shown again');
  assert(stepSection(container, 'Extract').hasAttribute('hidden'), 'the Extract step is hidden again');
  assert(rows(container).length === 5, 'the scan results are still there, under the filter that was on');
  assert(checkedNewRows(container).join(',') === NEW_IDS.join(','), 'the selection is still there');
  assert(textOf(bulkBar(container)).includes('已選 3 部新影片'), 'the bulk bar is back with the same count');
  assert(discoverRequests() === 2, 'switching steps runs no new scan');
  assert(requests('GET', '/api/streams').length === 1, 'switching steps does not reload the ready list');

  assert(
    !NO_RAW_PALETTE.test(withoutExtractStep(container)),
    'the header, the Discover step and its bulk bar use no raw palette classes',
  );
  assert(
    [...pageHeader(container).querySelectorAll('button'), ...stepSection(container, 'Discover').querySelectorAll('button')]
      .every((button) => button.getAttribute('type') === 'button'),
    'every button in the header and the Discover step has an explicit type',
  );

  // --- Import: the selected new videos become pending streams; the channel is scanned again, and
  // the ready-to-extract list reloads, since pending streams are exactly what it lists ---

  readyReply = ok({ data: [...READY, IMPORTED_READY], total: READY.length + 1 } satisfies ListResponse<Stream>);
  importReplies.push(imported(NEW_IDS));
  discoverReplies.push(scan(AFTER_IMPORT));
  await click(buttonNamed(bulkBar(container), 'Import as pending streams'), 'Import as pending streams');
  const firstImport = requests('POST', '/api/pipeline/import-streams');
  assert(firstImport.length === 1, 'Import as pending streams sends one import');
  assert(importedIds(firstImport[0]) === [...NEW_IDS].sort().join(','), 'the import posts the three selected video IDs');
  assert(notifications(container).includes('Imported 3 stream(s)'), 'a successful import says how many streams it created');
  assert(discoverRequests() === 3, 'a successful import scans the channel again');
  for (const stat of ['5 videos found', '0 new', '5 already in Prism']) {
    assert(hasStat(container, stat), `after the import the summary strip reads "${stat}"`);
  }
  assert(chip(container, 'All').getAttribute('aria-pressed') === 'true', 'a run with nothing new shows All');
  assert(statusPill(rows(container)[0]) === 'In Prism · Pending', 'an imported video now reads In Prism · Pending');
  assert(bulkBar(container) === null, 'the import clears the selection, and the bulk bar goes');
  assert(!selectAll(container).checked, 'Select all is unchecked when nothing is new');
  assert(selectAll(container).disabled, 'Select all is disabled when nothing is new');

  assert(requests('GET', '/api/streams').length === 2, 'a successful import reloads the ready-to-extract list');
  assert(
    textOf(stepOption(container, 'Extract')) === '2Extract3',
    `the Extract step counts the imported stream (got "${textOf(stepOption(container, 'Extract'))}")`,
  );
  await click(stepOption(container, 'Extract'), 'the Extract step');
  assert(
    textOf(stepSection(container, 'Extract')).includes('Freshly imported stream'),
    'the imported stream is ready to extract',
  );
  await click(stepOption(container, 'Discover'), 'the Discover step');

  // --- A failed import keeps the selection and offers Retry; on another streamer, Retry refuses ---

  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(pageHeader(container), 'Discover again'), 'Discover again');
  assert(chip(container, 'New').getAttribute('aria-pressed') === 'true', 'a new run resets the filter to New');
  assert(checkedNewRows(container).join(',') === NEW_IDS.join(','), 'a new run pre-selects the new videos again');

  importReplies.push({ status: 500, body: { error: 'D1 is busy' } });
  await click(buttonNamed(bulkBar(container), 'Import as pending streams'), 'Import as pending streams');
  assert(notifications(container).includes('Couldn’t import streams'), 'a failed import says so in a toast');
  assert(notifications(container).includes('D1 is busy'), 'the toast carries the reason');
  assert(textOf(bulkBar(container)).includes('已選 3 部新影片'), 'a failed import keeps the selection');
  assert(discoverRequests() === 4, 'a failed import does not scan again');
  assert(requests('GET', '/api/streams').length === 2, 'a failed import does not reload the ready list');

  // The toast outlives the page (it belongs to the app, above the streamer-keyed routes), and the
  // client names the streamer only when a request goes out: a Retry after a switch would send
  // mizuki's videos to aurora. It refuses instead, and keeps the retry for when mizuki is back.
  await act(async () => {
    setCurrentStreamer('aurora');
  });
  await click(buttonNamed(container.querySelector('section[aria-label="Notifications"]'), 'Retry'), "the toast's Retry");
  assert(requests('POST', '/api/pipeline/import-streams').length === 2, 'Retry on another streamer sends no import');
  assert(discoverRequests() === 4, 'Retry on another streamer scans nothing');
  assert(!notifications(container).includes('Couldn’t import streams'), 'Retry dismisses the failure toast');
  assert(
    notifications(container).includes('Switch back to mizuki to retry this import'),
    'Retry on another streamer says which streamer the import belongs to',
  );

  await act(async () => {
    setCurrentStreamer('mizuki');
  });
  importReplies.push(imported(NEW_IDS));
  discoverReplies.push(scan(AFTER_IMPORT));
  await click(buttonNamed(container.querySelector('section[aria-label="Notifications"]'), 'Retry'), 'Retry, back on mizuki');
  const imports = requests('POST', '/api/pipeline/import-streams');
  assert(imports.length === 3, `back on the import's streamer, Retry sends it once more (saw ${imports.length} imports)`);
  assert(imports[2]?.params.get('streamer') === 'mizuki', "the retried import goes to the import's own streamer");
  assert(importedIds(imports[2]) === [...NEW_IDS].sort().join(','), 'Retry imports the same videos');
  assert(!notifications(container).includes('Switch back to mizuki'), 'Retry dismisses the refusal');
  assert(countOf(notifications(container), 'Imported 3 stream(s)') === 2, 'the retried import reports its success');
  assert(discoverRequests() === 5, 'a retried import that succeeds scans the channel again');
  assert(requests('GET', '/api/streams').length === 3, 'a retried import that succeeds reloads the ready list');

  // A switch while the import is still in flight: the import belongs to the streamer it went out
  // for, not to whoever is current when it fails.
  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(pageHeader(container), 'Discover again'), 'Discover again');
  const releaseFailingImport = holdNextImport();
  importReplies.push({ status: 500, body: { error: 'D1 is busy' } });
  await click(buttonNamed(bulkBar(container), 'Import as pending streams'), 'Import as pending streams');
  assert(
    requests('POST', '/api/pipeline/import-streams')[3]?.params.get('streamer') === 'mizuki',
    'the import goes out for mizuki',
  );
  await act(async () => {
    setCurrentStreamer('aurora');
  });
  await act(async () => {
    releaseFailingImport();
  });
  await settle();
  await click(buttonNamed(container.querySelector('section[aria-label="Notifications"]'), 'Retry'), "the toast's Retry");
  assert(
    requests('POST', '/api/pipeline/import-streams').length === 4,
    'Retry refuses when the streamer changed while the import was in flight',
  );
  assert(
    notifications(container).includes('Switch back to mizuki to retry this import'),
    'the refusal names the streamer the import went out for',
  );
  const refusal = [...container.querySelectorAll('section[aria-label="Notifications"] li')].find((toast) =>
    textOf(toast).includes('Switch back to mizuki'),
  );
  await click(refusal?.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification"]'), 'Dismiss');
  await act(async () => {
    setCurrentStreamer('mizuki');
  });

  // --- An import that ends after the page has gone: no re-scan (it spends YouTube quota) and no reload ---

  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(pageHeader(container), 'Discover again'), 'Discover again');
  const releaseImport = holdNextImport();
  importReplies.push(imported(NEW_IDS));
  await click(buttonNamed(bulkBar(container), 'Import as pending streams'), 'Import as pending streams');
  assert(requests('POST', '/api/pipeline/import-streams').length === 5, 'the import is on its way');

  // Open is a router link to the stream Prism already has: following it unmounts the page.
  await click(chip(container, 'All'), 'the All chip');
  await click(container.querySelector<HTMLAnchorElement>('a[href="/streams/s-old"]'), 'Open');
  assert(textOf(container.querySelector('#location')) === '/streams/s-old', 'Open goes to the stream, in the app');
  assert(container.querySelector('section[aria-label="Discover"]') === null, 'the Pipeline page is gone');

  await act(async () => {
    releaseImport();
  });
  await settle();
  assert(countOf(notifications(container), 'Imported 3 stream(s)') === 3, 'the import still reports its result');
  assert(discoverRequests() === 7, 'an import that ends after the page has gone scans nothing');
  assert(requests('GET', '/api/streams').length === 3, 'nor does it reload the ready list');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await app.unmount();

  console.log('✓ Pipeline Discover: scan, filter, pre-selected new rows, import with Retry; steps keep their state');

  // --- Failures: no count on Extract when its list fails; a failed scan says why, inline ---

  calls = [];
  unexpected = [];
  readyReply = { status: 500, body: { error: 'Streams are unavailable' } };
  const failing = await mount(page());
  assert(
    textOf(stepOption(failing.container, 'Extract')) === '2Extract',
    'the Extract step shows no count when its list failed to load',
  );

  discoverReplies.push({ status: 500, body: { error: 'YouTube quota exceeded' } });
  await click(buttonNamed(stepSection(failing.container, 'Discover'), 'Discover streams'), 'Discover streams');
  const note = stepSection(failing.container, 'Discover').querySelector('[role="alert"]');
  assert(textOf(note) === 'YouTube quota exceeded', 'a failed scan says why, inline');
  assert(
    textOf(stepSection(failing.container, 'Discover')).includes('Find new karaoke streams'),
    'a failed first scan keeps the empty state',
  );
  assert(
    buttonNamed(pageHeader(failing.container), 'Discover streams') !== undefined,
    'nothing has been scanned yet, so the header still reads Discover streams',
  );
  assert(!NO_RAW_PALETTE.test(withoutExtractStep(failing.container)), 'the danger note uses no raw palette classes');

  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(pageHeader(failing.container), 'Discover streams'), 'Discover streams');
  assert(stepSection(failing.container, 'Discover').querySelector('[role="alert"]') === null, 'a successful scan clears the note');
  assert(rows(failing.container).length === 3, 'and shows what it found');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await failing.unmount();

  console.log('✓ Pipeline failures: no Extract count after a failed list load, and a failed scan says why');
}

await main();
