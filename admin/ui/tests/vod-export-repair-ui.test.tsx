import { act, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import type { VodExportRepairRecord } from '../src/api/vodExportTypes';
import VodExportRepair from '../src/pages/VodExportRepair';

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

await win.happyDOM.close();

console.log('✓ VOD export repair initialises its loading guard lazily, with no commit spent flipping it');
