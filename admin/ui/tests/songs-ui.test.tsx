/**
 * The Songs page on the studio kit (spec §8.9), mounted live the way App.tsx mounts every page
 * (ToastProvider > router) against a stubbed fetch: the header with its search and its "New song"
 * link, the status filter, the sortable table and its paging, what a curator may do to a row and
 * what a contributor sees of it, the toasts and the focus an action leaves behind, and the load
 * failure with its Retry. The route itself is pinned too: it renders through `routeElement`.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser, PaginatedResponse, Song, Status } from '../../shared/types';
import { buttonClasses } from '../src/components/ui/button-classes';
import { click, installDom, mount, settle, typeInto } from './helpers/dom';
import { NO_ARBITRARY_HEX, NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The value, or a failure naming what the page should have rendered. */
function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`the page renders ${what}`);
  return value;
}

function assertNoRawColour(html: string, what: string): void {
  assert(!NO_RAW_PALETTE.test(html), `${what} uses no raw palette classes`);
  assert(!NO_ARBITRARY_HEX.test(html), `${what} uses no arbitrary hex colours`);
}

// --- Fixtures ---

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

const THIS_YEAR = new Date().getFullYear();

function song(id: string, title: string, originalArtist: string, status: Status, createdAt: string): Song {
  return {
    id,
    workId: null,
    title,
    originalArtist,
    tags: [],
    status,
    submittedBy: 'fan@example.com',
    reviewedBy: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function withStatus(base: Song, status: Status): Song {
  return { ...base, status, reviewedBy: 'curator@example.com' };
}

// Stored times are UTC ("YYYY-MM-DD HH:MM:SS"), as D1 writes them. One song per status, and a
// second pending one; the first is from this year, the rest are not.
const PENDING = song('s-pending', 'Pending Song', 'Artist A', 'pending', `${THIS_YEAR}-01-15 12:00:00`);
const EXTRACTED = song('s-extracted', 'Extracted Song', 'Artist B', 'extracted', '2020-03-04 12:00:00');
const PENDING_TWO = song('s-pending-2', 'Second Pending Song', 'Artist C', 'pending', '2020-03-03 12:00:00');
const APPROVED = song('s-approved', 'Approved Song', 'Artist D', 'approved', '2020-03-02 12:00:00');
const REJECTED = song('s-rejected', 'Rejected Song', 'Artist E', 'rejected', '2020-03-01 12:00:00');
const EXCLUDED = song('s-excluded', 'Excluded Song', 'Artist F', 'excluded', '2020-02-28 12:00:00');
const SONGS = [PENDING, EXTRACTED, PENDING_TWO, APPROVED, REJECTED, EXCLUDED];
const TITLES = SONGS.map((row) => row.title).join('|');

/** Three pages of fifty, so the footer has somewhere to go. */
function listBody(data: Song[], overrides: Partial<PaginatedResponse<Song>> = {}): PaginatedResponse<Song> {
  return { data, total: 120, page: 1, pageSize: 50, totalPages: 3, ...overrides };
}

// --- The stubbed API ---

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

interface Reply {
  status: number;
  body: unknown;
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const failure = (status: number, error: string): Reply => ({ status, body: { error } });

const calls: Call[] = [];
const unexpected: string[] = [];

const defaultListReply = (): Reply => ok(listBody(SONGS));

/** What the worker answers a status change: the whole song, in the status that was asked for. */
const defaultStatusReply = (call: Call, id: string): Reply => {
  const target = SONGS.find((row) => row.id === id);
  const requested = (call.body as { status: Status }).status;
  return target === undefined ? failure(404, 'Song not found') : ok(withStatus(target, requested));
};

/** What the worker answers a read of one song: the song as it has it, by default as the list shows it. */
const defaultSongReply = (_call: Call, id: string): Reply => {
  const target = SONGS.find((row) => row.id === id);
  return target === undefined ? failure(404, 'Song not found') : ok(target);
};

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let listReply: (call: Call) => Reply | Promise<Reply> = defaultListReply;
let statusReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultStatusReply;
let songReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultSongReply;

function reset(): void {
  calls.length = 0;
  listReply = defaultListReply;
  statusReply = defaultStatusReply;
  songReply = defaultSongReply;
}

interface Held {
  reply: Promise<Reply>;
  release: (reply: Reply) => void;
}

/** A reply the scenario releases itself, with `respond`. */
function held(): Held {
  let release!: (reply: Reply) => void;
  const reply = new Promise<Reply>((resolve) => {
    release = resolve;
  });
  return { reply, release };
}

async function respond(gate: Held, reply: Reply): Promise<void> {
  await act(async () => {
    gate.release(reply);
  });
  await settle();
}

function installFetchStub(): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      const call: Call = {
        method,
        path: url.pathname,
        params: url.searchParams,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      };
      calls.push(call);
      const statusId = /^\/api\/songs\/([^/]+)\/status$/.exec(url.pathname)?.[1];
      const songId = /^\/api\/songs\/([^/]+)$/.exec(url.pathname)?.[1];
      let reply: Reply | Promise<Reply> | undefined;
      if (method === 'GET' && url.pathname === '/api/songs') reply = listReply(call);
      else if (method === 'PATCH' && statusId !== undefined) reply = statusReply(call, decodeURIComponent(statusId));
      else if (method === 'GET' && songId !== undefined) reply = songReply(call, decodeURIComponent(songId));
      if (reply === undefined) {
        unexpected.push(`${method} ${url.pathname}${url.search}`);
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
      }
      const settled = await reply;
      return new Response(JSON.stringify(settled.body), {
        status: settled.status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function listCalls(): Call[] {
  return calls.filter((call) => call.method === 'GET' && call.path === '/api/songs');
}

function statusCalls(): Call[] {
  return calls.filter((call) => call.method === 'PATCH');
}

/** Reads of one song, as a failed decision sends to learn what the worker has. */
function songCalls(): Call[] {
  return calls.filter((call) => call.method === 'GET' && /^\/api\/songs\/[^/]+$/.test(call.path));
}

function lastList(): Call {
  return need(listCalls().at(-1), 'a list request');
}

// --- DOM lookups ---

function textOf(node: Element | null | undefined): string {
  return node?.textContent?.trim() ?? '';
}

/** Read through a call, so that an assertion on one element does not narrow the next one's type. */
function focused(): Element | null {
  return document.activeElement;
}

function pageHeader(container: HTMLElement): HTMLElement {
  return need(container.querySelector<HTMLElement>('header'), 'its header');
}

function statusGroup(container: HTMLElement): HTMLElement {
  return need(
    container.querySelector<HTMLElement>('[role="group"][aria-label="Filter songs by status"]'),
    'the status filter',
  );
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

function statusOption(container: HTMLElement, name: string): HTMLButtonElement {
  return need(buttonNamed(statusGroup(container), name), `the ${name} status option`);
}

function headCells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('thead th')];
}

function headCell(container: HTMLElement, name: string): HTMLElement {
  return need(headCells(container).find((cell) => textOf(cell) === name), `the ${name} column head`);
}

function sortButton(container: HTMLElement, name: string): HTMLButtonElement {
  return need(headCell(container, name).querySelector<HTMLButtonElement>('button'), `a sort button on ${name}`);
}

function sortOf(container: HTMLElement, name: string): string | null {
  return headCell(container, name).getAttribute('aria-sort');
}

function bodyRows(container: HTMLElement): HTMLTableRowElement[] {
  return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')];
}

function rowFor(container: HTMLElement, title: string): HTMLTableRowElement {
  return need(bodyRows(container).find((row) => textOf(row.querySelector('a')) === title), `the row for ${title}`);
}

function titleLink(row: HTMLElement): HTMLAnchorElement {
  return need(row.querySelector<HTMLAnchorElement>('a'), 'the row title link');
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('td')];
}

function statusOf(row: HTMLElement): string {
  return textOf(cellsOf(row)[2]);
}

function rowTitles(container: HTMLElement): string {
  return bodyRows(container)
    .map((row) => textOf(row.querySelector('a')))
    .join('|');
}

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"]');
}

function noteRetry(container: HTMLElement): HTMLButtonElement {
  return need(buttonNamed(need(alertOf(container), 'a danger alert'), 'Retry'), 'a Retry in the alert');
}

interface ToastView {
  message: string;
  detail: string;
  retry: HTMLButtonElement | null;
}

function toastsOf(container: HTMLElement): ToastView[] {
  const section = container.querySelector('section[aria-label="Notifications"]');
  return [...(section?.querySelectorAll<HTMLElement>('li') ?? [])].map((item) => {
    const lines = [...item.querySelectorAll('p')].map((line) => textOf(line));
    return { message: lines[0] ?? '', detail: lines[1] ?? '', retry: buttonNamed(item, 'Retry') };
  });
}

function pagerText(container: HTMLElement): string {
  return textOf(container).replace(/\s+/g, ' ');
}

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user: AuthUser) => Promise<Mounted>;

// --- Scenarios ---

async function firstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const first = held();
  listReply = () => first.reply;
  const { container, unmount } = await mountPage(curator);

  // One request on mount, for the default query: nothing typed, filtered or paged yet.
  assert(calls.length > 0 && listCalls().length === calls.length, 'mounting asks for the list and nothing else');
  assert(listCalls().length === 1, 'mounting sends exactly one request');
  const initial = lastList();
  assert(
    initial.params.toString() === 'page=1&pageSize=50&sortBy=createdAt&sortDir=desc&streamer=mizuki',
    `the first request is page 1 of 50, newest first, for the current streamer (got ${initial.params.toString()})`,
  );

  // The header and the filter are there before any data: only the table waits for it.
  const header = pageHeader(container);
  const root = need(container.firstElementChild as HTMLElement | null, 'a page root');
  assert(root.firstElementChild === header, 'the header is the page first child, so it sticks to <main>');
  assert(!/overflow|blur|transform|filter/.test(root.className), 'the page root has no blur, transform or overflow');
  const gutter = need(root.children[1], 'the page gutter');
  assert(
    gutter.classList.contains('p-4') && gutter.classList.contains('lg:px-5'),
    '<main> gives a page no gutter of its own, so the page brings it',
  );
  assert(container.querySelectorAll('h1').length === 1, 'the page has exactly one <h1>');
  assert(textOf(header.querySelector('h1')) === 'Songs', 'the <h1> is "Songs"');
  assert(textOf(header).startsWith('CATALOG'), 'the crumb is CATALOG');

  const form = need(header.querySelector<HTMLFormElement>('form[role="search"]'), 'the search form in the header');
  const search = need(form.querySelector<HTMLInputElement>('input'), 'the search field');
  const label = need(form.querySelector<HTMLLabelElement>('label'), 'the search label');
  assert(search.type === 'search', 'the search field is a search input');
  assert(
    textOf(label) === 'Search by title or artist' && search.id !== '' && label.htmlFor === search.id,
    'the search field is labelled "Search by title or artist"',
  );
  assert(search.placeholder === 'Search by title or artist…', 'the placeholder reads "Search by title or artist…"');
  assert(need(buttonNamed(form, 'Search'), 'a Search button').type === 'submit', 'Search submits the form');

  const newSong = need(header.querySelector<HTMLAnchorElement>('a[href="/submit/song"]'), 'the New song link');
  assert(textOf(newSong) === 'New song' && newSong.querySelector('svg') !== null, 'the link reads "New song", with an icon');
  assert(newSong.className === buttonClasses({ variant: 'primary' }), 'the link looks like a primary button');

  // The filter sits in a toolbar under the header, and scrolls by itself on a phone.
  const group = statusGroup(container);
  assert(!header.contains(group), 'the status filter is in a toolbar, not in the header');
  assert(
    group.parentElement?.classList.contains('overflow-x-auto') === true &&
      group.parentElement.classList.contains('max-w-full'),
    'six options outgrow a phone: the filter scrolls inside its wrapper, not the page',
  );
  assert(
    [...group.querySelectorAll('button')].map((button) => textOf(button)).join('|') ===
      'All|Pending|Approved|Rejected|Excluded|Extracted',
    'the filter offers All and the five statuses, in that order',
  );
  assert(
    [...group.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed')).join('|') ===
      'true|false|false|false|false|false',
    'All is the option in effect',
  );
  assert(container.querySelector('select') === null, 'the native select is gone');

  // A skeleton until the first response, and no table, no empty notice and no footer behind it.
  const skeleton = need(container.querySelector('[role="status"]'), 'a skeleton while the first load is out');
  assert(textOf(skeleton) === 'Loading songs…', 'the skeleton says what is loading');
  assert(container.querySelector('table') === null, 'no table before the first response');
  assert(!container.innerHTML.includes('No songs found.'), 'an unanswered list is not an empty one');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok(listBody(SONGS)));
  assert(container.querySelector('[role="status"]') === null, 'the response ends the loading state');
  assert(rowTitles(container) === TITLES, `the rows are the six songs in the server's order (got ${rowTitles(container)})`);
  assert(listCalls().length === 1, 'nothing else is requested once the page has loaded');

  // The table: a kit table in a glass card that clips but does not scroll, so the head stays sticky.
  const table = need(container.querySelector('table'), 'the table');
  assert(
    table.className.includes('table-fixed') && /max-xl:min-w-\[\d+px\]/.test(table.className),
    'the table is fixed-layout and keeps a minimum width, below which it scrolls',
  );
  const scroller = need(table.parentElement, 'the table scroller');
  assert(scroller.classList.contains('max-xl:overflow-x-auto'), 'the table scrolls inside its card below 1280 px');
  const card = need(scroller.parentElement, 'the table card');
  assert(
    card.classList.contains('glass-card') && card.classList.contains('overflow-clip') && !/overflow-(hidden|auto)/.test(card.className),
    'the card clips with overflow-clip, which is no scroll container',
  );
  assert(need(table.querySelector('thead'), 'a head').classList.contains('xl:sticky'), 'the head sticks from 1280 px');

  assert(
    headCells(container).map((cell) => textOf(cell)).join('|') === 'Title|Artist|Status|Created|Actions',
    'a curator sees Title, Artist, Status, Created and Actions',
  );
  assert(
    headCell(container, 'Actions').querySelector('.sr-only') !== null,
    'the Actions head is a label for screen readers only',
  );
  assert(
    [sortOf(container, 'Title'), sortOf(container, 'Artist'), sortOf(container, 'Status'), sortOf(container, 'Created')].join('|') ===
      'none|none|none|descending',
    'the list is sorted by Created, newest first',
  );
  assert(headCell(container, 'Actions').getAttribute('aria-sort') === null, 'Actions is not sortable');

  // The rows: a link to the song, the artist, a status pill, the creation time; Approve and Reject
  // on the songs that can still be decided.
  assert(
    bodyRows(container).map((row) => titleLink(row).getAttribute('href')).join('|') ===
      SONGS.map((row) => `/songs/${row.id}`).join('|'),
    'each title links to its song',
  );
  assert(
    bodyRows(container).map((row) => textOf(cellsOf(row)[1])).join('|') === SONGS.map((row) => row.originalArtist).join('|'),
    'each row names its artist',
  );
  assert(
    bodyRows(container).map(statusOf).join('|') === 'Pending|Extracted|Pending|Approved|Rejected|Excluded',
    'each row shows its status as a pill',
  );
  assert(
    need(cellsOf(rowFor(container, 'Excluded Song'))[2]?.querySelector('span'), 'the excluded pill').classList.contains('line-through'),
    'an excluded song is struck through',
  );
  for (const row of SONGS) {
    const tr = rowFor(container, row.title);
    const decidable = row.status === 'pending' || row.status === 'extracted';
    assert(cellsOf(tr).length === 5, `${row.title}: five cells for a curator`);
    assert(
      (buttonNamed(tr, 'Approve') !== null) === decidable && (buttonNamed(tr, 'Reject') !== null) === decidable,
      `${row.title} (${row.status}): Approve and Reject ${decidable ? 'are' : 'are not'} offered`,
    );
  }
  const extractedRow = rowFor(container, 'Extracted Song');
  assert(
    buttonNamed(extractedRow, 'Approve')?.getAttribute('aria-label') === 'Approve Extracted Song',
    "a row's button names the song it acts on",
  );

  // Dates: the short form in the cell, the full time and the exact instant beside it.
  const thisYear = need(rowFor(container, 'Pending Song').querySelector('time'), "the pending song's time");
  assert(thisYear.getAttribute('datetime') === `${THIS_YEAR}-01-15T12:00:00.000Z`, 'the exact instant is in dateTime, as an ISO string');
  assert(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/.test(textOf(thisYear)), `a date this year reads like "Jan 15, 12:00" (got ${textOf(thisYear)})`);
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(thisYear.getAttribute('title') ?? ''), 'the full time is in the title');
  const older = need(extractedRow.querySelector('time'), "the extracted song's time");
  assert(older.getAttribute('datetime') === '2020-03-04T12:00:00.000Z', 'the exact instant is in dateTime for an older song too');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(textOf(older)), `a date from another year reads like "2020-03-04" (got ${textOf(older)})`);
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(older.getAttribute('title') ?? ''), 'and has its full time in the title');

  // Paging is the shared footer.
  assert(pagerText(container).includes('Showing 1–50 of 120') && pagerText(container).includes('Page 1 of 3'), 'the footer names the range and the page');

  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assert(toastsOf(container).length === 0, 'a load raises no toast');
  assertNoRawColour(container.innerHTML, 'the loaded page');

  await unmount();
  console.log('✓ Songs: first request, header with search and New song, filter toolbar, skeleton, kit table, dates, footer');
}

async function queryFollowsTheControls(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const search = need(container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field');

  // Typing alone asks for nothing: the term applies on submit.
  await typeInto(search, 'lemon');
  assert(listCalls().length === 1, 'typing a term sends no request');

  // Paging: the footer steps the server page.
  await click(need(buttonNamed(container, 'Next'), 'Next'), 'Next');
  assert(lastList().params.get('page') === '2', 'Next asks for page 2');
  assert(pagerText(container).includes('Showing 51–100 of 120'), 'the footer follows the page');
  assert(lastList().params.get('search') === null, 'the typed, unsubmitted term is still not sent');

  // Submitting applies the term and goes back to page 1.
  await click(need(buttonNamed(container, 'Search'), 'Search'), 'Search');
  let latest = lastList();
  assert(latest.params.get('search') === 'lemon' && latest.params.get('page') === '1', 'submitting sends search=lemon on page 1');
  assert(listCalls().length === 3, 'one request per change');

  // The status filter goes back to page 1 too, and keeps the submitted term.
  await click(need(buttonNamed(container, 'Next'), 'Next'), 'Next');
  assert(lastList().params.get('page') === '2', 'the list is on page 2 again');
  await typeInto(search, 'other');
  await click(statusOption(container, 'Pending'), 'the Pending option');
  latest = lastList();
  assert(
    latest.params.get('status') === 'pending' && latest.params.get('page') === '1',
    'choosing Pending sends status=pending on page 1',
  );
  assert(latest.params.get('search') === 'lemon', 'a typed, unsubmitted term never rides along on another change');
  assert(statusOption(container, 'Pending').getAttribute('aria-pressed') === 'true', 'Pending is the option in effect');
  assert(statusOption(container, 'All').getAttribute('aria-pressed') === 'false', 'and All no longer is');

  // Clearing the term and submitting drops it.
  await typeInto(search, '');
  await click(need(buttonNamed(container, 'Search'), 'Search'), 'Search');
  assert(
    lastList().params.get('search') === null && lastList().params.get('status') === 'pending',
    'an empty term is not sent, and the status stays',
  );
  await click(statusOption(container, 'All'), 'the All option');
  assert(lastList().params.get('status') === null, 'All sends no status');

  // Sorting: a new column starts ascending, the same one flips; any sort returns to page 1.
  await click(need(buttonNamed(container, 'Next'), 'Next'), 'Next');
  assert(lastList().params.get('page') === '2', 'the list is on page 2 before sorting');
  await click(sortButton(container, 'Title'), 'the Title head');
  latest = lastList();
  assert(
    latest.params.get('sortBy') === 'title' && latest.params.get('sortDir') === 'asc' && latest.params.get('page') === '1',
    'the Title head sorts title ascending, from page 1',
  );
  assert(sortOf(container, 'Title') === 'ascending' && sortOf(container, 'Created') === 'none', 'the head shows the direction');
  await click(sortButton(container, 'Title'), 'the Title head again');
  assert(
    lastList().params.get('sortBy') === 'title' && lastList().params.get('sortDir') === 'desc',
    'the Title head again sorts descending',
  );
  assert(sortOf(container, 'Title') === 'descending', 'and shows it');
  for (const [name, key] of [
    ['Artist', 'originalArtist'],
    ['Status', 'status'],
    ['Created', 'createdAt'],
  ] as const) {
    await click(sortButton(container, name), `the ${name} head`);
    assert(
      lastList().params.get('sortBy') === key && lastList().params.get('sortDir') === 'asc',
      `the ${name} head sorts ${key} ascending on its first click, whichever way the last one went`,
    );
  }
  await click(sortButton(container, 'Created'), 'the Created head again');
  assert(lastList().params.get('sortDir') === 'desc', 'the Created head again flips to descending');
  assert(unexpected.length === 0, `nothing but the list is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Songs: the search, the status filter, the sort and the footer each send their own query, and go back to page 1');
}

async function pagerKeepsFocusAtTheEnds(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const previous = need(buttonNamed(container, 'Previous'), 'Previous');
  const next = need(buttonNamed(container, 'Next'), 'Next');

  // The first page: Previous has nowhere to go. It is aria-disabled, never disabled: a browser drops the
  // keyboard focus from a button that turns disabled, and the press that got here is what turns it.
  assert(
    previous.getAttribute('aria-disabled') === 'true' && !previous.hasAttribute('disabled'),
    'on page 1 Previous is aria-disabled, not disabled',
  );
  assert(next.getAttribute('aria-disabled') === null && !next.hasAttribute('disabled'), 'and Next is available');
  await act(async () => {
    previous.focus();
  });
  await click(previous, 'Previous on page 1');
  assert(listCalls().length === 1 && focused() === previous, 'a press on Previous at page 1 sends no request and keeps the focus');

  // Up to the last page from the keyboard: the press that gets there keeps the focus, and Next then does nothing.
  await act(async () => {
    next.focus();
  });
  await click(next, 'Next');
  assert(lastList().params.get('page') === '2', 'Next asks for page 2');
  assert(next.getAttribute('aria-disabled') === null, 'Next is still available on page 2');
  await click(next, 'Next');
  assert(lastList().params.get('page') === '3' && pagerText(container).includes('Page 3 of 3'), 'Next reaches the last page');
  assert(
    next.getAttribute('aria-disabled') === 'true' && !next.hasAttribute('disabled'),
    'on the last page Next is aria-disabled, not disabled',
  );
  assert(focused() === next, 'the focus stays on the Next that reached the last page');
  // happy-dom keeps the focus of a button that turns disabled, where a browser drops it, and `focus()` does
  // nothing on a disabled one: asking for the focus again is what tells the two apart.
  await act(async () => {
    previous.focus();
  });
  await act(async () => {
    next.focus();
  });
  assert(focused() === next, 'and Next can take the focus again');
  const asked = listCalls().length;
  await click(next, 'Next on the last page');
  assert(
    listCalls().length === asked && pagerText(container).includes('Page 3 of 3'),
    'a press on Next at the last page sends no request and stays on it',
  );
  assert(focused() === next, 'and keeps the focus');

  // And back down to page 1 from the keyboard: Previous keeps the focus the same way.
  await act(async () => {
    previous.focus();
  });
  await click(previous, 'Previous');
  assert(lastList().params.get('page') === '2', 'Previous asks for page 2');
  await click(previous, 'Previous');
  assert(lastList().params.get('page') === '1' && pagerText(container).includes('Page 1 of 3'), 'Previous reaches page 1');
  assert(
    previous.getAttribute('aria-disabled') === 'true' && !previous.hasAttribute('disabled') && focused() === previous,
    'on page 1 Previous is aria-disabled again, and holds the focus',
  );
  await act(async () => {
    next.focus();
  });
  await act(async () => {
    previous.focus();
  });
  assert(focused() === previous, 'and can take it again');
  const askedAgain = listCalls().length;
  await click(previous, 'Previous on page 1');
  assert(listCalls().length === askedAgain && focused() === previous, 'a press on Previous at page 1 sends no request, again');
  assert(next.getAttribute('aria-disabled') === null, 'Next is available again');
  assert(unexpected.length === 0, `nothing but the list is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Songs: the footer steps at the ends of the range are aria-disabled, so the press that got there keeps the focus and sends nothing');
}

async function laterLoadsKeepTheRows(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  assert(rowTitles(container) === TITLES, 'the list is loaded');

  const next = held();
  listReply = () => next.reply;
  await click(statusOption(container, 'Approved'), 'the Approved option');
  assert(rowTitles(container) === TITLES, 'the rows stay while the next load is out');
  assert(container.querySelector('[role="status"]') === null, 'a later load shows no skeleton');
  assert(statusOption(container, 'Approved').getAttribute('aria-pressed') === 'true', 'the option already reads as chosen');

  await respond(next, ok(listBody([APPROVED], { total: 1, totalPages: 1 })));
  assert(rowTitles(container) === 'Approved Song', 'the new rows replace them once they arrive');
  assert(!container.innerHTML.includes('Showing 1–50'), 'the footer follows the new result');
  assert(pagerText(container).includes('Showing 1–1 of 1'), 'and names the new range');
  assert(buttonNamed(rowFor(container, 'Approved Song'), 'Approve') === null, 'an approved song offers no decision');

  // An empty result is a notice in the table, with no footer.
  listReply = () => ok(listBody([], { total: 0, totalPages: 0 }));
  await click(statusOption(container, 'Excluded'), 'the Excluded option');
  const emptyRow = need(bodyRows(container)[0], 'an empty row');
  assert(bodyRows(container).length === 1 && textOf(emptyRow) === 'No songs found.', 'an empty result reads "No songs found."');
  assert(emptyRow.querySelector('td')?.getAttribute('colspan') === '5', "the notice spans a curator's five columns");
  assert(!pagerText(container).includes('Showing'), 'an empty result has no footer');
  assertNoRawColour(container.innerHTML, 'the empty page');

  await unmount();
  console.log('✓ Songs: a later load keeps the rows until the new ones arrive; an empty result says so');
}

async function contributorView(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);

  assert(rowTitles(container) === TITLES, 'a contributor sees the same songs');
  assert(
    headCells(container).map((cell) => textOf(cell)).join('|') === 'Title|Artist|Status|Created',
    'a contributor has no Actions column',
  );
  assert(!container.innerHTML.includes('Actions'), 'and no hidden one either');
  assert(
    bodyRows(container).every((row) => cellsOf(row).length === 4),
    'each row has four cells',
  );
  assert(
    buttonNamed(container, 'Approve') === null && buttonNamed(container, 'Reject') === null,
    'no row offers Approve or Reject, pending or not',
  );
  assert(
    rowFor(container, 'Pending Song').querySelector('a[href="/songs/s-pending"]') !== null,
    'a contributor can still open a song',
  );
  assert(
    need(container.querySelector('a[href="/submit/song"]'), 'the New song link').textContent === 'New song',
    'and start a new one',
  );
  assertNoRawColour(container.innerHTML, "a contributor's page");

  listReply = () => ok(listBody([], { total: 0, totalPages: 0 }));
  await click(statusOption(container, 'Rejected'), 'the Rejected option');
  assert(
    need(bodyRows(container)[0]?.querySelector('td'), 'the empty notice').getAttribute('colspan') === '4',
    "an empty result spans a contributor's four columns",
  );
  assert(statusCalls().length === 0, 'a contributor sends no status change');

  await unmount();
  console.log('✓ Songs (contributor): same list, no Actions column, no Approve or Reject');
}

async function approveAndFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const pendingRow = rowFor(container, 'Pending Song');
  const approve = need(buttonNamed(pendingRow, 'Approve'), 'Approve on the pending row');
  const reject = need(buttonNamed(pendingRow, 'Reject'), 'Reject on the pending row');

  // A keyboard user on Approve: it sends { status: 'approved' }, and is busy (still focusable) meanwhile.
  await act(async () => {
    approve.focus();
  });
  assert(focused() === approve, 'the keyboard is on Approve');
  const answer = held();
  statusReply = () => answer.reply;
  await click(approve, 'Approve');
  assert(statusCalls().length === 1, 'Approve sends one request');
  const sent = need(statusCalls()[0], 'the status request');
  assert(sent.path === '/api/songs/s-pending/status' && sent.method === 'PATCH', 'it patches the song status');
  deepStrictEqual(sent.body, { status: 'approved' });
  assert(
    approve.getAttribute('aria-busy') === 'true' && approve.getAttribute('aria-disabled') === 'true' && !approve.hasAttribute('disabled'),
    'the clicked button is busy, not disabled',
  );
  assert(reject.hasAttribute('disabled'), "its sibling is unavailable while the request is out: the song cannot be decided twice");
  assert(focused() === approve, 'Approve keeps the focus while its request is out');
  await click(approve, 'the busy Approve');
  assert(statusCalls().length === 1, 'a second click on the busy button sends nothing');
  assert(statusOf(pendingRow) === 'Pending', 'the row reads Pending until the server has answered');
  assert(toastsOf(container).length === 0, 'and nothing is announced yet');

  await respond(answer, ok(withStatus(PENDING, 'approved')));
  statusReply = defaultStatusReply;
  assert(statusOf(pendingRow) === 'Approved', 'the row shows the new status as a pill');
  assert(rowFor(container, 'Pending Song') === pendingRow, 'the same row stays in place');
  assert(!approve.isConnected && !reject.isConnected, 'the decided song offers no decision any more');
  assert(
    buttonNamed(pendingRow, 'Approve') === null && buttonNamed(pendingRow, 'Reject') === null,
    'neither button is left in the row',
  );
  assert(
    focused() === titleLink(pendingRow),
    `the focus that Approve held moves to the row's title link, not to <body> (got ${focused()?.tagName})`,
  );
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Song approved', detail: 'Pending Song' }],
  );
  assert(listCalls().length === 1, 'the list is patched in place, not reloaded');
  assert(rowTitles(container) === TITLES, 'and keeps every row');

  // An extracted song can be approved too, and Reject sends its own status.
  const extractedRow = rowFor(container, 'Extracted Song');
  await click(need(buttonNamed(extractedRow, 'Approve'), 'Approve on the extracted row'), 'Approve on the extracted row');
  assert(need(statusCalls()[1], 'the second status request').path === '/api/songs/s-extracted/status', 'Approve works on an extracted song');
  deepStrictEqual(need(statusCalls()[1], 'the second status request').body, { status: 'approved' });
  assert(statusOf(extractedRow) === 'Approved', 'the extracted song reads Approved');

  const secondRow = rowFor(container, 'Second Pending Song');
  const rejectSecond = need(buttonNamed(secondRow, 'Reject'), 'Reject on the second pending row');
  await act(async () => {
    rejectSecond.focus();
  });
  await click(rejectSecond, 'Reject');
  deepStrictEqual(need(statusCalls()[2], 'the third status request').body, { status: 'rejected' });
  assert(statusOf(secondRow) === 'Rejected', 'Reject shows a Rejected pill');
  assert(focused() === titleLink(secondRow), 'Reject hands its focus to the row title link too');
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [
      { message: 'Song approved', detail: 'Pending Song' },
      { message: 'Song approved', detail: 'Extracted Song' },
      { message: 'Song rejected', detail: 'Second Pending Song' },
    ],
  );
  assert(listCalls().length === 1 && unexpected.length === 0, 'none of it reloads the list');
  assertNoRawColour(container.innerHTML, 'the page after its actions');

  await unmount();
  console.log('✓ Songs (curator): Approve and Reject on pending and extracted songs — busy meanwhile, pill, toast, focus on the title link');
}

async function focusIsNeverStolen(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Song');
  const reject = need(buttonNamed(row, 'Reject'), 'Reject');
  const answer = held();
  statusReply = () => answer.reply;
  await act(async () => {
    reject.focus();
  });
  await click(reject, 'Reject');

  // The keyboard goes elsewhere while the request is out: the answer must not pull it back.
  const search = need(container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field');
  await act(async () => {
    search.focus();
  });
  await respond(answer, ok(withStatus(PENDING, 'rejected')));
  assert(statusOf(row) === 'Rejected', 'the row still changes');
  assert(focused() === search, 'the focus stays where the user put it');

  await unmount();
  console.log('✓ Songs: an answer that lands after the focus has moved on does not take it back');
}

async function failedActionOffersRetry(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Song');
  const approve = need(buttonNamed(row, 'Approve'), 'Approve');
  const reject = need(buttonNamed(row, 'Reject'), 'Reject');

  statusReply = () => failure(400, 'Cannot transition from rejected to approved');
  await act(async () => {
    approve.focus();
  });
  await click(approve, 'Approve');

  assert(statusOf(row) === 'Pending', 'a failed action leaves the row as it was');
  assert(row.contains(approve) && approve.isConnected, 'and keeps its buttons');
  assert(
    approve.getAttribute('aria-busy') === null && approve.getAttribute('aria-disabled') === null && !reject.hasAttribute('disabled'),
    'both buttons are available again',
  );
  assert(focused() === approve, 'the focus never left Approve');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `a failure raises one toast (saw ${toasts.length})`);
  const failed = need(toasts[0], 'the failure toast');
  assert(failed.message === 'Cannot transition from rejected to approved', `the toast carries the server's message (got "${failed.message}")`);
  assert(failed.retry !== null, 'and offers Retry');
  assert(
    need(container.querySelector('section[aria-label="Notifications"] li'), 'the toast').innerHTML.includes('bg-danger-solid'),
    'an error toast is the danger one',
  );

  // Retry sends the same call again, and its success replaces the failure.
  statusReply = defaultStatusReply;
  await click(failed.retry, 'Retry in the toast');
  assert(statusCalls().length === 2, 'Retry sends the call again');
  const retried = need(statusCalls()[1], 'the retried request');
  assert(retried.path === '/api/songs/s-pending/status', 'to the same song');
  deepStrictEqual(retried.body, { status: 'approved' });
  assert(statusOf(row) === 'Approved', 'the row shows the new status');
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Song approved', detail: 'Pending Song' }],
  );

  // A failed Reject retries as a Reject.
  const secondRow = rowFor(container, 'Second Pending Song');
  statusReply = () => failure(500, 'Database is locked');
  await click(need(buttonNamed(secondRow, 'Reject'), 'Reject on the second pending row'), 'Reject');
  const lockedToast = need(
    toastsOf(container).find((toast) => toast.message === 'Database is locked'),
    'a toast with the server message',
  );
  assert(statusOf(secondRow) === 'Pending', 'the second song is still pending');
  statusReply = defaultStatusReply;
  await click(lockedToast.retry, 'Retry in the toast');
  deepStrictEqual(need(statusCalls()[3], 'the retried reject').body, { status: 'rejected' });
  assert(statusOf(secondRow) === 'Rejected', 'the retried Reject takes effect');

  assert(listCalls().length === 1, 'the list was not reloaded');
  await unmount();
  console.log('✓ Songs (curator): a failed action keeps the row, shows the server message and a Retry that sends the same call');
}

async function retryWhileTheRowIsBusySendsNothing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Song');
  const approve = need(buttonNamed(row, 'Approve'), 'Approve');
  const reject = need(buttonNamed(row, 'Reject'), 'Reject');

  // A failure toast stays up with its Retry. Another request then goes out for the same song; the Retry reaches the
  // handler past the row's unavailable buttons, and must not start a second request beside it.
  statusReply = () => failure(500, 'Database is locked');
  await click(approve, 'Approve');
  const firstFailure = need(
    toastsOf(container).find((toast) => toast.message === 'Database is locked'),
    'the failure toast',
  );
  assert(firstFailure.retry !== null, 'the failed Approve left a toast with a Retry');

  const gate = held();
  statusReply = (call, id) => (id === 's-pending' ? gate.reply : defaultStatusReply(call, id));
  await click(reject, 'Reject');
  assert(statusCalls().length === 2, 'Reject is out');
  assert(reject.getAttribute('aria-busy') === 'true' && approve.hasAttribute('disabled'), 'the row is busy');

  await click(firstFailure.retry, 'the old Retry');
  assert(statusCalls().length === 2, `a Retry pressed while the song has a request out sends nothing (sent ${statusCalls().length - 2} more)`);
  const raised = toastsOf(container).filter((toast) => toast.message === 'Database is locked');
  assert(raised.length === 1 && raised[0]?.retry !== null, 'the same failure is back up, with its Retry, so the retry is not lost');
  assert(
    reject.getAttribute('aria-busy') === 'true' && approve.hasAttribute('disabled'),
    'and the row stays busy: Approve and Reject wait for the request that is out',
  );

  // Another song is not held by it.
  const other = rowFor(container, 'Second Pending Song');
  await click(need(buttonNamed(other, 'Approve'), 'Approve on the second pending row'), 'Approve on the second pending row');
  assert(statusOf(other) === 'Approved', 'a request out for one song does not hold another');

  await respond(gate, ok(withStatus(PENDING, 'rejected')));
  assert(statusOf(row) === 'Rejected', 'the busy song takes the answer of the request that was out');
  assert(
    statusCalls().filter((call) => call.path === '/api/songs/s-pending/status').length === 2,
    'only the two real requests were sent for it',
  );
  assert(listCalls().length === 1 && unexpected.length === 0, 'none of it reloads the list');

  await unmount();
  console.log('✓ Songs (curator): a toast Retry pressed while the song has a request out sends nothing and puts its failure back up');
}

/*
 * The worker refuses a change to the status a song already has (400), so a decision it made whose answer was lost on
 * the way would fail again on every Retry. A failed decision reads the song back before it says anything, the row
 * busy meanwhile: the three outcomes of that read.
 */

async function aFailedDecisionTheWorkerMadeIsDone(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Song');
  const approve = need(buttonNamed(row, 'Approve'), 'Approve');
  const reject = need(buttonNamed(row, 'Reject'), 'Reject');

  // The approval went through, but its answer was lost on the way back: a gateway error.
  const reading = held();
  statusReply = () => failure(504, 'Gateway timeout');
  songReply = () => reading.reply;
  await act(async () => {
    approve.focus();
  });
  await click(approve, 'Approve');
  assert(
    approve.getAttribute('aria-busy') === 'true' && reject.hasAttribute('disabled') && toastsOf(container).length === 0,
    'the failed change says nothing yet: the row stays busy while the song is read back',
  );
  assert(songCalls().length === 1 && songCalls()[0]?.path === '/api/songs/s-pending', 'the song is read back');
  await respond(reading, ok(withStatus(PENDING, 'approved')));
  assert(statusOf(row) === 'Approved', 'the song already has the status: the decision is done, and the row reads Approved');
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Song approved', detail: 'Pending Song' }],
  );
  assert(statusCalls().length === 1, 'one change was sent, and no second');
  assert(focused() === titleLink(row), "the focus that Approve held moves to the row's title link, as on any approval");
  assert(listCalls().length === 1 && unexpected.length === 0, 'and nothing else is asked for');

  await unmount();
  console.log('✓ Songs (curator): a failed decision the worker has made after all reads as done, after the song is read back');
}

async function aFailedDecisionOnAnUnchangedSongStands(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Second Pending Song');

  // The song is read back unchanged: the failure stands, with its Retry, and the Retry is the whole decision again.
  statusReply = () => failure(500, 'Database is locked');
  await click(need(buttonNamed(row, 'Reject'), 'Reject'), 'Reject');
  assert(songCalls().length === 1 && songCalls()[0]?.path === '/api/songs/s-pending-2', 'the failed change reads the song back');
  const locked = need(
    toastsOf(container).find((toast) => toast.message === 'Database is locked'),
    'the failure toast',
  );
  assert(locked.retry !== null && statusOf(row) === 'Pending', 'the song is unchanged: the failure stands, with its Retry');
  statusReply = defaultStatusReply;
  await click(locked.retry, 'Retry in the toast');
  assert(statusCalls().length === 2 && statusOf(row) === 'Rejected', 'Retry sends the change again, and it goes through');
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Song rejected', detail: 'Second Pending Song' }],
  );
  assert(unexpected.length === 0, `nothing unstubbed is asked for (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Songs (curator): a failed decision on a song read back unchanged keeps its failure and its Retry');
}

async function aFailedReadKeepsTheDecisionsFailure(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Extracted Song');

  // The read fails too: what is reported is the change's own failure, with its Retry, not the read's.
  statusReply = () => failure(503, 'Status store is down');
  songReply = () => failure(500, 'Song store is down');
  await click(need(buttonNamed(row, 'Approve'), 'Approve'), 'Approve');
  assert(songCalls().length === 1, 'the failed change tries to read the song back');
  const down = need(
    toastsOf(container).find((toast) => toast.message === 'Status store is down'),
    "the change's failure toast",
  );
  assert(down.retry !== null, 'with its Retry');
  assert(!toastsOf(container).some((toast) => toast.message === 'Song store is down'), "and the read's failure is not what is reported");
  assert(statusOf(row) === 'Extracted' && toastsOf(container).length === 1, 'the row is as it was, and nothing else is said');

  await unmount();
  console.log("✓ Songs (curator): a failed decision whose read back fails too reports the change's own failure, with its Retry");
}

async function loadFailure(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => failure(500, 'Songs are unavailable');
  const { container, unmount } = await mountPage(curator);

  const note = need(alertOf(container), 'a danger alert for a failed load');
  assert(textOf(note).includes('Songs are unavailable'), "the alert carries the server's message");
  assert(note.classList.contains('border-tone-danger-line'), 'the alert is a danger note');
  assert(container.querySelector('table') === null, 'with nothing loaded there is no table');
  assert(container.querySelector('[role="status"]') === null, 'and no skeleton either');
  assert(!container.innerHTML.includes('No songs found.'), 'a failure is not an empty list');
  assert(
    pageHeader(container).querySelector('input[type="search"]') !== null && statusGroup(container).isConnected,
    'the header with its search, and the filter, stay',
  );
  assertNoRawColour(container.innerHTML, 'the failed page');

  // Retry asks again, with the same query. The alert leaves with it, so the focus it held goes to the heading.
  const retry = noteRetry(container);
  await act(async () => {
    retry.focus();
  });
  assert(focused() === retry, 'the keyboard is on Retry');
  const again = held();
  listReply = () => again.reply;
  await click(retry, 'Retry');
  assert(listCalls().length === 2, 'Retry reloads the list');
  assert(listCalls()[1]?.params.toString() === listCalls()[0]?.params.toString(), 'with the same query');
  assert(
    focused() === container.querySelector('h1'),
    `the focus goes to the page heading, not to <body> (got ${focused()?.tagName})`,
  );
  assert(container.querySelector('[role="status"]') !== null, 'the skeleton shows while the retry is out');
  await respond(again, ok(listBody(SONGS)));
  assert(alertOf(container) === null, 'a successful retry clears the alert');
  assert(rowTitles(container) === TITLES, 'and shows the rows');

  // A failure after rows are on screen keeps them, with the alert above.
  listReply = () => failure(503, 'Songs are busy');
  await click(statusOption(container, 'Approved'), 'the Approved option');
  assert(textOf(alertOf(container)).includes('Songs are busy'), 'a later failure raises the alert too');
  assert(rowTitles(container) === TITLES, 'and leaves the last rows in place');
  listReply = () => ok(listBody([APPROVED], { total: 1, totalPages: 1 }));
  await click(noteRetry(container), 'Retry');
  assert(listCalls().length === 4, 'Retry asks again');
  assert(lastList().params.get('status') === 'approved', 'for the filter now in effect');
  assert(alertOf(container) === null && rowTitles(container) === 'Approved Song', 'and the new rows replace the old ones');
  assert(toastsOf(container).length === 0, 'a load failure is an alert, not a toast');

  await unmount();
  console.log('✓ Songs: a load failure is a danger alert with a Retry that reloads and hands its focus to the heading');
}

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  setCurrentStreamer('mizuki');
  const { default: SongsList } = await import('../src/pages/SongsList');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES, routeElement } = await import('../src/lib/routes');

  // The route renders through `routeElement`: the page brings its own header and gutter.
  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/songs'), 'the /songs route');
  const rendered = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/songs']}>
      <Routes>
        <Route path="/songs" element={routeElement(route, curator)} />
      </Routes>
    </MemoryRouter>,
  );
  assert(rendered !== '', 'the route renders');
  console.log('✓ Songs: its route renders');

  const mountPage: MountPage = (user) =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <MemoryRouter initialEntries={['/songs']}>
          <Routes>
            <Route path="/songs" element={<SongsList user={user} />} />
            <Route path="/songs/:id" element={<p>Song page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

  await firstLoadAndLayout(mountPage);
  await queryFollowsTheControls(mountPage);
  await pagerKeepsFocusAtTheEnds(mountPage);
  await laterLoadsKeepTheRows(mountPage);
  await contributorView(mountPage);
  await approveAndFocus(mountPage);
  await focusIsNeverStolen(mountPage);
  await failedActionOffersRetry(mountPage);
  await retryWhileTheRowIsBusySendsNothing(mountPage);
  await aFailedDecisionTheWorkerMadeIsDone(mountPage);
  await aFailedDecisionOnAnUnchangedSongStands(mountPage);
  await aFailedReadKeepsTheDecisionsFailure(mountPage);
  await loadFailure(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  const source = readFileSync(new URL('../src/pages/SongsList.tsx', import.meta.url), 'utf8');
  assertNoRawColour(source, 'the page source');
  console.log('✓ Songs: no raw palette class and no arbitrary hex, in the markup or the source');
}

await main();
