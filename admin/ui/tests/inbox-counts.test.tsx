import { act, useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser, CrystalTicket, NovaSubmission, NovaVodSubmission } from '../../shared/types';
import { InboxCountsProvider, useInboxCounts, type InboxCounts } from '../src/components/shell/InboxCounts';
import { ConfirmProvider } from '../src/components/ui/confirm';
import { ToastProvider } from '../src/components/ui/toast';
import { click, installDom, mount, settle, typeInto } from './helpers/dom';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- Fixtures (only `status` varies per test; every other field is filler matching the shape
// tests/nova-vod-row.test.tsx and tests/nova-submissions-links.test.tsx already use for these
// types) ---

function novaSubmission(overrides: Partial<NovaSubmission> = {}): NovaSubmission {
  return {
    id: 'sub-1',
    youtube_channel_url: 'https://www.youtube.com/@safe',
    youtube_channel_id: 'UC123',
    youtube_channel_verified_id: null,
    youtube_channel_verified_at: null,
    slug: 'safe',
    brand_name: 'Safe Brand',
    display_name: 'Safe Streamer',
    description: '',
    avatar_url: '',
    subscriber_count: '',
    link_youtube: '',
    link_twitter: '',
    link_facebook: '',
    link_instagram: '',
    link_twitch: '',
    group: '',
    enabled: 1,
    display_order: 0,
    theme_json: '',
    external_url: '',
    status: 'pending',
    submitted_at: '2026-06-17T00:00:00Z',
    reviewed_at: null,
    reviewer_note: '',
    ...overrides,
  };
}

function novaVod(overrides: Partial<NovaVodSubmission> = {}): NovaVodSubmission {
  return {
    id: 'vod-1',
    streamer_slug: 'mizuki',
    video_id: 'pRy1JZ2jSi8',
    video_url: 'https://www.youtube.com/watch?v=pRy1JZ2jSi8',
    stream_title: 'Stream',
    stream_date: '2026-08-22',
    thumbnail_url: 'https://i.ytimg.com/vi/pRy1JZ2jSi8/hqdefault.jpg',
    submitter_note: '',
    status: 'pending',
    submitted_at: '2026-08-22 23:10',
    reviewed_at: null,
    reviewer_note: '',
    ...overrides,
  };
}

function crystalTicket(overrides: Partial<CrystalTicket> = {}): CrystalTicket {
  return {
    id: 't-1',
    type: 'bug',
    title: 'Ticket',
    body: '',
    nickname: '',
    contact: '',
    is_public_reply_allowed: 0,
    context_url: '',
    status: 'pending',
    admin_reply: '',
    replied_at: null,
    submitted_at: '2026-09-01T00:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

// --- fetch stub: a status + JSON body per request — a list GET by its URL, a mutation by its
// method and path — reconfigurable between scenarios, plus a log of every URL requested so a test
// can prove exactly how many new requests `refresh()` issued ---

// Marks a stub as a bodyless error response (see `setEmptyErrorResponse`) rather than a JSON body.
const EMPTY_BODY = Symbol('empty-body');

interface StubResponse {
  status: number;
  body: unknown;
}

const NOVA_URL = '/api/nova/submissions';
const VODS_URL = '/api/nova/vods';
const CRYSTAL_URL = '/api/crystal/tickets';

const responses = new Map<string, StubResponse>();
let requestLog: string[] = [];

function setResponse(url: string, status: number, body: unknown): void {
  responses.set(url, { status, body });
}

/**
 * A bodyless error response with an empty `statusText` — real for HTTP/2 through Cloudflare. No
 * body and no `statusText` to fall back to, and no JSON to parse either, so `responseError()`
 * (client.ts) resolves its blank message to the status-coded fallback: the resulting
 * `ApiError.message` is `Request failed (HTTP ${status})`, never `''`.
 */
function setEmptyErrorResponse(url: string, status: number): void {
  responses.set(url, { status, body: EMPTY_BODY });
}

/** A mutation's response, keyed by method and path: the client appends `?streamer=` to its URL. */
function setMutationResponse(method: 'PATCH' | 'POST' | 'DELETE', path: string, body: unknown): void {
  responses.set(`${method} ${path}`, { status: 200, body });
}

function callsTo(url: string): number {
  return requestLog.filter((entry) => entry === url).length;
}

function installFetchStub(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      requestLog.push(url);
      const method = init?.method ?? 'GET';
      const key = method === 'GET' ? url : `${method} ${url.split('?')[0]}`;
      const stub = responses.get(key);
      assert(stub !== undefined, `a stubbed response is configured for ${key}`);
      if (stub.body === EMPTY_BODY) {
        return new Response(null, { status: stub.status, statusText: '' });
      }
      return new Response(JSON.stringify(stub.body), {
        status: stub.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

type Snapshot = ReturnType<typeof useInboxCounts>;

/** Each list's load state, as `name:loading` (in flight), `name:failed` (its last load failed) or `name:done`. */
function loadStates(snapshot: Snapshot): string {
  return (['nova', 'vods', 'crystal'] as const)
    .map((name) => {
      const load = snapshot.loads[name];
      if (load.loading) return `${name}:loading`;
      return load.error !== null ? `${name}:failed` : `${name}:done`;
    })
    .join(',');
}

/** Calls `useInboxCounts()` and reports every render via an effect with no dependency array — the
 * caller counts its own `onRender` invocations, mirroring tests/ui-toast.test.tsx's ToastProbe. */
function InboxProbe({ onRender }: { onRender: (snapshot: Snapshot) => void }) {
  const counts = useInboxCounts();
  useEffect(() => {
    onRender(counts);
  });
  return null;
}

/** Its own "Re-render" button, independent of any inbox-count state — mirrors ToastHarness. */
function InboxHarness({ onRender }: { onRender: (snapshot: Snapshot) => void }) {
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button type="button" id="rerender" onClick={() => setRenders((count) => count + 1)}>
        Re-render ({renders})
      </button>
      <InboxCountsProvider isCurator>
        <InboxProbe onRender={onRender} />
      </InboxCountsProvider>
    </>
  );
}

const CURATOR: AuthUser = { email: 'curator@example.com', role: 'curator' };

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

/**
 * The messages of the toasts on screen, in alphabetical order: the kit lists success toasts and error
 * toasts in two regions, so the order on screen is not the order they came in.
 */
function toastMessages(container: HTMLElement): string[] {
  const items = container.querySelectorAll('section[aria-label="Notifications"] li');
  return Array.from(items)
    .map((item) => item.querySelector('p')?.textContent?.trim() ?? '')
    .sort();
}

/** The detail line of each toast on screen (empty for a toast with none), in the order `toastMessages` lists them. */
function toastDetails(container: HTMLElement): string[] {
  const items = Array.from(container.querySelectorAll('section[aria-label="Notifications"] li'));
  return items
    .map((item) => ({ message: item.querySelector('p')?.textContent?.trim() ?? '', detail: item.querySelectorAll('p')[1]?.textContent?.trim() ?? '' }))
    .sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0))
    .map((toast) => toast.detail);
}

/** Mounts an inbox page beside a probe, inside a curator's provider — a router, since the Nova page
 * keeps its filters in the URL, and the toast and confirm providers the inbox pages report and ask
 * through — the way App and Layout wrap every page. */
async function mountPage(page: ReactNode): Promise<{ container: HTMLElement; unmount: () => Promise<void>; counts: () => Snapshot }> {
  let latestCounts: Snapshot | undefined;
  const mounted = await mount(
    <ToastProvider timers={NO_TIMERS}>
      <ConfirmProvider>
        <MemoryRouter>
          <InboxCountsProvider isCurator>
            <InboxProbe onRender={(snapshot) => { latestCounts = snapshot; }} />
            {page}
          </InboxCountsProvider>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
  await settle();
  return {
    ...mounted,
    counts: () => {
      assert(latestCounts !== undefined, 'the probe has rendered at least once');
      return latestCounts;
    },
  };
}

/** The table row whose expand toggle names `name` (a Nova display name or a VOD title). */
function rowOf(container: HTMLElement, name: string): HTMLElement {
  const row = container.querySelector(`button[aria-label="展開 ${name}"]`)?.closest('tr');
  assert(row !== null && row !== undefined, `the table renders a row for ${name}`);
  return row;
}

/** The first button in `scope` whose accessible name — aria-label, else its text — is `name`. */
function buttonNamed(scope: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(scope.querySelectorAll('button')).find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name,
  );
}

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  // --- Outside a provider: every count reads null and refresh() is a no-op that does not throw ---

  let outsideSnapshot: Snapshot | undefined;
  const outside = await mount(<InboxProbe onRender={(snapshot) => { outsideSnapshot = snapshot; }} />);
  assert(outsideSnapshot !== undefined, 'the probe rendered outside a provider');
  const outsideValue = outsideSnapshot;
  const outsideCounts: InboxCounts = outsideValue;
  assert(
    outsideCounts.nova === null && outsideCounts.vods === null && outsideCounts.crystal === null,
    'outside a provider every count reads null',
  );
  assert(
    loadStates(outsideValue) === 'nova:done,vods:done,crystal:done',
    `outside a provider nothing is in flight and nothing failed (got ${loadStates(outsideValue)})`,
  );
  await act(async () => { outsideValue.refresh(); });
  await settle();
  assert(outsideValue.nova === null, 'refresh outside a provider is a no-op, not a throw');
  await outside.unmount();
  console.log('✓ outside a provider, useInboxCounts() returns null counts and a no-op refresh');

  // --- In-provider pre-resolution state: a different code path from OUTSIDE_PROVIDER_VALUE above
  // — this is useApiResource's own "nothing has resolved yet" derivation. `mount()` settles
  // internally, so the first commit is captured via the probe's first `onRender` call (which fires
  // within `mount()`'s initial `act()`, before its own `settle()` gives any fetch a chance to
  // resolve), not by reading state after `mount()` returns. ---

  requestLog = [];
  setResponse(NOVA_URL, 200, { data: [novaSubmission({ id: 'n1', status: 'pending' })], total: 1 });
  setResponse(VODS_URL, 200, { data: [], total: 0 });
  setResponse(CRYSTAL_URL, 200, { data: [], total: 0 });

  let firstCommitSnapshot: Snapshot | undefined;
  const preResolution = await mount(
    <InboxCountsProvider isCurator>
      <InboxProbe
        onRender={(snapshot) => {
          if (firstCommitSnapshot === undefined) firstCommitSnapshot = snapshot;
        }}
      />
    </InboxCountsProvider>,
  );
  assert(firstCommitSnapshot !== undefined, 'the probe committed at least once');
  assert(
    firstCommitSnapshot.nova === null && firstCommitSnapshot.vods === null && firstCommitSnapshot.crystal === null,
    'immediately after the first commit, before any list has resolved, every count reads null',
  );
  assert(
    loadStates(firstCommitSnapshot) === 'nova:loading,vods:loading,crystal:loading',
    `and every list reads as loading (got ${loadStates(firstCommitSnapshot)})`,
  );
  await settle();
  await preResolution.unmount();
  console.log('✓ in a provider, every count reads null until its list resolves for the first time');

  // --- Partial failure at first load: Crystal 500, VODs 403, Nova still succeeds; no throw ---

  requestLog = [];
  setResponse(NOVA_URL, 200, {
    data: [novaSubmission({ id: 'n1', status: 'pending' }), novaSubmission({ id: 'n2', status: 'pending' }), novaSubmission({ id: 'n3', status: 'approved' })],
    total: 3,
  });
  setResponse(VODS_URL, 403, { error: 'Forbidden' });
  setResponse(CRYSTAL_URL, 500, { error: 'Internal Server Error' });

  let partialSnapshot: Snapshot | undefined;
  let partialThrew = false;
  try {
    const partial = await mount(
      <InboxCountsProvider isCurator>
        <InboxProbe onRender={(snapshot) => { partialSnapshot = snapshot; }} />
      </InboxCountsProvider>,
    );
    await settle();
    await partial.unmount();
  } catch {
    partialThrew = true;
  }
  assert(!partialThrew, 'a 500 from Crystal and a 403 from VODs do not throw');
  assert(partialSnapshot !== undefined, 'the probe rendered despite two of three lists failing');
  const partialValue = partialSnapshot;
  assert(partialValue.nova === 2, 'the list that succeeded still reports its pending count');
  assert(partialValue.vods === null, 'a 403 reads as unknown, not a throw');
  assert(partialValue.crystal === null, 'a 500 reads as unknown, not a throw');
  assert(
    loadStates(partialValue) === 'nova:done,vods:failed,crystal:failed',
    `each list reports whether its own load failed (got ${loadStates(partialValue)})`,
  );
  console.log('✓ a partial inbox failure nulls only the failed lists and never throws');

  // --- A contributor: the worker serves the three lists to curators alone, so the provider asks
  // for none of them, on mount or on refresh(); every count stays null and no load reads as failed ---

  requestLog = [];
  setResponse(NOVA_URL, 200, { data: [novaSubmission({ id: 'n1', status: 'pending' })], total: 1 });
  setResponse(VODS_URL, 200, { data: [novaVod({ id: 'v1', status: 'pending' })], total: 1 });
  setResponse(CRYSTAL_URL, 200, { data: [crystalTicket({ id: 't1', status: 'pending' })], total: 1 });

  const contributorSnapshots: Snapshot[] = [];
  const contributorProvider = await mount(
    <InboxCountsProvider isCurator={false}>
      <InboxProbe onRender={(snapshot) => { contributorSnapshots.push(snapshot); }} />
    </InboxCountsProvider>,
  );
  await settle();

  function latestContributor(): Snapshot {
    const snapshot = contributorSnapshots[contributorSnapshots.length - 1];
    assert(snapshot !== undefined, "the probe rendered in a contributor's provider");
    return snapshot;
  }

  assert(requestLog.length === 0, `a contributor's provider requests nothing on mount (got ${requestLog.join(', ')})`);
  assert(
    latestContributor().nova === null && latestContributor().vods === null && latestContributor().crystal === null,
    "a contributor's counts stay null",
  );
  assert(
    loadStates(latestContributor()) === 'nova:done,vods:done,crystal:done',
    `and no list is in flight or failed (got ${loadStates(latestContributor())})`,
  );

  await act(async () => { latestContributor().refresh(); });
  await act(async () => { latestContributor().refresh('vods'); });
  await settle();
  assert(requestLog.length === 0, `refresh() requests nothing for a contributor either (got ${requestLog.join(', ')})`);
  assert(
    loadStates(latestContributor()) === 'nova:done,vods:done,crystal:done' && latestContributor().vods === null,
    `and every list still reads settled, its count null (got ${loadStates(latestContributor())})`,
  );
  assert(
    contributorSnapshots.every((snapshot) =>
      (['nova', 'vods', 'crystal'] as const).every((name) => snapshot.loads[name].error === null),
    ),
    'no list ever reads as failed, so nothing shows an error',
  );
  await contributorProvider.unmount();
  console.log("✓ a contributor's provider requests none of the curator-only lists, on mount or on refresh()");

  // --- Happy path, stable identity, refresh(), and the stale-data trap — threaded through one
  // mount so the object-identity comparisons stay easy to follow ---

  requestLog = [];
  setResponse(NOVA_URL, 200, {
    data: [novaSubmission({ id: 'n1', status: 'pending' }), novaSubmission({ id: 'n2', status: 'pending' }), novaSubmission({ id: 'n3', status: 'approved' })],
    total: 3,
  });
  setResponse(VODS_URL, 200, { data: [novaVod({ id: 'v1', status: 'pending' })], total: 1 });
  setResponse(CRYSTAL_URL, 200, { data: [], total: 0 });

  let renderCalls = 0;
  let latest: Snapshot | undefined;
  const harness = await mount(
    <InboxHarness
      onRender={(snapshot) => {
        renderCalls += 1;
        latest = snapshot;
      }}
    />,
  );
  await settle();

  function current(): Snapshot {
    assert(latest !== undefined, 'the probe has rendered at least once');
    return latest;
  }

  assert(current().nova === 2, 'Nova: two pending out of three submissions');
  assert(current().vods === 1, 'VODs: the one pending submission');
  assert(current().crystal === 0, 'Crystal: no pending tickets');
  assert(
    loadStates(current()) === 'nova:done,vods:done,crystal:done',
    `once loaded, no list is in flight or failed (got ${loadStates(current())})`,
  );
  assert(callsTo(NOVA_URL) === 1 && callsTo(VODS_URL) === 1 && callsTo(CRYSTAL_URL) === 1, 'mount starts exactly one request per list');
  console.log('✓ InboxCountsProvider computes each pending count from a live mount');

  const stableValue = current();
  const callsBeforeRerender = renderCalls;

  const rerenderButton = harness.container.querySelector<HTMLButtonElement>('#rerender');
  assert(rerenderButton !== null, 'the harness renders its own re-render button');
  await click(rerenderButton, 'the harness re-render button');
  assert(renderCalls > callsBeforeRerender, 'the harness re-rendering does re-render the probe (a real signal, not a stuck assertion)');
  assert(current() === stableValue, 'the context value keeps its identity across an unrelated re-render, with every count unchanged');
  console.log('✓ useInboxCounts() keeps a stable identity while nova/vods/crystal/refresh are unchanged');

  // Nova now fails; vods/crystal keep succeeding. refresh() must (a) issue exactly one new
  // request per list and (b) turn ONLY nova back to null — not keep showing 2 (the stale-data
  // trap: useApiResource keeps a failed reload's previous `data` on screen, so deriving a count
  // from `data` before checking `error` would leave the old number on screen).
  setResponse(NOVA_URL, 500, { error: 'Internal Server Error' });
  await act(async () => { current().refresh(); });
  await settle();

  assert(callsTo(NOVA_URL) === 2 && callsTo(VODS_URL) === 2 && callsTo(CRYSTAL_URL) === 2, 'refresh() issues exactly one new request per list');
  assert(current().nova === null, 'a refresh that fails after a successful load turns that count back to null, not the stale 2');
  assert(current().vods === 1 && current().crystal === 0, 'the two lists that kept succeeding still report their real counts');
  assert(current() !== stableValue, 'a real count change produces a new context value');
  console.log('✓ refresh() reloads all three lists and a failed reload nulls only the list that failed');

  // refresh('vods') — what the VOD inbox page calls after an action — reloads that list only.
  setResponse(VODS_URL, 200, { data: [novaVod({ id: 'v1', status: 'approved' })], total: 1 });
  await act(async () => { current().refresh('vods'); });
  await settle();

  assert(callsTo(VODS_URL) === 3, "refresh('vods') issues one new VODs request");
  assert(callsTo(NOVA_URL) === 2 && callsTo(CRYSTAL_URL) === 2, "refresh('vods') requests neither Nova nor Crystal");
  assert(current().vods === 0, 'the VODs count follows the reloaded list');
  assert(current().nova === null && current().crystal === 0, 'the other two counts are untouched');
  console.log('✓ refresh(name) reloads only the named inbox');

  await harness.unmount();

  // --- The stale-data trap, exercised with a bodyless error response: no body and an empty
  // statusText (real for HTTP/2 through Cloudflare) leave responseError() (client.ts) nothing to
  // fall back to, so it resolves to the status-coded message — 'Request failed (HTTP 500)', never
  // ''. The count must still read null here: pendingCount() checks `resource.error !== null`, not
  // truthiness, because the error slot is null exactly when the last load succeeded. ---

  requestLog = [];
  setResponse(NOVA_URL, 200, {
    data: [novaSubmission({ id: 'n1', status: 'pending' }), novaSubmission({ id: 'n2', status: 'pending' })],
    total: 2,
  });
  setResponse(VODS_URL, 200, { data: [], total: 0 });
  setResponse(CRYSTAL_URL, 200, { data: [], total: 0 });

  let emptyErrorRenders = 0;
  let emptyErrorLatest: Snapshot | undefined;
  const emptyErrorHarness = await mount(
    <InboxCountsProvider isCurator>
      <InboxProbe
        onRender={(snapshot) => {
          emptyErrorRenders += 1;
          emptyErrorLatest = snapshot;
        }}
      />
    </InboxCountsProvider>,
  );
  await settle();

  function currentEmptyError(): Snapshot {
    assert(emptyErrorLatest !== undefined, 'the probe has rendered at least once');
    return emptyErrorLatest;
  }

  assert(currentEmptyError().nova === 2, 'Nova succeeds first, establishing a count that must not go stale');
  const rendersBeforeEmptyError = emptyErrorRenders;

  setEmptyErrorResponse(NOVA_URL, 500);
  await act(async () => { currentEmptyError().refresh(); });
  await settle();

  assert(emptyErrorRenders > rendersBeforeEmptyError, 'the refresh does re-render the probe (a real signal, not a stuck assertion)');
  assert(currentEmptyError().nova === null, 'a bodyless error response still nulls the count, not the stale 2');

  await emptyErrorHarness.unmount();
  console.log('✓ a bodyless error response with an empty statusText still nulls the count');

  // --- The inbox pages keep their badge current: every action that can change a pending count
  // reloads that inbox's list for the badge — once, and no other inbox's — so the count follows
  // the server instead of keeping its mount-time value until a full reload ---

  const { default: NovaSubmissions } = await import('../src/pages/NovaSubmissions');
  const { default: NovaVodSubmissions } = await import('../src/pages/NovaVodSubmissions');
  const { default: CrystalTickets } = await import('../src/pages/CrystalTickets');
  // The Nova delete still asks through window.confirm; the VOD delete asks through the kit confirm.
  window.confirm = () => true;

  // Nova: approve one, delete the other, then "Fetch All Channel Info" reloads a list that has
  // gained a new submission since.
  requestLog = [];
  setResponse(NOVA_URL, 200, {
    data: [novaSubmission({ id: 'n1', display_name: 'Alpha' }), novaSubmission({ id: 'n2', display_name: 'Beta' })],
    total: 2,
  });
  setResponse(VODS_URL, 200, { data: [], total: 0 });
  setResponse(CRYSTAL_URL, 200, { data: [], total: 0 });
  const novaPage = await mountPage(<NovaSubmissions user={CURATOR} />);
  assert(novaPage.counts().nova === 2, 'Nova: the badge starts at two pending');
  assert(callsTo(NOVA_URL) === 2, 'the badge and the page each load the Nova list once');

  const alphaApproved = novaSubmission({ id: 'n1', display_name: 'Alpha', status: 'approved' });
  setMutationResponse('PATCH', '/api/nova/submissions/n1/status', alphaApproved);
  setResponse(NOVA_URL, 200, { data: [alphaApproved, novaSubmission({ id: 'n2', display_name: 'Beta' })], total: 2 });
  await click(buttonNamed(rowOf(novaPage.container, 'Alpha'), 'Approve'), "Alpha's Approve button");
  assert(callsTo(NOVA_URL) === 3, 'an approval reloads the Nova list for the badge, once');
  assert(novaPage.counts().nova === 1, 'Nova: the badge drops to one after an approval');

  setMutationResponse('DELETE', '/api/nova/submissions/n2', { ok: true });
  setResponse(NOVA_URL, 200, { data: [alphaApproved], total: 1 });
  await click(buttonNamed(rowOf(novaPage.container, 'Beta'), 'Delete'), "Beta's Delete button");
  assert(callsTo(NOVA_URL) === 4, 'a delete reloads the Nova list for the badge, once');
  assert(novaPage.counts().nova === 0, 'Nova: the badge drops to zero after deleting the last pending one');

  setMutationResponse('POST', '/api/nova/submissions/fetch-all-subscribers', { updated: 0, failed: 0, results: [] });
  setResponse(NOVA_URL, 200, { data: [alphaApproved, novaSubmission({ id: 'n3', display_name: 'Gamma' })], total: 2 });
  await click(buttonNamed(novaPage.container, 'Fetch All Channel Info'), 'the Fetch All Channel Info button');
  assert(callsTo(NOVA_URL) === 6, "the page's own reload refetches both its list and the badge's");
  assert(novaPage.counts().nova === 1, 'Nova: the badge picks up the submission that reload brought in');
  assert(callsTo(VODS_URL) === 1 && callsTo(CRYSTAL_URL) === 1, 'no Nova action reloads another inbox');
  await novaPage.unmount();
  console.log('✓ the Nova inbox reloads its badge after an approval, a delete and its own reload');

  // Nova VODs: approve one (a toast names it), then delete the other through the kit confirm: Cancel sends
  // nothing and keeps the row, Delete sends the request, says so in a toast and reloads the badge.
  requestLog = [];
  setResponse(NOVA_URL, 200, { data: [], total: 0 });
  setResponse(VODS_URL, 200, {
    data: [novaVod({ id: 'v1', stream_title: 'Stream A' }), novaVod({ id: 'v2', stream_title: 'Stream B' })],
    total: 2,
  });
  setResponse(CRYSTAL_URL, 200, { data: [], total: 0 });
  const vodPage = await mountPage(<NovaVodSubmissions user={CURATOR} />);
  assert(vodPage.counts().vods === 2, 'VODs: the badge starts at two pending');
  const vodRequests = (id: string) => requestLog.filter((entry) => entry.startsWith(`/api/nova/vods/${id}`)).length;

  const streamAApproved = novaVod({ id: 'v1', stream_title: 'Stream A', status: 'approved' });
  setMutationResponse('PATCH', '/api/nova/vods/v1/status', streamAApproved);
  setResponse(VODS_URL, 200, { data: [streamAApproved, novaVod({ id: 'v2', stream_title: 'Stream B' })], total: 2 });
  await click(buttonNamed(rowOf(vodPage.container, 'Stream A'), 'Approve'), "Stream A's Approve button");
  assert(callsTo(VODS_URL) === 3, 'an approval reloads the VODs list for the badge, once');
  assert(vodPage.counts().vods === 1, 'VODs: the badge drops to one after an approval');
  assert(
    toastMessages(vodPage.container).join('|') === 'VOD approved' && toastDetails(vodPage.container).join('|') === 'Stream A',
    `an approval toasts "VOD approved", naming the VOD (got ${toastMessages(vodPage.container).join('|')})`,
  );

  setMutationResponse('DELETE', '/api/nova/vods/v2', { ok: true });
  setResponse(VODS_URL, 200, { data: [streamAApproved], total: 1 });
  const deleteB = buttonNamed(rowOf(vodPage.container, 'Stream B'), 'Delete');
  assert(deleteB !== undefined, "Stream B's row offers Delete");
  await act(async () => { deleteB.focus(); });
  await click(deleteB, "Stream B's Delete button");
  const confirmDialog = vodPage.container.querySelector<HTMLElement>('dialog[open]');
  assert(confirmDialog !== null, 'Delete asks through the kit confirm, not window.confirm');
  assert(
    (confirmDialog.textContent ?? '').includes('v2') && (confirmDialog.textContent ?? '').includes('Stream B'),
    'the confirm names the VOD: its id and its title',
  );
  assert(vodRequests('v2') === 0 && callsTo(VODS_URL) === 3, 'asking sends nothing');

  await click(buttonNamed(confirmDialog, 'Cancel'), "the confirm's Cancel button");
  assert(vodPage.container.querySelector('dialog[open]') === null, 'Cancel closes the confirm');
  assert(vodRequests('v2') === 0, 'Cancel sends no request');
  assert(callsTo(VODS_URL) === 3 && vodPage.counts().vods === 1, 'Cancel reloads nothing and leaves the badge alone');
  assert(vodPage.container.querySelector('button[aria-label="展開 Stream B"]') !== null, 'Cancel keeps the row');
  assert(document.activeElement === deleteB, "Cancel leaves the focus on the row's Delete control");
  assert(toastMessages(vodPage.container).join('|') === 'VOD approved', 'Cancel toasts nothing');

  await click(deleteB, "Stream B's Delete button, again");
  const confirmAgain = vodPage.container.querySelector<HTMLElement>('dialog[open]');
  assert(confirmAgain !== null, 'Delete asks again');
  await click(buttonNamed(confirmAgain, 'Delete'), "the confirm's own Delete button");
  assert(vodRequests('v2') === 1, 'confirming sends exactly one DELETE');
  assert(callsTo(VODS_URL) === 4, 'a delete reloads the VODs list for the badge, once');
  assert(vodPage.counts().vods === 0, 'VODs: the badge drops to zero after deleting the last pending one');
  assert(vodPage.container.querySelector('button[aria-label="展開 Stream B"]') === null, 'the deleted row is gone');
  assert(
    toastMessages(vodPage.container).join('|') === 'VOD approved|VOD deleted' &&
      toastDetails(vodPage.container).join('|') === 'Stream A|Stream B',
    `a delete toasts "VOD deleted", naming the VOD (got ${toastMessages(vodPage.container).join('|')})`,
  );
  assert(callsTo(NOVA_URL) === 1 && callsTo(CRYSTAL_URL) === 1, 'no VOD action reloads another inbox');
  await vodPage.unmount();
  console.log('✓ the Nova VOD inbox reloads its badge after an approval and a confirmed delete; Cancel sends nothing');

  // Crystal: a reply marks its ticket replied (the worker's replyToTicket); Close closes the other.
  // Each of them says how it went in a toast, and a refused reply leaves the badge alone.
  requestLog = [];
  setResponse(NOVA_URL, 200, { data: [], total: 0 });
  setResponse(VODS_URL, 200, { data: [], total: 0 });
  setResponse(CRYSTAL_URL, 200, {
    data: [crystalTicket({ id: 't1', title: 'Ticket A' }), crystalTicket({ id: 't2', title: 'Ticket B' })],
    total: 2,
  });
  const crystalPage = await mountPage(<CrystalTickets user={CURATOR} />);
  assert(crystalPage.counts().crystal === 2, 'Crystal: the badge starts at two pending');
  const summaryOf = (title: string) =>
    Array.from(crystalPage.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find((button) =>
      button.textContent?.includes(title),
    );

  const ticketAReplied = crystalTicket({ id: 't1', title: 'Ticket A', status: 'replied', admin_reply: 'Thanks!' });
  setMutationResponse('POST', '/api/crystal/tickets/t1/reply', ticketAReplied);
  setResponse(CRYSTAL_URL, 200, { data: [ticketAReplied, crystalTicket({ id: 't2', title: 'Ticket B' })], total: 2 });
  await click(summaryOf('Ticket A'), "Ticket A's summary row");
  const replyBox = crystalPage.container.querySelector('textarea');
  assert(replyBox !== null, 'the expanded ticket has a reply box');
  await typeInto(replyBox, 'Thanks!');

  responses.set('POST /api/crystal/tickets/t1/reply', { status: 500, body: { error: 'Reply store is down' } });
  await click(buttonNamed(crystalPage.container, 'Send Reply'), 'the Send Reply button');
  assert(
    toastMessages(crystalPage.container).join('|') === 'Reply store is down',
    `a refused reply toasts the server's message (got ${toastMessages(crystalPage.container).join('|')})`,
  );
  assert(replyBox.value === 'Thanks!', 'a refused reply keeps the draft in the reply box');
  assert(callsTo(CRYSTAL_URL) === 2, 'a refused reply does not reload the Crystal list for the badge');
  assert(crystalPage.counts().crystal === 2, 'Crystal: a refused reply leaves the badge at two');

  setMutationResponse('POST', '/api/crystal/tickets/t1/reply', ticketAReplied);
  await click(buttonNamed(crystalPage.container, 'Send Reply'), 'the Send Reply button, again');
  assert(
    toastMessages(crystalPage.container).join('|') === 'Reply sent|Reply store is down',
    `a reply that lands toasts "Reply sent" (got ${toastMessages(crystalPage.container).join('|')})`,
  );
  assert(callsTo(CRYSTAL_URL) === 3, 'a reply reloads the Crystal list for the badge, once');
  assert(crystalPage.counts().crystal === 1, 'Crystal: the badge drops to one after a reply');

  const ticketBClosed = crystalTicket({ id: 't2', title: 'Ticket B', status: 'closed' });
  setMutationResponse('PATCH', '/api/crystal/tickets/t2/status', ticketBClosed);
  setResponse(CRYSTAL_URL, 200, { data: [ticketAReplied, ticketBClosed], total: 2 });
  await click(summaryOf('Ticket B'), "Ticket B's summary row");
  await click(buttonNamed(crystalPage.container, 'Close'), 'the Close button');
  assert(
    toastMessages(crystalPage.container).join('|') === 'Reply sent|Reply store is down|Ticket closed',
    `closing a ticket toasts "Ticket closed" (got ${toastMessages(crystalPage.container).join('|')})`,
  );
  assert(callsTo(CRYSTAL_URL) === 4, 'a status change reloads the Crystal list for the badge, once');
  assert(crystalPage.counts().crystal === 0, 'Crystal: the badge drops to zero after closing the last pending one');
  assert(callsTo(NOVA_URL) === 1 && callsTo(VODS_URL) === 1, 'no Crystal action reloads another inbox');
  await crystalPage.unmount();
  console.log('✓ the Crystal inbox reloads its badge after a reply and a status change');
}

await main();
console.log('✓ inbox counts: pending totals for Nova, Nova VODs and Crystal, with silent failures, kept current by their pages');
