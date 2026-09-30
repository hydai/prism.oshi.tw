import { act } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type {
  AuthUser,
  WorkMatchCandidate,
  WorkMatchCandidatesResponse,
  WorkMatchCandidateWork,
  WorkMatchStats,
} from '../../shared/types';
import type { WorkReviewState } from '../src/pages/work-review-state';
import { click, installDom, mount, press, settle, typeInto } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

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

const candidate: WorkMatchCandidate = {
  candidateKey: 'a'.repeat(64),
  fingerprint: 'b'.repeat(64),
  catalogRevision: 7,
  confidence: 'high',
  reasons: ['case_width_whitespace'],
  works: [
    {
      id: 'work-canonical',
      title: 'I Love You 3000',
      originalArtist: 'Stephanie Poetri',
      tags: ['pop'],
      streamerCount: 2,
      songCount: 2,
      performanceCount: 8,
      approvedSongCount: 2,
      pendingSongCount: 0,
      streamerIds: ['alice', 'bob'],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    },
    {
      id: 'work-source',
      title: 'I love you 3000',
      originalArtist: 'Stephanie Poetri',
      tags: ['english'],
      streamerCount: 1,
      songCount: 1,
      performanceCount: 2,
      approvedSongCount: 1,
      pendingSongCount: 0,
      streamerIds: ['alice'],
      createdAt: '2026-01-03',
      updatedAt: '2026-01-04',
    },
  ],
  suggestedCanonicalWorkId: 'work-canonical',
  streamerCount: 2,
  songCount: 3,
  performanceCount: 10,
  localDuplicates: [{ streamerId: 'alice', songCount: 2 }],
  decision: null,
  reviewNote: '',
  reviewVersion: null,
  reviewedBy: null,
  reviewedAt: null,
};

/** The fixture under another key; the catalog revision tells a row on screen (7) from its re-read (8). */
function rowAt(candidateKey: string, catalogRevision = 7): WorkMatchCandidate {
  return { ...candidate, candidateKey, catalogRevision };
}

/** "a@7 b@8": each row's key and revision, in order, so a list reads as one string in a failure message. */
function keysAndRevisions(rows: readonly WorkMatchCandidate[]): string {
  return rows.map((row) => `${row.candidateKey}@${row.catalogRevision}`).join(' ');
}

// --- The live page: fixtures, a stubbed server whose replies the test can hold, DOM lookups ---

/** A work of a live candidate, with the fixture's artist and counts. */
function liveWork(id: string, title: string): WorkMatchCandidateWork {
  return { ...candidate.works[1]!, id, title };
}

/**
 * A live candidate `key`: the works "Song {KEY}" (`{key}-1`, suggested) and "song {key}" (`{key}-2`),
 * at catalog revision 7 with no review yet, so its list row reads "Song {KEY} and song {key}".
 */
function liveRow(key: string, overrides: Partial<WorkMatchCandidate> = {}): WorkMatchCandidate {
  return {
    ...candidate,
    candidateKey: key,
    fingerprint: `fp-${key}`,
    catalogRevision: 7,
    works: [liveWork(`${key}-1`, `Song ${key.toUpperCase()}`), liveWork(`${key}-2`, `song ${key}`)],
    suggestedCanonicalWorkId: `${key}-1`,
    localDuplicates: [],
    ...overrides,
  };
}

/** A list row's first line, as the list shows it for `liveRow(key)`. */
function titlesOf(key: string): string {
  return `Song ${key.toUpperCase()} and song ${key}`;
}

/** Distinct counts, so each filter option shows the stat it is fed from. */
const LIVE_STATS: WorkMatchStats = {
  candidateCount: 9,
  pendingCount: 5,
  needsResearchCount: 3,
  notDuplicateCount: 1,
  affectedWorks: 11,
};

interface Reply {
  status: number;
  body: unknown;
}

type Route = 'list' | 'review' | 'merge';

interface Call {
  route: Route;
  params: URLSearchParams;
  body: Record<string, unknown> | null;
}

function listReply(
  rows: WorkMatchCandidate[],
  options: { total?: number; totalPages?: number; page?: number; stats?: Partial<WorkMatchStats> } = {},
): Reply {
  const total = options.total ?? rows.length;
  const body: WorkMatchCandidatesResponse = {
    data: rows,
    total,
    page: options.page ?? 1,
    pageSize: 50,
    totalPages: options.totalPages ?? Math.ceil(total / 50),
    stats: { ...LIVE_STATS, ...options.stats },
  };
  return { status: 200, body };
}

const REVIEW_OK: Reply = { status: 200, body: { ok: true } };
const MERGE_OK: Reply = {
  status: 200,
  body: {
    ok: true,
    canonicalWorkId: 'kept',
    mergedWorks: 1,
    relinkedSongs: 1,
    preservedSongs: 3,
    preservedPerformances: 10,
  },
};

/**
 * The stubbed server: each request takes the next reply queued for its route, awaiting it when it is
 * a held one. `events` logs every request and every reply as it goes out, in order.
 */
const server = {
  calls: [] as Call[],
  events: [] as string[],
  unexpected: [] as string[],
  replies: { list: [], review: [], merge: [] } as Record<Route, Array<Reply | Promise<Reply>>>,
};

function resetServer(): void {
  server.calls = [];
  server.events = [];
  server.unexpected = [];
  server.replies = { list: [], review: [], merge: [] };
}

function routeOf(method: string, path: string): Route | null {
  if (method === 'GET' && path === '/api/work-matches') return 'list';
  if (method === 'POST' && path === '/api/work-matches/review') return 'review';
  if (method === 'POST' && path === '/api/work-matches/merge') return 'merge';
  return null;
}

/** "GET pending p1", "POST review a", "POST merge m1@7": what a request asked for, in one string. */
function eventOf(call: Call): string {
  if (call.route === 'list') return `GET ${call.params.get('filter')} p${call.params.get('page')}`;
  if (call.route === 'merge') return `POST merge ${String(call.body?.candidateKey)}@${String(call.body?.catalogRevision)}`;
  return `POST review ${String(call.body?.candidateKey)}`;
}

function installLiveServer(): void {
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
      const call: Call = {
        route,
        params: url.searchParams,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      server.calls.push(call);
      server.events.push(eventOf(call));
      const reply = await next;
      server.events.push(`replied: ${eventOf(call)}`);
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

function textOf(node: Element | null | undefined): string {
  return node?.textContent ?? '';
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => (button.getAttribute('aria-label') ?? textOf(button).trim()) === name,
  );
}

function filterButtons(container: HTMLElement): HTMLButtonElement[] {
  const group = container.querySelector('[role="group"][aria-label="Review filter"]');
  assert(group !== null, 'the header renders the Review filter');
  return [...group.querySelectorAll<HTMLButtonElement>('button')];
}

function filterButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = filterButtons(container).find((option) => textOf(option).startsWith(label));
  assert(button !== undefined, `the Review filter has a ${label} option`);
  return button;
}

function candidatesList(container: HTMLElement): HTMLUListElement {
  const list = container.querySelector<HTMLUListElement>('ul[aria-label="Candidates"]');
  assert(list !== null, 'the queue renders its candidate list');
  return list;
}

function rowButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...candidatesList(container).querySelectorAll<HTMLButtonElement>('li > button')];
}

function rowTitles(container: HTMLElement): string[] {
  return rowButtons(container).map((row) => textOf(row.children[0]));
}

function rowFor(container: HTMLElement, key: string): HTMLButtonElement {
  const row = rowButtons(container).find((button) => textOf(button.children[0]) === titlesOf(key));
  assert(row !== undefined, `the list has the row of ${key}`);
  return row;
}

/** The first line of the selected row, or '' when no row is selected. */
function selectedTitles(container: HTMLElement): string {
  return textOf(candidatesList(container).querySelector('button[aria-current="true"]')?.children[0]);
}

/** The pills on a list row, in order. */
function rowPills(row: HTMLButtonElement): HTMLElement[] {
  return [...(row.children[2]?.children ?? [])] as HTMLElement[];
}

/**
 * How a list row's content looks. `muted`: a row decided in this view — its titles and meta in the
 * muted text colour, every pill after the first (its decision pill, which keeps its own tone)
 * neutral. `live`: any other row — titles in the text colour, meta subtle, the High pill ok. Anything
 * else is `mixed`. Colours only: no opacity utility anywhere in the row's content, since opacity
 * would take its texts below their contrast.
 */
function rowLook(row: HTMLButtonElement): 'muted' | 'live' | 'mixed' {
  const [titles, meta] = [...row.children];
  const wears = (node: Element | undefined, utility: string) => node?.className.split(/\s+/).includes(utility) === true;
  const pills = rowPills(row);
  if (row.querySelector('[class*="opacity-"]') !== null) return 'mixed';
  if (
    wears(titles, 'text-fg-muted')
    && wears(meta, 'text-fg-muted')
    && pills.length > 1
    && pills.slice(1).every((pill) => wears(pill, 'bg-tone-neutral-bg'))
  ) {
    return 'muted';
  }
  const high = pills.find((pill) => textOf(pill) === 'High');
  if (wears(titles, 'text-fg') && wears(meta, 'text-fg-subtle') && wears(high, 'bg-tone-ok-bg')) return 'live';
  return 'mixed';
}

function listHeading(container: HTMLElement): HTMLElement {
  const heading = [...container.querySelectorAll<HTMLElement>('h2')].find((node) => textOf(node) === 'Candidates');
  assert(heading !== undefined, 'the queue titles its list Candidates');
  return heading;
}

/** The count beside the list title ("1–50 of 130"). */
function listCount(container: HTMLElement): string {
  return textOf(listHeading(container).nextElementSibling);
}

/** The queue's detail column: whatever it shows for the selection. */
function detailColumn(container: HTMLElement): HTMLElement {
  const column = listHeading(container).closest('.glass-card')?.nextElementSibling;
  assert(column instanceof HTMLElement, 'the queue renders its detail column');
  return column;
}

function toastText(container: HTMLElement): string {
  return textOf(container.querySelector('section[aria-label="Notifications"]'));
}

function alertWith(container: HTMLElement, text: string): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="alert"]')].find((node) => textOf(node).includes(text));
}

/**
 * Counts every `disabled` change on `button`. happy-dom reports no reliable `oldValue` for a removed
 * attribute, so the count (with the attribute read at a known moment) says what happened.
 */
function watchDisabled(button: HTMLButtonElement): { flips: () => number; stop: () => void } {
  const Observer = (window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
  let flips = 0;
  const observer = new Observer((records) => {
    flips += records.length;
  });
  observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  return {
    flips: () => {
      flips += observer.takeRecords().length;
      return flips;
    },
    stop: () => observer.disconnect(),
  };
}

const DECISION_ACTIONS = ['Review merge impact', 'Needs research', 'Not duplicate'];

/** The filter and the detail's decision buttons are all disabled (`busy`) or all enabled. */
function assertQueueControls(container: HTMLElement, busy: boolean, when: string): void {
  for (const option of filterButtons(container)) {
    assert(option.disabled === busy, `the ${textOf(option)} filter is ${busy ? 'disabled' : 'enabled'} ${when}`);
  }
  for (const name of DECISION_ACTIONS) {
    const button = buttonNamed(detailColumn(container), name);
    assert(button !== undefined, `the detail offers ${name} ${when}`);
    assert(button.disabled === busy, `${name} is ${busy ? 'disabled' : 'enabled'} ${when}`);
  }
}

async function main(): Promise<void> {
  installLocalStorage();
  installDom();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const listResponse: WorkMatchCandidatesResponse = {
    data: [candidate],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    stats: {
      candidateCount: 1,
      pendingCount: 1,
      notDuplicateCount: 0,
      needsResearchCount: 0,
      affectedWorks: 2,
    },
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const body = url.endsWith('/merge')
        ? {
            ok: true,
            canonicalWorkId: 'work-canonical',
            mergedWorks: 1,
            relinkedSongs: 1,
            preservedSongs: 3,
            preservedPerformances: 10,
          }
        : url.endsWith('/review')
          ? { ok: true }
          : listResponse;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const { api } = await import('../src/api/client');
  const { getNavGroups } = await import('../src/lib/navigation');
  const {
    default: GlobalWorkReview,
    MergeImpact,
  } = await import('../src/pages/GlobalWorkReview');
  const { default: WorkMatchCandidateCard } = await import(
    '../src/components/WorkMatchCandidateCard'
  );
  const {
    candidateReviewStateKey,
    decisionPill,
    mergeRefreshedCandidates,
    decisionsAfterRefresh,
    selectMergeSourceWorkIds,
  } = await import('../src/lib/global-work-review');
  const {
    candidateRangeLabel,
    initialWorkReviewState,
    isWorkReviewQueueBusy,
    workReviewReducer,
  } = await import('../src/pages/work-review-state');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');
  const { Icon } = await import('../src/components/ui/Icon');

  /** Static markup as a DOM tree, to read text the way the page shows it. */
  const parse = (html: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  };

  await api.listWorkMatches({ filter: 'pending', page: 2, pageSize: 20 });
  await api.reviewWorkMatch({
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    workIds: candidate.works.map((work) => work.id),
    decision: 'needs_research',
    expectedReviewVersion: candidate.reviewVersion,
    note: 'Verify official source',
  });
  await api.mergeWorkMatch({
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
    catalogRevision: candidate.catalogRevision,
    expectedReviewVersion: candidate.reviewVersion,
    canonicalWorkId: 'work-canonical',
    sourceWorkIds: ['work-source'],
    note: 'Verified official release credits',
  });

  assert(requests[0]?.url === '/api/work-matches?filter=pending&page=2&pageSize=20', 'scan API is site-wide and paginated');
  assert(!requests.some((request) => request.url.includes('streamer=')), 'work review never inherits the selected streamer');
  assert(requests[1]?.init?.method === 'POST', 'review decision uses an authenticated mutation request');
  const reviewBody = JSON.parse(String(requests[1]?.init?.body)) as Record<string, unknown>;
  assert(reviewBody.expectedReviewVersion === null, 'review payload binds the displayed decision version');
  assert(requests[2]?.init?.method === 'POST', 'global merge uses an authenticated mutation request');
  const mergeBody = JSON.parse(String(requests[2]?.init?.body)) as Record<string, unknown>;
  assert(mergeBody.catalogRevision === 7, 'merge payload binds the displayed catalog revision');
  assert(mergeBody.expectedReviewVersion === null, 'merge payload binds the displayed review version');
  assert(mergeBody.note === 'Verified official release credits', 'merge payload preserves the curator note');
  assert(mergeBody.canonicalWorkId === 'work-canonical', 'merge payload binds the reviewed canonical ID');
  assert(
    Array.isArray(mergeBody.sourceWorkIds) && mergeBody.sourceWorkIds[0] === 'work-source',
    'merge payload binds the reviewed source IDs',
  );

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getNavGroups(curator).flatMap((group) => group.items).some((item) => item.to === '/works/review'),
    'curators see the site-wide work review queue',
  );
  assert(
    !getNavGroups(contributor).flatMap((group) => group.items).some((item) => item.to === '/works/review'),
    'contributors cannot navigate to global work review',
  );

  // The page links to the Global Library with a router Link, so it renders inside a router.
  const pageHtml = renderToStaticMarkup(
    <MemoryRouter>
      <GlobalWorkReview />
    </MemoryRouter>,
  );
  assert(pageHtml.includes('Global Work Review'), 'review page renders its global heading');
  assert(pageHtml.includes('never merges automatically'), 'review page states its manual-only safety boundary');

  {
    // The first render is the page still scanning: the header, the info strip and the queue's frame
    // are already there, so the safety sentence never waits for the network.
    const page = parse(pageHtml);
    const header = page.querySelector('header');
    assert(header !== null, 'the page opens with its header');
    assert(textOf(header.querySelector('h1')) === 'Global Work Review', 'the header title is Global Work Review');
    assert(textOf(header).startsWith('LIBRARY'), 'the header crumb is LIBRARY');
    const filter = header.querySelector('[role="group"][aria-label="Review filter"]');
    assert(filter !== null, 'the Review filter sits in the header');
    const options = [...filter.querySelectorAll('button')];
    const labels = ['Pending', 'Needs research', 'Not duplicate', 'All'];
    assert(
      options.length === 4 && labels.every((label, index) => textOf(options[index]).startsWith(label)),
      `the Review filter offers ${labels.join(' / ')}, got ${options.map((option) => textOf(option)).join(' / ')}`,
    );
    assert(
      options.every((option) => option.getAttribute('type') === 'button'),
      'every filter option is an explicit type="button"',
    );
    const libraryLink = header.querySelector('a[href="/works"]');
    assert(textOf(libraryLink) === 'Global Library', 'the header links to the Global Library');
    assert(textOf(page).includes('affected work IDs'), 'the info strip counts the affected work IDs');
    assert(textOf(page).includes('Scanning global works...'), 'the first render is the page still scanning');
    assert(
      textOf(page).includes('Tier A finds formatting-only title and original-artist differences.'),
      'the info strip keeps the Tier A explanation while the page is still loading',
    );
    assert(!NO_RAW_PALETTE.test(pageHtml), 'the page uses no raw Tailwind palette classes');
  }

  const impactHtml = renderToStaticMarkup(
    <MergeImpact
      candidate={candidate}
      canonicalWorkId="work-canonical"
      sourceWorkIds={['work-source']}
    />,
  );
  assert(impactHtml.includes('Site-wide identity change'), 'confirmation states the global scope');
  assert(impactHtml.includes('performance IDs are preserved'), 'confirmation guarantees stable playback identities');
  assert(impactHtml.includes('No song or performance row is deleted'), 'confirmation states the non-destructive boundary');
  assert(impactHtml.includes('Canonical tags after merge: pop, english'), 'confirmation discloses the resulting tag union');
  assert(impactHtml.includes('Adds: english'), 'confirmation identifies tags added to the canonical work');
  // renderToString marks every boundary between two text nodes with <!-- -->: the tag union stays
  // one text run, so it reads as one sentence to anything that searches the page's text.
  assert(
    renderToString(
      <MergeImpact candidate={candidate} canonicalWorkId="work-canonical" sourceWorkIds={['work-source']} />,
    ).includes('Canonical tags after merge: pop, english.'),
    '"Canonical tags after merge: pop, english." is one text run',
  );
  assert(!NO_RAW_PALETTE.test(impactHtml), 'the merge impact uses no raw Tailwind palette classes');

  const cardProps = {
    candidate,
    selectedCanonicalWorkId: 'work-canonical',
    note: 'Verify official source',
    queueBusy: false,
    acting: false,
    isConfirming: false,
    onCanonicalChange: () => undefined,
    onNoteChange: () => undefined,
    onReviewMergeImpact: () => undefined,
    onCancelMerge: () => undefined,
    onConfirmMerge: () => undefined,
    onSaveDecision: () => undefined,
  };
  // Rendered in a router like the page, as the brief for the queue asks.
  const candidateHtml = renderToStaticMarkup(
    <MemoryRouter>
      <WorkMatchCandidateCard {...cardProps} />
    </MemoryRouter>,
  );
  assert(candidateHtml.includes('I Love You 3000'), 'candidate card renders the canonical work');
  assert(candidateHtml.includes('I love you 3000'), 'candidate card renders the possible duplicate');
  assert(candidateHtml.includes('Verify official source'), 'candidate card preserves the draft review note');
  assert(candidateHtml.includes('Review merge impact'), 'candidate card exposes the merge review action');
  assert(candidateHtml.includes('Local follow-up required'), 'candidate card discloses local duplicate follow-up');

  {
    const card = parse(candidateHtml);
    const text = textOf(card);
    assert(!NO_RAW_PALETTE.test(candidateHtml), 'the candidate card uses no raw Tailwind palette classes');
    assert(text.includes('High confidence') && text.includes('Pending review'), 'the card opens with its confidence and review pills');
    assert(text.includes('Case / width / whitespace'), 'the card shows a pill per reason');
    const key = card.querySelector(`[title="${candidate.candidateKey}"]`);
    assert(textOf(key) === candidate.candidateKey.slice(0, 12), 'the card shows the first 12 characters of the key, the full key in its title');
    assert(
      text.includes('2 work IDs · 3 local songs · 10 performances · 2 VTubers'),
      'the summary line counts work IDs, local songs, performances and VTubers',
    );
    assert(text.includes('Keep which work identity?'), 'the identity choice has its section label');
    assert(textOf(card.querySelector('legend')) === 'Choose the canonical global work', 'the identity radios keep their legend');
    assert(
      card.querySelector('legend')?.getAttribute('class')?.includes('sr-only') === true,
      'the legend stays for assistive tech only',
    );
    const radios = [...card.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    assert(radios.length === 2, 'one radio card per work');
    const chosen = radios.find((radio) => radio.value === 'work-canonical')?.closest('label');
    const other = radios.find((radio) => radio.value === 'work-source')?.closest('label');
    assert(
      chosen?.getAttribute('class')?.includes('bg-selected') === true
        && chosen.getAttribute('class')?.includes('border-hot-line') === true,
      'the chosen identity card wears the selected background and the hot border',
    );
    assert(
      other?.getAttribute('class')?.includes('bg-selected') === false
        && other.getAttribute('class')?.includes('border-hot-line') === false,
      'an identity card not chosen does not',
    );
    assert(textOf(chosen).includes('— Stephanie Poetri'), 'a radio card names the artist');
    assert(textOf(chosen).includes('Suggested by usage') && !textOf(other).includes('Suggested by usage'), 'only the suggested work says so');
    assert(textOf(chosen).includes('alice') && textOf(chosen).includes('bob'), 'a radio card lists its VTubers');
    // The counts close each radio card, one line each.
    const countLines = (label: Element | null | undefined) =>
      [...(label?.lastElementChild?.children ?? [])].map((line) => textOf(line));
    assert(
      countLines(chosen).includes('2 songs') && countLines(chosen).includes('8 performances'),
      `a radio card counts songs and performances, got ${countLines(chosen).join(' / ')}`,
    );
    assert(
      countLines(other).includes('1 song') && countLines(other).includes('2 performances'),
      `the counts are pluralised, got ${countLines(other).join(' / ')}`,
    );
    assert(
      text.includes('Local follow-up required after a global merge: alice (2). This action will not merge those local song rows.'),
      'the local follow-up note keeps its text',
    );
    assert(
      textOf(card.querySelector('label textarea')?.closest('label')).startsWith(
        'Review note (optional — saved with the decision or merge)',
      ),
      'the review note keeps its label',
    );
    assert(text.includes('then jumps to the next candidate'), 'the actions say where the queue goes next');
    for (const name of DECISION_ACTIONS) {
      const button = buttonNamed(card, name);
      assert(button?.getAttribute('type') === 'button', `${name} is an explicit type="button"`);
    }
  }

  {
    const withPending = parse(
      renderToStaticMarkup(
        <MemoryRouter>
          <WorkMatchCandidateCard
            {...cardProps}
            candidate={{ ...candidate, works: [{ ...candidate.works[0]!, pendingSongCount: 1 }, candidate.works[1]!] }}
          />
        </MemoryRouter>,
      ),
    );
    const pendingLine = [...withPending.querySelectorAll('span')].find((line) => textOf(line) === '1 pending');
    assert(pendingLine?.getAttribute('class')?.includes('text-tone-warn-fg') === true, 'a work with pending songs says so in amber');

    const batchHtml = renderToStaticMarkup(
      <MemoryRouter>
        <WorkMatchCandidateCard
          {...cardProps}
          candidate={{
            ...candidate,
            works: Array.from({ length: 53 }, (_, index) => ({ ...candidate.works[0]!, id: `work-${index}` })),
            suggestedCanonicalWorkId: 'work-0',
          }}
          selectedCanonicalWorkId="work-0"
        />
      </MemoryRouter>,
    );
    assert(
      textOf(parse(batchHtml)).includes(
        'This reviewed batch will retire 50 source work IDs; 2 will remain and reappear for another confirmed batch.',
      ),
      'an over-limit candidate explains its deferred batch',
    );
    assert(!NO_RAW_PALETTE.test(batchHtml), 'the deferred-batch note uses no raw Tailwind palette classes');

    const confirmingHtml = renderToStaticMarkup(
      <MemoryRouter>
        <WorkMatchCandidateCard {...cardProps} isConfirming />
      </MemoryRouter>,
    );
    const confirming = parse(confirmingHtml);
    assert(!NO_RAW_PALETTE.test(confirmingHtml), 'the merge confirmation uses no raw Tailwind palette classes');
    assert(textOf(confirming).includes('Site-wide identity change'), 'confirming shows the merge impact');
    assert(
      textOf(confirming).includes('Canonical: work-canonical') && textOf(confirming).includes('Retire: work-source'),
      'confirming names the surviving and the retired work IDs',
    );
    assert(buttonNamed(confirming, 'Confirm global work merge') !== undefined, 'confirming offers the merge');
    assert(buttonNamed(confirming, 'Cancel') !== undefined, 'confirming offers Cancel');
    assert(buttonNamed(confirming, 'Review merge impact') === undefined, 'confirming replaces the first step');
  }

  {
    // The list count is the slice of the filter the page covers by the server's numbers. Decided rows
    // kept on screen are not counted, so it stays sane however many of them there are.
    const RANGE_CASES: ReadonlyArray<{ name: string; page: number; total: number; expected: string }> = [
      { name: 'the first page of many', page: 1, total: 130, expected: '1–50 of 130' },
      { name: 'a middle page', page: 2, total: 130, expected: '51–100 of 130' },
      { name: 'a last page partly filled', page: 3, total: 130, expected: '101–130 of 130' },
      { name: 'a last page exactly filled', page: 2, total: 100, expected: '51–100 of 100' },
      { name: 'a single candidate', page: 1, total: 1, expected: '1–1 of 1' },
      { name: 'an empty filter', page: 1, total: 0, expected: '0 of 0' },
      { name: 'a page past the end once its rows were decided away', page: 3, total: 100, expected: '0 of 100' },
      { name: 'the first page once every candidate was decided away', page: 1, total: 0, expected: '0 of 0' },
    ];
    for (const { name, page, total, expected } of RANGE_CASES) {
      const actual = candidateRangeLabel(page, 50, total);
      assert(actual === expected, `candidateRangeLabel, ${name}: expected "${expected}", got "${actual}"`);
    }
  }

  {
    // One decision → pill map for the list rows and the detail: a decision saved on the server, a
    // merge made in this view, or none yet.
    const PILL_CASES: ReadonlyArray<[Parameters<typeof decisionPill>[0], string, string]> = [
      ['not_duplicate', 'Not duplicate', 'neutral'],
      ['needs_research', 'Needs research', 'warn'],
      ['merged', 'Merged', 'ok'],
      [null, 'Pending review', 'neutral'],
    ];
    for (const [decision, label, tone] of PILL_CASES) {
      const pill = decisionPill(decision);
      assert(
        pill.label === label && pill.tone === tone,
        `decisionPill(${String(decision)}) is a ${tone} "${label}" pill (got a ${pill.tone} "${pill.label}")`,
      );
    }
  }
  console.log('✓ work review page: header, filter, info strip while loading, restyled card and merge impact, list count rule, decision pills');

  const changedFingerprint = { ...candidate, fingerprint: 'c'.repeat(64) };
  assert(
    candidateReviewStateKey(candidate) !== candidateReviewStateKey(changedFingerprint),
    'review notes are isolated by candidate fingerprint',
  );
  const oversizedCandidate: WorkMatchCandidate = {
    ...candidate,
    works: Array.from({ length: 53 }, (_, index) => ({
      ...candidate.works[0]!,
      id: `work-${index}`,
    })),
  };
  const partialSources = selectMergeSourceWorkIds(oversizedCandidate, 'work-0');
  assert(partialSources.length === 50, 'over-limit candidates are split into server-safe batches');
  assert(!partialSources.includes('work-0'), 'partial merge sources exclude the canonical work');

  let reviewState = workReviewReducer(
    {
      ...initialWorkReviewState,
      candidates: [candidate],
      stats: listResponse.stats,
      total: 1,
      totalPages: 1,
      scanError: 'stale scan error',
    },
    { type: 'scanStarted' },
  );
  assert(reviewState.loading, 'starting a scan enables the loading state');
  assert(reviewState.candidates.length === 0, 'starting a scan clears stale candidates');
  assert(reviewState.total === 0 && reviewState.totalPages === 0, 'starting a scan resets pagination totals');
  assert(reviewState.scanError === null, 'starting a scan clears the previous scan error');

  reviewState = workReviewReducer(reviewState, {
    type: 'scanSucceeded',
    response: listResponse,
  });
  assert(reviewState.candidates[0]?.candidateKey === candidate.candidateKey, 'a scan stores its candidates');
  assert(reviewState.stats.candidateCount === 1, 'a scan stores aggregate queue statistics');
  assert(reviewState.total === 1 && reviewState.totalPages === 1, 'a scan stores pagination totals');

  // Action feedback is a toast now, so the state holds no message or action error to clear.
  reviewState = {
    ...reviewState,
    page: 1,
    totalPages: 3,
    confirmingCandidateKey: candidate.candidateKey,
  };
  reviewState = workReviewReducer(reviewState, { type: 'nextPageRequested' });
  reviewState = workReviewReducer(reviewState, { type: 'nextPageRequested' });
  assert(reviewState.page === 3, 'consecutive page actions use the latest reducer state');
  assert(reviewState.confirmingCandidateKey === null, 'changing pages closes merge confirmation');

  reviewState = workReviewReducer(
    {
      ...reviewState,
      page: 3,
      confirmingCandidateKey: candidate.candidateKey,
    },
    { type: 'filterChanged', filter: 'needs_research' },
  );
  assert(reviewState.filter === 'needs_research', 'changing the filter stores the selected queue');
  assert(reviewState.page === 1, 'changing the filter returns to the first page');
  assert(reviewState.confirmingCandidateKey === null, 'changing the filter closes merge confirmation');

  reviewState = workReviewReducer(reviewState, {
    type: 'actionStarted',
    candidateKey: candidate.candidateKey,
  });
  assert(reviewState.actionCandidateKey === candidate.candidateKey, 'an action marks its candidate as busy');
  reviewState = workReviewReducer(reviewState, { type: 'refreshRequested' });
  reviewState = workReviewReducer(reviewState, { type: 'actionFinished' });
  assert(reviewState.refreshVersion === 1, 'a failed action or a reload requests a fresh scan');
  assert(reviewState.actionCandidateKey === null, 'finishing an action releases the queue lock');

  console.log('✓ work review UI and state transitions preserve curator safeguards');

  // --- mergeRefreshedCandidates: the rows on screen absorb a silent re-read of the same page ---

  const MERGE_CASES: ReadonlyArray<{
    name: string;
    current: WorkMatchCandidate[];
    decided: string[];
    fresh: WorkMatchCandidate[];
    expected: string;
  }> = [
    {
      name: 'a row the re-read has is replaced by the fresh row',
      current: [rowAt('a'), rowAt('b')],
      decided: [],
      fresh: [rowAt('a', 8), rowAt('b', 8)],
      expected: 'a@8 b@8',
    },
    {
      name: 'the order on screen wins over the re-read order',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: [],
      fresh: [rowAt('c', 8), rowAt('a', 8), rowAt('b', 8)],
      expected: 'a@8 b@8 c@8',
    },
    {
      name: 'a decided row the re-read lacks stays as it was',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: ['b'],
      fresh: [rowAt('a', 8), rowAt('c', 8)],
      expected: 'a@8 b@7 c@8',
    },
    {
      name: 'a decided row the re-read still has takes the fresh version',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('a', 8), rowAt('b', 8)],
      expected: 'a@8 b@8',
    },
    {
      name: 'an undecided row the re-read lacks drops out',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: [],
      fresh: [rowAt('a', 8), rowAt('c', 8)],
      expected: 'a@8 c@8',
    },
    {
      name: 'rows only the re-read has append in its order',
      current: [rowAt('a')],
      decided: [],
      fresh: [rowAt('x', 8), rowAt('a', 8), rowAt('y', 8)],
      expected: 'a@8 x@8 y@8',
    },
    {
      name: 'replace, keep, drop and append together',
      current: [rowAt('a'), rowAt('b'), rowAt('c'), rowAt('d')],
      decided: ['b'],
      fresh: [rowAt('n', 8), rowAt('d', 8), rowAt('a', 8), rowAt('m', 8)],
      expected: 'a@8 b@7 d@8 n@8 m@8',
    },
    {
      name: 'an empty re-read leaves only the decided rows',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: ['a', 'c'],
      fresh: [],
      expected: 'a@7 c@7',
    },
    {
      name: 'an empty screen takes the whole re-read',
      current: [],
      decided: [],
      fresh: [rowAt('x', 8), rowAt('y', 8)],
      expected: 'x@8 y@8',
    },
    {
      name: 'a decided key on neither side adds no row',
      current: [rowAt('a')],
      decided: ['gone'],
      fresh: [rowAt('a', 8)],
      expected: 'a@8',
    },
  ];

  for (const { name, current, decided, fresh, expected } of MERGE_CASES) {
    // Frozen inputs: a merge that pushes into or sorts either list throws.
    const merged = mergeRefreshedCandidates(
      Object.freeze([...current]),
      Object.freeze([...fresh]),
      Object.fromEntries(decided.map((key) => [key, 'merged' as const])),
    );
    const actual = keysAndRevisions(merged);
    assert(actual === expected, `mergeRefreshedCandidates, ${name}: expected "${expected}", got "${actual}"`);
  }
  const staleDecided = rowAt('b');
  const keptDecided = mergeRefreshedCandidates([rowAt('a'), staleDecided], [rowAt('a', 8)], { b: 'merged' });
  assert(keptDecided[1] === staleDecided, 'a decided row the re-read lacks is the very row that was on screen');

  console.log('✓ mergeRefreshedCandidates: a fresh row replaces, a decided row stays, a vanished row drops, a new row appends');

  // --- decisionsAfterRefresh: a decision holds for the fingerprint it was made under ---

  /** The row under another fingerprint: a title or an artist of its works edited elsewhere. */
  const refingerprinted = (row: WorkMatchCandidate): WorkMatchCandidate => ({ ...row, fingerprint: 'c'.repeat(64) });
  const LAPSE_CASES: ReadonlyArray<{
    name: string;
    current: WorkMatchCandidate[];
    decided: string[];
    fresh: WorkMatchCandidate[];
    expected: string;
  }> = [
    {
      name: 'a decided row the re-read returns under another fingerprint loses its decision',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [refingerprinted(rowAt('a', 8)), rowAt('b', 8)],
      expected: '',
    },
    {
      name: 'a decided row the re-read returns under the same fingerprint keeps it',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('a', 8), rowAt('b', 8)],
      expected: 'a',
    },
    {
      name: 'a decided row the re-read lacks keeps it',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('b', 8)],
      expected: 'a',
    },
    {
      name: 'of several decisions only the one whose fingerprint changed lapses',
      current: [rowAt('a'), rowAt('b'), rowAt('c')],
      decided: ['a', 'b', 'c'],
      fresh: [rowAt('a', 8), refingerprinted(rowAt('b', 8))],
      expected: 'a c',
    },
    {
      name: 'an undecided row under another fingerprint takes no decision with it',
      current: [rowAt('a'), rowAt('b')],
      decided: ['a'],
      fresh: [rowAt('a', 8), refingerprinted(rowAt('b', 8))],
      expected: 'a',
    },
  ];
  for (const { name, current, decided, fresh, expected } of LAPSE_CASES) {
    // Frozen inputs: a helper that edits the rows or the decisions in place throws.
    const kept = decisionsAfterRefresh(
      Object.freeze([...current]),
      Object.freeze([...fresh]),
      Object.freeze(Object.fromEntries(decided.map((key) => [key, 'merged' as const]))),
    );
    const actual = Object.keys(kept).sort().join(' ');
    assert(actual === expected, `decisionsAfterRefresh, ${name}: expected "${expected}", got "${actual}"`);
  }
  const holding = { a: 'not_duplicate', b: 'needs_research' } as const;
  assert(
    decisionsAfterRefresh([rowAt('a'), rowAt('b')], [rowAt('a', 8)], holding) === holding,
    'with no decision lapsed, the very same record comes back',
  );
  assert(
    JSON.stringify(decisionsAfterRefresh([rowAt('a'), rowAt('b')], [refingerprinted(rowAt('a', 8)), rowAt('b', 8)], holding))
      === JSON.stringify({ b: 'needs_research' }),
    'a decision that holds keeps the outcome it recorded',
  );

  console.log(
    '✓ decisionsAfterRefresh: a decision holds while its candidate keeps the fingerprint it was made under; a re-read under another fingerprint drops it, a missing row keeps it',
  );

  // --- The queue's state: selection, decided rows and the silent re-read ---

  const queueState = (overrides: Partial<WorkReviewState> = {}): WorkReviewState => ({
    ...initialWorkReviewState,
    loading: false,
    candidates: [rowAt('a'), rowAt('b'), rowAt('c'), rowAt('d')],
    selectedKey: 'a',
    ...overrides,
  });
  const decidedKeys = (state: WorkReviewState): string => Object.keys(state.decided).sort().join(' ');

  {
    const started = workReviewReducer(
      queueState({ selectedKey: 'c', decided: { a: 'merged' }, rereading: true }),
      { type: 'scanStarted' },
    );
    assert(started.candidates.length === 0 && started.selectedKey === null, 'starting a scan clears the selection with the list');
    assert(!started.rereading, 'starting a scan abandons a re-read of the list it just cleared');

    const scanned = workReviewReducer(
      { ...started, decided: { a: 'merged' }, rereadError: "Couldn't refresh this page." },
      { type: 'scanSucceeded', response: { ...listResponse, data: [rowAt('x'), rowAt('y')], total: 2 } },
    );
    assert(keysAndRevisions(scanned.candidates) === 'x@7 y@7', 'a scan stores its rows');
    assert(scanned.selectedKey === 'x', 'a scan selects its first candidate');
    assert(decidedKeys(scanned) === '', 'a scan forgets the decisions of the list it replaces');
    assert(scanned.rereadError === null, 'a scan clears a failed re-read');

    const emptied = workReviewReducer(scanned, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [], total: 0, totalPages: 0 },
    });
    assert(emptied.selectedKey === null, 'a scan without candidates selects nothing');

    const picked = workReviewReducer(
      queueState({ decided: { a: 'merged' }, rereading: true }),
      { type: 'candidateSelected', key: 'c' },
    );
    assert(picked.selectedKey === 'c', 'selecting a row stores its key');
    assert(
      keysAndRevisions(picked.candidates) === 'a@7 b@7 c@7 d@7' && decidedKeys(picked) === 'a' && picked.rereading,
      'selecting a row changes nothing else',
    );
  }
  console.log('✓ work review state: a scan selects its first candidate and forgets the previous decisions; a click selects a row');

  {
    const recorded = workReviewReducer(queueState(), {
      type: 'decisionRecorded',
      candidateKey: 'a',
      outcome: 'not_duplicate',
    });
    assert(recorded.decided['a'] === 'not_duplicate', 'a decision is recorded against its candidate');
    assert(recorded.selectedKey === 'b', 'a decision moves the selection to the next undecided row');
    assert(recorded.rereading, 'a decision starts the silent re-read');
    assert(keysAndRevisions(recorded.candidates) === 'a@7 b@7 c@7 d@7', 'the decided row stays in the list');

    for (const outcome of ['not_duplicate', 'needs_research', 'merged'] as const) {
      const state = workReviewReducer(queueState(), { type: 'decisionRecorded', candidateKey: 'a', outcome });
      assert(state.decided['a'] === outcome, `the ${outcome} outcome is recorded as given`);
    }

    // A decision ends any pending merge confirmation: the full reload that used to clear it is gone.
    for (const confirming of ['a', 'c']) {
      const confirmed = workReviewReducer(queueState({ confirmingCandidateKey: confirming }), {
        type: 'decisionRecorded',
        candidateKey: 'a',
        outcome: 'merged',
      });
      assert(
        confirmed.confirmingCandidateKey === null,
        `a decision ends the merge confirmation open on ${confirming === 'a' ? 'the decided row' : 'another row'}`,
      );
    }

    const DECISION_CASES: ReadonlyArray<{
      name: string;
      state: WorkReviewState;
      candidateKey: string;
      expected: string | null;
    }> = [
      { name: 'the next row', state: queueState(), candidateKey: 'a', expected: 'b' },
      {
        name: 'decided rows after it are skipped',
        state: queueState({ decided: { b: 'merged', c: 'needs_research' } }),
        candidateKey: 'a',
        expected: 'd',
      },
      {
        name: 'the last row wraps to the first undecided one',
        state: queueState({ selectedKey: 'd', decided: { a: 'merged' } }),
        candidateKey: 'd',
        expected: 'b',
      },
      {
        name: 'nothing left undecided selects nothing',
        state: queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: 'b', decided: { a: 'merged' } }),
        candidateKey: 'b',
        expected: null,
      },
      {
        name: 'a curator who moved on to another undecided row while it saved keeps that row',
        state: queueState({ selectedKey: 'c' }),
        candidateKey: 'a',
        expected: 'c',
      },
      {
        name: 'a selection resting on another decided row moves on from the decided one',
        state: queueState({ selectedKey: 'b', decided: { b: 'needs_research' } }),
        candidateKey: 'a',
        expected: 'c',
      },
      {
        name: 'no selection starts from the decided row',
        state: queueState({ selectedKey: null }),
        candidateKey: 'b',
        expected: 'c',
      },
    ];
    for (const { name, state, candidateKey, expected } of DECISION_CASES) {
      const after = workReviewReducer(state, { type: 'decisionRecorded', candidateKey, outcome: 'merged' });
      assert(
        after.selectedKey === expected,
        `decisionRecorded, ${name}: expected ${String(expected)}, got ${String(after.selectedKey)}`,
      );
      assert(after.decided[candidateKey] === 'merged' && after.rereading, `decisionRecorded, ${name}: recorded, re-reading`);
    }
  }
  console.log('✓ work review state: a decision is recorded, the row stays, the selection moves to the next undecided row and a re-read starts');

  {
    const refreshedStats = {
      candidateCount: 5,
      pendingCount: 3,
      notDuplicateCount: 1,
      needsResearchCount: 0,
      affectedWorks: 8,
    };
    for (const loading of [false, true]) {
      const before = queueState({
        loading,
        rereading: true,
        selectedKey: 'b',
        decided: { a: 'merged' },
        filter: 'all',
        page: 2,
        scanError: 'scan error',
        refreshVersion: 3,
        confirmingCandidateKey: 'c',
        actionCandidateKey: 'a',
      });
      const refreshed = workReviewReducer(before, {
        type: 'pageRefreshed',
        candidates: [rowAt('b', 8), rowAt('c', 8), rowAt('d', 8), rowAt('e', 8)],
        stats: refreshedStats,
        total: 5,
        totalPages: 2,
      });
      assert(
        keysAndRevisions(refreshed.candidates) === 'a@7 b@8 c@8 d@8 e@8',
        `a re-read merges into the rows on screen, got ${keysAndRevisions(refreshed.candidates)}`,
      );
      assert(refreshed.stats === refreshedStats, 'a re-read updates the filter counts');
      assert(refreshed.total === 5 && refreshed.totalPages === 2, 'a re-read updates the pagination totals');
      assert(!refreshed.rereading, 'a re-read that lands ends the re-read');
      for (const field of [
        'loading',
        'filter',
        'page',
        'scanError',
        'refreshVersion',
        'confirmingCandidateKey',
        'actionCandidateKey',
        'decided',
        'selectedKey',
      ] as const) {
        assert(Object.is(before[field], refreshed[field]), `a silent re-read leaves ${field} alone (loading ${String(loading)})`);
      }
    }

    const RESELECT_CASES: ReadonlyArray<{
      name: string;
      state: WorkReviewState;
      fresh: WorkMatchCandidate[];
      expected: string | null;
    }> = [
      {
        name: 'a selected row that is still there stays selected',
        state: queueState({ selectedKey: 'b' }),
        fresh: [rowAt('a', 8), rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
        expected: 'b',
      },
      {
        name: 'a selected row that vanished gives way to the next row from its old position',
        state: queueState({ selectedKey: 'b' }),
        fresh: [rowAt('a', 8), rowAt('c', 8), rowAt('d', 8)],
        expected: 'c',
      },
      {
        name: 'rows after it that vanished too, or were decided, are skipped',
        state: queueState({ selectedKey: 'b', decided: { c: 'needs_research' } }),
        fresh: [rowAt('a', 8), rowAt('d', 8)],
        expected: 'd',
      },
      {
        name: 'the order on screen decides what follows, not the re-read order',
        state: queueState({ selectedKey: 'c' }),
        fresh: [rowAt('d', 8), rowAt('a', 8), rowAt('b', 8)],
        expected: 'd',
      },
      {
        name: 'with nothing live after it, the first live row before it',
        state: queueState({ selectedKey: 'c', decided: { a: 'merged' } }),
        fresh: [rowAt('b', 8)],
        expected: 'b',
      },
      {
        name: 'nothing live left selects nothing',
        state: queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: 'b', decided: { a: 'merged' } }),
        fresh: [],
        expected: null,
      },
      {
        name: 'no selection takes the first undecided row on screen',
        state: queueState({ selectedKey: null, decided: { a: 'merged' } }),
        fresh: [rowAt('a', 8), rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
        expected: 'b',
      },
      {
        // An over-limit merge's remainder comes back under a new key, appended.
        name: 'the selected row vanished and the only undecided row is one the re-read appended',
        state: queueState({ candidates: [rowAt('a')], selectedKey: 'a' }),
        fresh: [rowAt('x', 8)],
        expected: 'x',
      },
      {
        name: 'the appended row that is picked is the first undecided one of the merged list',
        state: queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: 'a', decided: { b: 'merged' } }),
        fresh: [rowAt('x', 8), rowAt('y', 8)],
        expected: 'x',
      },
      {
        name: 'every row decided (no selection) and the re-read appends an undecided row',
        state: queueState({
          candidates: [rowAt('a'), rowAt('b')],
          selectedKey: null,
          decided: { a: 'merged', b: 'not_duplicate' },
        }),
        fresh: [rowAt('x', 8)],
        expected: 'x',
      },
      {
        name: 'every merged row decided and nothing appended stays unselected',
        state: queueState({
          candidates: [rowAt('a'), rowAt('b')],
          selectedKey: null,
          decided: { a: 'merged', b: 'not_duplicate' },
        }),
        fresh: [],
        expected: null,
      },
      {
        name: 'every merged row decided, the re-read only returning them, stays unselected',
        state: queueState({
          candidates: [rowAt('a'), rowAt('b')],
          selectedKey: null,
          decided: { a: 'merged', b: 'not_duplicate' },
        }),
        fresh: [rowAt('a', 8), rowAt('b', 8)],
        expected: null,
      },
      {
        name: 'the walk from the old position comes first: a live row after it beats an appended one',
        state: queueState({ selectedKey: 'b' }),
        fresh: [rowAt('a', 8), rowAt('c', 8), rowAt('d', 8), rowAt('x', 8)],
        expected: 'c',
      },
      {
        name: 'the walk wraps before an appended row is considered',
        state: queueState({ selectedKey: 'd' }),
        fresh: [rowAt('a', 8), rowAt('b', 8), rowAt('x', 8)],
        expected: 'a',
      },
    ];
    for (const { name, state, fresh, expected } of RESELECT_CASES) {
      const after = workReviewReducer(state, {
        type: 'pageRefreshed',
        candidates: fresh,
        stats: refreshedStats,
        total: fresh.length,
        totalPages: 1,
      });
      assert(
        after.selectedKey === expected,
        `pageRefreshed, ${name}: expected ${String(expected)}, got ${String(after.selectedKey)}`,
      );
      assert(
        after.selectedKey === null || after.candidates.some((row) => row.candidateKey === after.selectedKey),
        `pageRefreshed, ${name}: the selection is a row of the merged list`,
      );
    }
  }
  console.log('✓ work review state: a re-read merges into the rows, keeps loading alone and re-selects only when nothing is selected or the selected row vanished');

  {
    // A decision holds for the fingerprint it was made under. A re-read that brings its candidate back
    // under another one (a title or an artist edited elsewhere) brings a new candidate, pending on the
    // server: the decision lapses and the fresh row is live again — selectable, actionable, counted.
    const refreshed = (state: WorkReviewState, fresh: WorkMatchCandidate[]) =>
      workReviewReducer(state, { type: 'pageRefreshed', candidates: fresh, stats: listResponse.stats, total: fresh.length, totalPages: 1 });
    const changedA = refingerprinted(rowAt('a', 8));

    const lapsed = refreshed(
      queueState({ selectedKey: 'd', decided: { a: 'not_duplicate', b: 'merged', c: 'needs_research' }, rereading: true }),
      [changedA, rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
    );
    assert(decidedKeys(lapsed) === 'b c', `the re-read under another fingerprint drops a's decision only (got "${decidedKeys(lapsed)}")`);
    assert(lapsed.candidates[0] === changedA, 'the fresh row takes its place, in place');
    assert(lapsed.selectedKey === 'd' && !lapsed.rereading, 'the selection stays and the re-read is over');
    const counted = workReviewReducer(lapsed, { type: 'decisionRecorded', candidateKey: 'd', outcome: 'merged' });
    assert(counted.selectedKey === 'a', `the queue counts the row again: deciding the last one wraps to it (got ${String(counted.selectedKey)})`);

    const reselected = refreshed(
      queueState({ candidates: [rowAt('a'), rowAt('b')], selectedKey: null, decided: { a: 'merged', b: 'not_duplicate' } }),
      [changedA, rowAt('b', 8)],
    );
    assert(
      reselected.selectedKey === 'a' && decidedKeys(reselected) === 'b',
      `with every row decided and nothing selected, the row gone live again is selected (got ${String(reselected.selectedKey)})`,
    );

    const aDecided = queueState({ selectedKey: 'b', decided: { a: 'not_duplicate' } });
    const sameFingerprint = refreshed(aDecided, [rowAt('a', 8), rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)]);
    assert(
      sameFingerprint.decided === aDecided.decided,
      'a re-read under the same fingerprint keeps the decision, the very same record',
    );
    assert(keysAndRevisions(sameFingerprint.candidates) === 'a@8 b@8 c@8 d@8', 'and the decided row takes the fresh version');

    const lacking = refreshed(aDecided, [rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)]);
    assert(
      lacking.decided === aDecided.decided && keysAndRevisions(lacking.candidates) === 'a@7 b@8 c@8 d@8',
      'a decided row the re-read lacks keeps its decision and stays as it was',
    );
  }
  console.log(
    '✓ work review state: a re-read that brings a decided candidate back under another fingerprint drops the decision, and the fresh row is selectable and counted; the same fingerprint or a missing row keeps it',
  );

  {
    const before = queueState({ rereading: true, selectedKey: 'b', decided: { a: 'merged' } });
    const failed = workReviewReducer(before, { type: 'pageRefreshFailed', error: "Couldn't refresh this page." });
    assert(failed.candidates === before.candidates, 'a failed re-read keeps the list');
    assert(failed.decided === before.decided && failed.selectedKey === 'b', 'a failed re-read keeps the decisions and the selection');
    assert(!failed.rereading, 'a failed re-read ends the re-read');
    assert(failed.rereadError === "Couldn't refresh this page.", 'a failed re-read says why');
    assert(failed.loading === before.loading, 'a failed re-read leaves loading alone');

    // The block stays until a reload lands: a scan that has only started does not lift it.
    const reloading = workReviewReducer(failed, { type: 'scanStarted' });
    assert(reloading.rereadError === "Couldn't refresh this page.", 'a scan that has started keeps the failed re-read');
    const reloaded = workReviewReducer(reloading, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [rowAt('x')], total: 1 },
    });
    assert(reloaded.rereadError === null, 'a scan that succeeds clears it');
  }
  console.log('✓ work review state: a failed re-read keeps the list and blocks the queue until a reload succeeds');

  {
    // The busy rule the page gates every decision, merge, filter and page control on.
    const BUSY_CASES: ReadonlyArray<{ name: string; overrides: Partial<WorkReviewState>; busy: boolean }> = [
      { name: 'nothing running', overrides: {}, busy: false },
      { name: 'a decision or merge saving', overrides: { actionCandidateKey: 'a' }, busy: true },
      { name: 'a silent re-read running', overrides: { rereading: true }, busy: true },
      { name: 'the last re-read failed', overrides: { rereadError: "Couldn't refresh this page." }, busy: true },
      {
        name: 'all three at once',
        overrides: { actionCandidateKey: 'a', rereading: true, rereadError: "Couldn't refresh this page." },
        busy: true,
      },
    ];
    for (const { name, overrides, busy } of BUSY_CASES) {
      assert(
        isWorkReviewQueueBusy(queueState(overrides)) === busy,
        `isWorkReviewQueueBusy, ${name}: expected ${busy ? 'busy' : 'idle'}`,
      );
    }
    assert(!isWorkReviewQueueBusy(initialWorkReviewState), 'a fresh page is idle');

    // The rule follows the state machine. A saved decision stays busy through the re-read, so a
    // second merge never starts on a row the re-read has not refreshed.
    let flow = workReviewReducer(queueState(), { type: 'actionStarted', candidateKey: 'a' });
    assert(isWorkReviewQueueBusy(flow), 'a decision that is saving keeps the queue busy');
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'a', outcome: 'merged' });
    flow = workReviewReducer(flow, { type: 'actionFinished' });
    assert(isWorkReviewQueueBusy(flow), 'the save is over but the re-read has not landed: still busy');
    flow = workReviewReducer(flow, {
      type: 'pageRefreshed',
      candidates: [rowAt('b', 8), rowAt('c', 8), rowAt('d', 8)],
      stats: listResponse.stats,
      total: 3,
      totalPages: 1,
    });
    assert(!isWorkReviewQueueBusy(flow), 'the re-read has landed: idle');
    flow = workReviewReducer(flow, { type: 'actionStarted', candidateKey: 'b' });
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'b', outcome: 'not_duplicate' });
    flow = workReviewReducer(flow, { type: 'actionFinished' });
    flow = workReviewReducer(flow, { type: 'pageRefreshFailed', error: "Couldn't refresh this page." });
    assert(isWorkReviewQueueBusy(flow), 'a failed re-read keeps the queue busy');
    flow = workReviewReducer(flow, { type: 'scanStarted' });
    assert(isWorkReviewQueueBusy(flow), 'a reload that has only started does not free it');
    flow = workReviewReducer(flow, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [rowAt('x')], total: 1 },
    });
    assert(!isWorkReviewQueueBusy(flow), 'a reload that succeeds frees it');
  }
  console.log('✓ work review state: the queue is busy while an action saves, a re-read runs or the last re-read failed');

  {
    const decidedState = queueState({ page: 2, totalPages: 3, decided: { a: 'merged', b: 'not_duplicate' } });
    for (const action of [
      { type: 'filterChanged', filter: 'all' },
      { type: 'previousPageRequested' },
      { type: 'nextPageRequested' },
    ] as const) {
      const moved = workReviewReducer(decidedState, action);
      assert(decidedKeys(moved) === '', `${action.type} clears the decided rows`);
    }
  }
  console.log('✓ work review state: a filter change or a page change clears the decided rows');

  {
    // The page's scan is keyed on the filter and the page, and the kit Segmented also reports a click
    // on the option that is already active. Only a click that changes one of the two rescans, so only
    // such a click may clear the decided rows: the active filter on page 1 changes neither, no scan
    // follows, and clearing would turn every decided row still on screen live again.
    const FILTER_CASES: ReadonlyArray<{
      name: string;
      filter: WorkReviewState['filter'];
      page: number;
      clears: boolean;
    }> = [
      { name: 'the active filter on page 1 changes nothing the scan is keyed on', filter: 'pending', page: 1, clears: false },
      { name: 'the active filter on page 2 goes back to page 1, which rescans', filter: 'pending', page: 2, clears: true },
      { name: 'another filter on page 1 rescans', filter: 'all', page: 1, clears: true },
      { name: 'another filter on page 2 rescans', filter: 'all', page: 2, clears: true },
    ];
    for (const { name, filter, page, clears } of FILTER_CASES) {
      const before = queueState({
        filter: 'pending',
        page,
        totalPages: 3,
        selectedKey: 'c',
        decided: { a: 'merged', b: 'not_duplicate' },
        confirmingCandidateKey: 'c',
      });
      const after = workReviewReducer(before, { type: 'filterChanged', filter });
      assert(
        decidedKeys(after) === (clears ? '' : 'a b'),
        `filterChanged, ${name}: the decided rows ${clears ? 'clear' : 'stay'}, got "${decidedKeys(after)}"`,
      );
      if (!clears) {
        assert(after.decided === before.decided, `filterChanged, ${name}: the decided map is the very one it was`);
      }
      assert(after.candidates === before.candidates, `filterChanged, ${name}: the rows stay until a scan replaces them`);
      assert(after.selectedKey === 'c', `filterChanged, ${name}: the selection stays until a scan replaces the rows`);
      assert(after.filter === filter && after.page === 1, `filterChanged, ${name}: the filter is stored and the page is the first`);
      assert(
        after.confirmingCandidateKey === null,
        `filterChanged, ${name}: the merge confirmation is closed as before`,
      );
    }
  }
  console.log('✓ work review state: the active filter on page 1 keeps the decided rows; any filter click that rescans clears them');

  {
    // The same holds for the page steps: a step that leaves the page where it is (Previous at page 1,
    // Next at the last page) rescans nothing, so it must not clear the decided rows. The reducer does
    // not lean on the buttons being disabled there.
    const PAGE_CASES: ReadonlyArray<{
      name: string;
      action: 'previousPageRequested' | 'nextPageRequested';
      page: number;
      totalPages: number;
      expectedPage: number;
      clears: boolean;
    }> = [
      {
        name: 'Previous at page 1 changes nothing the scan is keyed on',
        action: 'previousPageRequested',
        page: 1,
        totalPages: 3,
        expectedPage: 1,
        clears: false,
      },
      {
        name: 'Next at the last page changes nothing the scan is keyed on',
        action: 'nextPageRequested',
        page: 3,
        totalPages: 3,
        expectedPage: 3,
        clears: false,
      },
      {
        name: 'Previous on a single page changes nothing the scan is keyed on',
        action: 'previousPageRequested',
        page: 1,
        totalPages: 1,
        expectedPage: 1,
        clears: false,
      },
      {
        name: 'Next on a single page changes nothing the scan is keyed on',
        action: 'nextPageRequested',
        page: 1,
        totalPages: 1,
        expectedPage: 1,
        clears: false,
      },
      {
        name: 'Previous from page 2 goes to page 1, which rescans',
        action: 'previousPageRequested',
        page: 2,
        totalPages: 3,
        expectedPage: 1,
        clears: true,
      },
      {
        name: 'Next from page 1 of 3 goes to page 2, which rescans',
        action: 'nextPageRequested',
        page: 1,
        totalPages: 3,
        expectedPage: 2,
        clears: true,
      },
      {
        name: 'Next from the last page but one goes to the last page, which rescans',
        action: 'nextPageRequested',
        page: 2,
        totalPages: 3,
        expectedPage: 3,
        clears: true,
      },
      {
        // The filter emptied (every row decided away): the server counts no page at all.
        name: 'Next with no page left stays on page 1, never page 0',
        action: 'nextPageRequested',
        page: 1,
        totalPages: 0,
        expectedPage: 1,
        clears: false,
      },
    ];
    for (const { name, action, page, totalPages, expectedPage, clears } of PAGE_CASES) {
      const before = queueState({
        page,
        totalPages,
        selectedKey: 'c',
        decided: { a: 'merged', b: 'not_duplicate' },
        confirmingCandidateKey: 'c',
      });
      const after = workReviewReducer(before, { type: action });
      assert(
        decidedKeys(after) === (clears ? '' : 'a b'),
        `${action}, ${name}: the decided rows ${clears ? 'clear' : 'stay'}, got "${decidedKeys(after)}"`,
      );
      if (!clears) {
        assert(after.decided === before.decided, `${action}, ${name}: the decided map is the very one it was`);
      }
      assert(after.candidates === before.candidates, `${action}, ${name}: the rows stay until a scan replaces them`);
      assert(after.selectedKey === 'c', `${action}, ${name}: the selection stays until a scan replaces the rows`);
      assert(after.page === expectedPage, `${action}, ${name}: the page is ${expectedPage}, got ${after.page}`);
      assert(
        after.confirmingCandidateKey === null,
        `${action}, ${name}: the merge confirmation is closed as before`,
      );
    }
  }
  console.log('✓ work review state: Previous at the first page and Next at the last keep the decided rows; a page step that rescans clears them');

  {
    // Two merges in a row: the second row comes back from the re-read with the catalog revision the
    // first merge advanced, so the second merge is not stale.
    let flow = workReviewReducer(initialWorkReviewState, {
      type: 'scanSucceeded',
      response: { ...listResponse, data: [rowAt('a'), rowAt('b'), rowAt('c')], total: 3 },
    });
    assert(flow.selectedKey === 'a', 'the scan selects the first candidate');
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'a', outcome: 'merged' });
    assert(flow.selectedKey === 'b' && flow.rereading, 'the first merge selects the next row and starts a re-read');
    flow = workReviewReducer(flow, {
      type: 'pageRefreshed',
      candidates: [rowAt('b', 8), rowAt('c', 8)],
      stats: listResponse.stats,
      total: 2,
      totalPages: 1,
    });
    const second = flow.candidates.find((row) => row.candidateKey === flow.selectedKey);
    assert(!flow.rereading, 'the re-read has landed');
    assert(second?.catalogRevision === 8, 'the row selected after a merge carries the re-read catalog revision');
    flow = workReviewReducer(flow, { type: 'decisionRecorded', candidateKey: 'b', outcome: 'merged' });
    flow = workReviewReducer(flow, {
      type: 'pageRefreshed',
      candidates: [rowAt('c', 9)],
      stats: listResponse.stats,
      total: 1,
      totalPages: 1,
    });
    assert(
      keysAndRevisions(flow.candidates) === 'a@7 b@8 c@9',
      `both merged rows stay as they were decided and the last row is fresh, got ${keysAndRevisions(flow.candidates)}`,
    );
    assert(flow.selectedKey === 'c', 'the selection follows the queue to the last undecided row');
  }
  console.log('✓ work review state: a second merge selects a row that carries the revision the re-read refreshed');

  // ===================== The page, live: a keyboard review queue on a stubbed server =====================

  installLiveServer();
  // Toasts stay up until dismissed, so every one can be read, and no real timer outlives the test.
  const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };
  const openPage = () =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={['/works/review']}>
            <GlobalWorkReview />
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>,
    );
  const listParams = (index: number): string => callsTo('list')[index]?.params.toString() ?? '(no request)';
  const assertNoStrayRequests = () => {
    assert(server.unexpected.length === 0, `the page made only the requests the test expects (also: ${server.unexpected.join(', ')})`);
  };
  const PENDING_PAGE_1 = 'filter=pending&page=1&pageSize=50';
  const gitCompareIcon = parse(renderToStaticMarkup(<Icon name="gitCompare" />)).querySelector('svg')?.innerHTML;

  {
    // --- The first scan: the filter counts, the info strip, the rows, the first row selected ---
    resetServer();
    const a = liveRow('a', { reasons: ['case_width_whitespace', 'punctuation_spacing'] });
    const b = liveRow('b', { streamerCount: 1 });
    const c = liveRow('c', {
      works: [liveWork('c-1', 'Song C'), liveWork('c-2', 'song c'), liveWork('c-3', 'SONG C')],
    });
    server.replies.list.push(listReply([a, b, c]));
    const app = await openPage();
    const { container } = app;

    assert(callsTo('list').length === 1, `the page scans once on mount (saw ${callsTo('list').length})`);
    assert(listParams(0) === PENDING_PAGE_1, `the first scan reads the first 50 pending candidates (got ${listParams(0)})`);
    const counts = filterButtons(container).map((option) => textOf(option));
    assert(
      JSON.stringify(counts) === JSON.stringify(['Pending5', 'Needs research3', 'Not duplicate1', 'All9']),
      `each filter shows its count: pending, needs research, not duplicate, all candidates (got ${counts.join(' / ')})`,
    );
    assert(filterButton(container, 'Pending').getAttribute('aria-pressed') === 'true', 'Pending is the filter shown first');
    assert(textOf(container).includes('11 affected work IDs'), 'the info strip counts the affected work IDs');

    const [rowA, rowB, rowC] = rowButtons(container);
    assert(
      rowA !== undefined && rowB !== undefined && rowC !== undefined && rowButtons(container).length === 3,
      'one row per candidate',
    );
    assert(textOf(rowA.children[0]) === 'Song A and song a', `a row reads "{title A} and {title B}", got "${textOf(rowA.children[0])}"`);
    const compare = rowA.children[0]?.querySelector('svg');
    assert(
      gitCompareIcon !== undefined && compare?.getAttribute('aria-hidden') === 'true' && compare.innerHTML === gitCompareIcon,
      'a gitCompare icon stands between the two titles',
    );
    assert(textOf(rowA.children[0]?.querySelector('.sr-only')).trim() === 'and', 'assistive tech hears "and" in its place');
    assert(
      textOf(rowC.children[0]) === 'Song C and song c +1',
      `three works read "{title A} and {title B} +{n}", got "${textOf(rowC.children[0])}"`,
    );
    assert(
      textOf(rowA.children[1]) === 'Stephanie Poetri · 2 work IDs · 2 VTubers',
      `a row names the artist and counts the work IDs and VTubers, got "${textOf(rowA.children[1])}"`,
    );
    assert(
      textOf(rowB.children[1]) === 'Stephanie Poetri · 2 work IDs · 1 VTuber',
      `the VTuber count is pluralised, got "${textOf(rowB.children[1])}"`,
    );
    assert(textOf(rowC.children[1]) === 'Stephanie Poetri · 3 work IDs · 2 VTubers', 'the work ID count follows the works');
    const pillsA = rowPills(rowA).map((pill) => textOf(pill));
    assert(
      JSON.stringify(pillsA) === JSON.stringify(['High', 'Case / width / whitespace', 'Punctuation / spacing']),
      `a row shows the confidence pill and one pill per reason (got ${pillsA.join(' / ')})`,
    );
    assert(
      rowA.getAttribute('aria-current') === 'true' && selectedTitles(container) === titlesOf('a'),
      'the first candidate is selected',
    );
    assert(listCount(container) === '1–3 of 3', `the list counts its slice (got "${listCount(container)}")`);
    assert(
      textOf(detailColumn(container)).includes('Keep which work identity?') && textOf(detailColumn(container)).includes('a-1'),
      "the detail is the selected candidate's card",
    );
    assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the loaded page uses no raw Tailwind palette classes');

    // --- Not duplicate: busy while it saves and while the page re-reads; the row stays ---
    const review = held();
    const reread = held();
    server.replies.review.push(review.reply);
    server.replies.list.push(reread.reply);
    const list = candidatesList(container);
    const watched = watchDisabled(filterButton(container, 'All'));
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), 'the Not duplicate button');
    assertQueueControls(container, true, 'while the decision saves');
    await review.release(REVIEW_OK);

    const [decision] = callsTo('review');
    assert(
      decision?.body?.candidateKey === 'a'
        && decision.body.decision === 'not_duplicate'
        && decision.body.expectedReviewVersion === null,
      'Not duplicate posts the decision for the displayed review version',
    );
    assert(
      callsTo('list').length === 2 && listParams(1) === PENDING_PAGE_1,
      'a silent re-read of the same filter and page follows the decision',
    );
    assert(candidatesList(container) === list && list.isConnected, 'the list stays mounted while the page re-reads');
    assert(rowButtons(container)[0] === rowA && rowLook(rowA) === 'muted', 'the decided row stays in place, faded by colour');
    assert(rowLook(rowB) === 'live' && rowLook(rowC) === 'live', 'the rows left to decide stay live');
    const outcome = rowPills(rowA)[0];
    assert(
      textOf(outcome) === 'Not duplicate' && outcome?.className.includes('bg-tone-neutral-bg') === true,
      'the decided row wears a neutral Not duplicate pill',
    );
    assert(
      JSON.stringify(rowPills(rowA).map((pill) => textOf(pill)))
        === JSON.stringify(['Not duplicate', 'High', 'Case / width / whitespace', 'Punctuation / spacing']),
      'after its decision pill the decided row keeps its confidence and reason pills, neutral',
    );
    assert(selectedTitles(container) === titlesOf('b'), 'the selection moves to the next row');
    assert(toastText(container).includes('Saved as not duplicate.'), 'the decision is toasted');
    assertQueueControls(container, true, 'while the re-read runs');
    assert(
      watched.flips() === 1 && filterButton(container, 'All').disabled,
      'from the save to the re-read the queue is never idle: the filter was disabled once and still is',
    );

    await reread.release(
      listReply(
        [liveRow('b', { catalogRevision: 8, streamerCount: 1 }), liveRow('c', { catalogRevision: 8, works: c.works })],
        { stats: { pendingCount: 4, notDuplicateCount: 2 } },
      ),
    );
    assert(watched.flips() === 2 && !filterButton(container, 'All').disabled, 'the queue frees once the re-read lands');
    watched.stop();
    assertQueueControls(container, false, 'once the re-read has landed');
    assert(
      textOf(filterButton(container, 'Pending')) === 'Pending4' && textOf(filterButton(container, 'Not duplicate')) === 'Not duplicate2',
      'the re-read updates the filter counts',
    );
    assert(candidatesList(container) === list && rowButtons(container).length === 3, 'the re-read merges into the same list, the decided row kept');
    assert(
      listCount(container) === '1–2 of 2',
      `three rows on screen, but the count is the slice the server reports (got "${listCount(container)}")`,
    );
    assert(selectedTitles(container) === titlesOf('b'), 'the selection stays on the next row');

    // --- A decided row is read-only ---
    await click(rowA, 'the decided row');
    const decidedDetail = detailColumn(container);
    assert(
      textOf(decidedDetail).includes('It leaves the list when you reload or change the filter.'),
      "a decided row's detail says when it leaves the list",
    );
    const decidedPill = [...decidedDetail.querySelectorAll<HTMLElement>('span')].find((node) => textOf(node) === 'Not duplicate');
    assert(decidedPill?.className.includes('bg-tone-neutral-bg') === true, "a decided row's detail shows its decision pill");
    assert(decidedDetail.querySelectorAll('button, textarea, input').length === 0, "a decided row's detail has no action and no field");
    assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the queue with a decided row uses no raw Tailwind palette classes');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ work review queue: counts, rows and selection; Not duplicate keeps the row faded and re-reads the page silently');

  {
    // --- Review Focus 2: two merges in a row; the second waits for the re-read and sends its revision ---
    resetServer();
    server.replies.list.push(listReply([liveRow('m1'), liveRow('m2'), liveRow('m3')]));
    const app = await openPage();
    const { container } = app;
    const watched = watchDisabled(filterButton(container, 'All'));

    await click(buttonNamed(detailColumn(container), 'Review merge impact'), 'Review merge impact');
    assert(textOf(detailColumn(container)).includes('Site-wide identity change'), 'the first step shows the merge impact');
    assert(callsTo('merge').length === 0, 'reviewing the impact merges nothing');
    const reread = held();
    server.replies.merge.push(MERGE_OK);
    server.replies.list.push(reread.reply);
    await click(buttonNamed(detailColumn(container), 'Confirm global work merge'), 'Confirm global work merge');

    const [first] = callsTo('merge');
    assert(
      first?.body?.candidateKey === 'm1'
        && first.body.catalogRevision === 7
        && first.body.canonicalWorkId === 'm1-1'
        && JSON.stringify(first.body.sourceWorkIds) === '["m1-2"]',
      'the first merge sends the scanned revision and the reviewed identities',
    );
    assert(
      toastText(container).includes('Merged 1 work ID(s); preserved 3 songs and 10 performances.'),
      'the merge is toasted with its summary',
    );
    const mergedRow = rowFor(container, 'm1');
    assert(
      textOf(rowPills(mergedRow)[0]) === 'Merged'
        && rowPills(mergedRow)[0]?.className.includes('bg-tone-ok-bg') === true
        && rowLook(mergedRow) === 'muted',
      'the merged row stays, faded by colour, its Merged pill in its own ok tone',
    );
    assert(selectedTitles(container) === titlesOf('m2'), 'the selection moves to the next row');

    const secondStep = buttonNamed(detailColumn(container), 'Review merge impact');
    assert(secondStep?.disabled === true, "the next row's merge waits for the re-read");
    await click(secondStep, "the next row's Review merge impact");
    assert(
      buttonNamed(detailColumn(container), 'Confirm global work merge') === undefined,
      'a merge that waits for the re-read cannot be confirmed',
    );
    assert(
      watched.flips() === 1 && filterButton(container, 'All').disabled,
      'from the merge to its re-read the queue is never idle',
    );

    await reread.release(
      listReply([liveRow('m2', { catalogRevision: 8, reviewVersion: 4 }), liveRow('m3', { catalogRevision: 8 })]),
    );
    assert(watched.flips() === 2 && !filterButton(container, 'All').disabled, 'the queue frees once the re-read lands');
    watched.stop();

    server.replies.merge.push(MERGE_OK);
    server.replies.list.push(listReply([liveRow('m3', { catalogRevision: 9 })]));
    await click(buttonNamed(detailColumn(container), 'Review merge impact'), "the next row's Review merge impact");
    await click(buttonNamed(detailColumn(container), 'Confirm global work merge'), 'the second Confirm global work merge');
    const second = callsTo('merge')[1];
    assert(
      second?.body?.candidateKey === 'm2' && second.body.catalogRevision === 8 && second.body.expectedReviewVersion === 4,
      `the second merge sends the catalog revision and review version the re-read returned (got ${String(second?.body?.catalogRevision)} / ${String(second?.body?.expectedReviewVersion)})`,
    );
    const firstMergeAt = server.events.indexOf('POST merge m1@7');
    const rereadAt = server.events.indexOf('GET pending p1', firstMergeAt);
    const rereadLandedAt = server.events.indexOf('replied: GET pending p1', rereadAt);
    const secondMergeAt = server.events.indexOf('POST merge m2@8');
    assert(
      firstMergeAt >= 0 && firstMergeAt < rereadAt && rereadAt < rereadLandedAt && rereadLandedAt < secondMergeAt,
      `the second merge starts only after the re-read has landed (${server.events.join(' → ')})`,
    );
    assert(selectedTitles(container) === titlesOf('m3'), 'the queue moves on to the last row');
    assert(textOf(rowPills(rowFor(container, 'm2'))[0]) === 'Merged', 'both merged rows stay, marked');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ work review queue: a second merge waits for the re-read and sends the revision it returned');

  {
    // --- A failed re-read blocks the queue until a reload lands; a failed decision rescans ---
    resetServer();
    server.replies.list.push(listReply([liveRow('f1'), liveRow('f2')]));
    const app = await openPage();
    const { container } = app;
    server.replies.review.push(REVIEW_OK);
    server.replies.list.push({ status: 500, body: { error: 'D1 is unavailable' } });
    await click(buttonNamed(detailColumn(container), 'Needs research'), 'the Needs research button');

    assert(callsTo('review')[0]?.body?.decision === 'needs_research', 'Needs research posts its decision');
    assert(toastText(container).includes('Saved for source research.'), 'the decision is toasted');
    const researched = rowPills(rowFor(container, 'f1'))[0];
    assert(
      textOf(researched) === 'Needs research' && researched?.className.includes('bg-tone-warn-bg') === true,
      'the decided row wears a warn Needs research pill',
    );
    assert(rowLook(rowFor(container, 'f1')) === 'muted', 'and fades by colour around it, the pill keeping its warn tone');
    const blocked = alertWith(container, "Couldn't refresh this page. Reload before the next decision.");
    assert(
      blocked !== undefined && blocked.className.includes('bg-tone-danger-bg'),
      'a failed re-read says so in a danger note',
    );
    const reload = buttonNamed(blocked, 'Reload');
    assert(reload !== undefined && !reload.disabled, 'the note offers Reload');
    assert(selectedTitles(container) === titlesOf('f2'), 'the selection has still moved on');
    assertQueueControls(container, true, 'after a failed re-read');
    assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the failed re-read note uses no raw Tailwind palette classes');

    server.replies.list.push(listReply([liveRow('f2', { catalogRevision: 8 }), liveRow('f3', { catalogRevision: 8 })]));
    await click(reload, 'Reload');
    assert(callsTo('list').length === 3 && listParams(2) === PENDING_PAGE_1, 'Reload rescans the same filter and page');
    assert(alertWith(container, "Couldn't refresh this page.") === undefined, 'a reload that lands lifts the block');
    assert(
      JSON.stringify(rowTitles(container)) === JSON.stringify([titlesOf('f2'), titlesOf('f3')]),
      'the reload replaces the list, the decided row with it',
    );
    assert(selectedTitles(container) === titlesOf('f2'), 'the reload selects its first row');
    assertQueueControls(container, false, 'once a reload has landed');

    // A decision the server refuses is toasted, and the page rescans for fresh review versions.
    server.replies.review.push({ status: 409, body: { error: 'This candidate changed since it was loaded.' } });
    server.replies.list.push(
      listReply([liveRow('f2', { catalogRevision: 9, reviewVersion: 2 }), liveRow('f3', { catalogRevision: 9 })]),
    );
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), 'the Not duplicate button');
    assert(toastText(container).includes('This candidate changed since it was loaded.'), 'a failed decision toasts its error');
    assert(callsTo('list').length === 4 && listParams(3) === PENDING_PAGE_1, 'a failed decision rescans the page');
    assert(
      rowButtons(container).every((row) => rowLook(row) === 'live'),
      'nothing is marked decided after a failed decision',
    );
    assertQueueControls(container, false, 'once a failed decision has rescanned');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ work review queue: a failed re-read blocks the queue until Reload lands; a failed decision is toasted and rescans');

  {
    // --- Review Focus 1 (J in the note), and what a re-read seeds and keeps ---
    resetServer();
    server.replies.list.push(listReply([liveRow('p', { reviewNote: 'Saved note on p' }), liveRow('q')]));
    const app = await openPage();
    const { container } = app;
    const noteField = (): HTMLTextAreaElement => {
      const field = detailColumn(container).querySelector('textarea');
      assert(field !== null, 'the detail has the review note');
      return field;
    };
    const radio = (workId: string): HTMLInputElement => {
      const input = detailColumn(container).querySelector<HTMLInputElement>(`input[type="radio"][value="${workId}"]`);
      assert(input !== null, `the detail offers the ${workId} identity`);
      return input;
    };
    assert(noteField().value === 'Saved note on p', 'the scan seeds each row with its saved note');

    noteField().focus();
    const typed = await press(noteField(), 'j');
    assert(
      !typed.defaultPrevented && selectedTitles(container) === titlesOf('p'),
      'J pressed in the review note leaves the selection alone',
    );
    await typeInto(noteField(), 'Saved note on pj');
    assert(
      noteField().value === 'Saved note on pj' && selectedTitles(container) === titlesOf('p'),
      'J typed into the review note lands in the note',
    );
    await press(document.body, 'j');
    assert(selectedTitles(container) === titlesOf('q'), 'J anywhere else selects the next row');

    assert(radio('q-1').checked && !radio('q-2').checked, 'the suggested identity is chosen at first');
    await click(radio('q-2'), "q's second identity");
    assert(radio('q-2').checked, 'a click chooses another identity');
    await typeInto(noteField(), 'Draft on q');
    radio('q-2').focus();
    await press(radio('q-2'), 'k');
    assert(selectedTitles(container) === titlesOf('p'), 'K pressed on a focused identity radio still moves the queue');

    // Decide p; while the page re-reads, the curator keeps typing on q.
    const reread = held();
    server.replies.review.push(REVIEW_OK);
    server.replies.list.push(reread.reply);
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), 'the Not duplicate button');
    assert(callsTo('review')[0]?.body?.note === 'Saved note on pj', "the decision carries p's note");
    assert(
      selectedTitles(container) === titlesOf('q') && noteField().value === 'Draft on q' && radio('q-2').checked,
      'the selection moves to q, its draft and its identity intact',
    );
    assert(
      !noteField().disabled && !radio('q-1').disabled,
      "the next row's note and identities stay editable while the page re-reads",
    );
    await typeInto(noteField(), 'Draft on q, typed while the page re-reads');
    await reread.release(
      listReply([
        liveRow('q', { reviewNote: 'Saved note on q', catalogRevision: 8 }),
        liveRow('r', { reviewNote: 'Saved note on r', suggestedCanonicalWorkId: 'r-2', catalogRevision: 8 }),
      ]),
    );
    assert(
      noteField().value === 'Draft on q, typed while the page re-reads',
      'the re-read does not overwrite the note being typed',
    );
    assert(radio('q-2').checked, 'nor the identity chosen on q');
    await press(document.body, 'j');
    assert(selectedTitles(container) === titlesOf('r'), 'the row the re-read appended comes next');
    assert(noteField().value === 'Saved note on r', 'an appended row is seeded with its saved note');
    assert(radio('r-2').checked && !radio('r-1').checked, 'an appended row is seeded with its suggested identity');
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ work review queue: J types in the review note and moves the queue elsewhere; a re-read seeds new rows and keeps drafts');

  {
    // --- Every row decided: Next page when there is one, and Reload; the page buttons wait while busy ---
    resetServer();
    server.replies.list.push(listReply([liveRow('x'), liveRow('y')]));
    const app = await openPage();
    const { container } = app;
    const pageButton = (label: 'Previous page' | 'Next page'): HTMLButtonElement => {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert(button !== null, `the list footer has ${label}`);
      return button;
    };

    // Pending: each decision moves its row out of the filter.
    server.replies.review.push(REVIEW_OK);
    server.replies.list.push(listReply([liveRow('y', { catalogRevision: 8 })], { stats: { pendingCount: 1 } }));
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), "x's Not duplicate");
    assert(
      selectedTitles(container) === titlesOf('y') && listCount(container) === '1–1 of 1',
      `one candidate is left in Pending (count "${listCount(container)}")`,
    );
    server.replies.review.push(REVIEW_OK);
    server.replies.list.push(listReply([], { stats: { pendingCount: 0 } }));
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), "y's Not duplicate");

    let done = detailColumn(container);
    assert(textOf(done).includes('Every candidate on this page is decided'), 'with every row decided, the detail says so');
    assert(buttonNamed(done, 'Next page') === undefined, 'no Next page when there is none');
    const reload = buttonNamed(done, 'Reload');
    assert(reload !== undefined && !reload.disabled, 'the empty state offers Reload');
    assert(
      selectedTitles(container) === '' && rowButtons(container).every((row) => rowLook(row) === 'muted'),
      'both rows stay, faded by colour, and nothing is selected',
    );
    assert(listCount(container) === '0 of 0', `nothing is left to count (got "${listCount(container)}")`);
    assert(pageButton('Previous page').disabled && pageButton('Next page').disabled, 'a single page has no page to move to');

    server.replies.list.push(listReply([], { stats: { pendingCount: 0 } }));
    await click(reload, 'Reload');
    assert(callsTo('list').length === 4 && listParams(3) === PENDING_PAGE_1, 'Reload rescans the page');
    assert(textOf(container).includes('No candidates in this review state.'), 'an empty filter says so');

    // All keeps a decided candidate in the filter: page 1 of 2 ends with every row decided.
    server.replies.list.push(listReply([liveRow('u'), liveRow('v')], { total: 52, totalPages: 2 }));
    await click(filterButton(container, 'All'), 'the All filter');
    assert(listParams(4) === 'filter=all&page=1&pageSize=50', `the All filter scans its first page (got ${listParams(4)})`);
    assert(
      selectedTitles(container) === titlesOf('u') && !pageButton('Next page').disabled,
      'page 1 of 2 selects its first row, and Next page is open',
    );
    const reread = held();
    server.replies.review.push(REVIEW_OK);
    server.replies.list.push(reread.reply);
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), "u's Not duplicate");
    assert(pageButton('Next page').disabled && pageButton('Previous page').disabled, 'the page buttons wait for the re-read');
    assert(listParams(5) === 'filter=all&page=1&pageSize=50', 'the re-read keeps the filter and the page');
    const decidedU = liveRow('u', { decision: 'not_duplicate', reviewVersion: 1, catalogRevision: 8 });
    await reread.release(listReply([decidedU, liveRow('v', { catalogRevision: 8 })], { total: 52, totalPages: 2 }));
    assert(!pageButton('Next page').disabled, 'Next page opens again once the re-read lands');
    server.replies.review.push(REVIEW_OK);
    server.replies.list.push(
      listReply(
        [decidedU, liveRow('v', { decision: 'not_duplicate', reviewVersion: 1, catalogRevision: 8 })],
        { total: 52, totalPages: 2 },
      ),
    );
    await click(buttonNamed(detailColumn(container), 'Not duplicate'), "v's Not duplicate");

    done = detailColumn(container);
    assert(textOf(done).includes('Every candidate on this page is decided'), 'every row of page 1 is decided');
    const nextPage = buttonNamed(done, 'Next page');
    assert(
      nextPage !== undefined && !nextPage.disabled && buttonNamed(done, 'Reload') !== undefined,
      'the empty state offers Next page and Reload',
    );
    server.replies.list.push(listReply([liveRow('z')], { page: 2, total: 51, totalPages: 2 }));
    await click(nextPage, "the empty state's Next page");
    assert(listParams(7) === 'filter=all&page=2&pageSize=50', `Next page scans page 2 (got ${listParams(7)})`);
    assert(
      JSON.stringify(rowTitles(container)) === JSON.stringify([titlesOf('z')]) && selectedTitles(container) === titlesOf('z'),
      'page 2 replaces the list and selects its first row',
    );
    assert(listCount(container) === '51–51 of 51', `page 2 counts from 51 (got "${listCount(container)}")`);
    assert(
      pageButton('Next page').disabled && !pageButton('Previous page').disabled,
      'on the last page only Previous page is open',
    );
    assertNoStrayRequests();
    await app.unmount();
  }
  console.log('✓ work review queue: every row decided offers Next page (when there is one) and Reload; the page buttons wait while busy');

  {
    // --- A row decided on the server wears its decision and stays live; the queue's lead is measured ---
    resetServer();
    // What each ResizeObserver the page makes observes: the header's, then the lead's.
    const observed: Element[] = [];
    class RecordingResizeObserver {
      observe(target: Element): void {
        observed.push(target);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    const ownResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    Object.defineProperty(globalThis, 'ResizeObserver', { value: RecordingResizeObserver, configurable: true, writable: true });
    try {
      server.replies.list.push(listReply([liveRow('p')]));
      const app = await openPage();
      const { container } = app;

      // The Tier A strip is the queue's lead: the page measures it, so the list card leaves room for it.
      const page = container.querySelector('header')?.parentElement;
      assert(
        page instanceof HTMLElement && page.style.getPropertyValue('--queue-lead-h') !== '',
        'the page publishes the room its lead takes as --queue-lead-h',
      );
      const lead = observed.find((element) => element !== page.firstElementChild);
      assert(textOf(lead).includes('Tier A finds formatting-only'), 'the lead it measures is the Tier A strip');
      assert(
        lead?.nextElementSibling?.querySelector('ul[aria-label="Candidates"]') != null,
        'and the queue follows the lead',
      );

      // Under All, the rows decided on the server wear their decision in the list.
      const researchedRow = liveRow('r', { decision: 'needs_research', reviewVersion: 3 });
      const dismissedRow = liveRow('d', { decision: 'not_duplicate', reviewVersion: 2 });
      server.replies.list.push(listReply([liveRow('p'), researchedRow, dismissedRow]));
      await click(filterButton(container, 'All'), 'the All filter');
      const pillsOf = (key: string) => rowPills(rowFor(container, key)).map((pill) => textOf(pill));
      assert(
        JSON.stringify(pillsOf('p')) === JSON.stringify(['High', 'Case / width / whitespace']),
        `a row with no decision shows no decision pill (got ${pillsOf('p').join(' / ')})`,
      );
      const researched = rowPills(rowFor(container, 'r'))[0];
      assert(
        textOf(researched) === 'Needs research' && researched?.className.includes('bg-tone-warn-bg') === true,
        'a row the server holds for research wears a warn Needs research pill',
      );
      const dismissed = rowPills(rowFor(container, 'd'))[0];
      assert(
        textOf(dismissed) === 'Not duplicate' && dismissed?.className.includes('bg-tone-neutral-bg') === true,
        'a row the server holds as not a duplicate wears a neutral Not duplicate pill',
      );

      // The pill is all it gets: decided on the server, not in this view, such a row stays live.
      for (const key of ['r', 'd']) {
        assert(rowLook(rowFor(container, key)) === 'live', `the server-decided ${key} row is not faded`);
      }
      await click(rowFor(container, 'd'), 'the d row');
      assert(selectedTitles(container) === titlesOf('d'), 'a server-decided row can be selected');
      assertQueueControls(container, false, 'on a row decided on the server');

      // And the queue still counts it: deciding p moves the selection on to r, not past it.
      await click(rowFor(container, 'p'), 'the p row');
      server.replies.review.push(REVIEW_OK);
      server.replies.list.push(
        listReply([liveRow('p', { decision: 'not_duplicate', reviewVersion: 1, catalogRevision: 8 }), researchedRow, dismissedRow]),
      );
      await click(buttonNamed(detailColumn(container), 'Not duplicate'), "p's Not duplicate");
      assert(
        selectedTitles(container) === titlesOf('r'),
        `deciding p selects r, decided on the server but not here (got "${selectedTitles(container)}")`,
      );
      assertNoStrayRequests();
      await app.unmount();
    } finally {
      if (ownResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', ownResizeObserver);
      else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    }
  }
  console.log(
    '✓ work review queue: a row decided on the server wears its decision pill and stays selectable, actionable and counted; the Tier A strip is the lead the list card makes room for',
  );
}

await main();
