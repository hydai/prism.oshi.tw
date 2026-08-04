import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';
import type { AuthUser, GlobalWorkSummary, GlobalWorksResponse } from '../../shared/types';

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

async function main(): Promise<void> {
  installLocalStorage();

  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const response: GlobalWorksResponse = {
    data: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
    stats: {
      totalWorks: 0,
      sharedWorks: 0,
      linkedSongs: 0,
      linkedPerformances: 0,
      unlinkedSongs: 0,
    },
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      const body = requestedUrl.endsWith('/tags/bulk')
        ? { updated: [{ id: 'work-1', tags: ['genre:rock'] }] }
        : requestedUrl.includes('/tags')
          ? { id: 'work-1', tags: ['genre:rock'] }
          : response;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const { api } = await import('../src/api/client');
  const { getVisibleNavItems } = await import('../src/lib/navigation');
  const { default: GlobalWorks } = await import('../src/pages/GlobalWorks');
  const { SortHeader } = await import('../src/components/SortHeader');
  const { default: TagPicker } = await import('../src/components/TagPicker');
  const { globalWorksReducer, initialGlobalWorksState } = await import('../src/pages/global-works-state');

  await api.listGlobalWorks({ search: 'Shared', sharedOnly: true, page: 1 });
  assert(requestedUrl.startsWith('/api/works?'), 'global library uses the global works endpoint');
  assert(requestedUrl.includes('search=Shared'), 'global library binds its search query');
  assert(requestedUrl.includes('sharedOnly=true'), 'global library requests cross-streamer-only results');
  assert(!requestedUrl.includes('streamer='), 'global library is never scoped by the selected streamer');

  await api.listGlobalWorks({ tag: 'genre:rock', untaggedOnly: false });
  assert(requestedUrl.includes('tag=genre%3Arock'), 'global library can filter by a stable tag ID');

  await api.updateWorkTags('work-1', { tags: ['genre:rock'] });
  assert(requestedUrl === '/api/works/work-1/tags', 'single work tag update stays global');
  assert(requestedInit?.method === 'PUT', 'single work tag update uses PUT');
  assert(String(requestedInit?.body).includes('genre:rock'), 'single work tag update sends stable IDs');

  await api.bulkUpdateWorkTags({ workIds: ['work-1'], addTags: ['genre:rock'], removeTags: [] });
  assert(requestedUrl === '/api/works/tags/bulk', 'bulk work tag update stays global');
  assert(requestedInit?.method === 'POST', 'bulk work tag update uses POST');

  const loaded = globalWorksReducer(
    { ...initialGlobalWorksState, page: 2, selectedWorkIds: new Set(['work-1']), editingWorkId: 'work-1' },
    {
      type: 'loadSucceeded',
      response: {
        ...response,
        data: [{
          id: 'work-1',
          title: 'Shared',
          originalArtist: 'Artist',
          tags: [],
          streamerCount: 1,
          songCount: 1,
          performanceCount: 1,
          streamerIds: ['mizuki'],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        }],
        total: 1,
        totalPages: 1,
      },
    },
  );
  assert(loaded.works.length === 1 && loaded.total === 1, 'a load replaces the listed works and totals');
  assert(loaded.selectedWorkIds.size === 0 && loaded.editingWorkId === null, 'a load drops selection and inline editing of stale rows');

  const tagFiltered = globalWorksReducer(
    { ...initialGlobalWorksState, page: 3, untaggedOnly: true },
    { type: 'tagFilterChanged', tagFilter: 'genre:rock' },
  );
  assert(tagFiltered.page === 1 && tagFiltered.tagFilter === 'genre:rock', 'choosing a tag filter restarts from page one');
  assert(!tagFiltered.untaggedOnly, 'a tag filter switches "untagged only" off');
  const untagged = globalWorksReducer(tagFiltered, { type: 'untaggedOnlyChanged', untaggedOnly: true });
  assert(untagged.untaggedOnly && untagged.tagFilter === '', '"untagged only" clears the tag filter');

  const sortedByTitle = globalWorksReducer(initialGlobalWorksState, { type: 'sortToggled', sortKey: 'title' });
  assert(sortedByTitle.sortKey === 'title' && sortedByTitle.sortDir === 'asc', 'text columns start ascending');
  const flipped = globalWorksReducer(sortedByTitle, { type: 'sortToggled', sortKey: 'title' });
  assert(flipped.sortDir === 'desc', 'toggling the active column flips its direction');

  const selected = globalWorksReducer(loaded, { type: 'pageSelectionToggled' });
  assert(selected.selectedWorkIds.has('work-1'), 'page selection selects every listed work');
  assert(globalWorksReducer(selected, { type: 'pageSelectionToggled' }).selectedWorkIds.size === 0, 'page selection toggles back to none');
  const bulkApplied = globalWorksReducer(
    { ...selected, batchTags: ['genre:rock'] },
    { type: 'bulkTagsApplied', updated: [{ id: 'work-1', tags: ['genre:rock'] }] },
  );
  assert(bulkApplied.works[0]?.tags[0] === 'genre:rock', 'a bulk update patches the listed works in place');
  assert(bulkApplied.batchTags.length === 0 && bulkApplied.selectedWorkIds.size === 0, 'a bulk update resets the batch editor');

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getVisibleNavItems(curator).some((item) => item.to === '/works'),
    'curators see the Global Library navigation entry',
  );
  assert(
    !getVisibleNavItems(contributor).some((item) => item.to === '/works'),
    'contributors do not see the Global Library navigation entry',
  );

  const html = renderToStaticMarkup(<GlobalWorks />);
  assert(html.includes('Global Song Library'), 'global library page renders its heading');
  assert(html.includes('Shared by multiple VTubers only'), 'global library page renders its cross-streamer filter');
  assert(html.includes('Unlinked songs'), 'global library page renders its coverage warning card');

  const sortHeaderHtml = renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <SortHeader
            label="Title"
            field="title"
            activeField="title"
            direction="asc"
            onSort={() => undefined}
          />
        </tr>
      </thead>
    </table>,
  );
  assert(sortHeaderHtml.includes('aria-sort="ascending"'), 'active column header exposes its sort direction');
  assert(sortHeaderHtml.includes('<button type="button"'), 'sortable column header uses a keyboard-accessible button');
  assert(sortHeaderHtml.includes('aria-hidden="true"'), 'decorative sort arrow stays out of the accessible name');

  const pickerHtml = renderToStaticMarkup(
    <TagPicker value={['genre:rock']} onChange={() => undefined} recommendedScope="work" />,
  );
  assert(pickerHtml.includes('搖滾'), 'tag picker renders localized labels');
  assert(pickerHtml.includes('aria-pressed="true"'), 'tag picker exposes selected state');

  console.log('✓ Global Library stays site-wide and curator-only');
}

function work(overrides: Partial<GlobalWorkSummary> = {}): GlobalWorkSummary {
  return {
    id: 'work-1',
    title: 'Work One',
    originalArtist: 'Artist One',
    tags: [],
    streamerCount: 1,
    songCount: 1,
    performanceCount: 1,
    streamerIds: ['mizuki'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface PendingFetch {
  url: string;
  respond: (body: unknown) => void;
}

/** Every load the page has started, in order; the test resolves each one explicitly. */
const pendingFetches: PendingFetch[] = [];

function stubQueuedFetch(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (input: RequestInfo | URL) =>
      new Promise<Response>((resolve) => {
        pendingFetches.push({
          url: String(input),
          respond: (body: unknown) => resolve(new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })),
        });
      }),
  });
}

function pendingAt(index: number): PendingFetch {
  const pending = pendingFetches[index];
  assert(pending !== undefined, `the page started load #${index + 1}`);
  return pending;
}

/**
 * Mounts the real page against a live DOM (the way `tests/stream-detail-ui.test.tsx` mounts
 * StreamDetail) to pin what `renderToStaticMarkup` above cannot see: the migration from a
 * hand-rolled fetch effect onto `useApiResource` must still start one load on mount, still
 * flip straight from loading to the resolved table with no extra render in between, and still
 * restart the loading state on the very render a filter/page change is made — not one render
 * later, the way writing `loading` from inside the effect used to.
 */
async function globalWorksLoadsThroughTheHook(): Promise<void> {
  installLocalStorage();
  stubQueuedFetch();

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

  const { default: GlobalWorks } = await import('../src/pages/GlobalWorks');

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  // Every commit of the page, mount included: a hand-rolled effect that writes `loading`
  // itself (the pre-fix `GlobalWorks`) resolves a load in two commits — one where the data
  // lands but `loading` hasn't caught up yet, and a second, one microtask later, where
  // `.finally()` flips it — instead of the one commit a derived `loading` produces. Content
  // assertions on `container.innerHTML` cannot see this: `act()` drains every one of those
  // commits before it returns control, so the DOM the test can inspect is already the settled
  // one either way. Only counting commits catches the difference — exactly why
  // `tests/api-resource.test.ts`'s `hookDerivesLoading` does the same.
  let commitCount = 0;
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);

  await act(async () => {
    root.render(
      <Profiler id="global-works" onRender={() => { commitCount += 1; }}>
        <GlobalWorks />
      </Profiler>,
    );
  });

  assert(container.innerHTML.includes('Loading...'), 'the page starts in its loading state');
  assert(!container.innerHTML.includes('Work One'), 'no row renders before the first response');
  // Read into a local before asserting: `assert` narrows what it is handed, and reusing
  // `pendingFetches.length`/`commitCount` directly across assertions with different expected
  // values later would make one of those comparisons a type error.
  const loadsAfterMount = pendingFetches.length;
  assert(loadsAfterMount === 1, 'mounting starts exactly one load');
  const commitsAfterMount = commitCount;
  assert(commitsAfterMount === 1, 'mounting commits once, already in its loading state');
  assert(pendingAt(0).url.startsWith('/api/works?'), 'the load uses the global works endpoint');
  assert(pendingAt(0).url.includes('page=1'), 'the first load requests page 1');
  assert(pendingAt(0).url.includes('pageSize=50'), 'the load requests the fixed page size');
  assert(pendingAt(0).url.includes('sortBy=performanceCount'), 'the load requests the default sort column');
  assert(pendingAt(0).url.includes('sortDir=desc'), 'the load requests the default sort direction');
  assert(!pendingAt(0).url.includes('sharedOnly'), 'sharedOnly is omitted while its filter is off');
  assert(!pendingAt(0).url.includes('search='), 'no search term is sent before one is submitted');

  const firstPage: GlobalWorksResponse = {
    data: [work()],
    total: 120,
    page: 1,
    pageSize: 50,
    totalPages: 3,
    stats: { totalWorks: 120, sharedWorks: 4, linkedSongs: 300, linkedPerformances: 900, unlinkedSongs: 2 },
  };
  await act(async () => {
    pendingAt(0).respond(firstPage);
  });
  await settle();

  assert(!container.innerHTML.includes('Loading...'), 'the first response ends the loading state');
  assert(container.innerHTML.includes('Work One'), 'the first page of works renders');
  assert(container.innerHTML.includes('120'), 'the stats card renders the resolved total');
  assert(container.innerHTML.includes('Showing 1') && container.innerHTML.includes('of 120'), 'pagination reflects the resolved total');
  assert(container.innerHTML.includes('Page 1 of 3'), 'pagination reflects the resolved page count');
  const commitsAfterFirstLoad = commitCount;
  assert(
    commitsAfterFirstLoad === commitsAfterMount + 1,
    'the first response ends the load in exactly one more commit — no extra render just to flip loading behind it',
  );

  const nextButton = [...container.querySelectorAll<DomElement>('button')].find(
    (button) => button.textContent.trim() === 'Next',
  );
  assert(nextButton !== undefined, 'pagination renders a Next button once there is a second page');
  await act(async () => {
    nextButton.click();
  });

  assert(
    container.innerHTML.includes('Loading...'),
    'moving to the next page returns to the loading state on the very render that changed the page, not one render later',
  );
  const loadsAfterNext = pendingFetches.length;
  assert(loadsAfterNext === 2, 'the page change starts a second load');
  assert(pendingAt(1).url.includes('page=2'), 'the second load requests the next page');
  const commitsAfterNextClick = commitCount;
  assert(
    commitsAfterNextClick === commitsAfterFirstLoad + 1,
    'the page change is loading on its own first commit — no separate commit was needed to flip loading on afterward',
  );

  const secondPage: GlobalWorksResponse = {
    ...firstPage,
    data: [work({ id: 'work-2', title: 'Work Two' })],
    page: 2,
  };
  await act(async () => {
    pendingAt(1).respond(secondPage);
  });
  await settle();

  assert(container.innerHTML.includes('Work Two'), 'the second page of works renders');
  assert(!container.innerHTML.includes('Work One'), 'the previous page no longer renders once the new page has loaded');
  assert(container.innerHTML.includes('Page 2 of 3'), 'pagination reflects the new page');
  const commitsAfterSecondLoad = commitCount;
  assert(
    commitsAfterSecondLoad === commitsAfterNextClick + 1,
    'the second response ends its load in exactly one more commit too',
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
  await win.happyDOM.close();

  console.log('✓ Global Library loads and refetches through useApiResource with no extra render');
}

await main();
await globalWorksLoadsThroughTheHook();
