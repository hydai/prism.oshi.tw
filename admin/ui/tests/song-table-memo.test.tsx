/**
 * The song tables are the two biggest lists in the admin UI, and every keystroke, toast and modal
 * toggle on their page used to re-render them: both took the whole controller object as one prop,
 * so any field changing meant new props.
 *
 * This probe mounts the *real* pages — real controller hooks, real callbacks — in a happy-dom
 * document and counts how often each table renders. Counting needs no instrumentation in the
 * pages: `originalArtist` is read at render time by the tables and by nothing else (the floating
 * pill reads title and timestamps), so a getter on one fixture row counts that row's renders.
 *
 * A page state change the table does not read (opening and closing the paste-import modal) must
 * not reach it; changes it does read (the selected row, a reloaded row set) must.
 */
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AuthUser,
  ListResponse,
  StampPerformance,
  StampStats,
  Stream,
  StreamDetail,
  StreamWithPending,
} from '../../shared/types';
import StampEditorPage from '../src/pages/StampEditor';
import StreamDetailPage from '../src/pages/StreamDetail';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- A DOM for React to commit into ---

const win = new Window({
  url: 'http://localhost/',
  // The editors mount a YouTube player, which appends the IFrame API script tag; nothing in this
  // probe needs that script, and fetching it would reach the network.
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
  MouseEvent: win.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// --- The API the pages load themselves from ---

function stubFetch(handle: (pathname: string) => unknown): void {
  const fetchStub: typeof fetch = async (input) => {
    const { pathname } = new URL(String(input), 'http://localhost/');
    const payload = handle(pathname);
    if (payload === undefined) throw new Error(`unstubbed request: ${pathname}`);
    return { ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response;
  };
  Object.defineProperty(globalThis, 'fetch', { value: fetchStub, configurable: true, writable: true });
}

// --- Fixtures: the second row counts its own renders ---

interface RenderCounter {
  reads: number;
}

function countingRows(counter: RenderCounter): StampPerformance[] {
  return [
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
      get originalArtist(): string {
        counter.reads += 1;
        return 'Second Artist';
      },
      timestamp: 3700,
      endTimestamp: null,
      note: '',
      status: 'approved',
    },
  ];
}

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };

const stream: StreamWithPending = {
  id: 'stream-current',
  streamerId: 'mizuki',
  title: 'Current Karaoke Stream',
  date: '2026-08-17',
  videoId: 'video-current',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-current',
  credit: {},
  status: 'pending',
  submittedBy: null,
  reviewedBy: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  pendingCount: 1,
};

// --- Mount / drive helpers ---

type Container = DomElement;

/** Lets React finish the load → select → load chain the editors run on mount. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountPage(element: ReactElement): Promise<{ container: Container; unmount: () => Promise<void> }> {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(element);
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

async function click(node: { click: () => void } | null | undefined, what: string): Promise<void> {
  assert(node !== null && node !== undefined, `the page renders ${what}`);
  await act(async () => {
    node.click();
  });
  await settle();
}

async function clickButton(container: Container, label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  await click(button, `a ${label} button`);
}

/** Sidebar entries and icon buttons have no plain text label; a title or a fragment finds them. */
async function clickBySelector(container: Container, selector: string, what: string): Promise<void> {
  await click(container.querySelector<DomElement>(selector), what);
}

async function clickButtonContaining(container: Container, text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent.includes(text),
  );
  await click(button, `a button naming ${text}`);
}

/**
 * One page's whole story: the table renders, an unrelated state change leaves it alone, and the
 * changes it does read still reach it.
 */
interface TableProbe {
  label: string;
  counter: RenderCounter;
  container: Container;
  /** Changes state the table does not read, and proves it happened. */
  unrelatedChange: () => Promise<void>;
  /** Changes a prop the table reads (the selected row). */
  selectionChange: () => Promise<void>;
  /** Replaces the row set the table renders. */
  rowSetChange: () => Promise<void>;
}

async function probeTable(probe: TableProbe): Promise<void> {
  const { label, counter, container } = probe;
  assert(container.innerHTML.includes('Second Song'), `${label}: the table renders the fixture rows`);
  assert(counter.reads > 0, `${label}: the render counter sees the table`);

  const beforeUnrelated = counter.reads;
  await probe.unrelatedChange();
  assert(
    counter.reads === beforeUnrelated,
    `${label}: page state the table does not read must not re-render it `
      + `(${counter.reads - beforeUnrelated} extra render(s))`,
  );

  const beforeSelection = counter.reads;
  await probe.selectionChange();
  assert(counter.reads > beforeSelection, `${label}: selecting another row must re-render the table`);

  const beforeRowSet = counter.reads;
  await probe.rowSetChange();
  assert(counter.reads > beforeRowSet, `${label}: a reloaded row set must re-render the table`);
}

// --- StampEditor / SongList ---

const stampCounter: RenderCounter = { reads: 0 };
const stampRows = countingRows(stampCounter);

stubFetch((pathname) => {
  if (pathname === '/api/stamp/stats') return { total: 2, filled: 1, remaining: 1 } satisfies StampStats;
  if (pathname === '/api/stamp/streams') {
    return { data: [stream], total: 1 } satisfies ListResponse<StreamWithPending>;
  }
  if (pathname === `/api/streams/${stream.id}/performances`) {
    // A fresh array each load, as the real API is: the row objects (and their counters) persist.
    return { data: [...stampRows], total: stampRows.length } satisfies ListResponse<StampPerformance>;
  }
  return undefined;
});

const stampPage = await mountPage(
  // The `stream` query parameter is the editor's deep link: it opens on that stream by itself.
  <MemoryRouter initialEntries={[`/stamp?stream=${stream.id}`]}>
    <StampEditorPage user={curator} />
  </MemoryRouter>,
);

await probeTable({
  label: 'StampEditor SongList',
  counter: stampCounter,
  container: stampPage.container,
  unrelatedChange: async () => {
    await clickButton(stampPage.container, 'Paste Import');
    assert(
      stampPage.container.innerHTML.includes('Paste a timestamp list'),
      'StampEditor SongList: the paste-import modal really opened',
    );
    await clickButton(stampPage.container, 'Cancel');
    assert(
      !stampPage.container.innerHTML.includes('Paste a timestamp list'),
      'StampEditor SongList: the paste-import modal really closed',
    );
  },
  selectionChange: async () => {
    await clickButton(stampPage.container, '#2');
    const rowTwo = stampPage.container.querySelector<DomElement>('[title="Select song 2"]');
    assert(
      rowTwo?.getAttribute('aria-pressed') === 'true',
      'StampEditor SongList: the clicked row really became the selected one',
    );
  },
  rowSetChange: async () => {
    // Re-picking the open stream reloads its performances into a new array.
    await clickButtonContaining(stampPage.container, stream.title);
  },
});

await stampPage.unmount();

// --- StreamDetail / PerformanceTable ---

const detailCounter: RenderCounter = { reads: 0 };
const detailRows = countingRows(detailCounter);
const detail: StreamDetail = { ...stream, credit: { author: 'Timestamp Curator' }, performances: detailRows };

stubFetch((pathname) => {
  if (pathname === '/api/streams') return { data: [detail], total: 1 } satisfies ListResponse<Stream>;
  if (pathname === `/api/streams/${detail.id}/detail`) {
    // A fresh array each load, as the real API is: the row objects (and their counters) persist.
    return { ...detail, performances: [...detailRows] } satisfies StreamDetail;
  }
  if (pathname === '/api/performances/performance-two/status') return { ok: true };
  return undefined;
});

const detailPage = await mountPage(
  <MemoryRouter initialEntries={[`/streams/${detail.id}`]}>
    <Routes>
      <Route path="/streams/:id" element={<StreamDetailPage user={curator} />} />
    </Routes>
  </MemoryRouter>,
);

await probeTable({
  label: 'StreamDetail PerformanceTable',
  counter: detailCounter,
  container: detailPage.container,
  unrelatedChange: async () => {
    await clickButton(detailPage.container, 'Paste Import');
    assert(
      detailPage.container.innerHTML.includes('Paste a timestamp list'),
      'StreamDetail PerformanceTable: the paste-import modal really opened',
    );
    await clickButton(detailPage.container, 'Cancel');
    assert(
      !detailPage.container.innerHTML.includes('Paste a timestamp list'),
      'StreamDetail PerformanceTable: the paste-import modal really closed',
    );
  },
  selectionChange: async () => {
    await clickBySelector(detailPage.container, '#performance-row-performance-two', 'a performance row');
    const rowTwo = detailPage.container.querySelector<DomElement>('#performance-row-performance-two');
    const rowOne = detailPage.container.querySelector<DomElement>('#performance-row-performance-one');
    assert(
      rowTwo?.getAttribute('class')?.includes('bg-blue-50') === true
        && rowOne?.getAttribute('class')?.includes('bg-blue-50') === false,
      'StreamDetail PerformanceTable: the clicked row really became the selected one',
    );
  },
  rowSetChange: async () => {
    // Unapproving a row writes, then reloads the stream detail into a new performances array.
    await clickBySelector(detailPage.container, '[title="Unapprove"]', 'the row unapprove button');
  },
});

await detailPage.unmount();

await win.happyDOM.close();

console.log('✓ the song tables ignore page state they do not read, and still follow the rows they do');
