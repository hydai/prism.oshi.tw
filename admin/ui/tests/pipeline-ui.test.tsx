/**
 * The Pipeline page, mounted live the way App.tsx mounts every page (ToastProvider > ConfirmProvider
 * > router) against a stubbed fetch: the two steps in the header — both stay mounted and the inactive
 * one is `hidden`, so a trip to the other step keeps each step's work — the Discover step (its empty
 * states, the summary strip, the filter chips, the table with its pre-selected new rows, the bulk
 * bar, and the import with its toasts), and the Extract step (the ready list with its search and its
 * error card, the timestamp sources, the checked and editable parsed rows, and the import with its
 * replace confirm and the jump to the Stamp Editor).
 */
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type {
  CandidateComment,
  DiscoveredStream,
  DiscoverStreamsResponse,
  ExtractImportBody,
  ExtractImportResponse,
  ExtractResponse,
  ImportStreamsResponse,
  ListResponse,
  Stream,
} from '../../shared/types';
import { inPrismLabel, newStreamIds, summarizeDiscovered, visibleDiscovered } from '../src/pages/pipeline-discover';
import { click, installDom, mount, press, settle, typeInto } from './helpers/dom';
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

/** Ready stream one's pinned comment, which the server picks, and a second one the curator can use instead. */
const PINNED: CandidateComment = {
  commentId: 'c-pinned',
  text: '0:10 Opening / Alice\n4:10 Lemon / 米津玄師\n8:00 Encore / Bob',
  author: 'Alice Timestamps',
  likes: 12,
  timestampCount: 3,
  isPinned: true,
};
// Its ranges are the commenter's own: no row ends where the next one starts, so moving a start moves
// no end (EXTRACT_TYPO below is a list whose ends the parse took from the next start).
const SECOND: CandidateComment = {
  commentId: 'c-second',
  text: '0:05 ~ 3:20 Blue Bird / Ikimono Gakari\n3:30 ~ 7:05 Lemon / Yonezu Kenshi\n7:15 Idol / YOASOBI',
  author: 'Bob Notes',
  likes: 3,
  timestampCount: 3,
  isPinned: false,
};

/** Ready stream one: the server uses the pinned comment. Its rows carry no end, so there is no End column. */
const EXTRACT_ONE: ExtractResponse = {
  source: 'comment',
  candidateComment: PINNED,
  allCandidates: [PINNED, SECOND],
  parsedSongs: [
    { orderIndex: 0, songName: 'Opening', artist: 'Alice', startSeconds: 10, endSeconds: null, startTimestamp: '0:10', endTimestamp: null },
    { orderIndex: 1, songName: 'Lemon', artist: '米津玄師', startSeconds: 250, endSeconds: null, startTimestamp: '4:10', endTimestamp: null },
    { orderIndex: 2, songName: 'Encore', artist: 'Bob', startSeconds: 480, endSeconds: null, startTimestamp: '8:00', endTimestamp: null },
  ],
  credit: { author: 'Alice Timestamps', commentUrl: 'https://www.youtube.com/watch?v=ready-1-video&lc=c-pinned' },
};

/** Ready stream two: no comment qualifies and the description has nothing either. */
const EXTRACT_TWO_NONE: ExtractResponse = {
  source: null,
  candidateComment: null,
  allCandidates: [],
  parsedSongs: [],
  credit: null,
};

/** Ready stream two re-scanned: the list is in the description. */
const EXTRACT_TWO_DESCRIPTION: ExtractResponse = {
  source: 'description',
  candidateComment: null,
  allCandidates: [],
  parsedSongs: [
    { orderIndex: 0, songName: 'Idol', artist: 'YOASOBI', startSeconds: 60, endSeconds: 260, startTimestamp: '1:00', endTimestamp: '4:20' },
    { orderIndex: 1, songName: 'Lemon', artist: '米津玄師', startSeconds: 260, endSeconds: 520, startTimestamp: '4:20', endTimestamp: '8:40' },
    { orderIndex: 2, songName: 'Encore', artist: 'Bob', startSeconds: 520, endSeconds: null, startTimestamp: '8:40', endTimestamp: null },
  ],
  credit: null,
};

/** A stream with no title: the ready list names it by its video ID, `ready-3-video`. */
const UNTITLED_READY = readyStream('ready-3', '', '2026-08-20');

/** One row per check after an OK first row: no artist, an earlier start, a repeat of #1, no title. */
const EXTRACT_FLAGGED: ExtractResponse = {
  source: 'description',
  candidateComment: null,
  allCandidates: [],
  parsedSongs: [
    { orderIndex: 0, songName: 'Opening', artist: 'Alice', startSeconds: 10, endSeconds: null, startTimestamp: '0:10', endTimestamp: null },
    { orderIndex: 1, songName: 'Lemon', artist: '', startSeconds: 250, endSeconds: null, startTimestamp: '4:10', endTimestamp: null },
    { orderIndex: 2, songName: 'Idol', artist: 'YOASOBI', startSeconds: 200, endSeconds: null, startTimestamp: '3:20', endTimestamp: null },
    { orderIndex: 3, songName: 'opening', artist: 'alice', startSeconds: 300, endSeconds: null, startTimestamp: '5:00', endTimestamp: null },
    { orderIndex: 4, songName: '', artist: 'Aimer', startSeconds: 400, endSeconds: null, startTimestamp: '6:40', endTimestamp: null },
  ],
  credit: null,
};

/** A list of one song. */
const EXTRACT_SINGLE: ExtractResponse = {
  source: 'description',
  candidateComment: null,
  allCandidates: [],
  parsedSongs: [
    { orderIndex: 0, songName: 'Encore', artist: 'Bob', startSeconds: 480, endSeconds: null, startTimestamp: '8:00', endTimestamp: null },
  ],
  credit: null,
};

/**
 * A list with a typo in its second start (0:25 for 4:25), as the parse reads it: each row without an
 * end of its own ends where the next starts, so row 1 ends at the typo, before it starts.
 */
const EXTRACT_TYPO: ExtractResponse = {
  source: 'description',
  candidateComment: null,
  allCandidates: [],
  parsedSongs: [
    { orderIndex: 0, songName: 'Lemon', artist: '米津玄師', startSeconds: 250, endSeconds: 25, startTimestamp: '4:10', endTimestamp: '0:25' },
    { orderIndex: 1, songName: 'Idol', artist: 'YOASOBI', startSeconds: 25, endSeconds: 480, startTimestamp: '0:25', endTimestamp: '8:00' },
    { orderIndex: 2, songName: 'Encore', artist: 'Bob', startSeconds: 480, endSeconds: null, startTimestamp: '8:00', endTimestamp: null },
  ],
  credit: null,
};

/**
 * A comment that gives its first song an end of its own, equal to the next start, and leaves the
 * second song's end to the parse, which takes the next start.
 */
const OWN_END: CandidateComment = {
  commentId: 'c-own-end',
  text: '0:00 - 3:00 Opening / Alice\n3:00 Lemon / 米津玄師\n6:00 Encore / Bob',
  author: 'Carol Ranges',
  likes: 5,
  timestampCount: 3,
  isPinned: true,
};
/** Another comment of the same shape, for Use this. */
const OWN_END_OTHER: CandidateComment = {
  commentId: 'c-own-end-other',
  text: '0:00 - 2:00 Blue Bird / Ikimono Gakari\n2:00 Idol / YOASOBI\n5:00 Encore / Bob',
  author: 'Dave Ranges',
  likes: 2,
  timestampCount: 3,
  isPinned: false,
};
/** Ready stream one with OWN_END in use, its rows as the server parses them. */
const EXTRACT_OWN_END: ExtractResponse = {
  source: 'comment',
  candidateComment: OWN_END,
  allCandidates: [OWN_END, OWN_END_OTHER],
  parsedSongs: [
    { orderIndex: 0, songName: 'Opening', artist: 'Alice', startSeconds: 0, endSeconds: 180, startTimestamp: '0:00', endTimestamp: '3:00' },
    { orderIndex: 1, songName: 'Lemon', artist: '米津玄師', startSeconds: 180, endSeconds: 360, startTimestamp: '3:00', endTimestamp: '6:00' },
    { orderIndex: 2, songName: 'Encore', artist: 'Bob', startSeconds: 360, endSeconds: null, startTimestamp: '6:00', endTimestamp: null },
  ],
  credit: { author: 'Carol Ranges', commentUrl: 'https://www.youtube.com/watch?v=ready-1-video&lc=c-own-end' },
};

/** What the server says when the stream already has songs and the import did not ask to replace them. */
const ALREADY_IMPORTED: Reply = {
  status: 409,
  body: { error: 'This stream already has 2 song(s) imported. Use replace mode to overwrite.', existingCount: 2 },
};

function importedSongs(created: number): Reply {
  return ok({ ok: true, created } satisfies ExtractImportResponse);
}

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

// --- fetch stub: the ready list, discover, import, extract and extract-import, each answered from
// what the test set up; every request is logged, and one nothing answers is recorded as unexpected
// (and gets a 404) ---

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
/** One reply per extract request, in order. */
const extractReplies: Reply[] = [];
/** One reply per extract-import request, in order. */
const extractImportReplies: Reply[] = [];
/** Holds the next extract request open until the test releases it. */
let extractGate: Promise<void> | null = null;
/** Holds the next extract-import request open until the test releases it. */
let extractImportGate: Promise<void> | null = null;

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

function holdNextExtract(): () => void {
  let release: () => void = () => undefined;
  extractGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

function holdNextExtractImport(): () => void {
  let release: () => void = () => undefined;
  extractImportGate = new Promise<void>((resolve) => {
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
      } else if (method === 'POST' && url.pathname === '/api/pipeline/extract') {
        const gate = extractGate;
        extractGate = null;
        if (gate) await gate;
        reply = extractReplies.shift();
      } else if (method === 'POST' && url.pathname === '/api/pipeline/extract-import') {
        const gate = extractImportGate;
        extractImportGate = null;
        if (gate) await gate;
        reply = extractImportReplies.shift();
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

function checkedNewRows(container: HTMLElement): string[] {
  return DISCOVERED.filter((stream) => stream.isNew && rowCheckbox(container, stream.title || stream.videoId)?.checked)
    .map((stream) => stream.videoId);
}

/** The ready list's items: one button per stream waiting for extraction, as filtered. */
function readyItems(container: HTMLElement): HTMLButtonElement[] {
  return [
    ...stepSection(container, 'Extract').querySelectorAll<HTMLButtonElement>(
      'ul[aria-label="Streams ready to extract"] button',
    ),
  ];
}

function readyItem(container: HTMLElement, title: string): HTMLButtonElement | undefined {
  return readyItems(container).find((item) => textOf(item).includes(title));
}

function sourceCards(container: HTMLElement): HTMLLIElement[] {
  return [...stepSection(container, 'Extract').querySelectorAll<HTMLLIElement>('ul[aria-label="Timestamp sources"] > li')];
}

/** A source card by its kind — the text of its first line. */
function sourceCard(container: HTMLElement, kind: 'Pinned comment' | 'Comment' | 'Description'): HTMLLIElement {
  const card = sourceCards(container).find((item) => textOf(item.firstElementChild) === kind);
  assert(card !== undefined, `the sources show a ${kind} card`);
  return card;
}

function parsedRows(container: HTMLElement): HTMLTableRowElement[] {
  return [...stepSection(container, 'Extract').querySelectorAll<HTMLTableRowElement>('tbody tr')];
}

/** A parsed row's field by its label: `Song 2 start`, `Song 1 title`, `Song 3 artist`. */
function field(container: HTMLElement, label: string): HTMLInputElement {
  const input = stepSection(container, 'Extract').querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  assert(input !== null, `the parsed rows have ${label}`);
  return input;
}

function fieldValues(container: HTMLElement, column: 'start' | 'title' | 'artist'): string {
  return parsedRows(container)
    .map((_, index) => field(container, `Song ${index + 1} ${column}`).value)
    .join('|');
}

function headTexts(container: HTMLElement): string[] {
  return [...stepSection(container, 'Extract').querySelectorAll('thead th')].map((head) => textOf(head));
}

/** Row `n`'s Check cell: the one before the row's Remove button. */
function checkText(container: HTMLElement, n: number): string {
  const cells = parsedRows(container)[n - 1]?.querySelectorAll('td');
  return textOf(cells?.[cells.length - 2]);
}

function checkTexts(container: HTMLElement): string {
  return parsedRows(container)
    .map((_, index) => checkText(container, index + 1))
    .join('|');
}

/** Row `n`'s Check message: the element a field's `aria-describedby` points at. */
function checkMessage(container: HTMLElement, n: number): HTMLElement {
  const cells = parsedRows(container)[n - 1]?.querySelectorAll('td');
  const message = cells?.[cells.length - 2]?.querySelector<HTMLElement>('[id]');
  assert(message !== null && message !== undefined, `row ${n}'s Check cell has a message to point at`);
  return message;
}

/** The warn look a field takes when its row's issue is about it: tokens only. */
function isWarned(input: HTMLInputElement): boolean {
  const classes = input.className.split(' ');
  return classes.includes('border-tone-warn-line') && classes.includes('shadow-[0_0_0_3px_var(--tone-warn-bg)]');
}

/**
 * The danger look of a field whose row's issue blocks the import: marked invalid, with the danger
 * line, text and the warn look's 3 px ring in danger tokens (never lighter than a warned field) —
 * and the focus ring over that ring while the field has keyboard focus, which the ring's
 * attribute-qualified selector would otherwise outrank.
 */
function isMarkedInvalid(input: HTMLInputElement): boolean {
  const classes = input.className.split(' ');
  return (
    input.getAttribute('aria-invalid') === 'true'
    && classes.includes('aria-[invalid=true]:border-tone-danger-line')
    && classes.includes('aria-[invalid=true]:text-tone-danger-fg')
    && classes.includes('aria-[invalid=true]:shadow-[0_0_0_3px_var(--tone-danger-bg)]')
    && classes.includes('aria-[invalid=true]:focus-visible:shadow-focus')
    && !isWarned(input)
  );
}

/** The End column's cells, when the table has one. */
function endTexts(container: HTMLElement): string {
  const endColumn = headTexts(container).indexOf('End');
  return parsedRows(container)
    .map((row) => textOf(row.querySelectorAll('td')[endColumn]))
    .join('|');
}

function openStampEditorBox(container: HTMLElement): HTMLInputElement {
  const label = [...stepSection(container, 'Extract').querySelectorAll('label')].find(
    (candidate) => textOf(candidate) === 'Open Stamp Editor after import',
  );
  const box = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  assert(box !== null && box !== undefined, 'the import bar offers Open Stamp Editor after import');
  return box;
}

function importButton(container: HTMLElement): HTMLButtonElement {
  const button = [...stepSection(container, 'Extract').querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    /^Import \d+ songs?$/.test(textOf(candidate).trim()),
  );
  assert(button !== undefined, 'the import bar offers Import N songs');
  return button;
}

function extractRequests(): Call[] {
  return requests('POST', '/api/pipeline/extract');
}

function extractImports(): ExtractImportBody[] {
  return requests('POST', '/api/pipeline/extract-import').map((call) => call.body as ExtractImportBody);
}

/** An import's songs as `title/artist/start/end`, one per row. */
function songsSent(body: ExtractImportBody | undefined): string {
  return (body?.songs ?? []).map((song) => `${song.songName}/${song.artist}/${song.startSeconds}/${song.endSeconds}`).join('|');
}

/** Focuses `input` and then leaves it, the way a click elsewhere or Tab does. */
async function leaveField(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus();
  });
  await act(async () => {
    input.blur();
  });
  await settle();
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output id="location">{`${location.pathname}${location.search}`}</output>
      {/* Leaves the page, as a sidebar link would, whatever the page is doing. */}
      <button type="button" id="leave" onClick={() => navigate('/streams/away')}>
        Leave
      </button>
    </>
  );
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
            <Route path="/stamp" element={<p>Stamp Editor</p>} />
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
    !NO_RAW_PALETTE.test(container.innerHTML),
    'the page — the header, both steps and the bulk bar — uses no raw palette classes',
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
  assert(
    !NO_RAW_PALETTE.test(failing.container.innerHTML),
    'the danger note and the ready list’s error card use no raw palette classes',
  );

  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(pageHeader(failing.container), 'Discover streams'), 'Discover streams');
  assert(stepSection(failing.container, 'Discover').querySelector('[role="alert"]') === null, 'a successful scan clears the note');
  assert(rows(failing.container).length === 3, 'and shows what it found');

  // The ready list failed too: the Extract step says so, and its Retry loads the list again.
  await click(stepOption(failing.container, 'Extract'), 'the Extract step');
  const failedList = stepSection(failing.container, 'Extract');
  assert(textOf(failedList).includes('Couldn’t load streams'), 'a ready list that failed to load says so');
  assert(textOf(failedList).includes('Streams are unavailable'), 'and says why');
  assert(readyItems(failing.container).length === 0, 'a list that failed to load lists no streams');
  assert(!textOf(failedList).includes('No streams ready'), 'nor claims there are none');
  readyReply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
  const listLoadsBeforeRetry = requests('GET', '/api/streams').length;
  await click(buttonNamed(failedList, 'Retry'), 'the ready list’s Retry');
  assert(requests('GET', '/api/streams').length === listLoadsBeforeRetry + 1, 'Retry loads the ready list once more');
  assert(!textOf(failedList).includes('Couldn’t load streams'), 'a load that succeeds clears the error');
  assert(
    readyItem(failing.container, 'Ready stream one') !== undefined && readyItem(failing.container, 'Ready stream two') !== undefined,
    'and lists the streams',
  );
  assert(
    textOf(stepOption(failing.container, 'Extract')) === '2Extract2',
    'the Extract step counts the streams once they have loaded',
  );

  // The reload after a Discover import asks for the list without a Retry. One that fails says so;
  // the next one that loads clears that failure all the same.
  await click(stepOption(failing.container, 'Discover'), 'the Discover step');
  readyReply = { status: 500, body: { error: 'Streams are unavailable' } };
  importReplies.push(imported(NEW_IDS));
  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(bulkBar(failing.container), 'Import as pending streams'), 'Import as pending streams');
  assert(
    textOf(stepSection(failing.container, 'Extract')).includes('Couldn’t load streams'),
    'a ready list that fails to reload after an import says so',
  );
  readyReply = ok({ data: [...READY, IMPORTED_READY], total: READY.length + 1 } satisfies ListResponse<Stream>);
  importReplies.push(imported(NEW_IDS));
  discoverReplies.push(scan(AFTER_IMPORT));
  await click(buttonNamed(bulkBar(failing.container), 'Import as pending streams'), 'Import as pending streams');
  assert(
    !textOf(stepSection(failing.container, 'Extract')).includes('Couldn’t load streams'),
    'the next reload that loads clears the failure',
  );
  assert(readyItem(failing.container, 'Freshly imported stream') !== undefined, 'and lists the streams it loaded');
  assert(
    textOf(stepOption(failing.container, 'Extract')) === '2Extract3',
    `and the Extract step counts them again (got "${textOf(stepOption(failing.container, 'Extract'))}")`,
  );
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await failing.unmount();

  console.log('✓ Pipeline failures: a failed scan says why; a failed ready list shows no count, says why, and Retry loads it');

  // --- Extract: pick a stream, weigh its sources, check and edit the parsed rows, import them ---

  calls = [];
  unexpected = [];
  readyReply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
  const extracting = await mount(page());
  const ex = extracting.container;
  await click(stepOption(ex, 'Extract'), 'the Extract step');
  const extractStep = stepSection(ex, 'Extract');

  assert(extractRequests().length === 0, 'nothing is extracted on page load or on opening the step: each extract spends YouTube quota');
  assert(textOf(extractStep).includes('Pick a stream to find its timestamps'), 'before any extract, the step asks for a stream');
  assert(readyItems(ex).length === 2, 'the ready list shows both streams');
  assert(
    readyItems(ex).every((item) => item.getAttribute('aria-current') === null),
    'no stream is current before one is extracted',
  );
  const firstItem = readyItem(ex, 'Ready stream one');
  assert(textOf(firstItem).includes('2026-09-01'), 'an item shows the stream date');
  assert(
    firstItem?.querySelector('[title="Ready stream one"]') !== null,
    'an item keeps the full title in `title`: it is clamped to two lines',
  );

  // The search filters the list by title or date, here in the page.
  const search = extractStep.querySelector<HTMLInputElement>('input[type="search"]');
  assert(search !== null, 'the ready list has a search field');
  assert(
    textOf(extractStep.querySelector(`label[for="${search.id}"]`)) === 'Search streams to extract',
    'the search field is labelled Search streams to extract',
  );
  await typeInto(search, 'TWO');
  assert(readyItems(ex).length === 1 && readyItem(ex, 'Ready stream two') !== undefined, 'the search matches titles, ignoring case');
  await typeInto(search, '2026-09-01');
  assert(readyItems(ex).length === 1 && readyItem(ex, 'Ready stream one') !== undefined, 'the search matches dates');
  await typeInto(search, 'no such stream');
  assert(readyItems(ex).length === 0, 'a search that matches nothing lists nothing');
  await typeInto(search, '');
  assert(readyItems(ex).length === 2, 'an empty search lists every stream again');
  assert(requests('GET', '/api/streams').length === 1, 'searching requests nothing');

  // A click runs the extract. While it runs, a skeleton stands in and the stream is current.
  const releaseExtract = holdNextExtract();
  extractReplies.push(ok(EXTRACT_ONE));
  await click(readyItem(ex, 'Ready stream one'), 'Ready stream one');
  assert(extractRequests().length === 1, 'clicking a stream extracts it');
  assert(
    (extractRequests()[0]?.body as { streamId?: string } | null)?.streamId === 'ready-1',
    'the extract posts the stream’s id',
  );
  assert(readyItem(ex, 'Ready stream one')?.getAttribute('aria-current') === 'true', 'the stream being extracted is current');
  assert(textOf(extractStep.querySelector('[role="status"]')) === 'Extracting...', 'a skeleton stands in while it runs');
  await click(readyItem(ex, 'Ready stream two'), 'Ready stream two, while the first extract runs');
  assert(extractRequests().length === 1, 'another stream starts nothing while an extract runs');
  await act(async () => {
    releaseExtract();
  });
  await settle();
  assert(extractStep.querySelector('[role="status"]') === null, 'the skeleton goes once the extract is back');
  assert(readyItem(ex, 'Ready stream one')?.getAttribute('aria-current') === 'true', 'the stream whose results show is current');

  // The timestamp sources: one card per candidate comment. The server used the pinned one and never
  // looked at the description, so there is no Description card.
  assert(textOf(extractStep).includes('2026-09-01 · ready-1-video'), 'the sources name the stream by date and video ID');
  assert(sourceCards(ex).length === 2, 'one card per candidate comment, and no Description card');
  const pinnedCard = sourceCard(ex, 'Pinned comment');
  assert(
    textOf(pinnedCard).includes('by Alice Timestamps · 3 timestamps · 12 likes'),
    'a comment card names its author, its timestamps and its likes',
  );
  assert(textOf(pinnedCard).includes('In use') && buttonNamed(pinnedCard, 'Use this') === undefined, 'the comment in use says so');
  const secondCard = sourceCard(ex, 'Comment');
  assert(textOf(secondCard).includes('by Bob Notes · 3 timestamps · 3 likes'), 'so does the second comment’s card');
  assert(
    buttonNamed(secondCard, 'Use this') !== undefined && !textOf(secondCard).includes('In use'),
    'a comment not in use offers Use this',
  );
  assert(buttonNamed(extractStep, 'Re-scan') !== undefined, 'the sources offer Re-scan');

  const pinnedText = pinnedCard.querySelector('pre');
  assert(pinnedText !== null && pinnedText.hasAttribute('hidden'), 'a comment’s text starts hidden');
  const showText = buttonNamed(pinnedCard, 'Show text');
  assert(
    showText?.getAttribute('aria-expanded') === 'false' && showText.getAttribute('aria-controls') === pinnedText.id,
    'Show text says it controls the hidden text',
  );
  await click(showText, 'Show text');
  assert(!pinnedText.hasAttribute('hidden') && textOf(pinnedText) === PINNED.text, 'Show text reveals the whole comment');
  assert(buttonNamed(pinnedCard, 'Hide text')?.getAttribute('aria-expanded') === 'true', 'and turns into Hide text');
  await click(buttonNamed(pinnedCard, 'Hide text'), 'Hide text');
  assert(pinnedText.hasAttribute('hidden'), 'Hide text hides it again');

  // The parsed songs: the server's rows, all fine, and no End column since none has an end.
  assert(fieldValues(ex, 'title') === 'Opening|Lemon|Encore', 'the parsed rows are the ones the server sent');
  assert(fieldValues(ex, 'start') === '0:10|4:10|8:00', 'each start shows as m:ss, ready to edit');
  assert(
    ['#', 'Start', 'Title', 'Artist', 'Check'].every((head) => headTexts(ex).includes(head)) && !headTexts(ex).includes('End'),
    'no row has an end, so the table has no End column',
  );
  assert(checkTexts(ex) === 'OK|OK|OK', 'every row checks out');
  assert(!textOf(extractStep).includes('to check'), 'no to-check count while every row is OK');
  assert(!textOf(extractStep).includes('import anyway?'), 'and no note in the import bar');
  assert(!openStampEditorBox(ex).checked, 'Open Stamp Editor after import starts unchecked');
  assert(textOf(importButton(ex)).trim() === 'Import 3 songs', 'the import bar offers Import 3 songs');

  // Use this parses the other comment here and replaces the rows with its songs.
  await click(buttonNamed(secondCard, 'Use this'), 'Use this');
  assert(extractRequests().length === 1, 'Use this requests nothing: the comment is parsed in the page');
  assert(fieldValues(ex, 'title') === 'Blue Bird|Lemon|Idol', 'Use this replaces the parsed rows with the comment’s songs');
  assert(fieldValues(ex, 'artist') === 'Ikimono Gakari|Yonezu Kenshi|YOASOBI', 'artists included');
  assert(
    textOf(sourceCard(ex, 'Comment')).includes('In use') && buttonNamed(sourceCard(ex, 'Pinned comment'), 'Use this') !== undefined,
    'the comment in use changes with it',
  );
  assert(headTexts(ex).includes('End'), 'these rows have ends, so the End column shows');
  assert(endTexts(ex) === '3:20|7:05|—', 'each row’s end, read-only, and — where there is none');
  assert(!parsedRows(ex).some((row) => row.querySelectorAll('td')[headTexts(ex).indexOf('End')]?.querySelector('input')), 'an end cannot be edited here');

  // A start commits on Enter (not during an IME composition), then the rows are checked again.
  const secondStart = field(ex, 'Song 2 start');
  await typeInto(secondStart, '0:03');
  assert(checkText(ex, 2) === 'OK', 'a start being typed is not committed yet');
  await press(secondStart, 'Enter', { isComposing: true });
  assert(checkText(ex, 2) === 'OK', 'an Enter that ends an IME composition commits nothing');
  await press(secondStart, 'Enter');
  assert(checkText(ex, 2) === 'Earlier than #1', 'Enter commits the start: row 2 now starts before row 1');
  assert(secondStart.value === '0:03', 'the field shows the committed start');
  assert(checkText(ex, 3) === 'OK', 'row 3 still starts after row 2');
  assert(
    endTexts(ex) === '3:20|7:05|—' && checkText(ex, 1) === 'OK',
    `row 1's end is the commenter's own, not row 2's old start, so it stays put (got ${endTexts(ex)})`,
  );
  assert(textOf(extractStep).includes('1 to check'), 'the header counts the row to check');
  assert(textOf(extractStep).includes('1 row still needs a look — import anyway?'), 'the import bar says one row needs a look');

  // Two rows to check: the plural.
  const thirdArtist = field(ex, 'Song 3 artist');
  await typeInto(thirdArtist, '  ');
  assert(checkText(ex, 3) === 'No artist', 'a blank artist is flagged as you type');
  assert(textOf(extractStep).includes('2 to check'), 'the header counts both rows');
  assert(textOf(extractStep).includes('2 rows still need a look — import anyway?'), 'the import bar says two rows need a look');
  await typeInto(thirdArtist, 'YOASOBI');
  assert(checkText(ex, 3) === 'OK', 'an artist again, and the row is OK again');

  // An invalid start keeps what was typed, is marked invalid, and commits nothing; Escape reverts.
  const thirdStart = field(ex, 'Song 3 start');
  await typeInto(thirdStart, '4:1x');
  await press(thirdStart, 'Enter');
  assert(thirdStart.getAttribute('aria-invalid') === 'true', 'an invalid start is marked invalid');
  assert(thirdStart.value === '4:1x', 'and keeps what was typed');
  await leaveField(thirdStart);
  assert(
    thirdStart.getAttribute('aria-invalid') === 'true' && thirdStart.value === '4:1x',
    'leaving the field commits nothing either: the draft stays, still marked',
  );
  await press(thirdStart, 'Escape');
  // Read afresh: the same node, but TypeScript has narrowed `thirdStart.value` to the draft above.
  assert(
    field(ex, 'Song 3 start').value === '7:15',
    'Escape brings back the row’s own start: the invalid draft never reached it',
  );
  assert(!thirdStart.hasAttribute('aria-invalid'), 'and clears the mark');

  // Leaving the field commits a valid start too, written back the way the table shows times; a
  // title edit applies as it is typed.
  await typeInto(thirdStart, '0:03');
  await leaveField(thirdStart);
  assert(checkText(ex, 3) === 'Same start as #2', 'leaving the field commits the start: row 3 now starts with row 2');
  await typeInto(thirdStart, '07:20');
  await leaveField(thirdStart);
  assert(field(ex, 'Song 3 start').value === '7:20', 'a committed start is written back as m:ss');
  assert(checkText(ex, 3) === 'OK' && !thirdStart.hasAttribute('aria-invalid'), 'and row 3 checks out again');
  await typeInto(field(ex, 'Song 1 title'), 'Blue Bird (TV size)');

  // --- The edits survive a trip to Discover and back: the step is hidden, never unmounted ---

  await click(stepOption(ex, 'Discover'), 'the Discover step');
  assert(stepSection(ex, 'Extract').hasAttribute('hidden'), 'the Extract step is hidden on Discover');
  await click(stepOption(ex, 'Extract'), 'the Extract step');
  assert(fieldValues(ex, 'title') === 'Blue Bird (TV size)|Lemon|Idol', 'a title edit survives the trip');
  assert(fieldValues(ex, 'start') === '0:05|0:03|7:20', 'so do the start edits');
  assert(checkText(ex, 2) === 'Earlier than #1', 'and what the checks make of them');
  assert(textOf(sourceCard(ex, 'Comment')).includes('In use'), 'and the comment in use');
  assert(extractRequests().length === 1, 'switching steps extracts nothing');
  assert(discoverRequests() === 0, 'nor scans the channel');

  // A click on the highlighted stream, whose results these are, runs nothing: another extract would
  // spend YouTube quota and drop the edits. Re-scan is the way to extract it again.
  await click(readyItem(ex, 'Ready stream one'), 'Ready stream one, whose results show');
  assert(extractRequests().length === 1, 'a click on the highlighted stream extracts nothing');
  assert(fieldValues(ex, 'title') === 'Blue Bird (TV size)|Lemon|Idol', 'and keeps the edits');

  assert(!NO_RAW_PALETTE.test(ex.innerHTML), 'the whole page, the Extract step included, uses no raw palette classes');
  assert(
    [...ex.querySelectorAll('button')].every((button) => button.getAttribute('type') === 'button'),
    'every button on the page has an explicit type',
  );

  // --- Import: a 409 asks before replacing; Cancel sends nothing more, Replace one more request ---

  const credit = { author: 'Bob Notes', commentUrl: 'https://www.youtube.com/watch?v=ready-1-video&lc=c-second' };
  const editedSongs = 'Blue Bird (TV size)/Ikimono Gakari/5/200|Lemon/Yonezu Kenshi/3/425|Idol/YOASOBI/440/null';
  extractImportReplies.push(ALREADY_IMPORTED);
  await click(importButton(ex), 'Import 3 songs');
  assert(extractImports().length === 1, 'Import sends one request');
  const firstSongImport = extractImports()[0];
  assert(firstSongImport?.streamId === 'ready-1' && firstSongImport.replace === false, 'the first request imports without replacing');
  assert(songsSent(firstSongImport) === editedSongs, `it sends the rows as edited (sent ${songsSent(firstSongImport)})`);
  assert(JSON.stringify(firstSongImport.credit) === JSON.stringify(credit), 'and credits the comment in use');
  let replaceDialog = ex.querySelector<HTMLElement>('dialog[open]');
  assert(replaceDialog !== null, 'a 409 asks before replacing the stream’s songs');
  assert(textOf(replaceDialog).includes('Replace the existing songs?'), 'the confirm asks whether to replace them');
  assert(
    textOf(replaceDialog).includes('This stream already has 2 song(s) imported. Use replace mode to overwrite.'),
    'and says what the server said',
  );
  assert(importButton(ex).getAttribute('aria-busy') === 'true', 'the import stays busy while the confirm is open');
  await click(buttonNamed(replaceDialog, 'Cancel'), 'the confirm’s Cancel');
  assert(ex.querySelector('dialog[open]') === null, 'Cancel closes the confirm');
  assert(extractImports().length === 1, 'Cancel sends nothing more');
  assert(importButton(ex).getAttribute('aria-busy') === null, 'the import is no longer busy');
  assert(fieldValues(ex, 'title') === 'Blue Bird (TV size)|Lemon|Idol', 'the rows are still there to import');
  assert(!notifications(ex).includes('Imported'), 'nothing was imported');

  extractImportReplies.push(ALREADY_IMPORTED, importedSongs(3));
  await click(importButton(ex), 'Import 3 songs');
  replaceDialog = ex.querySelector<HTMLElement>('dialog[open]');
  assert(replaceDialog !== null, 'the next 409 asks again');
  await click(buttonNamed(replaceDialog, 'Replace'), 'the confirm’s Replace');
  const songImports = extractImports();
  assert(
    songImports.length === 3,
    `confirming sends exactly one more request (saw ${songImports.length - 1} after the first)`,
  );
  assert(songImports[1]?.replace === false && songImports[2]?.replace === true, 'the request after the confirm replaces');
  assert(
    songsSent(songImports[2]) === editedSongs && JSON.stringify(songImports[2]?.credit) === JSON.stringify(credit),
    'it sends the same rows and the same credit',
  );
  assert(notifications(ex).includes('Imported 3 song(s)'), 'a successful import says how many songs it created');
  assert(textOf(ex.querySelector('#location')) === '/pipeline', 'with the box unchecked, the page stays');
  assert(textOf(extractStep).includes('Pick a stream to find its timestamps'), 'the imported rows are cleared');
  assert(
    readyItems(ex).every((item) => item.getAttribute('aria-current') === null),
    'no stream is current once its songs are imported',
  );

  // --- A failed extract says why; nothing found says so; Re-scan tries the same stream again ---

  extractReplies.push({ status: 502, body: { error: 'YouTube rejected the API key' } });
  await click(readyItem(ex, 'Ready stream two'), 'Ready stream two');
  assert((extractRequests()[1]?.body as { streamId?: string } | null)?.streamId === 'ready-2', 'the second extract is stream two’s');
  assert(textOf(extractStep.querySelector('[role="alert"]')).includes('YouTube rejected the API key'), 'a failed extract says why');
  assert(readyItem(ex, 'Ready stream two')?.getAttribute('aria-current') === null, 'and leaves no stream current');

  extractReplies.push(ok(EXTRACT_TWO_NONE));
  await click(readyItem(ex, 'Ready stream two'), 'Ready stream two, again');
  assert(extractRequests().length === 3, 'after a failed extract, a click on the same stream tries again');
  assert(extractStep.querySelector('[role="alert"]') === null, 'a new extract clears the failure');
  assert(textOf(extractStep).includes('2026-08-25 · ready-2-video'), 'the sources name stream two');
  assert(
    sourceCards(ex).length === 1 && textOf(sourceCard(ex, 'Description')).includes('No timestamps found'),
    'with no comment to use, the Description card says it found no timestamps',
  );
  assert(extractStep.querySelector('table') === null, 'nothing parsed, so no parsed songs');

  extractReplies.push(ok(EXTRACT_TWO_DESCRIPTION));
  await click(buttonNamed(extractStep, 'Re-scan'), 'Re-scan');
  assert(extractRequests().length === 4, 'Re-scan extracts once more');
  assert((extractRequests()[3]?.body as { streamId?: string } | null)?.streamId === 'ready-2', 'the same stream');
  assert(textOf(sourceCard(ex, 'Description')).includes('In use'), 'the description in use says so');
  assert(fieldValues(ex, 'title') === 'Idol|Lemon|Encore', 'and its songs are the parsed rows');

  // A start moved past its row's end: the worker refuses an end that is not after the start, so the
  // row blocks the import, marked on its start (the End column cannot be edited here).
  const idolStart = field(ex, 'Song 1 start');
  await typeInto(idolStart, '5:00');
  await press(idolStart, 'Enter');
  assert(checkText(ex, 1) === 'Ends before it starts', `a start past its row's end says so (got ${checkText(ex, 1)})`);
  assert(
    isMarkedInvalid(field(ex, 'Song 1 start')) && field(ex, 'Song 1 start').getAttribute('aria-describedby') === checkMessage(ex, 1).id,
    'the start is marked invalid, in the danger look, and described by its Check cell',
  );
  assert(importButton(ex).disabled, 'and the import waits for it');
  await typeInto(idolStart, '1:00');
  await press(idolStart, 'Enter');
  assert(
    checkText(ex, 1) === 'OK' && !isMarkedInvalid(field(ex, 'Song 1 start')) && !importButton(ex).disabled,
    'a start back before the end lifts the block',
  );

  await click(extractStep.querySelector<HTMLButtonElement>('button[aria-label="Remove song 2"]'), 'Remove song 2');
  assert(fieldValues(ex, 'title') === 'Idol|Encore', 'Remove song 2 drops that row');
  assert(textOf(importButton(ex)).trim() === 'Import 2 songs', 'the import counts what is left');

  // --- Open Stamp Editor after import: a successful import goes there, on the imported stream ---

  await click(openStampEditorBox(ex), 'Open Stamp Editor after import');
  assert(openStampEditorBox(ex).checked, 'the box is checked');
  extractImportReplies.push(importedSongs(2));
  await click(importButton(ex), 'Import 2 songs');
  const descriptionImport = extractImports()[3];
  assert(
    descriptionImport?.streamId === 'ready-2' && descriptionImport.replace === false,
    'the import goes to stream two, without replacing',
  );
  assert(songsSent(descriptionImport) === 'Idol/YOASOBI/60/260|Encore/Bob/520/null', 'with the rows that are left');
  assert(descriptionImport.credit === undefined, 'a description has no comment author to credit');
  assert(notifications(ex).includes('Imported 2 song(s)'), 'the import reports its result');
  assert(
    textOf(ex.querySelector('#location')) === '/stamp?stream=ready-2',
    'with the box checked, a successful import opens the Stamp Editor on the imported stream',
  );
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await extracting.unmount();

  console.log('✓ Pipeline Extract: ready list, sources, checked and editable rows, 409 confirm, Stamp Editor jump; edits survive a step switch');

  // --- An import that ends after the page has gone opens nothing: the curator stays where they went ---

  calls = [];
  unexpected = [];
  const leaving = await mount(page());
  await click(stepOption(leaving.container, 'Extract'), 'the Extract step');
  extractReplies.push(ok(EXTRACT_ONE));
  await click(readyItem(leaving.container, 'Ready stream one'), 'Ready stream one');
  await click(openStampEditorBox(leaving.container), 'Open Stamp Editor after import');
  const releaseSongImport = holdNextExtractImport();
  extractImportReplies.push(importedSongs(3));
  await click(importButton(leaving.container), 'Import 3 songs');
  assert(importButton(leaving.container).getAttribute('aria-busy') === 'true', 'the import is on its way');
  await click(leaving.container.querySelector<HTMLButtonElement>('#leave'), 'Leave');
  assert(textOf(leaving.container.querySelector('#location')) === '/streams/away', 'the curator leaves while it runs');
  await act(async () => {
    releaseSongImport();
  });
  await settle();
  assert(notifications(leaving.container).includes('Imported 3 song(s)'), 'the import still reports its result');
  assert(
    textOf(leaving.container.querySelector('#location')) === '/streams/away',
    'but the page has gone, so it opens nothing: the curator stays where they went',
  );
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await leaving.unmount();

  console.log('✓ Pipeline Extract: an import that ends after the page has gone reports, and opens nothing');

  // --- Extract: the field each issue is about, a missing title and a start that does not parse
  // (shown, and blocking the import), a search by the video ID an untitled stream is listed by, and
  // one song ---

  calls = [];
  unexpected = [];
  readyReply = ok({ data: [...READY, UNTITLED_READY], total: READY.length + 1 } satisfies ListResponse<Stream>);
  const checking = await mount(page());
  const ck = checking.container;
  await click(stepOption(ck, 'Extract'), 'the Extract step');

  // The list names an untitled stream by its video ID, and a search for that ID finds it.
  const checkingSearch = stepSection(ck, 'Extract').querySelector<HTMLInputElement>('input[type="search"]');
  assert(checkingSearch !== null, 'the ready list has a search field');
  assert(readyItem(ck, 'ready-3-video') !== undefined, 'an untitled stream is listed by its video ID');
  await typeInto(checkingSearch, 'READY-3-VIDEO');
  assert(
    readyItems(ck).length === 1 && readyItem(ck, 'ready-3-video') !== undefined,
    'a search for the video ID an untitled stream is listed by finds it, ignoring case',
  );
  await typeInto(checkingSearch, '');

  // Each flagged row marks the field its issue is about, described by the row's Check cell; the
  // other fields stay plain. An empty title or artist says what is missing. No title blocks the
  // import (the worker refuses a song without one), so its field takes the danger look instead.
  extractReplies.push(ok(EXTRACT_FLAGGED));
  await click(readyItem(ck, 'Ready stream one'), 'Ready stream one');
  assert(
    checkTexts(ck) === 'OK|No artist|Earlier than #2|Same as #1|No title',
    `the flagged rows check out (got ${checkTexts(ck)})`,
  );
  const warnedFields = ['Song 2 artist', 'Song 3 start', 'Song 4 title'];
  const flaggedFields = [...warnedFields, 'Song 5 title'];
  for (const label of flaggedFields) {
    const input = field(ck, label);
    const n = Number(label.split(' ')[1]);
    if (warnedFields.includes(label)) {
      assert(
        isWarned(input) && !input.hasAttribute('aria-invalid'),
        `${label} carries the warn outline: its row's issue is about it`,
      );
    } else {
      assert(isMarkedInvalid(input), `${label} is marked invalid, in the danger look: its row's issue blocks the import`);
    }
    assert(
      input.getAttribute('aria-describedby') === checkMessage(ck, n).id,
      `${label} is described by its row's Check cell`,
    );
  }
  for (const n of [1, 2, 3, 4, 5]) {
    for (const column of ['start', 'title', 'artist']) {
      const label = `Song ${n} ${column}`;
      if (flaggedFields.includes(label)) continue;
      assert(
        !isWarned(field(ck, label))
          && !field(ck, label).hasAttribute('aria-describedby')
          && !field(ck, label).hasAttribute('aria-invalid'),
        `${label} stays plain: no issue is about it`,
      );
    }
  }
  assert(field(ck, 'Song 2 artist').placeholder === 'Artist missing', 'an empty artist field says Artist missing');
  assert(field(ck, 'Song 5 title').placeholder === 'Title missing', 'an empty title field says Title missing');
  assert(
    checkMessage(ck, 5).className.split(' ').includes('text-tone-danger-fg')
      && checkMessage(ck, 2).className.split(' ').includes('text-tone-warn-fg'),
    'No title reads in the danger tone, No artist in the warn tone',
  );
  const blockedByTitle = importButton(ck);
  assert(blockedByTitle.disabled, 'a row with no title blocks the import');
  const titleReasonId = blockedByTitle.getAttribute('aria-describedby') ?? '';
  assert(
    titleReasonId !== '' && textOf(ck.querySelector(`[id="${titleReasonId}"]`)) === 'Fix the rows marked in red first',
    'the reason shows beside the button, as its description',
  );
  assert(
    textOf(stepSection(ck, 'Extract')).includes('4 rows still need a look')
      && !textOf(stepSection(ck, 'Extract')).includes('import anyway?'),
    'the import bar counts the flagged rows, and offers no import anyway while one blocks',
  );
  await click(blockedByTitle, 'the Import a missing title blocks');
  assert(extractImports().length === 0, 'an Import blocked by a missing title sends nothing');

  // A title lifts the block: the row checks out and Import is back; the warnings still ask for a look.
  await typeInto(field(ck, 'Song 5 title'), 'Brave Shine');
  assert(
    checkText(ck, 5) === 'OK' && !field(ck, 'Song 5 title').hasAttribute('aria-invalid'),
    `a title lifts the row's block (got ${checkText(ck, 5)})`,
  );
  assert(
    !importButton(ck).disabled && !importButton(ck).hasAttribute('aria-describedby'),
    'and Import is back, with no reason to give',
  );
  assert(
    textOf(stepSection(ck, 'Extract')).includes('3 rows still need a look — import anyway?'),
    'rows to check that only ask for a look do not block the import',
  );

  // A start that does not parse: its row says so as it is typed, counts among the rows to check,
  // and blocks the import, with the reason beside the button as its description.
  const firstStart = field(ck, 'Song 1 start');
  await typeInto(firstStart, '4:1x');
  assert(checkText(ck, 1) === "Start isn't a time", `a start that does not parse says so as it is typed (got ${checkText(ck, 1)})`);
  assert(
    isMarkedInvalid(firstStart) && firstStart.getAttribute('aria-describedby') === checkMessage(ck, 1).id,
    'the field is marked invalid, in the danger look, and described by its Check cell',
  );
  assert(textOf(stepSection(ck, 'Extract')).includes('4 to check'), 'the row counts toward the rows to check');
  assert(textOf(stepSection(ck, 'Extract')).includes('4 rows still need a look'), 'and toward the import bar’s count');
  const blockedImport = importButton(ck);
  assert(blockedImport.disabled, 'Import is disabled while a start does not parse');
  const reasonId = blockedImport.getAttribute('aria-describedby') ?? '';
  assert(
    reasonId !== '' && textOf(ck.querySelector(`[id="${reasonId}"]`)) === 'Fix the rows marked in red first',
    'the reason shows beside the button, as its description',
  );
  assert(!textOf(stepSection(ck, 'Extract')).includes('import anyway?'), 'while blocked, the bar offers no import anyway');
  await click(blockedImport, 'the blocked Import');
  assert(extractImports().length === 0, 'a blocked Import sends nothing');
  await leaveField(firstStart);
  assert(
    field(ck, 'Song 1 start').value === '4:1x' && importButton(ck).disabled,
    'leaving the field keeps the draft, and the block',
  );

  // Fixed: the row checks out again, Import is back, and the request carries the new start.
  await typeInto(firstStart, '0:15');
  assert(checkText(ck, 1) === 'OK' && !importButton(ck).disabled, 'a start that parses lifts the block');
  assert(
    !firstStart.hasAttribute('aria-invalid') && !firstStart.hasAttribute('aria-describedby'),
    'and the mark goes with it',
  );
  // A click on Import blurs the field first, which commits the start.
  await leaveField(firstStart);
  extractImportReplies.push(importedSongs(5));
  await click(importButton(ck), 'Import 5 songs');
  assert(extractImports().length === 1, 'Import sends the rows');
  assert(
    songsSent(extractImports()[0]).startsWith('Opening/Alice/15/null|'),
    `the request carries the new start (sent ${songsSent(extractImports()[0])})`,
  );
  assert(
    songsSent(extractImports()[0]).endsWith('|Brave Shine/Aimer/400/null'),
    `and the title that lifted the block (sent ${songsSent(extractImports()[0])})`,
  );

  // One song reads in the singular.
  extractReplies.push(ok(EXTRACT_SINGLE));
  await click(readyItem(ck, 'Ready stream two'), 'Ready stream two');
  assert(textOf(importButton(ck)).trim() === 'Import 1 song', `one song reads Import 1 song (got ${textOf(importButton(ck)).trim()})`);
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await checking.unmount();

  console.log('✓ Pipeline Extract: flagged fields, a missing title and an unparseable start block the import, a video-ID search, one song');

  // --- An extract whose stream leaves the ready list: its sources and its credit still name it ---

  calls = [];
  unexpected = [];
  readyReply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
  const leftList = await mount(page());
  const ll = leftList.container;
  await click(stepOption(ll, 'Extract'), 'the Extract step');
  extractReplies.push(ok(EXTRACT_ONE));
  await click(readyItem(ll, 'Ready stream one'), 'Ready stream one');
  assert(textOf(stepSection(ll, 'Extract')).includes('2026-09-01 · ready-1-video'), 'the sources name the stream extracted');

  // A Discover import reloads the ready list, which no longer holds stream one.
  await click(stepOption(ll, 'Discover'), 'the Discover step');
  discoverReplies.push(scan(DISCOVERED));
  await click(buttonNamed(stepSection(ll, 'Discover'), 'Discover streams'), 'Discover streams');
  readyReply = ok({ data: [READY[1]!, IMPORTED_READY], total: 2 } satisfies ListResponse<Stream>);
  importReplies.push(imported(NEW_IDS));
  discoverReplies.push(scan(AFTER_IMPORT));
  await click(buttonNamed(bulkBar(ll), 'Import as pending streams'), 'Import as pending streams');
  await click(stepOption(ll, 'Extract'), 'the Extract step');
  assert(
    readyItem(ll, 'Ready stream one') === undefined && readyItem(ll, 'Freshly imported stream') !== undefined,
    'the reloaded ready list no longer holds stream one',
  );

  // The other comment's credit links to stream one's video, and the sources still name it while
  // the import runs.
  await click(buttonNamed(sourceCard(ll, 'Comment'), 'Use this'), 'Use this');
  const releaseCreditImport = holdNextExtractImport();
  extractImportReplies.push(importedSongs(3));
  await click(importButton(ll), 'Import 3 songs');
  const creditImport = extractImports()[0];
  assert(creditImport?.streamId === 'ready-1', 'the import goes to stream one');
  assert(
    creditImport.credit?.commentUrl === 'https://www.youtube.com/watch?v=ready-1-video&lc=c-second',
    `the credit links to stream one's video (got ${creditImport.credit?.commentUrl})`,
  );
  assert(
    textOf(stepSection(ll, 'Extract')).includes('2026-09-01 · ready-1-video'),
    'the sources still name stream one once it has left the list',
  );
  await act(async () => {
    releaseCreditImport();
  });
  await settle();
  assert(notifications(ll).includes('Imported 3 song(s)'), 'the import lands');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await leftList.unmount();

  console.log('✓ Pipeline Extract: an extract whose stream leaves the ready list still names it, and credits its video');

  // --- A typo in a start: the row before ends there and is blocked; fixing the start moves that end
  // too (End cannot be edited here), so the block lifts and Import is back ---

  calls = [];
  unexpected = [];
  readyReply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
  const typo = await mount(page());
  const ty = typo.container;
  await click(stepOption(ty, 'Extract'), 'the Extract step');
  extractReplies.push(ok(EXTRACT_TYPO));
  await click(readyItem(ty, 'Ready stream one'), 'Ready stream one');
  assert(
    checkTexts(ty) === 'Ends before it starts|Earlier than #1|OK' && importButton(ty).disabled,
    `the typo leaves row 1 ending before it starts, which blocks the import (got ${checkTexts(ty)})`,
  );
  const typoStart = field(ty, 'Song 2 start');
  await typeInto(typoStart, '4:25');
  await press(typoStart, 'Enter');
  assert(endTexts(ty) === '4:25|8:00|—', `fixing row 2's start moves row 1's end with it (got ${endTexts(ty)})`);
  assert(
    checkTexts(ty) === 'OK|OK|OK' && !importButton(ty).disabled,
    `and lifts the block: every row checks out and Import is back (got ${checkTexts(ty)})`,
  );
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await typo.unmount();

  console.log('✓ Pipeline Extract: fixing a start that a row before ends at moves that end too, and lifts the block');

  // --- An end of the commenter's own stays put when the next start moves, even one equal to it; an
  // end the parse took from the next start follows it. The extract's comment and Use this alike ---

  calls = [];
  unexpected = [];
  readyReply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
  const ownEnds = await mount(page());
  const oe = ownEnds.container;
  await click(stepOption(oe, 'Extract'), 'the Extract step');
  extractReplies.push(ok(EXTRACT_OWN_END));
  await click(readyItem(oe, 'Ready stream one'), 'Ready stream one');
  assert(endTexts(oe) === '3:00|6:00|—', `the rows end where the comment and the parse say (got ${endTexts(oe)})`);
  const ownSecondStart = field(oe, 'Song 2 start');
  await typeInto(ownSecondStart, '3:10');
  await press(ownSecondStart, 'Enter');
  assert(
    endTexts(oe) === '3:00|6:00|—',
    `row 1's end is the commenter's own: row 2's new start leaves it at 3:00 (got ${endTexts(oe)})`,
  );
  const ownThirdStart = field(oe, 'Song 3 start');
  await typeInto(ownThirdStart, '6:30');
  await press(ownThirdStart, 'Enter');
  assert(endTexts(oe) === '3:00|6:30|—', `row 2's end is the parse's: it follows row 3's new start (got ${endTexts(oe)})`);
  assert(checkTexts(oe) === 'OK|OK|OK', `and every row checks out (got ${checkTexts(oe)})`);

  // Use this reads the other comment's text the same way.
  await click(buttonNamed(sourceCard(oe, 'Comment'), 'Use this'), 'Use this');
  await click(buttonNamed(oe.querySelector<HTMLElement>('dialog[open]'), 'Discard'), "the confirm's Discard");
  assert(fieldValues(oe, 'title') === 'Blue Bird|Idol|Encore', "the other comment's songs are the rows");
  const otherSecondStart = field(oe, 'Song 2 start');
  await typeInto(otherSecondStart, '2:10');
  await press(otherSecondStart, 'Enter');
  assert(endTexts(oe) === '2:00|5:00|—', `its row 1 keeps its own end too (got ${endTexts(oe)})`);

  // The worker gets the rows as shown, and nothing the page keeps for itself.
  extractImportReplies.push(importedSongs(3));
  await click(importButton(oe), 'Import 3 songs');
  const ownEndImport = extractImports()[0];
  assert(
    songsSent(ownEndImport) === 'Blue Bird/Ikimono Gakari/0/120|Idol/YOASOBI/130/300|Encore/Bob/300/null',
    `the import sends the rows as shown (sent ${songsSent(ownEndImport)})`,
  );
  assert(
    (ownEndImport?.songs ?? []).every(
      (song) => Object.keys(song).sort().join(',') === 'artist,endSeconds,songName,startSeconds',
    ),
    'each song sent carries its title, artist, start and end, and nothing else',
  );
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await ownEnds.unmount();

  console.log("✓ Pipeline Extract: a start edit moves the end the parse took from it, never one of the commenter's own");

  // --- Changed rows: another stream, Re-scan and another comment replace them, so each asks first;
  // Cancel leaves everything as it was. Rows nobody changed go without a question, and the stream
  // already on screen stays a no-op ---

  calls = [];
  unexpected = [];
  readyReply = ok({ data: READY, total: READY.length } satisfies ListResponse<Stream>);
  const guarded = await mount(page());
  const gd = guarded.container;
  await click(stepOption(gd, 'Extract'), 'the Extract step');
  extractReplies.push(ok(EXTRACT_ONE));
  await click(readyItem(gd, 'Ready stream one'), 'Ready stream one');
  assert(fieldValues(gd, 'title') === 'Opening|Lemon|Encore', "stream one's rows are on screen");

  const discardConfirm = () => gd.querySelector<HTMLElement>('dialog[open]');
  const rescanButton = () => buttonNamed(stepSection(gd, 'Extract'), 'Re-scan');
  const streamIdOf = (call: Call | undefined) => (call?.body as { streamId?: string } | null)?.streamId;
  /** Clicks `control` the way a pointer does: it takes the focus first, so a field being typed in is left. */
  const pointAt = async (control: HTMLElement | undefined, what: string): Promise<void> => {
    assert(control !== undefined, `the page renders ${what}`);
    await act(async () => {
      control.focus();
    });
    await click(control, what);
  };

  // A title edit: another stream asks before it drops the edit. Cancel keeps it, and the stream.
  await typeInto(field(gd, 'Song 1 title'), 'Opening (acoustic)');
  await pointAt(readyItem(gd, 'Ready stream two'), 'Ready stream two');
  let confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'another stream asks first while the rows are changed');
  assert(
    textOf(confirmDialog.querySelector('h2')) === 'Discard your changes?',
    `the confirm asks whether to discard the changes (got "${textOf(confirmDialog.querySelector('h2'))}")`,
  );
  assert(
    textOf(confirmDialog).includes('Your edits to the parsed songs for 2026-09-01 · ready-1-video will be lost.'),
    `and names the stream whose edits would be lost (got "${textOf(confirmDialog)}")`,
  );
  assert(
    buttonNamed(confirmDialog, 'Discard') !== undefined && document.activeElement === buttonNamed(confirmDialog, 'Cancel'),
    'it offers Discard, and starts on Cancel, so a stray Enter keeps the edits',
  );
  assert(extractRequests().length === 1, 'nothing is extracted while it asks');
  assert(!NO_RAW_PALETTE.test(gd.innerHTML), 'the confirm uses no raw palette classes');

  await click(buttonNamed(confirmDialog, 'Cancel'), "the confirm's Cancel");
  assert(discardConfirm() === null, 'Cancel closes the confirm');
  assert(extractRequests().length === 1, 'Cancel extracts nothing');
  assert(field(gd, 'Song 1 title').value === 'Opening (acoustic)', 'the edit is still there');
  assert(
    readyItem(gd, 'Ready stream one')?.getAttribute('aria-current') === 'true'
      && readyItem(gd, 'Ready stream two')?.getAttribute('aria-current') === null,
    'stream one is still the highlighted stream',
  );
  assert(textOf(stepSection(gd, 'Extract')).includes('2026-09-01 · ready-1-video'), "the sources are still stream one's");
  assert(document.activeElement === readyItem(gd, 'Ready stream two'), 'focus goes back to the stream whose click asked');

  // The stream already on screen: its click runs nothing and asks nothing, changed rows or not.
  await pointAt(readyItem(gd, 'Ready stream one'), 'Ready stream one, whose rows are changed');
  assert(discardConfirm() === null && extractRequests().length === 1, 'a click on the stream on screen asks and extracts nothing');

  // Discard: the other stream's extract runs, and its rows replace the edited ones.
  extractReplies.push(ok(EXTRACT_TWO_DESCRIPTION));
  await pointAt(readyItem(gd, 'Ready stream two'), 'Ready stream two');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'another stream asks again');
  await click(buttonNamed(confirmDialog, 'Discard'), "the confirm's Discard");
  assert(discardConfirm() === null, 'Discard closes the confirm');
  assert(extractRequests().length === 2 && streamIdOf(extractRequests()[1]) === 'ready-2', "Discard runs stream two's extract");
  assert(fieldValues(gd, 'title') === 'Idol|Lemon|Encore', "stream two's rows replace the edited ones");
  assert(readyItem(gd, 'Ready stream two')?.getAttribute('aria-current') === 'true', 'and stream two is highlighted');

  // Rows nobody has changed go without a question.
  extractReplies.push(ok(EXTRACT_ONE));
  await pointAt(readyItem(gd, 'Ready stream one'), 'Ready stream one');
  assert(discardConfirm() === null, 'with nothing changed, another stream asks nothing');
  assert(
    extractRequests().length === 3 && fieldValues(gd, 'title') === 'Opening|Lemon|Encore',
    'and its extract runs at once',
  );

  // A start still being typed commits as its field is left, before the click lands: it counts, and
  // Re-scan asks. Cancel keeps the committed start.
  const typedStart = field(gd, 'Song 2 start');
  await act(async () => {
    typedStart.focus();
  });
  await typeInto(typedStart, '4:20');
  await pointAt(rescanButton(), 'Re-scan');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'a start committed as its field is left counts: Re-scan asks first');
  await click(buttonNamed(confirmDialog, 'Cancel'), "the confirm's Cancel");
  assert(discardConfirm() === null && extractRequests().length === 3, 'Cancel re-scans nothing');
  assert(field(gd, 'Song 2 start').value === '4:20', 'the committed start stays');
  assert(document.activeElement === rescanButton(), 'focus goes back to Re-scan');

  extractReplies.push(ok(EXTRACT_ONE));
  await pointAt(rescanButton(), 'Re-scan');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'Re-scan asks again');
  await click(buttonNamed(confirmDialog, 'Discard'), "the confirm's Discard");
  assert(extractRequests().length === 4 && streamIdOf(extractRequests()[3]) === 'ready-1', 'Discard re-scans the same stream');
  assert(fieldValues(gd, 'start') === '0:10|4:10|8:00', "the new extract's rows are on screen, without the edit");

  extractReplies.push(ok(EXTRACT_ONE));
  await pointAt(rescanButton(), 'Re-scan');
  assert(discardConfirm() === null && extractRequests().length === 5, 'with nothing changed, Re-scan asks nothing and runs');

  // A removed row counts too: another comment asks before it replaces the rows.
  await click(stepSection(gd, 'Extract').querySelector<HTMLButtonElement>('button[aria-label="Remove song 3"]'), 'Remove song 3');
  assert(fieldValues(gd, 'title') === 'Opening|Lemon', 'Remove song 3 drops that row');
  await pointAt(buttonNamed(sourceCard(gd, 'Comment'), 'Use this'), 'Use this');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'another comment asks first while the rows are changed');
  await click(buttonNamed(confirmDialog, 'Cancel'), "the confirm's Cancel");
  assert(fieldValues(gd, 'title') === 'Opening|Lemon', 'Cancel keeps the rows as they were');
  assert(textOf(sourceCard(gd, 'Pinned comment')).includes('In use'), 'and the comment in use');
  assert(document.activeElement === buttonNamed(sourceCard(gd, 'Comment'), 'Use this'), 'focus goes back to Use this');

  await pointAt(buttonNamed(sourceCard(gd, 'Comment'), 'Use this'), 'Use this');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'Use this asks again');
  await click(buttonNamed(confirmDialog, 'Discard'), "the confirm's Discard");
  assert(fieldValues(gd, 'title') === 'Blue Bird|Lemon|Idol', "Discard puts the comment's songs in place");
  assert(textOf(sourceCard(gd, 'Comment')).includes('In use'), 'and that comment is in use');
  assert(extractRequests().length === 5, 'a comment is parsed in the page: no request');

  await pointAt(buttonNamed(sourceCard(gd, 'Pinned comment'), 'Use this'), 'Use this');
  assert(
    discardConfirm() === null && fieldValues(gd, 'title') === 'Opening|Lemon|Encore',
    'with nothing changed, Use this asks nothing and replaces the rows',
  );

  // A start draft dropped with Escape never reached the rows: nothing asks.
  const escapedStart = field(gd, 'Song 1 start');
  await act(async () => {
    escapedStart.focus();
  });
  await typeInto(escapedStart, '0:30');
  await press(escapedStart, 'Escape');
  extractReplies.push(ok(EXTRACT_TWO_DESCRIPTION));
  await pointAt(readyItem(gd, 'Ready stream two'), 'Ready stream two');
  assert(discardConfirm() === null, 'a start draft dropped with Escape changes nothing: another stream asks nothing');
  assert(
    extractRequests().length === 6 && fieldValues(gd, 'title') === 'Idol|Lemon|Encore',
    'and its extract runs at once',
  );

  // A draft that does not parse is never committed by leaving the field, so it stays pending:
  // another stream asks before it is dropped, the same as an edited row.
  const badStart = field(gd, 'Song 1 start');
  await act(async () => {
    badStart.focus();
  });
  await typeInto(badStart, '4:1x');
  await pointAt(readyItem(gd, 'Ready stream one'), 'Ready stream one');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'a draft that does not parse counts as pending: another stream asks first');
  assert(
    textOf(confirmDialog.querySelector('h2')) === 'Discard your changes?',
    'the confirm is the same one a changed row asks',
  );
  assert(extractRequests().length === 6, 'nothing is extracted while it asks');

  await click(buttonNamed(confirmDialog, 'Cancel'), "the confirm's Cancel");
  assert(discardConfirm() === null && extractRequests().length === 6, 'Cancel extracts nothing');
  assert(field(gd, 'Song 1 start').value === '4:1x', 'the pending draft is still exactly as typed');
  assert(document.activeElement === readyItem(gd, 'Ready stream one'), 'focus goes back to the stream whose click asked');

  extractReplies.push(ok(EXTRACT_ONE));
  await pointAt(readyItem(gd, 'Ready stream one'), 'Ready stream one');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'it asks again');
  await click(buttonNamed(confirmDialog, 'Discard'), "the confirm's Discard");
  assert(
    extractRequests().length === 7 && streamIdOf(extractRequests()[6]) === 'ready-1',
    'Discard runs the new extract',
  );
  assert(fieldValues(gd, 'title') === 'Opening|Lemon|Encore', "stream one's fresh rows are on screen");

  // Escape drops the draft before it can be counted: nothing asks.
  const escapedBadStart = field(gd, 'Song 1 start');
  await act(async () => {
    escapedBadStart.focus();
  });
  await typeInto(escapedBadStart, '4:1x');
  await press(escapedBadStart, 'Escape');
  extractReplies.push(ok(EXTRACT_TWO_DESCRIPTION));
  await pointAt(readyItem(gd, 'Ready stream two'), 'Ready stream two');
  assert(discardConfirm() === null, 'a pending draft dropped with Escape changes nothing: another stream asks nothing');
  assert(
    extractRequests().length === 8 && fieldValues(gd, 'title') === 'Idol|Lemon|Encore',
    'and its extract runs at once',
  );

  // Re-scan shares the same guard.
  const rescanBadStart = field(gd, 'Song 1 start');
  await act(async () => {
    rescanBadStart.focus();
  });
  await typeInto(rescanBadStart, '4:1x');
  extractReplies.push(ok(EXTRACT_TWO_DESCRIPTION));
  await pointAt(rescanButton(), 'Re-scan');
  confirmDialog = discardConfirm();
  assert(confirmDialog !== null, 'Re-scan asks too: a pending draft shares the same guard');
  await click(buttonNamed(confirmDialog, 'Discard'), "the confirm's Discard");
  assert(extractRequests().length === 9, 'Discard re-scans the stream');

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await guarded.unmount();

  console.log('✓ Pipeline Extract: changed rows and a pending Start draft ask before another stream, Re-scan or another comment replaces them; unchanged rows, the stream on screen and a dropped draft ask nothing');
}

await main();
