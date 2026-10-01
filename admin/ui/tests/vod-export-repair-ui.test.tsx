import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import type { VodExportRepairParent, VodExportRepairRecord } from '../src/api/vodExportTypes';
import { TONE_BOX_CLASS } from '../src/components/ui/pill-core';
import VodExportRepair from '../src/pages/VodExportRepair';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

function pageAt(path: string, user: AuthUser) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vod-export/repair/:entity/:rowId" element={<VodExportRepair user={user} />} />
      </Routes>
    </MemoryRouter>
  );
}

// --- The three guards are pure renders: `entity`/`rowId` come from `useParams()`, so every
// one of them is decided before any effect runs and needs no live DOM to prove. ---

function staticGuards(): void {
  const contributorHtml = renderToStaticMarkup(pageAt('/vod-export/repair/song/1', contributor));
  assert(contributorHtml.includes('Curator access is required'), 'a contributor sees the access guard, not the record');
  assert(!contributorHtml.includes('Loading source record'), 'the access guard never mentions loading');

  const badEntityHtml = renderToStaticMarkup(pageAt('/vod-export/repair/bogus/1', curator));
  assert(badEntityHtml.includes('Invalid private source locator'), 'an unrecognised entity kind is rejected');

  const badRowIdHtml = renderToStaticMarkup(pageAt('/vod-export/repair/song/not-a-number', curator));
  assert(badRowIdHtml.includes('Invalid private source locator'), 'a non-numeric row id is rejected');

  const zeroRowIdHtml = renderToStaticMarkup(pageAt('/vod-export/repair/song/0', curator));
  assert(zeroRowIdHtml.includes('Invalid private source locator'), 'row id 0 is rejected — the private id space starts at 1');

  console.log('✓ VOD export repair guards render before any fetch runs');
}

staticGuards();

// --- Live-mounted: pin `loading`'s initial value against a real commit count. ---
//
// `renderToStaticMarkup` never runs effects, so it cannot see the bug F11 was about: the old
// component always started `loading` at `true`, then had its mount effect immediately write it
// back to `false` for a request the guard rejects. Both renders show the SAME invalid-locator
// message (the render guard returns before `loading` is ever read), so no `innerHTML` assertion
// tells them apart — `act()` also drains that extra commit before it returns control, so even
// the DOM the test can inspect right after mounting is already settled either way. Only a raw
// commit count catches it, the same technique `tests/api-resource.test.ts`'s `hookDerivesLoading`
// and `tests/global-works-ui.test.tsx`'s hook-migration probe use for the sibling fix (F4).

const win = new Window({
  url: 'http://localhost/',
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
});
for (const [name, value] of Object.entries({
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  Event: win.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** Lets React finish whatever load → render chain a mount or a response started. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function rejectedRequestCommitsOnce(path: string, what: string): Promise<void> {
  let commitCount = 0;
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);

  await act(async () => {
    root.render(
      <Profiler id={`rejected-${what}`} onRender={() => { commitCount += 1; }}>
        {pageAt(path, curator)}
      </Profiler>,
    );
  });
  await settle();

  assert(container.innerHTML.includes('Invalid private source locator'), `${what}: the guard message renders`);
  const commitsForRejectedRequest = commitCount;
  assert(
    commitsForRejectedRequest === 1,
    `${what}: a request the guard rejects has nothing to load, so it should commit once (saw ${commitsForRejectedRequest})`,
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
}

async function validRequestLoadsFromLoadingToData(): Promise<void> {
  let resolveFetch!: (response: Response) => void;
  const pendingResponse = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  let requestedUrl = '';
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return pendingResponse;
    },
  });

  let commitCount = 0;
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);

  await act(async () => {
    root.render(
      <Profiler id="valid-request" onRender={() => { commitCount += 1; }}>
        {pageAt('/vod-export/repair/song/42', curator)}
      </Profiler>,
    );
  });

  assert(container.innerHTML.includes('Loading source record'), 'a valid request starts in its loading state');
  assert(requestedUrl === '/api/vod-export/repair/song/42', 'the page requests the record its own path names');
  // Read into a local before asserting: `assert` narrows what it is handed, and reusing
  // `commitCount` directly across assertions with different expected values later would make
  // one of those comparisons a type error.
  const commitsBeforeResolution = commitCount;
  assert(commitsBeforeResolution === 1, 'mounting a valid request commits once, already loading');

  const record: VodExportRepairRecord = {
    entity: 'song',
    rowId: 42,
    id: 'song-public-1',
    streamerId: 'mizuki',
    title: 'A Song',
    originalArtist: 'An Artist',
    status: 'approved',
    performanceCount: 3,
  };
  await act(async () => {
    resolveFetch(new Response(JSON.stringify(record), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  });
  await settle();

  assert(!container.innerHTML.includes('Loading source record'), 'the resolved record ends the loading state');
  assert(container.innerHTML.includes('A Song'), 'the resolved title renders');
  assert(container.innerHTML.includes('song-public-1'), 'the resolved public song id renders');
  const commitsAfterResolution = commitCount;
  assert(
    commitsAfterResolution === commitsBeforeResolution + 1,
    'the response ends the load in exactly one more commit — no extra render just to flip loading behind it',
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
}

await rejectedRequestCommitsOnce('/vod-export/repair/bogus/1', 'an unrecognised entity');
await rejectedRequestCommitsOnce('/vod-export/repair/song/not-a-number', 'a non-numeric row id');
await validRequestLoadsFromLoadingToData();

// --- The page on the studio kit (spec §8.8): header, guards, field rows and parent cards ---
//
// A restyle: every text and every commit budget above stays. These checks pin what the kit changed
// — the header with its back link, the danger notes and pills, the glass cards — and that every
// entity still lists each field it listed before.

/** Parses static markup into a detached element to query. */
function parse(markup: string): DomElement {
  const host = win.document.createElement('div');
  host.innerHTML = markup;
  return host;
}

function textOf(element: { textContent: string } | null | undefined): string {
  return element ? element.textContent.trim() : '';
}

const DANGER_TOKENS = TONE_BOX_CLASS.danger.split(' ');

/** The boxes in `root` (a `Note`, a `Pill`) that wear the danger tone and read exactly `text`. */
function dangerBoxes(root: DomElement, text: string): DomElement[] {
  return Array.from(root.querySelectorAll<DomElement>('div, span')).filter(
    (element) => textOf(element) === text && DANGER_TOKENS.every((token) => element.classList.contains(token)),
  );
}

/** A `<dl>`'s rows as [label, value] pairs. */
function rowsOf(list: DomElement | null): Array<[string, string]> {
  return Array.from(list?.children ?? []).map((row): [string, string] => [
    textOf(row.querySelector('dt')),
    textOf(row.querySelector('dd')),
  ]);
}

function headerAndGuards(): void {
  const html = renderToStaticMarkup(pageAt('/vod-export/repair/song/42', curator));
  const page = parse(html);
  const header = page.querySelector<DomElement>('header');
  assert(header !== null, 'the page renders a PageHeader');
  assert(
    page.firstElementChild?.firstElementChild === header,
    "the header is the page root's first child, so it sticks to <main> instead of scrolling inside the page",
  );
  assert(page.querySelectorAll('h1').length === 1, 'the page keeps exactly one <h1>');
  assert(textOf(header.querySelector('h1')) === 'VOD export source record', 'the <h1> is the record title, in the first render');
  assert(!header.outerHTML.includes('max-lg:sr-only'), 'a record page keeps its crumb and title visible below 1024px (recordTitle)');

  const crumb = header.querySelector<DomElement>('a[href="/vod-export"]');
  assert(crumb !== null && textOf(crumb) === 'Back to VOD Export', 'the crumb is a link to /vod-export reading "Back to VOD Export"');
  assert(crumb.querySelector('svg path')?.getAttribute('d') === 'm15 18-6-6 6-6', 'the crumb leads with the chevronLeft icon');
  assert(!html.includes('←'), 'the icon replaces the arrow glyph');

  const intro =
    'Private row locator song #42. Compare the raw relationship values with the resolved parent records before correcting canonical Admin data.';
  assert(Array.from(page.querySelectorAll('p')).some((paragraph) => textOf(paragraph) === intro), 'the locator sentence is kept whole');
  assert(textOf(page.querySelector('[role="status"]')) === 'Loading source record…', 'the first render is the loading skeleton');
  assert(!NO_RAW_PALETTE.test(html), 'the page uses no raw palette classes while loading');

  // The guards are danger notes in the page gutter: <main> gives a page none.
  for (const [what, guardHtml, message] of [
    ['a contributor', renderToStaticMarkup(pageAt('/vod-export/repair/song/1', contributor)), 'Curator access is required.'],
    ['a bad locator', renderToStaticMarkup(pageAt('/vod-export/repair/bogus/1', curator)), 'Invalid private source locator.'],
  ] as const) {
    const notes = dangerBoxes(parse(guardHtml), message);
    assert(notes.length === 1, `${what}: "${message}" is one danger note`);
    assert(notes[0]?.parentElement?.classList.contains('p-4') === true, `${what}: the note sits in the page gutter`);
    assert(!NO_RAW_PALETTE.test(guardHtml), `${what}: the guard uses no raw palette classes`);
  }

  console.log('✓ VOD export repair: studio header with a back link, danger-note guards in the page gutter');
}

headerAndGuards();

// Source: whichever branch a state reaches, the page names no raw palette class.
const repairSource = readFileSync(new URL('../src/pages/VodExportRepair.tsx', import.meta.url), 'utf8');
assert(!NO_RAW_PALETTE.test(repairSource), 'VodExportRepair.tsx names no raw palette class, in any branch');
console.log('✓ VOD export repair: its source names no raw palette class');

/** Makes every request answer with `respond()` — the page asks for one record and nothing else. */
function stubFetch(respond: () => Promise<Response>): void {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: respond });
}

const answer = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

/** Mounts the page for a curator at `path`, lets its one request land and hands back what it rendered. */
async function loadPage(path: string, respond: () => Promise<Response>) {
  stubFetch(respond);
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(pageAt(path, curator));
  });
  await settle();
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

type PerformanceRecord = Extract<VodExportRepairRecord, { entity: 'performance' }>;

const SONG_PARENT: VodExportRepairParent = { id: 'song-1', streamerId: 'mizuki', title: 'A Song', status: 'approved' };
const VOD_PARENT: VodExportRepairParent = { id: 'vod-1', streamerId: 'mizuki', title: 'Karaoke night', status: 'approved' };

const PERFORMANCE_RECORD: PerformanceRecord = {
  entity: 'performance',
  rowId: 9,
  id: 'perf-1',
  streamerId: 'mizuki',
  songId: 'song-1',
  streamId: 'vod-1',
  startSeconds: '30',
  startStorageClass: 'integer',
  endSeconds: '95',
  endStorageClass: 'integer',
  status: 'approved',
  referencedSong: SONG_PARENT,
  referencedVod: VOD_PARENT,
};

// Written out as literals, not derived from the page: this table is what each entity listed before
// the restyle — every label, in order — and the values it shows.
const ENTITY_CASES: Array<{ path: string; record: VodExportRepairRecord; rows: Array<[string, string]> }> = [
  {
    path: '/vod-export/repair/song/42',
    record: {
      entity: 'song',
      rowId: 42,
      id: 'song-public-1',
      streamerId: 'mizuki',
      title: 'A Song',
      originalArtist: 'An Artist',
      status: 'approved',
      performanceCount: 3,
    },
    rows: [
      ['Private row ID', '42'],
      ['Public song ID', 'song-public-1'],
      ['Streamer', 'mizuki'],
      ['Title', 'A Song'],
      ['Original artist', 'An Artist'],
      ['Status', 'approved'],
      ['Referenced performances', '3'],
    ],
  },
  {
    path: '/vod-export/repair/vod/7',
    record: {
      entity: 'vod',
      rowId: 7,
      id: 'vod-public-1',
      streamerId: 'mizuki',
      title: 'Karaoke night',
      date: '2026-09-01',
      videoId: 'dQw4w9WgXcQ',
      status: 'approved',
    },
    rows: [
      ['Private row ID', '7'],
      ['Public VOD ID', 'vod-public-1'],
      ['Streamer', 'mizuki'],
      ['Title', 'Karaoke night'],
      ['Date', '2026-09-01'],
      ['YouTube video ID', 'dQw4w9WgXcQ'],
      ['Status', 'approved'],
    ],
  },
  {
    path: '/vod-export/repair/streamer/3',
    record: {
      entity: 'streamer',
      rowId: 3,
      id: 'submission-1',
      slug: 'mizuki',
      displayName: 'Mizuki',
      youtubeChannelId: 'UC0123456789',
      enabled: true,
      status: 'approved',
    },
    rows: [
      ['Private row ID', '3'],
      ['Submission ID', 'submission-1'],
      ['Slug', 'mizuki'],
      ['Display name', 'Mizuki'],
      ['YouTube channel ID', 'UC0123456789'],
      ['Enabled', 'true'],
      ['Status', 'approved'],
    ],
  },
  {
    path: '/vod-export/repair/performance/9',
    record: PERFORMANCE_RECORD,
    rows: [
      ['Private row ID', '9'],
      ['Performance ID', 'perf-1'],
      ['Streamer', 'mizuki'],
      ['Stored song ID', 'song-1'],
      ['Stored VOD ID', 'vod-1'],
      ['Start seconds', '30 (integer)'],
      ['End seconds', '95 (integer)'],
      ['Status', 'approved'],
    ],
  },
];

async function everyEntityKeepsItsFields(): Promise<void> {
  for (const { path, record, rows } of ENTITY_CASES) {
    const { container, unmount } = await loadPage(path, () => answer(record));
    const fields = container.querySelector<DomElement>('dl');
    deepStrictEqual(rowsOf(fields), rows, `${record.entity}: every field, in order`);
    assert(fields !== null && fields.closest('.glass-card') !== null, `${record.entity}: the fields sit in a GlassCard`);
    assert(textOf(container.querySelector('h1')) === 'VOD export source record', `${record.entity}: the header stays once the record loads`);
    assert(container.querySelector('[role="status"]') === null, `${record.entity}: the skeleton is gone`);
    assert(!NO_RAW_PALETTE.test(container.innerHTML), `${record.entity}: the loaded page uses no raw palette classes`);
    await unmount();
  }

  // 0 and "false" are values; only null and the empty string are missing.
  const zero = await loadPage('/vod-export/repair/song/42', () =>
    answer({ entity: 'song', rowId: 42, id: 's', streamerId: 'm', title: 't', originalArtist: 'a', status: 'approved', performanceCount: 0 }),
  );
  assert(
    rowsOf(zero.container.querySelector<DomElement>('dl')).some(([label, value]) => label === 'Referenced performances' && value === '0'),
    'a count of 0 is shown, not flagged as missing',
  );
  assert(dangerBoxes(zero.container, 'Missing').length === 0, 'a song with no missing value shows no Missing pill');
  await zero.unmount();

  const disabled = await loadPage('/vod-export/repair/streamer/3', () =>
    answer({ entity: 'streamer', rowId: 3, id: 's', slug: 'm', displayName: 'M', youtubeChannelId: 'UC1', enabled: false, status: 'approved' }),
  );
  assert(
    rowsOf(disabled.container.querySelector<DomElement>('dl')).some(([label, value]) => label === 'Enabled' && value === 'false'),
    'a disabled streamer reads "false"',
  );
  await disabled.unmount();

  console.log('✓ VOD export repair: every entity lists each field it listed before, in a GlassCard');
}

async function missingValuesAreDangerPills(): Promise<void> {
  const record: PerformanceRecord = {
    ...PERFORMANCE_RECORD,
    songId: null,
    streamId: '',
    startSeconds: null,
    startStorageClass: 'null',
    status: null,
    referencedSong: null,
    referencedVod: null,
  };
  const { container, unmount } = await loadPage('/vod-export/repair/performance/9', () => answer(record));
  deepStrictEqual(
    rowsOf(container.querySelector<DomElement>('dl')),
    [
      ['Private row ID', '9'],
      ['Performance ID', 'perf-1'],
      ['Streamer', 'mizuki'],
      ['Stored song ID', 'Missing'],
      ['Stored VOD ID', 'Missing'],
      ['Start seconds', 'Missing (null)'],
      ['End seconds', '95 (integer)'],
      ['Status', 'Missing'],
    ],
    'null and empty values read Missing, the storage class stays beside them',
  );
  assert(dangerBoxes(container, 'Missing').length === 4, 'each of the four missing values is a danger Missing pill');
  assert(
    Array.from(container.querySelectorAll('dl code')).every((code) => textOf(code) !== ''),
    'no present value renders as an empty <code>',
  );
  await unmount();
  console.log('✓ VOD export repair: a missing value is a danger "Missing" pill');
}

async function parentCardsAreGlassWithDangerNotes(): Promise<void> {
  const record: PerformanceRecord = {
    ...PERFORMANCE_RECORD,
    referencedSong: null,
    referencedVod: { id: 'vod-1', streamerId: 'someone-else', title: null, status: 'approved' },
  };
  const { container, unmount } = await loadPage('/vod-export/repair/performance/9', () => answer(record));
  const cards = Array.from(container.querySelectorAll<DomElement>('section'));
  deepStrictEqual(
    cards.map((card) => card.getAttribute('aria-label')),
    ['Resolved song relationship', 'Resolved VOD relationship'],
    'the two parent cards, the song first',
  );
  const [songCard, vodCard] = cards;
  assert(songCard !== undefined && vodCard !== undefined, 'both parent cards render');
  for (const card of cards) {
    const name = card.getAttribute('aria-label');
    assert(card.classList.contains('glass-card'), `${name} is a GlassCard`);
    assert(textOf(card.querySelector('h2')) === name, `${name}: its heading names the relationship`);
  }

  assert(
    dangerBoxes(songCard, 'Referenced row does not exist.').length === 1 && songCard.querySelector('dl') === null,
    'a parent that does not exist is one danger note and no fact rows',
  );
  deepStrictEqual(
    rowsOf(vodCard.querySelector<DomElement>('dl')),
    [
      ['ID:', 'vod-1'],
      ['Streamer:', 'someone-else'],
      ['Status:', 'approved'],
      ['Title:', 'Missing'],
    ],
    'a found parent lists its four facts, a null one as Missing',
  );
  assert(dangerBoxes(vodCard, 'Missing').length === 1, "the parent's null title is a danger Missing pill");
  assert(
    dangerBoxes(vodCard, 'Streamer does not match the performance.').length === 1,
    "a parent of another streamer than the performance's carries the danger mismatch note",
  );
  assert(dangerBoxes(container, 'Referenced row does not exist.').length === 1, 'only the missing parent says it does not exist');
  assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the parent cards use no raw palette classes');
  await unmount();

  // The mismatch note needs both streamers: a matching parent, or a performance with no streamer, has none.
  for (const [what, streamerId] of [
    ['matching streamers', 'mizuki'],
    ['a performance with no streamer', null],
  ] as const) {
    const quiet = await loadPage('/vod-export/repair/performance/9', () =>
      answer({ ...PERFORMANCE_RECORD, streamerId, referencedSong: SONG_PARENT, referencedVod: VOD_PARENT }),
    );
    assert(
      !quiet.container.textContent.includes('Streamer does not match the performance.'),
      `${what}: no mismatch note`,
    );
    assert(!quiet.container.textContent.includes('Referenced row does not exist.'), `${what}: both parents exist`);
    await quiet.unmount();
  }
  console.log('✓ VOD export repair: parent cards are GlassCards with danger notes for a missing or mismatched parent');
}

async function failedLoadIsADangerAlert(): Promise<void> {
  const notFound = await loadPage('/vod-export/repair/song/42', () => answer({ error: 'Source record not found.' }, 404));
  const failure = notFound.container.querySelector<DomElement>('[role="alert"]');
  assert(failure !== null && textOf(failure) === 'Source record not found.', "the server's message is shown in an alert");
  assert(DANGER_TOKENS.every((token) => failure.classList.contains(token)), 'the alert is a danger note');
  assert(textOf(notFound.container.querySelector('h1')) === 'VOD export source record', 'the header stays over a failed load');
  assert(notFound.container.querySelector('[role="status"]') === null, 'a failed load ends the loading state');
  assert(notFound.container.querySelector('dl') === null, 'a failed load lists no fields');
  assert(!NO_RAW_PALETTE.test(notFound.container.innerHTML), 'the failed page uses no raw palette classes');
  await notFound.unmount();

  const offline = await loadPage('/vod-export/repair/song/42', () => Promise.reject('offline'));
  assert(
    textOf(offline.container.querySelector('[role="alert"]')) === 'Failed to load source record.',
    'a rejection that is not an Error falls back to the generic message',
  );
  await offline.unmount();
  console.log('✓ VOD export repair: a failed load is a danger alert under the header');
}

/** Prints where the router is, so a test can tell a router `Link` (navigates in place) from a plain anchor. */
function LocationProbe() {
  return <output>{useLocation().pathname}</output>;
}

async function backLinkNavigatesInPlace(): Promise<void> {
  stubFetch(() => new Promise<Response>(() => undefined));
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/vod-export/repair/song/42']}>
        <LocationProbe />
        <Routes>
          <Route path="/vod-export/repair/:entity/:rowId" element={<VodExportRepair user={curator} />} />
          <Route path="/vod-export" element={<p>the export list</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  assert(textOf(container.querySelector('output')) === '/vod-export/repair/song/42', 'the probe starts on the record');
  const crumb = container.querySelector<DomElement>('header a[href="/vod-export"]');
  assert(crumb !== null, 'the crumb link renders');
  await act(async () => {
    crumb.click();
  });
  await settle();
  assert(textOf(container.querySelector('output')) === '/vod-export', 'the crumb is a router Link: it navigates in place');
  assert(container.textContent.includes('the export list'), 'the export list route renders');
  assert(!container.textContent.includes('VOD export source record'), 'the record page is gone');
  await act(async () => {
    root.unmount();
  });
  container.remove();
  console.log('✓ VOD export repair: the back link is a router Link to /vod-export');
}

await everyEntityKeepsItsFields();
await missingValuesAreDangerPills();
await parentCardsAreGlassWithDangerNotes();
await failedLoadIsADangerAlert();
await backLinkNavigatesInPlace();

await win.happyDOM.close();

console.log('✓ VOD export repair initialises its loading guard lazily, with no commit spent flipping it');
