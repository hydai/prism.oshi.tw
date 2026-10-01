import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement, HTMLSelectElement as DomSelectElement } from 'happy-dom';
import type { AuthUser, GlobalWorkSummary, GlobalWorksResponse } from '../../shared/types';
import { isKitDangerNote } from './helpers/note';
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
  const { getNavGroups } = await import('../src/lib/navigation');
  const { default: GlobalWorks } = await import('../src/pages/GlobalWorks');
  const { SortHeader } = await import('../src/components/ui/Table');

  await api.listGlobalWorks({ search: 'Shared', sharedOnly: true, page: 1 });
  assert(requestedUrl.startsWith('/api/works?'), 'global library uses the global works endpoint');
  assert(requestedUrl.includes('search=Shared'), 'global library binds its search query');
  assert(requestedUrl.includes('sharedOnly=true'), 'global library requests cross-streamer-only results');
  assert(!requestedUrl.includes('streamer='), 'global library is never scoped by the selected streamer');

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getNavGroups(curator).flatMap((group) => group.items).some((item) => item.to === '/works'),
    'curators see the Global Library navigation entry',
  );
  assert(
    !getNavGroups(contributor).flatMap((group) => group.items).some((item) => item.to === '/works'),
    'contributors do not see the Global Library navigation entry',
  );

  // In a router: the page's "Review duplicates" link is a react-router Link.
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <GlobalWorks />
    </MemoryRouter>,
  );
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
 * `act`-wrapped microtask flushes — enough rounds for a fetch's `.then()` chain and the
 * resulting re-render to fully settle before the next assertion reads the DOM. Shared by every
 * live-mount function below (`globalWorksLoadsThroughTheHook`, `allWorksChipAndSortSummary`).
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
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
  const { ToastProvider } = await import('../src/components/ui/toast');

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
      <MemoryRouter>
        {/* Outside the Profiler: the provider's value never changes, so the counts below stay the page's own. */}
        <ToastProvider>
          <Profiler id="global-works" onRender={() => { commitCount += 1; }}>
            <GlobalWorks />
          </Profiler>
        </ToastProvider>
      </MemoryRouter>,
    );
  });

  assert(container.innerHTML.includes('Loading...'), 'the page starts in its loading state');
  assert(!container.innerHTML.includes('Work One'), 'no row renders before the first response');
  assert(!container.innerHTML.includes('all linked'), 'the placeholder zeros shown before the first response do not claim "all linked"');
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
    data: [
      work({ tags: ['language:ja'] }),
      work({
        id: 'work-many',
        title: 'Work Many',
        streamerIds: ['alpha', 'bravo', 'charlie', 'delta', 'echo'],
        streamerCount: 5,
        tags: ['language:zh', 'language:ja', 'language:en', 'source:vocaloid'],
      }),
      work({ id: 'work-pair', title: 'Work Pair', tags: ['language:ja', 'source:vocaloid'] }),
      work({
        id: 'work-wide',
        title: 'Work Wide Names',
        streamerIds: ['earendel', 'hibiki', 'margaretnorth', 'mizuki'],
        streamerCount: 4,
      }),
    ],
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
  // The tile is the parent of its label; the fixture reports 2 unlinked songs.
  const unlinkedTile = [...container.querySelectorAll<DomElement>('*')].find(
    (element) => element.textContent === 'Unlinked songs',
  )?.parentElement;
  assert(unlinkedTile !== null && unlinkedTile !== undefined, 'the Unlinked songs tile renders');
  assert(
    unlinkedTile.innerHTML.includes('text-tone-warn-fg') && unlinkedTile.textContent.includes('2'),
    'the Unlinked songs tile warns while songs are still unlinked',
  );
  assert(!container.innerHTML.includes('all linked'), 'no "all linked" while songs are still unlinked');

  // One line per row: the VTuber and tag cells never wrap. They show the first few chips; the
  // rest fold into a `+N` chip that names them in its tooltip, and in an sr-only list.
  const manyRow = [...container.querySelectorAll<DomElement>('tbody tr')].find((row) => row.textContent.includes('Work Many'));
  assert(manyRow !== undefined, 'the work with five VTubers and four tags renders');
  // Three VTuber chips fit before `+N`; two tag pills fit, so with more tags `+N` takes the second's place.
  const chipCells = [
    { name: 'VTuber', index: 3, visible: ['alpha', 'bravo', 'charlie'], hidden: ['delta', 'echo'] },
    { name: 'tag', index: 6, visible: ['中文歌'], hidden: ['日文歌', '英文歌', 'Vocaloid'] },
  ];
  for (const cell of chipCells) {
    const box = manyRow.children[cell.index]?.firstElementChild as DomElement | null | undefined;
    assert(box !== null && box !== undefined, `the ${cell.name} cell holds a chip box`);
    const classes = (box.getAttribute('class') ?? '').split(/\s+/);
    assert(
      ['flex-nowrap', 'overflow-hidden', 'min-w-0'].every((name) => classes.includes(name)) && !classes.includes('flex-wrap'),
      `the ${cell.name} chips stay on one line (found: ${classes.join(' ')})`,
    );
    const shown = [...box.children].filter((child) => child.getAttribute('aria-hidden') !== 'true' && child.tagName !== 'UL');
    assert(
      shown.map((child) => child.textContent.trim()).join('|') === cell.visible.join('|'),
      `the ${cell.name} cell shows ${cell.visible.join(', ')} (found: ${shown.map((child) => child.textContent.trim()).join(', ')})`,
    );
    const more = [...box.children].find((child) => child.getAttribute('aria-hidden') === 'true');
    assert(
      more !== undefined && more.textContent.trim() === `+${cell.hidden.length}` && more.getAttribute('title') === cell.hidden.join(', '),
      `the ${cell.name} cell folds the rest into +${cell.hidden.length}, named in its title`,
    );
    const srList = box.querySelector('ul.sr-only');
    assert(
      srList !== null && [...srList.querySelectorAll('li')].map((item) => item.textContent).join('|') === cell.hidden.join('|'),
      `a screen reader gets the ${cell.name}s the chip leaves out as a list`,
    );
  }
  const pairRow = [...container.querySelectorAll<DomElement>('tbody tr')].find((row) => row.textContent.includes('Work Pair'));
  const pairTags = pairRow?.children[6]?.firstElementChild;
  assert(
    pairTags !== null && pairTags !== undefined && pairTags.textContent === '日文歌Vocaloid'
      && pairTags.querySelector('[aria-hidden="true"]') === null && pairTags.querySelector('ul') === null,
    'a work with two tags shows both, with no +N',
  );

  // Otherwise — the first three slugs' own characters running past the cutoff — the cell folds to
  // two chips before `+N` instead of three: the same real slugs that ellipsized all three in
  // Chromium at 1280px (data/{slug}/songs.json): "earendel", "hibiki", "margaretnorth".
  const wideRow = [...container.querySelectorAll<DomElement>('tbody tr')].find((row) => row.textContent.includes('Work Wide Names'));
  assert(wideRow !== undefined, 'the work with four long VTuber slugs renders');
  const wideBox = wideRow.children[3]?.firstElementChild as DomElement | null | undefined;
  assert(wideBox !== null && wideBox !== undefined, 'the wide-slug VTuber cell holds a chip box');
  const wideShown = [...wideBox.children]
    .filter((child) => child.getAttribute('aria-hidden') !== 'true' && child.tagName !== 'UL')
    .map((child) => child.textContent.trim());
  assert(
    wideShown.join('|') === 'earendel|hibiki',
    `three long VTuber slugs would ellipsize at 1280px, so the cell folds to two (found: ${wideShown.join(', ')})`,
  );
  const wideMore = [...wideBox.children].find((child) => child.getAttribute('aria-hidden') === 'true');
  assert(
    wideMore !== undefined && wideMore.textContent.trim() === '+2' && wideMore.getAttribute('title') === 'margaretnorth, mizuki',
    'the rest still fold into +N, named in its title, when the cell has dropped to two chips',
  );
  const wideSrList = wideBox.querySelector('ul.sr-only');
  assert(
    wideSrList !== null && [...wideSrList.querySelectorAll('li')].map((item) => item.textContent).join('|') === 'margaretnorth|mizuki',
    'a screen reader still gets the dropped VTubers as a list',
  );

  assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the loaded page uses no raw Tailwind palette classes');
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
    stats: { ...firstPage.stats, unlinkedSongs: 0 },
  };
  await act(async () => {
    pendingAt(1).respond(secondPage);
  });
  await settle();

  assert(container.innerHTML.includes('Work Two'), 'the second page of works renders');
  assert(container.innerHTML.includes('all linked'), 'once the stats report 0 unlinked songs, the tile says "all linked"');
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

  const editButton = container.querySelector<DomElement>('button[aria-label="Edit tags"]');
  assert(editButton !== null, 'the row exposes its Edit tags button');
  await act(async () => { editButton.click(); });
  // The batch bar opened by the row-selection click above already renders a TagPicker of
  // its own, so an unscoped presence check would already be green before this click — only
  // a count distinguishes "still just the batch bar's" from "plus the inline editor's".
  const tagPickerCount = container.querySelectorAll('[data-testid="tag-picker"]').length;
  assert(tagPickerCount === 2, 'editing a row opens a second tag picker inline, alongside the batch editor\'s');
  assert(container.innerHTML.includes('Save tags'), 'the inline editor offers Save');
  assert(
    (container.querySelector<DomElement>('tbody h2')?.textContent ?? '').includes('共用作品標籤') && container.querySelector('tbody h3') === null,
    'the inline editor is titled by an <h2>, the level under the page <h1>',
  );
  assert(
    !NO_RAW_PALETTE.test(container.innerHTML),
    'the bulk bar, its tag popover and the inline editor use no raw Tailwind palette classes',
  );

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
  const conflictNote = [...container.querySelectorAll<DomElement>('[role="alert"]')].find((alert) =>
    alert.textContent.includes('剛被其他人修改'),
  );
  assert(conflictNote !== undefined && isKitDangerNote(conflictNote), 'a conflict is shown in the kit danger Note');
  assert(pendingAt(3).url.includes('page=2'), 'a conflict reloads the current page');
  await act(async () => {
    pendingAt(3).respond(secondPage);
  });
  await settle();
  assert(!container.innerHTML.includes('Save tags'), 'the editor is closed after the reload');

  // A page change starts a new query: the batch bar must vanish at once — the previous
  // rows are still loaded while the replacement loads (a skeleton shows instead), and they
  // must not stay actionable — and it must stay gone once the new page has landed.
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

  // A save and a batch apply each confirm themselves with a toast.
  const notifications = () => container.querySelector<DomElement>('section[aria-label="Notifications"]')?.textContent ?? '';
  const editFirst = container.querySelector<DomElement>('button[aria-label="Edit tags"]');
  assert(editFirst !== null, 'the first row exposes its Edit tags button');
  await act(async () => { editFirst.click(); });
  const saveFirst = [...container.querySelectorAll<DomElement>('button')].find((button) => button.textContent.trim() === 'Save tags');
  assert(saveFirst !== undefined, 'the inline editor renders its Save button again');
  await act(async () => { saveFirst.click(); });
  await settle();
  assert(pendingAt(5).method === 'PUT' && pendingAt(5).url.endsWith('/api/works/work-1/tags'), "saving PUTs the first row's tags");
  await act(async () => {
    pendingAt(5).respond({ id: 'work-1', tags: ['language:ja'] });
  });
  await settle();
  assert(notifications().includes('Tags saved'), 'a successful save says "Tags saved"');
  await act(async () => {
    pendingAt(6).respond(firstPage);
  });
  await settle();

  const selectFirst = container.querySelector<DomElement>('input[aria-label="Select Work One"]');
  assert(selectFirst !== null, 'the first row renders its selection checkbox');
  await act(async () => { selectFirst.click(); });
  const batchJapanese = container.querySelector<DomElement>('[aria-label="Bulk actions"] [data-testid="tag-option-language-ja"]');
  assert(batchJapanese !== null, "the batch bar's tag picker offers 日文歌");
  await act(async () => { batchJapanese.click(); });
  const addToSelection = [...container.querySelectorAll<DomElement>('[aria-label="Bulk actions"] button')].find((button) =>
    button.textContent.includes('加入所選標籤'),
  );
  assert(addToSelection !== undefined, 'the batch bar offers add');
  await act(async () => { addToSelection.click(); });
  await settle();
  assert(pendingAt(7).method === 'POST' && pendingAt(7).url.endsWith('/api/works/tags/bulk'), 'the batch POSTs to the bulk endpoint');
  await act(async () => {
    pendingAt(7).respond({ updated: [{ id: 'work-1', tags: ['language:ja'] }], skipped: [] });
  });
  await settle();
  assert(notifications().includes('Tags updated on 1 works'), 'a batch apply says how many works it updated');
  await act(async () => {
    pendingAt(8).respond(firstPage);
  });
  await settle();

  await act(async () => {
    root.unmount();
  });
  container.remove();
  await win.happyDOM.close();

  console.log('✓ Global Library loads and refetches through useApiResource with no extra render');
}

/**
 * The `All works` chip and the sort summary next to it: its own fresh mount and its own fetch
 * queue (reset up front) so these indices never shift `globalWorksLoadsThroughTheHook`'s
 * `pendingAt` calls above.
 */
async function allWorksChipAndSortSummary(): Promise<void> {
  installLocalStorage();
  pendingFetches.length = 0;
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
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  const { default: GlobalWorks } = await import('../src/pages/GlobalWorks');
  const { ToastProvider } = await import('../src/components/ui/toast');

  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastProvider>
          <GlobalWorks />
        </ToastProvider>
      </MemoryRouter>,
    );
  });

  // Row content is irrelevant here — the same fixture is reused for every response until the
  // zero-total one at the very end, and every action in between resets `page` to 1, so
  // `total: 120` keeps the range reading "1–50 of 120" throughout.
  const response: GlobalWorksResponse = {
    data: [],
    total: 120,
    page: 1,
    pageSize: 50,
    totalPages: 3,
    stats: { totalWorks: 120, sharedWorks: 4, linkedSongs: 300, linkedPerformances: 900, unlinkedSongs: 2 },
  };
  await act(async () => {
    pendingAt(0).respond(response);
  });
  await settle();

  function chip(label: string): DomElement {
    const found = [...container.querySelectorAll<DomElement>('button[aria-pressed]')].find(
      (button) => button.textContent.trim() === label,
    );
    assert(found !== undefined, `a chip labelled "${label}" renders`);
    return found;
  }
  function summary(): string {
    const el = container.querySelector<DomElement>('.ml-auto.text-token-sm.text-fg-muted');
    assert(el !== null, 'the sort summary renders');
    return el.textContent;
  }
  function tagSelect(): DomSelectElement {
    const found = container.querySelector<DomSelectElement>('select[aria-label="Filter global works by tag"]');
    assert(found !== null, 'the tag filter select renders');
    return found;
  }
  /**
   * Sets a (React-controlled) `<select>`'s value the way picking an option does, then settles.
   * React keeps its own copy of a controlled field's value on the node (`tests/helpers/dom.ts`'s
   * `typeInto` has the same note for text inputs); writing through the prototype's `value` setter
   * changes the DOM value without touching that copy, so the `change` event reads as a real pick
   * and fires onChange.
   */
  async function selectOption(select: DomSelectElement, value: string): Promise<void> {
    let setValue: ((next: string) => void) | undefined;
    for (let proto: object | null = Object.getPrototypeOf(select); proto && !setValue; proto = Object.getPrototypeOf(proto)) {
      setValue = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    }
    // Cast to the ambient DOM type for the dispatch itself: happy-dom's own `Event` type (what
    // its `dispatchEvent` expects) isn't what `new Event(...)` resolves to under this ambient-DOM
    // tsconfig — `tests/stream-detail-ui.test.tsx`'s `keyDown` does the same for the same reason.
    const element = select as unknown as HTMLSelectElement;
    await act(async () => {
      if (setValue) setValue.call(select, value);
      else element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
  }
  /** Re-queried on every call: the Title header's button unmounts and remounts with the rest of
   *  `WorksTable` each time a filter/sort/page change starts a fresh, loading, request. */
  function titleButton(): DomElement {
    const found = [...container.querySelectorAll<DomElement>('th button')].find(
      (button) => button.textContent.trim() === 'Title',
    );
    assert(found !== undefined, 'the Title column header renders');
    return found;
  }
  /** The Title header's own `aria-sort`, asserted to actually hold a direction. The summary's
   *  direction word is always checked against this, never against a hard-coded literal, so a
   *  wrong pairing between the header and the summary would still be caught. */
  function titleDirection(): 'ascending' | 'descending' {
    const th = [...container.querySelectorAll<DomElement>('th[aria-sort]')].find(
      (cell) => cell.textContent.trim() === 'Title',
    );
    assert(th !== undefined, 'the Title header renders with an aria-sort attribute');
    const value = th.getAttribute('aria-sort');
    assert(value === 'ascending' || value === 'descending', `the Title header's aria-sort names a direction (found: ${value})`);
    return value;
  }

  assert(chip('All works').getAttribute('aria-pressed') === 'true', 'the All works chip is pressed on load');
  assert(
    summary() === 'Sorted by Performances, descending · 1–50 of 120',
    `the summary names the default sort and the range on load (found: ${summary()})`,
  );
  // What a screen reader reads: the separator is hidden from it, its spaces are not (and, as a
  // screen reader does, runs of whitespace read as one).
  const spokenSummary = container.querySelector<DomElement>('.ml-auto.text-token-sm.text-fg-muted')?.cloneNode(true) as DomElement | undefined;
  for (const hidden of spokenSummary?.querySelectorAll<DomElement>('[aria-hidden="true"]') ?? []) hidden.remove();
  const spoken = (spokenSummary?.textContent ?? '').replace(/\s+/g, ' ');
  assert(
    spoken === 'Sorted by Performances, descending 1–50 of 120',
    `assistive technology reads the summary with a space where the separator was (found: ${spoken})`,
  );

  // A tag chosen in the <select> is a separate control that All works must leave alone —
  // chosen before the toggles below so the later All-works click has one active to check.
  await selectOption(tagSelect(), 'language:ja');
  await act(async () => { pendingAt(1).respond(response); });
  await settle();
  assert(pendingAt(1).url.includes('tag=language%3Aja'), 'choosing a tag requests it');

  // Turning on the shared-only filter alone already un-presses All works.
  await act(async () => { chip('Shared by multiple VTubers only').click(); });
  assert(chip('All works').getAttribute('aria-pressed') === 'false', 'All works un-presses once the shared filter alone is active');
  await act(async () => { pendingAt(2).respond(response); });
  await settle();

  // Turning on the second toggle too: both are now pressed, All works stays un-pressed.
  await act(async () => { chip('未標語言').click(); });
  await act(async () => { pendingAt(3).respond(response); });
  await settle();
  assert(chip('Shared by multiple VTubers only').getAttribute('aria-pressed') === 'true', 'the shared filter is pressed');
  assert(chip('未標語言').getAttribute('aria-pressed') === 'true', 'the untagged filter is pressed');
  assert(chip('All works').getAttribute('aria-pressed') === 'false', 'All works stays un-pressed with both filters active');

  // Drive the page away from 1 before clicking All works: otherwise "the request asks for page
  // 1" would hold even if `onAllWorks` never reset the page, since it would never have left 1.
  const nextButton = [...container.querySelectorAll<DomElement>('button')].find(
    (button) => button.textContent.trim() === 'Next',
  );
  assert(nextButton !== undefined, 'pagination renders a Next button');
  await act(async () => { nextButton.click(); });
  await act(async () => { pendingAt(4).respond(response); });
  await settle();
  assert(pendingAt(4).url.includes('page=2'), 'moving to the next page requests it');

  // All works clears both toggles and the page in one click, but leaves the tag filter (both
  // the <select>'s own value and the next request) alone.
  await act(async () => { chip('All works').click(); });
  assert(chip('All works').getAttribute('aria-pressed') === 'true', 'clicking All works re-presses it');
  assert(chip('Shared by multiple VTubers only').getAttribute('aria-pressed') === 'false', 'All works un-presses the shared filter');
  assert(chip('未標語言').getAttribute('aria-pressed') === 'false', 'All works un-presses the untagged filter');
  assert(tagSelect().value === 'language:ja', "the All works click leaves the tag select's value unchanged");
  assert(!pendingAt(5).url.includes('sharedOnly'), 'the All works request drops the shared filter');
  assert(!pendingAt(5).url.includes('untaggedOnly'), 'the All works request drops the untagged filter');
  assert(pendingAt(5).url.includes('page=1'), 'the All works request asks for page 1, having actually moved off it');
  assert(pendingAt(5).url.includes('tag=language%3Aja'), 'the All works request still carries the tag filter');
  await act(async () => { pendingAt(5).respond(response); });
  await settle();

  // The summary names whichever column is sorted, matching that header's own aria-sort.
  await act(async () => { titleButton().click(); });
  await act(async () => { pendingAt(6).respond(response); });
  await settle();
  const firstDirection = titleDirection();
  assert(firstDirection === 'ascending', 'sorting by Title for the first time sorts ascending');
  assert(
    summary() === `Sorted by Title, ${firstDirection} · 1–50 of 120`,
    `the summary names the active sort, matching the header's own direction (found: ${summary()})`,
  );

  // With no results, the summary still names the sort but adds neither the separator nor a
  // range. Clicking the already-active Title header again flips its direction — exercising a
  // second, different direction word too — and gives a natural second request to answer with a
  // zero-total response.
  const zeroTotal: GlobalWorksResponse = {
    data: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
    stats: { totalWorks: 0, sharedWorks: 0, linkedSongs: 0, linkedPerformances: 0, unlinkedSongs: 0 },
  };
  await act(async () => { titleButton().click(); });
  await act(async () => { pendingAt(7).respond(zeroTotal); });
  await settle();
  const secondDirection = titleDirection();
  assert(secondDirection === 'descending', 'clicking the already-active Title header again flips its direction');
  assert(
    summary() === `Sorted by Title, ${secondDirection}`,
    `with no results the summary names the sort with no separator or range (found: ${summary()})`,
  );

  // A load that fails says why, above the table, in the kit danger Note.
  await act(async () => { titleButton().click(); });
  await act(async () => { pendingAt(8).respondWith(500, { error: 'Global works are unavailable' }); });
  await settle();
  const loadFailure = [...container.querySelectorAll<DomElement>('[role="alert"]')].find(
    (alert) => alert.textContent === 'Global works are unavailable',
  );
  assert(loadFailure !== undefined && isKitDangerNote(loadFailure), 'a failed load says why, in the kit danger Note');

  await act(async () => {
    root.unmount();
  });
  container.remove();
  await win.happyDOM.close();

  console.log('✓ Global Library names the active filter and sort next to the range, and a failed load in the kit danger Note');
}

await main();
await globalWorksLoadsThroughTheHook();
await allWorksChipAndSortSummary();
