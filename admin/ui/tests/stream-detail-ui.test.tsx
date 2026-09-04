import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser, ListResponse, StampPerformance, Stream, StreamDetail } from '../../shared/types';
import { StreamDetailView } from '../src/pages/StreamDetail';
import StreamDetailPage from '../src/pages/StreamDetail';
import type { StreamDetailController } from '../src/pages/StreamDetail';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { InlineEdit } from '../src/components/stamp/InlineEdit';
import { handleInlineEditKeyDown } from '../src/lib/inline-edit';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const asyncNoop = async () => {};
const noop = () => {};

const detail: StreamDetail = {
  id: 'stream-current',
  streamerId: 'mizuki',
  title: 'Test Karaoke Stream',
  date: '2026-08-17',
  videoId: 'video-current',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-current',
  credit: { author: 'Timestamp Curator' },
  status: 'pending',
  submittedBy: 'submitter@example.com',
  reviewedBy: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  performances: [
    {
      id: 'performance-one',
      songId: 'song-one',
      title: 'First Song',
      originalArtist: 'First Artist',
      timestamp: 65,
      endTimestamp: 245,
      note: 'opening song',
      status: 'pending',
    },
    {
      id: 'performance-two',
      songId: 'song-two',
      title: 'Second Song',
      originalArtist: '',
      timestamp: 3700,
      endTimestamp: null,
      note: '',
      status: 'approved',
    },
  ],
};

function adjacentStream(id: string, date: string): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title: id,
    date,
    videoId: `${id}-video`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}-video`,
    credit: {},
    status: 'approved',
    submittedBy: null,
    reviewedBy: null,
    createdAt: '2026-08-17T00:00:00.000Z',
  };
}

const controller: StreamDetailController = {
  streamId: detail.id,
  detail,
  loading: false,
  error: null,
  editingField: null,
  setEditingField: noop,
  showPasteImport: false,
  setShowPasteImport: noop,
  playerRef: React.createRef<YouTubePlayerHandle>(),
  playerBoxRef: React.createRef<HTMLDivElement>(),
  selectedIndex: 0,
  setSelectedIndex: noop,
  showAddModal: false,
  setShowAddModal: noop,
  fetchLog: [],
  clearFetchLog: noop,
  isCurator: true,
  prevStream: adjacentStream('stream-newer', '2026-08-18'),
  nextStream: adjacentStream('stream-older', '2026-08-16'),
  unstampedCount: 1,
  handleStreamStatus: asyncNoop,
  handleStreamSave: asyncNoop,
  handleDeleteStream: asyncNoop,
  handlePasteImportDone: asyncNoop,
  copyVodUrl: noop,
  exportSongList: noop,
  handleSave: asyncNoop,
  handleDelete: asyncNoop,
  handlePerformanceStatus: asyncNoop,
  handleApproveAll: asyncNoop,
  handleUnapproveAll: asyncNoop,
  clearEndTimestamp: asyncNoop,
  clearAllEndTimestamps: asyncNoop,
  handleAddSong: asyncNoop,
};

function renderView(overrides: Partial<StreamDetailController> = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StreamDetailView controller={{ ...controller, ...overrides }} />
    </MemoryRouter>,
  );
}

const html = renderView();
assert(html.includes('Test Karaoke Stream'), 'stream title remains visible');
assert(html.includes('Timestamp Curator'), 'stream credit remains visible');
assert(html.includes('2026-08-18') && html.includes('2026-08-16'), 'previous and next navigation remain visible');
assert(html.includes('Performances (2)'), 'performance count remains visible');
assert(html.includes('1 unstamped'), 'unstamped count remains visible');
assert(html.includes('First Song') && html.includes('Second Song'), 'all performances remain visible');
assert(html.includes('1:05') && html.includes('4:05') && html.includes('1:01:40'), 'timestamps keep their display format');
assert(html.includes('Approve All') && html.includes('Unapprove All'), 'curator bulk actions remain visible');
assert(html.includes('Delete stream'), 'pending streams retain the curator delete action');
assert(html.includes('Open in Stamp Editor'), 'stamp editor navigation remains visible');
assert(html.includes('performance-row-performance-one'), 'performance deep-link target remains on each row');

const contributorHtml = renderView({ isCurator: false });
assert(!contributorHtml.includes('Approve All'), 'contributors do not see curator bulk approval');
assert(!contributorHtml.includes('Delete stream'), 'contributors do not see stream deletion');

const loadingHtml = renderView({ loading: true, detail: null });
assert(loadingHtml.includes('Loading...'), 'loading state remains intact');
const errorHtml = renderView({ error: 'Unable to load stream', detail: null });
assert(errorHtml.includes('Unable to load stream'), 'error state remains intact');

const addModalHtml = renderView({ showAddModal: true });
assert(addModalHtml.includes('Song title *'), 'add-song modal remains wired to page state');

const pasteModalHtml = renderView({ showPasteImport: true });
assert(pasteModalHtml.includes('Paste a timestamp list'), 'paste-import modal remains wired to page state');
assert(
  pasteModalHtml.includes('Replace existing performances') && !pasteModalHtml.includes('delete current songs first'),
  'StreamDetail keeps its own replace-mode wording after the modal is shared',
);
assert(!pasteModalHtml.includes('7:20 Third Song'), 'StreamDetail keeps its two-line paste example');

// --- Inline edit: StreamDetail still saves a field that was emptied ---

function commitInlineEdit(text: string, value: string, allowEmpty: boolean): { saved: string[]; cancels: number } {
  const saved: string[] = [];
  let cancels = 0;
  handleInlineEditKeyDown(
    { key: 'Enter', preventDefault: noop },
    { text, value, allowEmpty, onSave: (val) => saved.push(val), onCancel: () => { cancels += 1; } },
  );
  return { saved, cancels };
}

const clearedNote = commitInlineEdit('   ', 'opening song', true);
assert(clearedNote.saved.length === 1 && clearedNote.saved[0] === '', 'emptying a StreamDetail field saves the empty value');

const alreadyEmpty = commitInlineEdit('', '', true);
assert(alreadyEmpty.saved.length === 0 && alreadyEmpty.cancels === 1, 'an already-empty field cancels');

// The `allowEmpty` opt-in lives at the call site, so walk the rendered tree of the page's own
// performance table and take the exact props it hands the shared component.
interface InlineEditCallProps {
  value: string;
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
}

/**
 * `memo(Component)` is an object whose `.type` is the function, so a walker that reads `type.name`
 * or calls `type(props)` has to see through it — otherwise it silently stops matching the moment a
 * component is memoized.
 */
type RenderFunction = ((props: unknown) => React.ReactNode) & { name?: string };

function componentOf(type: React.ReactElement['type']): RenderFunction {
  const memoized = type as { $$typeof?: symbol; type?: unknown };
  return (memoized.$$typeof === Symbol.for('react.memo') ? memoized.type : type) as RenderFunction;
}

// `componentName` narrows the walk to one sub-component's render output (e.g. the performance
// table); omit it to read InlineEdits that StreamDetailView renders directly, like the stream title.
function inlineEditProps(tree: React.ReactNode, componentName?: string): InlineEditCallProps[] {
  const seen: React.ReactElement[] = [];
  const walk = (node: React.ReactNode): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!React.isValidElement(node)) return;
    seen.push(node);
    walk((node.props as { children?: React.ReactNode }).children);
  };

  walk(tree);
  if (componentName !== undefined) {
    const host = seen.find((element) => componentOf(element.type).name === componentName);
    assert(host !== undefined, `${componentName} renders inside the page view`);
    seen.length = 0;
    walk(componentOf(host.type)(host.props));
  }
  return seen.filter((element) => element.type === InlineEdit).map((element) => element.props as InlineEditCallProps);
}

const savedNotes: string[] = [];
const editedTable = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'note' },
    handleSave: async (perfId, field, value) => { savedNotes.push(`${perfId}:${field}:${value}`); },
  },
});
const detailInlineEdits = inlineEditProps(editedTable, 'PerformanceTable');
assert(detailInlineEdits.length === 1, 'the edited performance row renders one shared InlineEdit');
assert(detailInlineEdits[0]?.allowEmpty === true, 'StreamDetail rows opt into empty saves');

// Drive the props the page actually handed the shared component: clearing a note must still save it.
const noteRow = detailInlineEdits[0]!;
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...noteRow, text: '   ' });
assert(
  savedNotes.join() === 'performance-one:note:',
  'a StreamDetail row left empty saves the blank value through the page callback',
);

// --- Inline edit: the two title sites no longer opt into empty saves ---
//
// Clearing a stream or performance title used to round-trip a `''` the server rejected with 400.
// The prop assertion pins the JSX no longer passing `allowEmpty`; driving the real extracted
// callbacks through the key handler pins the resulting behavior (cancel, not a rejected save).

const savedStreamTitles: string[] = [];
let streamTitleCancelled = false;
const streamTitleTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'stream', field: 'title' },
    handleStreamSave: async (field, value) => { savedStreamTitles.push(`${field}:${value}`); },
    setEditingField: () => { streamTitleCancelled = true; },
  },
});
const streamTitleEdits = inlineEditProps(streamTitleTree);
assert(streamTitleEdits.length === 1, 'the stream title renders one shared InlineEdit while editing');
assert(streamTitleEdits[0]?.allowEmpty === undefined, 'stream title no longer opts into empty saves');
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...streamTitleEdits[0]!, text: '   ' });
assert(savedStreamTitles.length === 0, 'clearing the stream title no longer saves the empty value');
assert(streamTitleCancelled, 'clearing the stream title cancels the edit instead of saving');

const savedPerfTitles: string[] = [];
let perfTitleCancelled = false;
const perfTitleTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'title' },
    handleSave: async (perfId, field, value) => { savedPerfTitles.push(`${perfId}:${field}:${value}`); },
    setEditingField: () => { perfTitleCancelled = true; },
  },
});
const perfTitleEdits = inlineEditProps(perfTitleTree, 'PerformanceTable');
assert(perfTitleEdits.length === 1, 'the edited performance title row renders one shared InlineEdit');
assert(perfTitleEdits[0]?.allowEmpty === undefined, 'performance title no longer opts into empty saves');
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...perfTitleEdits[0]!, text: '   ' });
assert(savedPerfTitles.length === 0, 'clearing a performance title no longer saves the empty value');
assert(perfTitleCancelled, 'clearing a performance title cancels the edit instead of saving');

// --- Artist keeps its empty-save opt-in (unchanged); the prop assertion is the pin here since
// the save-behavior path is already exercised above for note, an identical opted-in field. ---

const artistTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'artist' },
  },
});
const artistEdits = inlineEditProps(artistTree, 'PerformanceTable');
assert(artistEdits.length === 1, 'the edited performance artist row renders one shared InlineEdit');
assert(artistEdits[0]?.allowEmpty === true, 'artist keeps its empty-save opt-in');

console.log('✓ StreamDetail retains navigation, controls, rows, access boundaries, and its shared stamp components');

// --- Moving from one stream to the next ---
//
// Everything above renders the view against a hand-built controller. What follows mounts the whole
// page — the shell, the per-stream component it keys by the stream id, and the real controller hook
// — against fake fetches in a live DOM, the way `tests/song-table-memo.test.tsx` and
// `tests/stamp-editor-ui.test.tsx` mount these editors. That is the only way to test what a
// navigation does: which state dies with the stream it belonged to, and which outlives it.

const navWin = new Window({
  url: 'http://localhost/',
  // The page mounts a YouTube player, which appends the IFrame API script tag; nothing here needs
  // that script, and fetching it would reach the network.
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
});

for (const [name, value] of Object.entries({
  window: navWin,
  document: navWin.document,
  navigator: navWin.navigator,
  HTMLElement: navWin.HTMLElement,
  Element: navWin.Element,
  Node: navWin.Node,
  Event: navWin.Event,
  MouseEvent: navWin.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };

function navStream(id: string, title: string, date: string): Stream {
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
    createdAt: '2026-08-20T00:00:00.000Z',
  };
}

function navPerformance(id: string, title: string, timestamp: number): StampPerformance {
  return {
    id,
    songId: `${id}-song`,
    title,
    originalArtist: 'Nav Artist',
    timestamp,
    endTimestamp: null,
    note: '',
    status: 'pending',
  };
}

const streamAlpha = navStream('stream-nav-a', 'Nav Stream Alpha', '2026-08-20');
const streamBeta = navStream('stream-nav-b', 'Nav Stream Beta', '2026-08-19');

const alphaRows = [
  navPerformance('perf-nav-a1', 'Alpha Song One', 10),
  navPerformance('perf-nav-a2', 'Alpha Song Two', 110),
  navPerformance('perf-nav-a3', 'Alpha Song Three', 210),
];
const betaRows = [
  navPerformance('perf-nav-b1', 'Beta Song One', 20),
  navPerformance('perf-nav-b2', 'Beta Song Two', 220),
];

const detailAlpha: StreamDetail = { ...streamAlpha, performances: alphaRows };
const detailBeta: StreamDetail = { ...streamBeta, performances: betaRows };

/** Every request the page makes, in order — the proof of what a navigation refetches. */
const navRequests: string[] = [];

function countRequests(pathname: string): number {
  return navRequests.filter((seen) => seen === pathname).length;
}

// Beta's detail is held until the test releases it, which puts the page deterministically in the
// window this refactor is about: the next stream requested, nothing of it on screen yet.
let releaseBetaDetail = (): void => {};
const betaDetailHeld = new Promise<void>((resolve) => { releaseBetaDetail = () => resolve(); });

const navFetch: typeof fetch = async (input) => {
  const { pathname } = new URL(String(input), 'http://localhost/');
  navRequests.push(pathname);
  if (pathname === `/api/streams/${streamBeta.id}/detail`) await betaDetailHeld;
  const payload = ((): unknown => {
    // Newest first, as the real list endpoint is: Alpha has no previous stream, Beta follows it.
    if (pathname === '/api/streams') return { data: [streamAlpha, streamBeta], total: 2 } satisfies ListResponse<Stream>;
    // A fresh array each load, as the real API is: the row ids and their order persist.
    if (pathname === `/api/streams/${streamAlpha.id}/detail`) return { ...detailAlpha, performances: [...alphaRows] };
    if (pathname === `/api/streams/${streamBeta.id}/detail`) return { ...detailBeta, performances: [...betaRows] };
    if (pathname === `/api/streams/${streamAlpha.id}/status`) return { ...streamAlpha, status: 'excluded' };
    if (pathname === '/api/performances/perf-nav-a2/status') return { ok: true };
    return undefined;
  })();
  if (payload === undefined) throw new Error(`unstubbed request: ${pathname}`);
  return { ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response;
};
Object.defineProperty(globalThis, 'fetch', { value: navFetch, configurable: true, writable: true });

/** Lets React finish the load → render chain the page runs on mount and after every write. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function clickNode(node: { click: () => void } | null | undefined, what: string): Promise<void> {
  assert(node !== null && node !== undefined, `the page renders ${what}`);
  await act(async () => {
    node.click();
  });
  await settle();
}

async function clickSelector(container: DomElement, selector: string, what: string): Promise<void> {
  await clickNode(container.querySelector<DomElement>(selector), what);
}

async function clickButtonNamed(container: DomElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll<DomElement>('button')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  await clickNode(button, `a ${label} button`);
}

/** The selected row is the one carrying the highlight the table paints on it. */
function rowIsSelected(container: DomElement, performanceId: string): boolean {
  return container
    .querySelector<DomElement>(`#performance-row-${performanceId}`)
    ?.getAttribute('class')
    ?.includes('bg-blue-50') === true;
}

const navContainer = navWin.document.createElement('div');
navWin.document.body.appendChild(navContainer);
const navRoot = createRoot(navContainer as unknown as HTMLElement);
await act(async () => {
  navRoot.render(
    // `?performance=` is the page's deep link: it opens on that row of the stream in the path.
    <MemoryRouter initialEntries={[`/streams/${streamAlpha.id}?performance=perf-nav-a3`]}>
      <Routes>
        <Route path="/streams/:id" element={<StreamDetailPage user={curator} />} />
      </Routes>
    </MemoryRouter>,
  );
});
await settle();

assert(navContainer.innerHTML.includes('Nav Stream Alpha'), 'the page loads the stream in the path');
assert(rowIsSelected(navContainer, 'perf-nav-a3'), 'a ?performance deep link selects the requested row once its stream loads');

// The pick the curator makes outranks the deep link from then on, reload included. The post-fetch
// write this replaced re-applied `?performance` on *every* load of the stream, so any reload —
// approving a row, saving a title, a paste import — snapped the selection back off their choice.
await clickSelector(navContainer, '#performance-row-perf-nav-a2', 'the second performance row');
assert(rowIsSelected(navContainer, 'perf-nav-a2'), 'clicking a row selects it');

await clickSelector(navContainer, '#performance-row-perf-nav-a2 [title="Approve"]', 'the row approve button');
const alphaDetailFetches = countRequests(`/api/streams/${streamAlpha.id}/detail`);
assert(alphaDetailFetches === 2, `approving a row reloads the stream detail (saw ${alphaDetailFetches} loads)`);
assert(
  rowIsSelected(navContainer, 'perf-nav-a2') && !rowIsSelected(navContainer, 'perf-nav-a3'),
  'a reload keeps the row the curator picked instead of snapping back to the deep-linked row',
);

// State raised on Alpha: a toast, and an open modal. One belongs to the page, the other to Alpha.
await clickButtonNamed(navContainer, 'Exclude');
assert(navContainer.innerHTML.includes('Stream excluded'), 'a stream status change raises its toast');
await clickButtonNamed(navContainer, '+ Add Song');
assert(navContainer.innerHTML.includes('Song title *'), 'the add-song modal opens on the stream being viewed');

// --- Navigate to the next stream, through the link the stream list feeds ---

// Beta's detail is still held here, so this is the moment the page has left one stream and has
// nothing of the next: the page's own toast has to survive it. The state that resets per stream
// used to be reset by an effect on a page that never unmounted, which meant the page went to its
// loading branch — taking the toast off screen with it, and restarting its clock on the way back.
const nextLink = navContainer.querySelector<DomElement>(`a[href="/streams/${streamBeta.id}"]`);
assert(nextLink !== null, 'the page renders the next-stream link');
await act(async () => {
  nextLink.click();
});
assert(navContainer.innerHTML.includes('Loading...'), 'the next stream is still loading while its detail is held');
assert(
  navContainer.innerHTML.includes('Stream excluded'),
  'a toast raised on one stream stays up while the next stream loads',
);

releaseBetaDetail();
await settle();

assert(navContainer.innerHTML.includes('Nav Stream Beta'), 'the next stream renders after the navigation');
const betaDetailFetches = countRequests(`/api/streams/${streamBeta.id}/detail`);
assert(betaDetailFetches === 1, `the next stream is fetched on arrival (saw ${betaDetailFetches} loads)`);

// Born with the stream, so buried with it: the modal, and the selection.
assert(!navContainer.innerHTML.includes('Song title *'), 'the add-song modal does not follow the curator to the next stream');
assert(
  rowIsSelected(navContainer, 'perf-nav-b1') && !rowIsSelected(navContainer, 'perf-nav-b2'),
  'the next stream starts on its own first row, not on the index picked in the last one',
);
assert(!navContainer.innerHTML.includes('Alpha Song'), 'no row of the previous stream is left on screen');

// Older than either stream, so it outlives both: the toast, and the stream list behind prev/next.
assert(navContainer.innerHTML.includes('Stream excluded'), 'the toast is still up once the next stream has rendered');
const streamListFetches = countRequests('/api/streams');
assert(streamListFetches === 1, `the stream list is fetched once for the page, not once per stream (saw ${streamListFetches})`);
assert(
  navContainer.querySelector(`a[href="/streams/${streamAlpha.id}"]`) !== null,
  'prev/next navigation still works after the move, from the stream list fetched on the first stream',
);

await act(async () => {
  navRoot.unmount();
});
navContainer.remove();
await navWin.happyDOM.close();

console.log('✓ StreamDetail starts each stream fresh, keeps the toast and the stream list across the move, and lets a pick outrank the deep link');
