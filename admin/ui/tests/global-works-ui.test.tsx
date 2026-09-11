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
    value: async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const { api } = await import('../src/api/client');
  const { getVisibleNavItems } = await import('../src/lib/navigation');
  const { default: GlobalWorks } = await import('../src/pages/GlobalWorks');
  const { SortHeader } = await import('../src/components/SortHeader');

  await api.listGlobalWorks({ search: 'Shared', sharedOnly: true, page: 1 });
  assert(requestedUrl.startsWith('/api/works?'), 'global library uses the global works endpoint');
  assert(requestedUrl.includes('search=Shared'), 'global library binds its search query');
  assert(requestedUrl.includes('sharedOnly=true'), 'global library requests cross-streamer-only results');
  assert(!requestedUrl.includes('streamer='), 'global library is never scoped by the selected streamer');

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
  assert(html.includes('未標語言'), 'global library page renders the untagged-language filter');
  assert(html.includes('All tags'), 'global library page renders the tag filter select');

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
  method: string;
  body: string | null;
  respond: (body: unknown) => void;
  respondWith: (status: number, body: unknown) => void;
}

/** Every load the page has started, in order; the test resolves each one explicitly. */
const pendingFetches: PendingFetch[] = [];

function stubQueuedFetch(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        const respondWith = (status: number, body: unknown) => resolve(new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }));
        pendingFetches.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: typeof init?.body === 'string' ? init.body : null,
          respond: (body: unknown) => respondWith(200, body),
          respondWith,
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
    data: [work({ tags: ['language:ja'] })],
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
  // Scoped to the table body: the tag filter `<select>` also renders every dictionary
  // label (as its options) on every render, so an unscoped `container.innerHTML` check
  // would stay green even if the row's own tag chip were deleted.
  assert(
    container.querySelector<DomElement>('tbody')!.innerHTML.includes('日文歌'),
    'work tags render with their dictionary labels',
  );
  assert(container.innerHTML.includes('Edit tags'), 'each row offers a tag editor');
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

  const rowCheckbox = container.querySelector<DomElement>('input[aria-label="Select Work Two"]');
  assert(rowCheckbox !== null, 'each row renders a selection checkbox');
  await act(async () => { rowCheckbox.click(); });
  assert(container.innerHTML.includes('已選擇 1 個作品'), 'selecting a row shows the batch editor');
  assert(container.innerHTML.includes('加入所選標籤'), 'the batch editor offers add');
  assert(container.innerHTML.includes('移除所選標籤'), 'the batch editor offers remove');

  const editButton = [...container.querySelectorAll<DomElement>('button')].find(
    (button) => button.textContent.trim() === 'Edit tags',
  );
  assert(editButton !== undefined, 'the row exposes its Edit tags button');
  await act(async () => { editButton.click(); });
  // The batch bar opened by the row-selection click above already renders a TagPicker of
  // its own, so an unscoped presence check would already be green before this click — only
  // a count distinguishes "still just the batch bar's" from "plus the inline editor's".
  const tagPickerCount = container.querySelectorAll('[data-testid="tag-picker"]').length;
  assert(tagPickerCount === 2, 'editing a row opens a second tag picker inline, alongside the batch editor\'s');
  assert(container.innerHTML.includes('Save tags'), 'the inline editor offers Save');

  // Saving sends the row's updatedAt the editor was opened with as `expectedUpdatedAt`; a
  // 409 means someone else changed the work meanwhile — the page says so and reloads
  // instead of overwriting.
  const saveButton = [...container.querySelectorAll<DomElement>('button')].find(
    (button) => button.textContent.trim() === 'Save tags',
  );
  assert(saveButton !== undefined, 'the inline editor renders its Save button');
  await act(async () => { saveButton.click(); });
  await settle();
  assert(pendingAt(2).method === 'PUT' && pendingAt(2).url.endsWith('/api/works/work-2/tags'), 'saving PUTs the row\'s tags');
  assert(JSON.parse(pendingAt(2).body ?? '{}').expectedUpdatedAt === work().updatedAt, 'the save carries the updatedAt the editor was opened with');
  await act(async () => {
    pendingAt(2).respondWith(409, { error: 'Work tags changed since they were loaded', tags: ['language:ja'] });
  });
  await settle();
  assert(container.innerHTML.includes('剛被其他人修改'), 'a conflict is explained to the curator');
  assert(pendingAt(3).url.includes('page=2'), 'a conflict reloads the current page');
  await act(async () => {
    pendingAt(3).respond(secondPage);
  });
  await settle();
  assert(!container.innerHTML.includes('Save tags'), 'the editor is closed after the reload');

  // A page change starts a new query: the batch bar must vanish at once — the previous
  // rows are still on screen while the replacement loads, and they must not stay
  // actionable — and it must stay gone once the new page has landed.
  const previousButton = [...container.querySelectorAll<DomElement>('button')].find(
    (button) => button.textContent.trim() === 'Previous',
  );
  assert(previousButton !== undefined, 'pagination renders a Previous button on page 2');
  await act(async () => { previousButton.click(); });
  assert(container.innerHTML.includes('Loading...'), 'moving back starts a load');
  assert(!container.innerHTML.includes('已選擇'), 'the selection from the previous result set is not actionable while the new page loads');
  await act(async () => {
    pendingAt(4).respond(firstPage);
  });
  await settle();
  assert(container.innerHTML.includes('Work One'), 'the first page renders again');
  assert(!container.innerHTML.includes('已選擇'), 'no selection carries over to the new result set');

  await act(async () => {
    root.unmount();
  });
  container.remove();
  await win.happyDOM.close();

  console.log('✓ Global Library loads and refetches through useApiResource with no extra render');
}

await main();
await globalWorksLoadsThroughTheHook();
