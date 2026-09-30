/**
 * The Dashboard (spec §8.1). First the pure helpers behind its cards — which streams to continue
 * stamping, the oldest pending stream, the inbox total, the catalog bar segments, the VOD export
 * state — then the page mounted live the way the shell mounts it (ToastProvider > router >
 * InboxCountsProvider) against a stubbed fetch: five cards that each load and fail on their own
 * (a failing endpoint degrades only its card, and Retry refetches only that endpoint), the catalog
 * bars, Continue stamping, Recent submissions, Refresh, and what a contributor sees and requests.
 */
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type {
  AuthUser,
  DashboardStats,
  ListResponse,
  Song,
  StampStats,
  StatusCounts,
  Stream,
  StreamWithPending,
  WorkMatchCandidatesResponse,
} from '../../shared/types';
import type { VodExportStatusResponse } from '../src/api/vodExportTypes';
import { formatFullTime, formatWhen } from '../src/lib/dates';
import {
  catalogSegments,
  continueStampingStreams,
  inboxTotal,
  monthDay,
  oldestPendingDate,
  streamsWithWork,
  vodExportState,
} from '../src/lib/dashboard-data';
import { click, installDom, mount, settle } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- Fixtures ---

function stream(id: string, date: string, title: string, overrides: Partial<Stream> = {}): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title,
    date,
    videoId: `${id}-video`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}-video`,
    credit: {},
    status: 'approved',
    submittedBy: null,
    reviewedBy: null,
    createdAt: `${date} 12:00:00`,
    ...overrides,
  };
}

function stampStream(id: string, date: string, title: string, pendingCount: number): StreamWithPending {
  return { ...stream(id, date, title), pendingCount };
}

function counts(approved: number, pending: number, rejected: number, excluded: number, extracted: number): StatusCounts {
  return { approved, pending, rejected, excluded, extracted };
}

// Review Focus 5: a 120-character CJK + emoji title, cut in code points so no surrogate pair splits.
const LONG_TITLE = Array.from('【歌枠】週六晚上唱歌給你聽✨土曜の夜は歌とともにゆっくりお休み🎤初見さん大歓迎🎵'.repeat(4))
  .slice(0, 120)
  .join('');
assert(Array.from(LONG_TITLE).length === 120, 'the long title fixture is 120 characters');

/** The streamer's streams with how many of their songs still lack an end timestamp. */
const STAMP_STREAMS: StreamWithPending[] = [
  stampStream('st-deep', '2026-03-07', 'Deep night karaoke', 1),
  stampStream('st-trip', '2026-04-02', LONG_TITLE, 7),
  stampStream('st-back', '2026-03-27', 'Back again', 5),
  stampStream('st-done', '2026-04-10', 'All stamped', 0),
  stampStream('st-white', '2026-03-14', 'White day', 3),
  stampStream('st-another', '2026-03-27', 'Another one', 2),
  stampStream('st-old', '2026-01-01', 'Old one', 4),
];

const STAMP_STATS: StampStats = { total: 5382, filled: 5366, remaining: 16 };

const PENDING_STREAMS: Stream[] = [
  stream('p-1', '2025-03-01', 'Pending one', { status: 'pending' }),
  stream('p-2', '2024-11-02', 'Pending two', { status: 'pending' }),
  stream('p-3', '2026-01-15', 'Pending three', { status: 'pending' }),
];

const SONG: Song = {
  id: 'song-1',
  workId: null,
  title: '閃亮(Shining) 自彈自唱',
  originalArtist: 'Someone',
  tags: [],
  status: 'approved',
  submittedBy: 'contributor@example.com',
  reviewedBy: null,
  createdAt: '2026-07-01 08:43:00',
  updatedAt: '2026-07-01 08:43:00',
};
const RECENT_STREAM = stream('stream-1', '2026-06-30', '【歌枠】可以開心一周的幸福歌聲魔法✨', {
  status: 'pending',
  submittedBy: null,
  createdAt: '2025-12-06 03:12:00',
});

const STATS: DashboardStats = {
  songs: counts(2390, 8, 0, 0, 0),
  streams: counts(303, 198, 0, 0, 0),
  performances: counts(5300, 20, 10, 50, 2),
  recentSubmissions: [SONG, RECENT_STREAM],
};

const WORK_MATCHES: WorkMatchCandidatesResponse = {
  data: [],
  total: 12,
  page: 1,
  pageSize: 1,
  totalPages: 12,
  stats: { candidateCount: 15, pendingCount: 12, notDuplicateCount: 0, needsResearchCount: 3, affectedWorks: 30 },
};

const PUBLISHED_AT = '2026-09-20T08:30:00.000Z';

const VOD_STATUS: VodExportStatusResponse = {
  currentPublication: {
    schemaVersion: '1.0.0',
    snapshotUrl: 'https://example.com/snapshot.json',
    sha256: 'a'.repeat(64),
    publishedAt: PUBLISHED_AT,
    uncompressedBytes: 1024,
    counts: { streamers: 2, vods: 3, performances: 4 },
  },
  changesNotPublished: true,
  publicationInProgress: false,
  generationInProgress: false,
  recoveryAvailable: false,
};

/** An inbox list: only `status` is read (the provider counts the pending ones). */
function inboxList(pending: number, other: number): ListResponse<{ id: string; status: string }> {
  const data = [
    ...Array.from({ length: pending }, (_, i) => ({ id: `pending-${i}`, status: 'pending' })),
    ...Array.from({ length: other }, (_, i) => ({ id: `other-${i}`, status: 'approved' })),
  ];
  return { data, total: data.length };
}

// --- The pure helpers ---

const ids = (streams: { id: string }[]) => streams.map((item) => item.id).join(',');

assert(
  ids(continueStampingStreams(STAMP_STREAMS)) === 'st-trip,st-another,st-back,st-white',
  `continueStampingStreams: streams with work, newest first, a same-day tie by title, the first four (got ${ids(continueStampingStreams(STAMP_STREAMS))})`,
);
assert(ids(continueStampingStreams(STAMP_STREAMS, 2)) === 'st-trip,st-another', 'continueStampingStreams takes its limit');
assert(
  ids(continueStampingStreams(STAMP_STREAMS, 10)) === 'st-trip,st-another,st-back,st-white,st-deep,st-old',
  'continueStampingStreams never lists a stream whose songs are all stamped',
);
assert(
  ids(STAMP_STREAMS) === 'st-deep,st-trip,st-back,st-done,st-white,st-another,st-old',
  'continueStampingStreams leaves its input in its order',
);
assert(continueStampingStreams([]).length === 0, 'no streams, nothing to continue');
assert(streamsWithWork(STAMP_STREAMS) === 6, 'streamsWithWork counts the streams with songs left to stamp');
assert(streamsWithWork([]) === 0, 'streamsWithWork of nothing is 0');

assert(oldestPendingDate(PENDING_STREAMS) === '2024-11-02', 'oldestPendingDate picks the earliest date');
assert(oldestPendingDate([]) === null, 'oldestPendingDate is null with nothing pending');
assert(
  oldestPendingDate([stream('x', '', 'No date'), ...PENDING_STREAMS]) === '2024-11-02',
  'oldestPendingDate skips a stream without a date',
);

assert(inboxTotal({ nova: null, vods: null, crystal: null }) === null, 'inboxTotal is null while every count is unknown');
assert(inboxTotal({ nova: 2, vods: null, crystal: 3 }) === null, 'inboxTotal is null while any count is unknown: never a partial sum');
assert(inboxTotal({ nova: 2, vods: 1, crystal: 2 }) === 5, 'inboxTotal sums all three');
assert(inboxTotal({ nova: 0, vods: 0, crystal: null }) === null, 'known zeros beside an unknown count are no total either');
assert(inboxTotal({ nova: 0, vods: 0, crystal: 0 }) === 0, 'known zeros are a total of 0, not unknown');

const songsSegments = catalogSegments(STATS.songs);
assert(
  JSON.stringify(songsSegments) ===
    JSON.stringify([
      { key: 'approved', label: 'Approved', tone: 'ok', value: 2390, pct: 99.67 },
      { key: 'pending', label: 'Pending', tone: 'warn', value: 8, pct: 0.33 },
    ]),
  `catalogSegments omits the zero statuses and rounds each share to two decimals (got ${JSON.stringify(songsSegments)})`,
);
const allFive = catalogSegments(STATS.performances);
assert(
  allFive.map((segment) => `${segment.key}/${segment.label}/${segment.tone}/${segment.value}`).join(',') ===
    'approved/Approved/ok/5300,pending/Pending/warn/20,rejected/Rejected/danger/10,excluded/Excluded/neutral/50,extracted/Extracted/teal/2',
  'catalogSegments: approved / ok, pending / warn, rejected / danger, excluded / neutral, extracted / teal, in that order',
);
assert(catalogSegments(counts(0, 0, 0, 0, 0)).length === 0, 'an empty catalog has no segments');

/** Every status count from 0 to 4, plus a few large and lopsided ones. */
const segmentCases: StatusCounts[] = [
  counts(1, 1, 1, 1, 3),
  counts(1, 999_999, 0, 0, 0),
  counts(5300, 20, 10, 50, 2),
  counts(2390, 8, 0, 0, 0),
];
for (let n = 0; n < 5 ** 5; n += 1) {
  const digits = [0, 1, 2, 3, 4].map((place) => Math.floor(n / 5 ** place) % 5);
  segmentCases.push(counts(digits[0] ?? 0, digits[1] ?? 0, digits[2] ?? 0, digits[3] ?? 0, digits[4] ?? 0));
}
for (const caseCounts of segmentCases) {
  const segments = catalogSegments(caseCounts);
  const nonZero = Object.values(caseCounts).filter((value) => value > 0).length;
  assert(segments.length === nonZero, `catalogSegments keeps exactly the non-zero statuses of ${JSON.stringify(caseCounts)}`);
  if (segments.length === 0) continue;
  const sum = segments.reduce((total, segment) => total + segment.pct, 0);
  assert(Math.abs(sum - 100) <= 0.01, `catalogSegments of ${JSON.stringify(caseCounts)} sums to 100 ± 0.01 (got ${sum})`);
  for (const segment of segments) {
    assert(
      Math.abs(segment.pct * 100 - Math.round(segment.pct * 100)) < 1e-6,
      `a share has at most two decimals (got ${segment.pct} in ${JSON.stringify(caseCounts)})`,
    );
  }
}

assert(monthDay('2026-04-02') === '04-02', 'monthDay cuts a date to MM-DD');
assert(monthDay('someday') === 'someday', 'monthDay leaves anything else as it is');

const vodBase = { ...VOD_STATUS, changesNotPublished: false };
assert(vodExportState(vodBase).label === 'Up to date' && vodExportState(vodBase).tone === 'ok', 'nothing unpublished: Up to date (ok)');
assert(
  vodExportState(VOD_STATUS).label === 'Unpublished changes' && vodExportState(VOD_STATUS).tone === 'warn',
  'changes not yet published: Unpublished changes (warn)',
);
for (const busy of [{ generationInProgress: true }, { publicationInProgress: true }]) {
  const state = vodExportState({ ...VOD_STATUS, ...busy });
  assert(state.label === 'In progress' && state.tone === 'info', `${Object.keys(busy)[0]}: In progress (info)`);
}

console.log('✓ dashboard-data: streams to continue, oldest pending date, inbox total, catalog segments, VOD export state');

// --- fetch stub: the six dashboard loads and the three inbox lists, each answered from what the test
// set up; every request is logged, and one nothing answers is recorded as unexpected (and gets a 404) ---

type Endpoint =
  | 'stats'
  | 'stampStats'
  | 'stampStreams'
  | 'pendingStreams'
  | 'workMatches'
  | 'vodStatus'
  | 'nova'
  | 'vods'
  | 'crystal';

const CURATOR_ENDPOINTS: Endpoint[] = ['stats', 'stampStats', 'stampStreams', 'pendingStreams', 'workMatches', 'vodStatus', 'nova', 'vods', 'crystal'];
// The worker serves the work matches, the VOD export status and the three inbox lists to curators
// alone: a contributor's page and shell ask for none of them.
const CONTRIBUTOR_ENDPOINTS: Endpoint[] = ['stats', 'stampStats', 'stampStreams', 'pendingStreams'];

interface Reply {
  status: number;
  body: unknown;
}

interface Call {
  endpoint: Endpoint;
  params: URLSearchParams;
}

function ok(body: unknown): Reply {
  return { status: 200, body };
}

const FAILURE: Reply = { status: 500, body: { error: 'Internal error' } };

function defaultReplies(): Record<Endpoint, Reply> {
  return {
    stats: ok(STATS),
    stampStats: ok(STAMP_STATS),
    stampStreams: ok({ data: STAMP_STREAMS, total: STAMP_STREAMS.length } satisfies ListResponse<StreamWithPending>),
    pendingStreams: ok({ data: PENDING_STREAMS, total: PENDING_STREAMS.length } satisfies ListResponse<Stream>),
    workMatches: ok(WORK_MATCHES),
    vodStatus: ok(VOD_STATUS),
    nova: ok(inboxList(2, 3)),
    vods: ok(inboxList(1, 0)),
    crystal: ok(inboxList(2, 1)),
  };
}

let replies = defaultReplies();
let calls: Call[] = [];
let unexpected: string[] = [];
/** Holds the next request to an endpoint open until the test releases it. */
const gates = new Map<Endpoint, Promise<void>>();

function holdNext(endpoint: Endpoint): () => void {
  let release: () => void = () => undefined;
  gates.set(
    endpoint,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  return release;
}

function endpointOf(method: string, url: URL): Endpoint | null {
  if (method !== 'GET') return null;
  switch (url.pathname) {
    case '/api/stats':
      return 'stats';
    case '/api/stamp/stats':
      return 'stampStats';
    case '/api/stamp/streams':
      return 'stampStreams';
    case '/api/streams':
      return url.searchParams.get('status') === 'pending' ? 'pendingStreams' : null;
    case '/api/work-matches':
      return 'workMatches';
    case '/api/vod-export/status':
      return 'vodStatus';
    case '/api/nova/submissions':
      return 'nova';
    case '/api/nova/vods':
      return 'vods';
    case '/api/crystal/tickets':
      return 'crystal';
    default:
      return null;
  }
}

function installFetchStub(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      const endpoint = endpointOf(method, url);
      if (endpoint === null) {
        unexpected.push(`${method} ${url.pathname}${url.search}`);
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
      }
      calls.push({ endpoint, params: url.searchParams });
      const gate = gates.get(endpoint);
      if (gate) {
        gates.delete(endpoint);
        await gate;
      }
      const reply = replies[endpoint];
      return new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

/** Resets the request log and the replies, then applies `overrides`. */
function resetStub(overrides: Partial<Record<Endpoint, Reply>> = {}): void {
  calls = [];
  unexpected = [];
  gates.clear();
  replies = { ...defaultReplies(), ...overrides };
}

function calledEndpoints(): string {
  return calls
    .map((call) => call.endpoint)
    .sort()
    .join(',');
}

function exactly(endpoints: Endpoint[]): string {
  return [...endpoints].sort().join(',');
}

// --- DOM lookups ---

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? '';
}

function heading(container: HTMLElement, text: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('h2')].find((node) => textOf(node) === text);
  assert(found !== undefined, `the page has a "${text}" heading`);
  return found;
}

function sectionOf(container: HTMLElement, title: string): HTMLElement {
  const section = heading(container, title).closest('section');
  assert(section !== null, `"${title}" heads a section`);
  return section;
}

/** The Needs attention cards, in order: each list item's card (a link, or a plain card). */
function attentionCards(container: HTMLElement): HTMLElement[] {
  const list = sectionOf(container, 'Needs attention').querySelector('ul');
  assert(list !== null, 'Needs attention lists its cards');
  return [...list.children].map((item) => item.firstElementChild as HTMLElement);
}

function hasTitle(card: HTMLElement, title: string): boolean {
  return [...card.querySelectorAll('span')].some((span) => textOf(span) === title);
}

function findCard(container: HTMLElement, title: string): HTMLElement | undefined {
  return attentionCards(container).find((card) => hasTitle(card, title));
}

function card(container: HTMLElement, title: string): HTMLElement {
  const found = findCard(container, title);
  assert(found !== undefined, `Needs attention shows the ${title} card`);
  return found;
}

/** A card's parts: its heading row, then its value, then its sub-line (or chips). */
function valueOf(cardNode: HTMLElement): string {
  return textOf(cardNode.children[1]);
}

function subOf(cardNode: HTMLElement): string {
  return textOf(cardNode.children[2]);
}

/** The classes of a card's icon tile, the first thing in its heading row. */
function tileClassesOf(cardNode: HTMLElement): string[] {
  return (cardNode.firstElementChild?.firstElementChild?.className ?? '').split(' ');
}

/** A failed card's value: the first part of its value row (a Retry icon and its tooltip follow). */
function failedValueOf(cardNode: HTMLElement): string {
  return textOf(cardNode.children[1]?.firstElementChild);
}

/** The Inbox card's chips, each as `href=text`. */
function inboxChips(container: HTMLElement): string {
  return [...card(container, 'Inbox').querySelectorAll<HTMLAnchorElement>('a')]
    .map((chip) => `${chip.getAttribute('href')}=${textOf(chip)}`)
    .join('|');
}

function retryButton(root: ParentNode, label: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function retryButtons(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button[aria-label^="Retry"]')].map(
    (button) => button.getAttribute('aria-label') ?? '',
  );
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button).trim() === name);
}

function locationOf(container: HTMLElement): string {
  return textOf(container.querySelector('#location'));
}

function pageHeader(container: HTMLElement): HTMLElement {
  const header = container.querySelector<HTMLElement>('header');
  assert(header !== null, 'the page renders its header');
  return header;
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output id="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" id="back" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}

const CURATOR: AuthUser = { email: 'curator@example.com', role: 'curator' };
const CONTRIBUTOR: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { default: Dashboard } = await import('../src/pages/Dashboard');
  const { InboxCountsProvider } = await import('../src/components/shell/InboxCounts');
  const { ToastProvider } = await import('../src/components/ui/toast');

  const page = (user: AuthUser) => (
    <ToastProvider>
      <MemoryRouter initialEntries={['/']}>
        <InboxCountsProvider isCurator={user.role === 'curator'}>
          <Routes>
            <Route path="/" element={<Dashboard user={user} />} />
            <Route path="*" element={<p>Elsewhere</p>} />
          </Routes>
          <LocationProbe />
        </InboxCountsProvider>
      </MemoryRouter>
    </ToastProvider>
  );

  // --- A curator's dashboard: one request per load; a card still loading shows a skeleton ---

  resetStub();
  const releaseStampStats = holdNext('stampStats');
  const app = await mount(page(CURATOR));
  const { container } = app;

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  assert(
    calledEndpoints() === exactly(CURATOR_ENDPOINTS),
    `the page makes one request per load plus the three inbox lists (got ${calledEndpoints()})`,
  );
  const byEndpoint = (endpoint: Endpoint) => calls.find((call) => call.endpoint === endpoint);
  assert(byEndpoint('pendingStreams')?.params.get('streamer') === 'mizuki', "the pending list is the current streamer's");
  assert(byEndpoint('stats')?.params.get('streamer') === 'mizuki', "the stats are the current streamer's");
  assert(byEndpoint('workMatches')?.params.get('pageSize') === '1', 'the duplicate candidates are read from a one-row page');

  const loadingCard = card(container, 'To stamp');
  assert(loadingCard.tagName === 'DIV', 'a card still loading is not a link yet');
  assert(
    (loadingCard.children[1]?.querySelector('[role="status"]') ?? null) !== null,
    'a card still loading shows a skeleton where its value goes',
  );
  assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the loading page uses no raw palette classes');

  await act(async () => {
    releaseStampStats();
  });
  await settle();

  // The header.
  const header = pageHeader(container);
  assert(textOf(header.querySelector('h1')) === 'Dashboard', 'the header is titled Dashboard');
  assert(textOf(header).includes('Overview · mizuki'), 'the crumb names the overview and the streamer');
  assert(textOf(header).includes('Updated just now'), 'the header says when the page was loaded: Updated just now');
  assert(buttonNamed(header, 'Refresh') !== undefined, 'the header offers Refresh');

  // The cards, in order, with their values and links.
  const cards = attentionCards(container);
  assert(cards.length === 5, `a curator sees five cards (got ${cards.length})`);
  assert(
    ['To stamp', 'Streams to review', 'Inbox', 'Duplicate candidates', 'VOD export'].every((title, index) => {
      const cardNode = cards[index];
      return cardNode !== undefined && hasTitle(cardNode, title);
    }),
    'the cards run To stamp, Streams to review, Inbox, Duplicate candidates, VOD export',
  );

  const toStamp = card(container, 'To stamp');
  assert(toStamp.tagName === 'A' && toStamp.getAttribute('href') === '/stamp', 'To stamp links to the Stamp Editor');
  assert(valueOf(toStamp) === '16 songs', `To stamp shows the songs left to stamp (got "${valueOf(toStamp)}")`);
  const stampSub = `6 streams · ${(5366).toLocaleString()} / ${(5382).toLocaleString()} done`;
  assert(subOf(toStamp) === stampSub, `To stamp's sub-line counts the streams with work and the songs done (got "${subOf(toStamp)}")`);

  const toReview = card(container, 'Streams to review');
  assert(
    toReview.tagName === 'A' && toReview.getAttribute('href') === '/streams?status=pending',
    'Streams to review links to the pending streams',
  );
  assert(valueOf(toReview) === '198 pending', `Streams to review counts the pending streams (got "${valueOf(toReview)}")`);
  assert(subOf(toReview) === 'Oldest from 2024-11-02', `Streams to review names the oldest (got "${subOf(toReview)}")`);
  const reviewTitles = [...toReview.querySelectorAll('span')].filter((span) => span.children.length === 0);
  assert(
    reviewTitles.some((span) => textOf(span) === 'Streams to review' && span.className === 'max-sm:hidden') &&
      reviewTitles.some((span) => textOf(span) === 'To review' && span.className === 'sm:hidden'),
    'below 640 px Streams to review is titled To review',
  );

  const inboxCard = card(container, 'Inbox');
  assert(inboxCard.tagName === 'DIV', 'the Inbox card is not a link itself: its chips are');
  assert(valueOf(inboxCard) === '5 waiting', `the Inbox card sums the three inboxes (got "${valueOf(inboxCard)}")`);
  const chips = [...inboxCard.querySelectorAll<HTMLAnchorElement>('a')].map(
    (chip) => `${chip.getAttribute('href')}=${textOf(chip)}`,
  );
  assert(
    chips.join('|') === '/nova=Nova 2|/nova/vods=VODs 1|/crystal=Crystal 2',
    `the Inbox chips link to each inbox with its count (got ${chips.join('|')})`,
  );

  const duplicates = card(container, 'Duplicate candidates');
  assert(
    duplicates.tagName === 'A' && duplicates.getAttribute('href') === '/works/review',
    'Duplicate candidates links to Work Review',
  );
  assert(valueOf(duplicates) === '12 open', `Duplicate candidates counts the open candidates (got "${valueOf(duplicates)}")`);
  assert(subOf(duplicates) === '3 marked “needs research”', `Duplicate candidates counts needs research (got "${subOf(duplicates)}")`);
  assert(hasTitle(duplicates, 'Duplicates'), 'below 640 px Duplicate candidates is titled Duplicates');

  const vodCard = card(container, 'VOD export');
  assert(vodCard.tagName === 'A' && vodCard.getAttribute('href') === '/vod-export', 'VOD export links to VOD Export');
  assert(valueOf(vodCard) === 'Unpublished changes', `VOD export says what is unpublished (got "${valueOf(vodCard)}")`);
  assert(
    subOf(vodCard) === `Last published ${formatWhen(PUBLISHED_AT, new Date())}`,
    `VOD export says when it was last published (got "${subOf(vodCard)}")`,
  );
  assert(retryButtons(container).length === 0, 'nothing failed, so nothing offers Retry');

  // The icon tiles: To stamp's is the accent gradient under a white icon and no other card's is;
  // Streams to review keeps its warn tint.
  const stampTile = tileClassesOf(toStamp);
  assert(
    ['border-transparent', 'bg-accent', 'text-white'].every((name) => stampTile.includes(name)),
    `To stamp's icon tile is the accent gradient under a white icon (got "${stampTile.join(' ')}")`,
  );
  assert(
    stampTile.includes('bg-origin-border'),
    `and the gradient spans the tile's border box, so its transparent border shows no hairline (got "${stampTile.join(' ')}")`,
  );
  assert(
    !stampTile.some((name) => name.includes('tone-')),
    `and the accent replaces its warn tint (got "${stampTile.join(' ')}")`,
  );
  assert(
    JSON.stringify(cards.map((cardNode) => tileClassesOf(cardNode).includes('bg-accent'))) ===
      JSON.stringify([true, false, false, false, false]),
    'To stamp is the only card with the accent tile',
  );
  const reviewTile = tileClassesOf(toReview);
  assert(
    ['border-tone-warn-line', 'bg-tone-warn-bg', 'text-tone-warn-fg'].every((name) => reviewTile.includes(name)),
    `Streams to review keeps its warn tile (got "${reviewTile.join(' ')}")`,
  );

  // A sub-line cut short (five cards at 1280 px) keeps its whole text in `title`. To stamp's keeps
  // each count whole, so a phone breaks it between them and never leaves "done" alone on a line.
  const subLineOf = (cardNode: HTMLElement) => cardNode.children[2] as HTMLElement | undefined;
  for (const cardNode of [toStamp, toReview, duplicates, vodCard]) {
    assert(
      subLineOf(cardNode)?.getAttribute('title') === subOf(cardNode),
      `a sub-line's title is its full text (got "${subLineOf(cardNode)?.getAttribute('title')}")`,
    );
  }
  const stampParts = [...(subLineOf(toStamp)?.querySelectorAll('span') ?? [])]
    .filter((part) => part.className.split(' ').includes('whitespace-nowrap'))
    .map((part) => textOf(part));
  assert(
    stampParts.join('|') === `6 streams|${(5366).toLocaleString()} / ${(5382).toLocaleString()} done`,
    `To stamp's counts each stay on one line (got ${stampParts.join('|')})`,
  );

  // The catalog.
  const catalog = sectionOf(container, 'Catalog');
  assert(textOf(catalog).includes('mizuki'), 'the catalog names the streamer');
  assert(textOf(catalog.querySelector('a[href="/songs"]')) === 'Songs', 'the catalog links to Songs');
  assert(textOf(catalog.querySelector('a[href="/streams"]')) === 'Streams', 'the catalog links to Streams');
  const bars = [...catalog.querySelectorAll('[role="img"]')];
  const barLabels = bars.map((bar) => bar.getAttribute('aria-label'));
  const n = (value: number) => value.toLocaleString();
  const expectedLabels = [
    `Songs: ${n(2398)} total — ${n(2390)} approved, 8 pending`,
    'Streams: 501 total — 303 approved, 198 pending',
    `Performances: ${n(5382)} total — ${n(5300)} approved, 20 pending, 10 rejected, 50 excluded, 2 extracted`,
  ];
  assert(
    JSON.stringify(barLabels) === JSON.stringify(expectedLabels),
    `each catalog bar is an image named by its parts (got ${JSON.stringify(barLabels)})`,
  );
  const songsBar = bars[0];
  assert(songsBar !== undefined, 'the catalog has a Songs bar');
  const songParts = [...songsBar.querySelectorAll<HTMLElement>('[title]')].map(
    (part) => `${part.getAttribute('title')}|${part.style.width}|${part.className.includes('bg-chart-ok') || part.className.includes('bg-chart-warn')}`,
  );
  assert(
    songParts.join(',') === `Approved: ${n(2390)}|99.67%|true,Pending: 8|0.33%|true`,
    `each part of a bar is a chart fill as wide as its share, titled with its count (got ${songParts.join(',')})`,
  );
  const performanceFills = [...(bars[2]?.querySelectorAll<HTMLElement>('[title]') ?? [])].map((part) =>
    ['ok', 'warn', 'danger', 'neutral', 'teal'].find((tone) => part.className.includes(`bg-chart-${tone}`)),
  );
  assert(
    performanceFills.join(',') === 'ok,warn,danger,neutral,teal',
    `the five statuses fill in their tones (got ${performanceFills.join(',')})`,
  );
  const legend = [...catalog.querySelectorAll('li')].map((item) => textOf(item));
  assert(
    legend.join(',') === 'Approved,Pending,Rejected,Excluded,Extracted',
    `the legend lists the five statuses (got ${legend.join(',')})`,
  );
  // The legend's dots fill like the bars, in the same order; nothing in either takes a tone's text
  // colour, which would compete with the chart fill for the same background.
  const legendDots = [...catalog.querySelectorAll('li > span')].map((dot) =>
    dot.className.split(' ').find((name) => name.startsWith('bg-')),
  );
  assert(
    legendDots.join(',') === 'bg-chart-ok,bg-chart-warn,bg-chart-danger,bg-chart-neutral,bg-chart-teal',
    `each legend dot is its status's chart fill (got ${legendDots.join(',')})`,
  );
  const fills = [...catalog.querySelectorAll<HTMLElement>('[role="img"] [title], li > span')];
  assert(fills.length === 14, `the catalog has nine bar parts and five legend dots (got ${fills.length})`);
  assert(
    fills.every((fill) => !fill.className.includes('bg-tone-')),
    'no bar part or legend dot fills with a tone colour',
  );

  // Continue stamping.
  const stamping = sectionOf(container, 'Continue stamping');
  assert(textOf(stamping.querySelector('a[href="/stamp"]')) === 'Stamp Editor', 'Continue stamping links to the Stamp Editor');
  const stampingRows = [...stamping.querySelectorAll<HTMLAnchorElement>('li a')];
  assert(
    stampingRows.map((row) => row.getAttribute('href')).join(',') ===
      '/stamp?stream=st-trip,/stamp?stream=st-another,/stamp?stream=st-back,/stamp?stream=st-white',
    'Continue stamping opens the four newest streams with work in the Stamp Editor',
  );
  assert(
    stampingRows.map((row) => textOf(row).endsWith(' left') && textOf(row).match(/(\d+) left$/)?.[1]).join(',') ===
      '7,2,5,3',
    'each row says how many songs are left',
  );
  const longRow = stampingRows[0];
  assert(longRow !== undefined, 'the long-titled stream is listed');
  const longTitle = longRow.querySelector<HTMLElement>('span[title]');
  assert(
    longTitle !== null && longTitle.getAttribute('title') === LONG_TITLE && textOf(longTitle) === LONG_TITLE,
    'a 120-character title keeps its full text in title, and the whole text in the markup',
  );
  assert(longTitle.className.includes('truncate'), 'CSS cuts the long title, not the markup');
  const dateTexts = [...(longRow.firstElementChild?.children ?? [])].map((part) => `${textOf(part)}:${part.className}`);
  assert(
    dateTexts.join('|') === '2026-04-02:max-sm:hidden|04-02:sm:hidden',
    `the date chip shortens to MM-DD below 640 px (got ${dateTexts.join('|')})`,
  );

  // Recent submissions.
  const recent = sectionOf(container, 'Recent submissions');
  assert(textOf(recent).includes('click a row to open it'), 'Recent submissions says a row opens its record');
  const recentRows = [...recent.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  assert(recentRows.length === 2, `Recent submissions lists every recent submission (got ${recentRows.length})`);
  const cellsOf = (row: HTMLTableRowElement | undefined) => [...(row?.querySelectorAll('td') ?? [])];
  const [songRow, streamRow] = recentRows;
  assert(
    songRow?.querySelector('a')?.getAttribute('href') === '/songs/song-1' && textOf(songRow.querySelector('a')) === SONG.title,
    'a song submission links to its song',
  );
  assert(
    streamRow?.querySelector('a')?.getAttribute('href') === '/streams/stream-1' &&
      textOf(streamRow.querySelector('a')) === RECENT_STREAM.title,
    'a stream submission links to its stream',
  );
  assert(
    cellsOf(songRow)[0]?.querySelector('svg')?.getAttribute('aria-hidden') === 'true',
    'the type icon is decorative',
  );
  assert(
    cellsOf(songRow).slice(2).map((cell) => textOf(cell)).join('|') ===
      `Song|Approved|contributor@example.com|${formatWhen(SONG.createdAt, new Date())}`,
    `a song row: type, status, submitter, when (got ${cellsOf(songRow).slice(2).map((cell) => textOf(cell)).join('|')})`,
  );
  assert(
    cellsOf(streamRow).slice(2).map((cell) => textOf(cell)).join('|') ===
      `Stream|Pending|—|${formatWhen(RECENT_STREAM.createdAt, new Date())}`,
    'a stream row: a missing submitter reads —',
  );
  const whenCell = cellsOf(songRow)[5];
  assert(
    whenCell?.querySelector('[title]')?.getAttribute('title') === formatFullTime(SONG.createdAt),
    'the full time of a submission is in its title',
  );

  assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the page uses no raw palette classes');
  assert(
    [...container.querySelectorAll('button')].every((button) => button.getAttribute('type') === 'button'),
    'every button has an explicit type',
  );

  // Refresh: every load once more, and the three inboxes.
  calls = [];
  await click(buttonNamed(header, 'Refresh'), 'Refresh');
  assert(
    calledEndpoints() === exactly(CURATOR_ENDPOINTS),
    `Refresh makes one new request per load plus the three inbox lists (got ${calledEndpoints()})`,
  );
  assert(textOf(pageHeader(container)).includes('Updated just now'), 'after Refresh the header says Updated just now');
  assert(card(container, 'To stamp').tagName === 'A', 'the cards are back after Refresh');

  // A row click opens the record; the title link opens it once, not twice.
  const typeCell = cellsOf(sectionOf(container, 'Recent submissions').querySelector<HTMLTableRowElement>('tbody tr') ?? undefined)[2];
  await click(typeCell, 'the Type cell of the song row');
  assert(locationOf(container) === '/songs/song-1', `a click anywhere on a row opens its record (at ${locationOf(container)})`);
  await click(container.querySelector<HTMLButtonElement>('#back'), 'Back');
  assert(locationOf(container) === '/', 'Back returns to the dashboard');
  const streamLink = sectionOf(container, 'Recent submissions').querySelector<HTMLAnchorElement>('a[href="/streams/stream-1"]');
  await click(streamLink, 'the stream title link');
  assert(locationOf(container) === '/streams/stream-1', 'the title link opens the stream');
  await click(container.querySelector<HTMLButtonElement>('#back'), 'Back');
  assert(locationOf(container) === '/', 'one Back returns to the dashboard: the link click navigated once');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await app.unmount();

  console.log('✓ Dashboard (curator): five cards with values and links, catalog bars, continue stamping, recent submissions, Refresh');

  // --- Review Focus 4: one endpoint failing degrades only its card, and Retry refetches only it ---

  resetStub({ vodStatus: FAILURE });
  const failing = await mount(page(CURATOR));
  const failedVod = card(failing.container, 'VOD export');
  assert(failedVod.tagName === 'DIV', 'a card that failed to load is not a link');
  assert(failedValueOf(failedVod) === '—', `a card that failed to load shows — (got "${failedValueOf(failedVod)}")`);
  assert(
    failedVod.children[1] !== undefined && retryButton(failedVod.children[1], 'Retry VOD export') !== null,
    'the failed card offers Retry VOD export beside its —',
  );
  assert(
    JSON.stringify(retryButtons(failing.container)) === JSON.stringify(['Retry VOD export']),
    `only the failed card offers Retry (got ${JSON.stringify(retryButtons(failing.container))})`,
  );
  for (const [title, href] of [
    ['To stamp', '/stamp'],
    ['Streams to review', '/streams?status=pending'],
    ['Duplicate candidates', '/works/review'],
  ] as const) {
    const other = card(failing.container, title);
    assert(other.tagName === 'A' && other.getAttribute('href') === href, `${title} still loads and links`);
  }
  assert(valueOf(card(failing.container, 'Inbox')) === '5 waiting', 'the Inbox card is unaffected');
  assert(!NO_RAW_PALETTE.test(failing.container.innerHTML), 'the failed card uses no raw palette classes');

  calls = [];
  replies.vodStatus = ok(VOD_STATUS);
  await click(retryButton(failedVod, 'Retry VOD export'), 'Retry VOD export');
  assert(
    calledEndpoints() === 'vodStatus',
    `Retry makes exactly one new request, to /api/vod-export/status only (got ${calledEndpoints()})`,
  );
  const retriedVod = card(failing.container, 'VOD export');
  assert(
    retriedVod.tagName === 'A' && valueOf(retriedVod) === 'Unpublished changes',
    'after Retry the VOD card loads and links',
  );
  assert(retryButtons(failing.container).length === 0, 'nothing offers Retry any more');

  // A Refresh that fails after a good load: the card says so rather than keep the old value.
  replies.vodStatus = FAILURE;
  await click(buttonNamed(pageHeader(failing.container), 'Refresh'), 'Refresh');
  const staleVod = card(failing.container, 'VOD export');
  assert(
    staleVod.tagName === 'DIV' && failedValueOf(staleVod) === '—' && retryButton(staleVod, 'Retry VOD export') !== null,
    'a failed reload turns the card into — + Retry instead of keeping the old status',
  );
  await failing.unmount();

  console.log('✓ Dashboard: a failing endpoint degrades only its card; Retry refetches only that endpoint');

  // --- A card over two loads retries its primary one, and its secondary one only when that failed
  // too; the sections over a failed load say so and retry it ---

  resetStub({ stats: FAILURE, stampStats: FAILURE, stampStreams: FAILURE });
  const broken = await mount(page(CURATOR));
  const brokenStamp = card(broken.container, 'To stamp');
  const brokenReview = card(broken.container, 'Streams to review');
  assert(
    failedValueOf(brokenStamp) === '—' && failedValueOf(brokenReview) === '—',
    'both cards over a failed primary load show —',
  );
  assert(
    brokenStamp.tagName === 'DIV' && brokenReview.tagName === 'DIV',
    'neither card over a failed primary load is a link',
  );
  const catalogText = textOf(sectionOf(broken.container, 'Catalog'));
  assert(catalogText.includes('Couldn’t load the catalog'), 'the catalog says it could not load');
  assert(
    textOf(sectionOf(broken.container, 'Continue stamping')).includes('Couldn’t load the streams to stamp'),
    'Continue stamping says it could not load',
  );
  assert(
    textOf(sectionOf(broken.container, 'Recent submissions')).includes('Couldn’t load recent submissions'),
    'Recent submissions says it could not load',
  );
  assert(
    JSON.stringify(retryButtons(broken.container).sort()) ===
      JSON.stringify(
        ['Retry Catalog', 'Retry Continue stamping', 'Retry Recent submissions', 'Retry Streams to review', 'Retry To stamp'].sort(),
      ),
    `each failed card and section offers its own Retry (got ${JSON.stringify(retryButtons(broken.container))})`,
  );
  assert(!NO_RAW_PALETTE.test(broken.container.innerHTML), 'the failure states use no raw palette classes');

  // To stamp: its streams failed too, so Retry asks for both.
  calls = [];
  replies.stampStats = ok(STAMP_STATS);
  replies.stampStreams = ok({ data: STAMP_STREAMS, total: STAMP_STREAMS.length });
  await click(retryButton(broken.container, 'Retry To stamp'), 'Retry To stamp');
  assert(
    calledEndpoints() === exactly(['stampStats', 'stampStreams']),
    `Retry To stamp reloads its stats and, since they failed too, its streams (got ${calledEndpoints()})`,
  );
  assert(subOf(card(broken.container, 'To stamp')) === stampSub, 'To stamp is whole again');

  // Streams to review: its pending list loaded, so Retry asks for the stats alone.
  calls = [];
  replies.stats = ok(STATS);
  await click(retryButton(broken.container, 'Retry Streams to review'), 'Retry Streams to review');
  assert(
    calledEndpoints() === 'stats',
    `Retry Streams to review reloads the stats only: its pending list did not fail (got ${calledEndpoints()})`,
  );
  assert(valueOf(card(broken.container, 'Streams to review')) === '198 pending', 'Streams to review is back');
  assert(
    sectionOf(broken.container, 'Catalog').querySelectorAll('[role="img"]').length === 3,
    'the catalog, over the same stats, is back too',
  );
  assert(retryButtons(broken.container).length === 0, 'nothing offers Retry any more');
  await broken.unmount();

  // Only the streams failing: To stamp still links, without the streams part of its sub-line.
  resetStub({ stampStreams: FAILURE });
  const partial = await mount(page(CURATOR));
  const partialStamp = card(partial.container, 'To stamp');
  assert(partialStamp.tagName === 'A', 'To stamp still links when only its streams failed');
  assert(
    subOf(partialStamp) === `${(5366).toLocaleString()} / ${(5382).toLocaleString()} done`,
    `without its streams, To stamp's sub-line counts the songs done alone (got "${subOf(partialStamp)}")`,
  );
  calls = [];
  replies.stampStreams = ok({ data: STAMP_STREAMS, total: STAMP_STREAMS.length });
  await click(retryButton(partial.container, 'Retry Continue stamping'), 'Retry Continue stamping');
  assert(calledEndpoints() === 'stampStreams', `Retry Continue stamping reloads the streams only (got ${calledEndpoints()})`);
  assert(subOf(card(partial.container, 'To stamp')) === stampSub, "To stamp's sub-line gets its streams part back");
  assert(
    sectionOf(partial.container, 'Continue stamping').querySelectorAll('li a').length === 4,
    'Continue stamping lists its streams',
  );

  // The streams failing on a Refresh after a good load: their part of the sub-line goes with them.
  replies.stampStreams = FAILURE;
  await click(buttonNamed(pageHeader(partial.container), 'Refresh'), 'Refresh');
  assert(
    subOf(card(partial.container, 'To stamp')) === `${(5366).toLocaleString()} / ${(5382).toLocaleString()} done`,
    "a failed reload of the streams drops their part of To stamp's sub-line rather than keep the old count",
  );
  assert(
    textOf(sectionOf(partial.container, 'Continue stamping')).includes('Couldn’t load the streams to stamp'),
    'and Continue stamping says it could not load',
  );
  await partial.unmount();

  console.log('✓ Dashboard: two-load cards retry what failed; failed sections say so and retry their load');

  // --- Nothing left: Continue stamping and Recent submissions say so ---

  resetStub({
    stampStats: ok({ total: 5382, filled: 5382, remaining: 0 } satisfies StampStats),
    stampStreams: ok({ data: [stampStream('st-done', '2026-04-10', 'All stamped', 0)], total: 1 }),
    stats: ok({ ...STATS, recentSubmissions: [] }),
    pendingStreams: ok({ data: [], total: 0 }),
  });
  const quiet = await mount(page(CURATOR));
  assert(textOf(sectionOf(quiet.container, 'Continue stamping')).includes('Nothing left to stamp'), 'no work left: Nothing left to stamp');
  assert(textOf(sectionOf(quiet.container, 'Recent submissions')).includes('No recent submissions.'), 'no submissions: No recent submissions.');
  assert(subOf(card(quiet.container, 'Streams to review')) === 'Nothing waiting', 'no pending stream: Nothing waiting');
  // Nothing is still a plural: 0 songs, 0 streams.
  const quietStamp = card(quiet.container, 'To stamp');
  assert(valueOf(quietStamp) === '0 songs', `none left reads 0 songs (got "${valueOf(quietStamp)}")`);
  assert(
    subOf(quietStamp) === `0 streams · ${(5382).toLocaleString()} / ${(5382).toLocaleString()} done`,
    `no stream with work reads 0 streams (got "${subOf(quietStamp)}")`,
  );
  await quiet.unmount();

  // One of each reads in the singular: 1 song, 1 stream.
  resetStub({
    stampStats: ok({ total: 10, filled: 9, remaining: 1 } satisfies StampStats),
    stampStreams: ok({ data: [stampStream('st-one', '2026-04-02', 'Only one', 1), stampStream('st-done', '2026-04-10', 'All stamped', 0)], total: 2 }),
  });
  const single = await mount(page(CURATOR));
  const singleStamp = card(single.container, 'To stamp');
  assert(valueOf(singleStamp) === '1 song', `one song left reads 1 song (got "${valueOf(singleStamp)}")`);
  assert(subOf(singleStamp) === '1 stream · 9 / 10 done', `one stream with work reads 1 stream (got "${subOf(singleStamp)}")`);
  await single.unmount();

  console.log('✓ Dashboard: nothing to stamp, nothing submitted, nothing waiting; 1 song and 1 stream in the singular');

  // --- The pending list failing alone: Streams to review says so, and its Retry reloads that list only ---

  resetStub({ pendingStreams: FAILURE });
  const pendingDown = await mount(page(CURATOR));
  const reviewDown = card(pendingDown.container, 'Streams to review');
  assert(
    reviewDown.tagName === 'DIV' && failedValueOf(reviewDown) === '—' && retryButton(reviewDown, 'Retry Streams to review') !== null,
    'with its pending list failed, Streams to review shows — and offers Retry',
  );
  calls = [];
  replies.pendingStreams = ok({ data: PENDING_STREAMS, total: PENDING_STREAMS.length } satisfies ListResponse<Stream>);
  await click(retryButton(reviewDown, 'Retry Streams to review'), 'Retry Streams to review');
  assert(calledEndpoints() === 'pendingStreams', `Retry reloads the pending list only (got ${calledEndpoints()})`);
  const reviewUp = card(pendingDown.container, 'Streams to review');
  assert(
    reviewUp.tagName === 'A' && valueOf(reviewUp) === '198 pending' && subOf(reviewUp) === 'Oldest from 2024-11-02',
    'once it loads, the card is whole again',
  );
  await pendingDown.unmount();

  console.log('✓ Dashboard: the pending list failing alone fails Streams to review, whose Retry reloads that list only');

  // --- A Retry in flight: the failed card keeps — and its Retry (busy, focused), never the value it
  // had before it failed; then the card's link takes the focus, or Retry keeps it on a new failure ---

  resetStub();
  const retrying = await mount(page(CURATOR));
  const rc = retrying.container;
  replies.vodStatus = FAILURE;
  await click(buttonNamed(pageHeader(rc), 'Refresh'), 'Refresh');
  const vodDown = card(rc, 'VOD export');
  const vodRetry = retryButton(vodDown, 'Retry VOD export');
  assert(vodDown.tagName === 'DIV' && vodRetry !== null, 'a reload that fails after a good load shows — and Retry');

  replies.vodStatus = ok({ ...VOD_STATUS, changesNotPublished: false });
  const releaseVod = holdNext('vodStatus');
  await act(async () => {
    vodRetry.focus();
  });
  await click(vodRetry, 'Retry VOD export');
  const vodHeld = card(rc, 'VOD export');
  assert(vodHeld.tagName === 'DIV', 'while the retried load runs, the card is no link');
  assert(
    failedValueOf(vodHeld) === '—' && !textOf(vodHeld).includes('Unpublished changes'),
    `and shows — rather than the status it had before it failed (got "${textOf(vodHeld)}")`,
  );
  assert(vodRetry.isConnected && vodHeld.contains(vodRetry), 'Retry stays in the card');
  assert(vodRetry.getAttribute('aria-disabled') === 'true', 'busy');
  assert(document.activeElement === vodRetry, 'and keeps the focus');
  calls = [];
  await click(vodRetry, 'the busy Retry');
  assert(calls.length === 0, `a click on the busy Retry sends nothing (got ${calledEndpoints()})`);
  await act(async () => {
    releaseVod();
  });
  await settle();
  const vodUp = card(rc, 'VOD export');
  assert(
    vodUp.tagName === 'A' && valueOf(vodUp) === 'Up to date',
    `the retried load lands: the card links, with the new status (got "${valueOf(vodUp)}")`,
  );
  assert(document.activeElement === vodUp, 'and the focus moves from Retry to the card');

  // A retry that fails again: Retry is back to itself, and keeps the focus.
  replies.vodStatus = FAILURE;
  await click(buttonNamed(pageHeader(rc), 'Refresh'), 'Refresh');
  const vodRetryAgain = retryButton(card(rc, 'VOD export'), 'Retry VOD export');
  assert(vodRetryAgain !== null, 'the card failed again');
  const releaseFailure = holdNext('vodStatus');
  await act(async () => {
    vodRetryAgain.focus();
  });
  await click(vodRetryAgain, 'Retry VOD export');
  await act(async () => {
    releaseFailure();
  });
  await settle();
  assert(
    card(rc, 'VOD export').tagName === 'DIV' && failedValueOf(card(rc, 'VOD export')) === '—',
    'a retried load that fails leaves the card failed',
  );
  assert(
    vodRetryAgain.isConnected && vodRetryAgain.getAttribute('aria-disabled') === null && document.activeElement === vodRetryAgain,
    'with its Retry ready again, and still focused',
  );
  await retrying.unmount();

  // A section: its Retry stays, busy and focused, while the load runs; then the section's first
  // link takes the focus.
  resetStub({ stats: FAILURE });
  const sectionDown = await mount(page(CURATOR));
  const catalogRetry = retryButton(sectionOf(sectionDown.container, 'Catalog'), 'Retry Catalog');
  assert(catalogRetry !== null, 'the failed catalog offers Retry');
  replies.stats = ok(STATS);
  const releaseStats = holdNext('stats');
  await act(async () => {
    catalogRetry.focus();
  });
  await click(catalogRetry, 'Retry Catalog');
  const catalogHeld = sectionOf(sectionDown.container, 'Catalog');
  assert(catalogHeld.querySelectorAll('[role="img"]').length === 0, 'while the retried load runs, the catalog shows no bars');
  assert(
    catalogRetry.isConnected && catalogHeld.contains(catalogRetry) && catalogRetry.getAttribute('aria-disabled') === 'true',
    'its Retry stays, busy',
  );
  assert(document.activeElement === catalogRetry, 'and keeps the focus');
  await act(async () => {
    releaseStats();
  });
  await settle();
  const catalogUp = sectionOf(sectionDown.container, 'Catalog');
  assert(catalogUp.querySelectorAll('[role="img"]').length === 3, 'the retried load lands: the bars are back');
  assert(
    document.activeElement === catalogUp.querySelector('a[href="/songs"]'),
    `and the focus moves to the section's first link (got ${document.activeElement?.outerHTML.slice(0, 80)})`,
  );
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await sectionDown.unmount();

  console.log('✓ Dashboard: a Retry in flight keeps — and its busy, focused Retry; success hands the focus on, failure keeps it');

  // --- Refresh of a card that is currently failed: no stale pre-failure value while it reruns, its
  // Retry stays in the DOM and busy, and Refresh itself — not the Retry focus handoff — keeps the
  // focus throughout ---

  resetStub();
  const refreshing = await mount(page(CURATOR));
  const rc2 = refreshing.container;
  const refreshButton = buttonNamed(pageHeader(rc2), 'Refresh');
  assert(refreshButton !== undefined, 'the header offers Refresh');

  // Fail the VOD export card first (a Refresh after a good load, as above).
  replies.vodStatus = FAILURE;
  await click(refreshButton, 'Refresh');
  const vodFailed = card(rc2, 'VOD export');
  assert(vodFailed.tagName === 'DIV' && failedValueOf(vodFailed) === '—', 'the card is down before the Refresh under test');
  // The busy Retry keeps this same element through error and retrying (AttentionCard), so it is
  // captured here, while its label still reads "Retry …", and reused below.
  const vodRetryBeforeRefresh = retryButton(vodFailed, 'Retry VOD export');
  assert(vodRetryBeforeRefresh !== null, 'the failed card offers Retry before the Refresh under test');

  // Refresh again: this one would succeed with a different value, held open.
  replies.vodStatus = ok({ ...VOD_STATUS, changesNotPublished: false });
  const releaseRefreshVod = holdNext('vodStatus');
  await act(async () => {
    refreshButton.focus();
  });
  await click(refreshButton, 'Refresh');
  const vodDuringRefresh = card(rc2, 'VOD export');
  assert(vodDuringRefresh.tagName === 'DIV', 'while the held Refresh runs, the previously-failed card is still no link');
  assert(
    failedValueOf(vodDuringRefresh) === '—' && !textOf(vodDuringRefresh).includes('Unpublished changes'),
    `and shows no stale pre-failure value (got "${textOf(vodDuringRefresh)}")`,
  );
  assert(
    vodRetryBeforeRefresh.isConnected &&
      vodDuringRefresh.contains(vodRetryBeforeRefresh) &&
      vodRetryBeforeRefresh.getAttribute('aria-disabled') === 'true',
    "its Retry is still in the DOM, busy, while Refresh's reload runs",
  );
  assert(document.activeElement === refreshButton, 'focus stays on Refresh, not the busy Retry');

  await act(async () => {
    releaseRefreshVod();
  });
  await settle();
  const vodAfterRefresh = card(rc2, 'VOD export');
  assert(
    vodAfterRefresh.tagName === 'A' && valueOf(vodAfterRefresh) === 'Up to date',
    `once the held request lands, the card is a link with the new value (got "${valueOf(vodAfterRefresh)}")`,
  );
  assert(document.activeElement === refreshButton, 'and focus is still on Refresh');
  await refreshing.unmount();

  console.log('✓ Dashboard: Refresh of a currently-failed card shows no stale value while it reruns, and keeps its own focus');

  // --- The Inbox card over the shell's three inbox lists: loading while a count is still owed and
  // failed while a list failed — never a partial total — with a Retry of the failed lists alone
  // that follows the page's retry rules; its chips show every known count throughout ---

  // One list still loading: a skeleton, no partial total, and the chips show what is known.
  resetStub();
  const releaseCrystal = holdNext('crystal');
  const inboxLoading = await mount(page(CURATOR));
  const loadingInbox = card(inboxLoading.container, 'Inbox');
  assert(
    (loadingInbox.children[1]?.querySelector('[role="status"]') ?? null) !== null && !textOf(loadingInbox).includes('waiting'),
    `while one inbox is still loading, the card shows a skeleton and no partial total (got "${textOf(loadingInbox)}")`,
  );
  assert(
    inboxChips(inboxLoading.container) === '/nova=Nova 2|/nova/vods=VODs 1|/crystal=Crystal —',
    `the chips show the counts known so far, — for the one still owed (got ${inboxChips(inboxLoading.container)})`,
  );
  await act(async () => {
    releaseCrystal();
  });
  await settle();
  assert(valueOf(card(inboxLoading.container, 'Inbox')) === '5 waiting', 'once all three are in, the card totals them');
  await inboxLoading.unmount();

  // One list failing: the card fails, with its own Retry and no total; the chips keep what is known.
  resetStub({ vods: FAILURE });
  const inboxDown = await mount(page(CURATOR));
  const downInbox = card(inboxDown.container, 'Inbox');
  assert(
    failedValueOf(downInbox) === '—' && !textOf(downInbox).includes('waiting'),
    `a failed inbox fails the card: — and no total (got "${textOf(downInbox)}")`,
  );
  assert(
    JSON.stringify(retryButtons(inboxDown.container)) === JSON.stringify(['Retry Inbox']),
    `the Inbox card offers Retry Inbox, and nothing else does (got ${JSON.stringify(retryButtons(inboxDown.container))})`,
  );
  assert(
    inboxChips(inboxDown.container) === '/nova=Nova 2|/nova/vods=VODs —|/crystal=Crystal 2',
    `the chips keep the counts they know (got ${inboxChips(inboxDown.container)})`,
  );
  calls = [];
  replies.vods = ok(inboxList(1, 0));
  await click(retryButton(downInbox, 'Retry Inbox'), 'Retry Inbox');
  assert(calledEndpoints() === 'vods', `Retry Inbox reloads the failed list only (got ${calledEndpoints()})`);
  assert(valueOf(card(inboxDown.container, 'Inbox')) === '5 waiting', 'the list loads again, and the card totals all three');
  await inboxDown.unmount();

  // A Retry in flight after a failed Refresh: no stale count while it runs — neither the total nor
  // the chip — and its Retry stays, busy and focused; on landing the first chip takes the focus.
  resetStub();
  const inboxRetrying = await mount(page(CURATOR));
  const ir = inboxRetrying.container;
  replies.vods = FAILURE;
  await click(buttonNamed(pageHeader(ir), 'Refresh'), 'Refresh');
  const inboxRetry = retryButton(card(ir, 'Inbox'), 'Retry Inbox');
  assert(inboxRetry !== null, 'a Refresh that fails one inbox after a good load fails the card, with Retry');
  replies.vods = ok(inboxList(3, 0));
  const releaseVods = holdNext('vods');
  await act(async () => {
    inboxRetry.focus();
  });
  await click(inboxRetry, 'Retry Inbox');
  const heldInbox = card(ir, 'Inbox');
  assert(
    failedValueOf(heldInbox) === '—' && !textOf(heldInbox).includes('waiting'),
    `while the retried list loads, the card shows — and no total (got "${textOf(heldInbox)}")`,
  );
  assert(
    inboxChips(ir) === '/nova=Nova 2|/nova/vods=VODs —|/crystal=Crystal 2',
    `nor its chip the count it had before it failed (got ${inboxChips(ir)})`,
  );
  assert(
    inboxRetry.isConnected && heldInbox.contains(inboxRetry) && inboxRetry.getAttribute('aria-disabled') === 'true',
    'its Retry stays, busy',
  );
  assert(document.activeElement === inboxRetry, 'and keeps the focus');
  calls = [];
  await click(inboxRetry, 'the busy Retry Inbox');
  assert(calls.length === 0, `a click on the busy Retry sends nothing (got ${calledEndpoints()})`);
  await act(async () => {
    releaseVods();
  });
  await settle();
  assert(valueOf(card(ir, 'Inbox')) === '7 waiting', `the retried list lands: the card totals all three (got "${valueOf(card(ir, 'Inbox'))}")`);
  assert(inboxChips(ir) === '/nova=Nova 2|/nova/vods=VODs 3|/crystal=Crystal 2', 'with the new count on its chip');
  assert(
    document.activeElement === card(ir, 'Inbox').querySelector('a[href="/nova"]'),
    `and the focus moves from Retry to the card's first chip (got ${document.activeElement?.outerHTML.slice(0, 80)})`,
  );

  // A retry that fails again: Retry is back to itself, and keeps the focus.
  replies.vods = FAILURE;
  await click(buttonNamed(pageHeader(ir), 'Refresh'), 'Refresh');
  const inboxRetryAgain = retryButton(card(ir, 'Inbox'), 'Retry Inbox');
  assert(inboxRetryAgain !== null, 'the card failed again');
  const releaseVodsFailure = holdNext('vods');
  await act(async () => {
    inboxRetryAgain.focus();
  });
  await click(inboxRetryAgain, 'Retry Inbox');
  await act(async () => {
    releaseVodsFailure();
  });
  await settle();
  assert(failedValueOf(card(ir, 'Inbox')) === '—', 'a retried list that fails leaves the card failed');
  assert(
    inboxRetryAgain.isConnected && inboxRetryAgain.getAttribute('aria-disabled') === null && document.activeElement === inboxRetryAgain,
    'with its Retry ready again, and still focused',
  );

  // A Refresh while the card is failed: the same treatment, and the focus stays on Refresh.
  const inboxRefresh = buttonNamed(pageHeader(ir), 'Refresh');
  assert(inboxRefresh !== undefined, 'the header offers Refresh');
  replies.vods = ok(inboxList(4, 0));
  const releaseRefreshVods = holdNext('vods');
  await act(async () => {
    inboxRefresh.focus();
  });
  await click(inboxRefresh, 'Refresh');
  const refreshingInbox = card(ir, 'Inbox');
  assert(
    failedValueOf(refreshingInbox) === '—' && !textOf(refreshingInbox).includes('waiting') && inboxChips(ir).includes('VODs —'),
    `while Refresh reloads the failed list, the card shows no stale count (got "${textOf(refreshingInbox)}")`,
  );
  assert(
    inboxRetryAgain.isConnected && refreshingInbox.contains(inboxRetryAgain) && inboxRetryAgain.getAttribute('aria-disabled') === 'true',
    "its Retry stays, busy, while Refresh's reload runs",
  );
  assert(document.activeElement === inboxRefresh, 'focus stays on Refresh');
  await act(async () => {
    releaseRefreshVods();
  });
  await settle();
  assert(valueOf(card(ir, 'Inbox')) === '8 waiting', `once it lands, the card totals all three (got "${valueOf(card(ir, 'Inbox'))}")`);
  assert(document.activeElement === inboxRefresh, 'and the focus is still on Refresh');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await inboxRetrying.unmount();

  console.log('✓ Dashboard: the Inbox card loads and fails with its three lists — never a partial total — and its Retry follows the page’s rules');

  // --- A contributor: no curator-only request, and no curator-only card ---

  resetStub();
  const contributor = await mount(page(CONTRIBUTOR));
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  assert(
    calledEndpoints() === exactly(CONTRIBUTOR_ENDPOINTS),
    `a contributor's page and shell never ask for /api/work-matches, /api/vod-export/status or the three inbox lists (got ${calledEndpoints()})`,
  );
  // The worker serves the three inbox lists to curators alone, and the shell loads them for curators
  // only: a contributor gets To stamp and Streams to review, and nothing else.
  const contributorCards = attentionCards(contributor.container);
  assert(contributorCards.length === 2, `a contributor sees two cards (got ${contributorCards.length})`);
  assert(
    ['To stamp', 'Streams to review'].every((title, index) => {
      const cardNode = contributorCards[index];
      return cardNode !== undefined && hasTitle(cardNode, title);
    }),
    "a contributor's two cards are To stamp and Streams to review",
  );
  assert(
    findCard(contributor.container, 'Inbox') === undefined
      && findCard(contributor.container, 'Duplicate candidates') === undefined
      && findCard(contributor.container, 'VOD export') === undefined,
    'no curator-only card renders for a contributor: Inbox, Duplicate candidates, VOD export',
  );
  const gridClasses = (sectionOf(contributor.container, 'Needs attention').querySelector('ul')?.className ?? '').split(' ');
  assert(
    gridClasses.includes('grid-cols-2') && !gridClasses.some((name) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(name)),
    `a contributor's two cards share one row at every width, with no empty third column (got "${gridClasses.join(' ')}")`,
  );
  calls = [];
  await click(buttonNamed(pageHeader(contributor.container), 'Refresh'), 'Refresh');
  assert(
    calledEndpoints() === exactly(CONTRIBUTOR_ENDPOINTS),
    `a contributor's Refresh still asks for none of them (got ${calledEndpoints()})`,
  );
  assert(!NO_RAW_PALETTE.test(contributor.container.innerHTML), "a contributor's page uses no raw palette classes");
  await contributor.unmount();

  console.log('✓ Dashboard (contributor): no curator-only request and no curator-only card');
}

await main();
