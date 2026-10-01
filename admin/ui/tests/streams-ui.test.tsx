/**
 * The Streams page on the studio kit (spec §8.9), mounted live the way App.tsx mounts every page
 * (ToastProvider > ConfirmProvider > router) against a stubbed fetch: the header with its search, count
 * and "New stream" link, the status and year chips, the sortable table, what each status offers a
 * curator (one primary action and a ⋯ menu), what a status change does to the row (and to its songs, for
 * Approve), the toasts and the focus an action leaves behind, and the load failure with its Retry.
 * A status change is answered the way the worker answers it: `{ id, status }` and nothing else, so a
 * row has to keep what it shows and take only the new status from it.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, Status, Stream } from '../../shared/types';
import { buttonClasses } from '../src/components/ui/button-classes';
import { STREAMS_FILTER_KEY } from '../src/lib/streamsFilter';
import { click as clickOnce, installDom, mount, settle, typeInto } from './helpers/dom';
import { NO_ARBITRARY_HEX, NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * The helper's click, then enough microtask rounds for a chain of two requests (a status change and the
 * approve-all after it) to finish: there is no timer in the page, so this waits for nothing real.
 */
async function click(node: { click: () => void } | null | undefined, what: string): Promise<void> {
  await clickOnce(node, what);
  await settle(40);
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

function stream(
  id: string,
  title: string,
  date: string,
  videoId: string,
  status: Status,
  createdAt: string,
  submittedBy: string | null = 'fan@example.com',
): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title,
    date,
    videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    credit: {},
    status,
    submittedBy,
    reviewedBy: null,
    createdAt,
  };
}

// Stored times are UTC ("YYYY-MM-DD HH:MM:SS"), as D1 writes them. One stream per status, from three
// different years; the first was created this year, the rest were not. The list is in date order.
const PENDING = stream('st-pending', 'Pending Stream', '2026-08-01', 'vidPending01', 'pending', `${THIS_YEAR}-01-15 12:00:00`);
const EXTRACTED = stream('st-extracted', 'Extracted Stream', '2026-07-20', 'vidExtract01', 'extracted', '2020-03-04 12:00:00', null);
const APPROVED = stream(
  'st-approved',
  'Approved Stream',
  '2025-12-06',
  'vidApproved1',
  'approved',
  '2020-03-02 12:00:00',
  'a-rather-long-address-for-a-submitter@example.com',
);
const REJECTED = stream('st-rejected', 'Rejected Stream', '2025-11-01', 'vidRejected1', 'rejected', '2020-03-01 12:00:00');
const EXCLUDED = stream('st-excluded', 'Excluded Stream', '2024-05-05', 'vidExcluded1', 'excluded', '2020-02-28 12:00:00');
const STREAMS = [PENDING, EXTRACTED, APPROVED, REJECTED, EXCLUDED];
const TITLES = STREAMS.map((row) => row.title).join('|');

const COLUMNS = ['Title', 'Date', 'Video ID', 'Status', 'Submitted by', 'Created', 'Actions'];
const TITLE = 0;
const DATE = 1;
const VIDEO = 2;
const STATUS = 3;
const SUBMITTER = 4;
const CREATED = 5;
const ACTIONS = 6;

function listBody(data: Stream[]): { data: Stream[]; total: number } {
  return { data, total: data.length };
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

const defaultListReply = (): Reply => ok(listBody(STREAMS));
/** What the worker answers a status change: the id and the status asked for, not the stream. */
const defaultStatusReply = (call: Call, id: string): Reply => ok({ id, status: (call.body as { status: Status }).status });
/** What the worker answers an approve-all: how many songs and performances it approved. */
const defaultApproveReply = (): Reply => ok({ ok: true, songs: 2, performances: 3 });
/** What the worker answers a read of one stream: the stream as it has it, by default as the list shows it. */
const defaultDetailReply = (_call: Call, id: string): Reply => {
  const target = STREAMS.find((row) => row.id === id);
  return target === undefined ? failure(404, 'Stream not found') : ok({ ...target, performances: [] });
};

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let listReply: (call: Call) => Reply | Promise<Reply> = defaultListReply;
let statusReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultStatusReply;
let approveReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultApproveReply;
let detailReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultDetailReply;

// What the page keeps in localStorage, as the browser would: the remembered filter and the streamer.
const storage = new Map<string, string>();

function installLocalStorage(): void {
  const stub: Storage = {
    get length() {
      return storage.size;
    },
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    removeItem: (key) => void storage.delete(key),
    setItem: (key, value) => void storage.set(key, value),
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: stub });
}

function savedFilter(): unknown {
  return JSON.parse(storage.get(STREAMS_FILTER_KEY) ?? 'null');
}

let setStreamer: (slug: string) => void = () => undefined;

function reset(): void {
  calls.length = 0;
  listReply = defaultListReply;
  statusReply = defaultStatusReply;
  approveReply = defaultApproveReply;
  detailReply = defaultDetailReply;
  storage.clear();
  setStreamer('mizuki');
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
  await settle(40);
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
      const statusId = /^\/api\/streams\/([^/]+)\/status$/.exec(url.pathname)?.[1];
      const approveId = /^\/api\/streams\/([^/]+)\/approve-all$/.exec(url.pathname)?.[1];
      const detailId = /^\/api\/streams\/([^/]+)\/detail$/.exec(url.pathname)?.[1];
      let reply: Reply | Promise<Reply> | undefined;
      if (method === 'GET' && url.pathname === '/api/streams') reply = listReply(call);
      else if (method === 'PATCH' && statusId !== undefined) reply = statusReply(call, decodeURIComponent(statusId));
      else if (method === 'POST' && approveId !== undefined) reply = approveReply(call, decodeURIComponent(approveId));
      else if (method === 'GET' && detailId !== undefined) reply = detailReply(call, decodeURIComponent(detailId));
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
  return calls.filter((call) => call.method === 'GET' && call.path === '/api/streams');
}

function statusCalls(): Call[] {
  return calls.filter((call) => call.method === 'PATCH');
}

function approveCalls(): Call[] {
  return calls.filter((call) => call.method === 'POST');
}

/** Reads of one stream, as a failed status change sends to learn what the worker has. */
function detailCalls(): Call[] {
  return calls.filter((call) => call.method === 'GET' && /^\/api\/streams\/[^/]+\/detail$/.test(call.path));
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

async function focus(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
  });
  assert(focused() === element, 'the element takes the focus');
}

function pageHeader(container: HTMLElement): HTMLElement {
  return need(container.querySelector<HTMLElement>('header'), 'its header');
}

function countOf(container: HTMLElement): string | null {
  const meta = pageHeader(container).querySelector('h1')?.nextElementSibling;
  return meta === null || meta === undefined ? null : textOf(meta);
}

function groupLabelled(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[role="group"][aria-labelledby="${id}"]`);
}

function statusGroup(container: HTMLElement): HTMLElement {
  return need(groupLabelled(container, 'streams-status-filter-label'), 'the status filter');
}

function yearGroup(container: HTMLElement): HTMLElement | null {
  return groupLabelled(container, 'streams-year-filter-label');
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

function chipsOf(group: HTMLElement): string {
  return [...group.querySelectorAll('button')].map((button) => textOf(button)).join('|');
}

function pressedOf(group: HTMLElement): string {
  return [...group.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed')).join('|');
}

function chip(group: HTMLElement | null, name: string): HTMLButtonElement {
  return need(buttonNamed(need(group, 'a chip group'), name), `the ${name} chip`);
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

function cellOf(row: HTMLElement, index: number): HTMLElement {
  return need(cellsOf(row)[index], `cell ${index} of the row`);
}

function statusOf(row: HTMLElement): string {
  return textOf(cellOf(row, STATUS));
}

function rowTitles(container: HTMLElement): string {
  return bodyRows(container)
    .map((row) => textOf(row.querySelector('a')))
    .join('|');
}

/** The row's own action: the first button in its Actions cell that is not the ⋯ trigger. */
function primaryOf(row: HTMLElement): HTMLButtonElement {
  return need(cellOf(row, ACTIONS).querySelector<HTMLButtonElement>('button:not([aria-haspopup])'), "the row's primary action");
}

function moreOf(row: HTMLElement): HTMLButtonElement | null {
  return cellOf(row, ACTIONS).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
}

function more(row: HTMLElement): HTMLButtonElement {
  return need(moreOf(row), "the row's ⋯ menu button");
}

/** The panel the ⋯ button controls. It is always in the row, hidden while closed. */
function panelOf(trigger: HTMLElement): HTMLElement {
  return need(document.getElementById(trigger.getAttribute('aria-controls') ?? ''), 'the menu panel');
}

function itemsOf(row: HTMLElement): HTMLButtonElement[] {
  const trigger = moreOf(row);
  return trigger === null ? [] : [...panelOf(trigger).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

function itemNames(row: HTMLElement): string {
  return itemsOf(row)
    .map((item) => textOf(item))
    .join('|');
}

/** What a row offers a curator: its primary action, then the items of its ⋯ menu ('-' when it has none). */
function offerOf(row: HTMLElement): string {
  return `${textOf(primaryOf(row))} / ${moreOf(row) === null ? '-' : itemNames(row)}`;
}

function isOpen(trigger: HTMLElement): boolean {
  return trigger.getAttribute('aria-expanded') === 'true' && !panelOf(trigger).hasAttribute('hidden');
}

/** A browser turns Enter on a focused <button> into a click; happy-dom does not, so do it as the browser does. */
async function pressEnterOnButton(button: Element): Promise<void> {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    if (!event.defaultPrevented) (button as HTMLButtonElement).click();
  });
  await settle(40);
}

/** Opens the row's ⋯ menu and chooses `name` from it, as a mouse would. */
async function chooseFromMenu(row: HTMLElement, name: string): Promise<void> {
  const trigger = more(row);
  await click(trigger, "the row's ⋯ menu button");
  assert(isOpen(trigger), 'the ⋯ button opens its menu');
  const item = need(itemsOf(row).find((candidate) => textOf(candidate) === name), `${name} in the menu`);
  await click(item, name);
}

/** A busy button: aria-busy and aria-disabled, never the disabled attribute, so it keeps the keyboard focus. */
function isBusy(button: HTMLButtonElement): boolean {
  return (
    button.getAttribute('aria-busy') === 'true' && button.getAttribute('aria-disabled') === 'true' && !button.hasAttribute('disabled')
  );
}

/** Unavailable without being busy: aria-disabled, and not the disabled attribute. */
function isInert(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-disabled') === 'true' && button.getAttribute('aria-busy') === null && !button.hasAttribute('disabled');
}

function isIdle(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-disabled') === null && button.getAttribute('aria-busy') === null && !button.hasAttribute('disabled');
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

/** Every toast in the Notifications region: the successes first, then the errors (the two lists it keeps). */
function toastsOf(container: HTMLElement): ToastView[] {
  const section = container.querySelector('section[aria-label="Notifications"]');
  return [...(section?.querySelectorAll<HTMLElement>('li') ?? [])].map((item) => {
    const lines = [...item.querySelectorAll('p')].map((line) => textOf(line));
    return { message: lines[0] ?? '', detail: lines[1] ?? '', retry: buttonNamed(item, 'Retry') };
  });
}

function summaryOf(container: HTMLElement): { message: string; detail: string }[] {
  return toastsOf(container).map(({ message, detail }) => ({ message, detail }));
}

function toastWith(container: HTMLElement, message: string): ToastView {
  return need(
    toastsOf(container).find((toast) => toast.message === message),
    `a toast reading "${message}"`,
  );
}

function locationOf(container: HTMLElement): string {
  return textOf(container.querySelector('[data-location]'));
}

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

/** Shows the router's location, for the scenarios that read the URL the page writes. */
function LocationProbe() {
  const location = useLocation();
  return (
    <span hidden data-location="">
      {location.pathname + location.search}
    </span>
  );
}

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user: AuthUser, url?: string, jumpTo?: string) => Promise<Mounted>;

const CASCADE_SUMMARY = 'Stream approved · 2 song(s), 3 performance(s)';
const SONGS_LOCKED = 'Stream approved, but its songs were not: Songs are locked';
const NO_LONGER_APPROVED = 'Stream is no longer approved';

// --- Scenarios ---

async function firstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const first = held();
  listReply = () => first.reply;
  const { container, unmount } = await mountPage(curator);

  // One request on mount, for the default query: nothing typed, filtered or remembered yet.
  assert(calls.length === 1 && listCalls().length === 1, 'mounting sends exactly one request, for the list');
  assert(
    lastList().params.toString() === 'streamer=mizuki',
    `the first request has no status and no search, for the current streamer (got ${lastList().params.toString()})`,
  );

  // The header, the search and the filters are there before any data: only the table waits for it.
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
  assert(textOf(header.querySelector('h1')) === 'Streams', 'the <h1> is "Streams"');
  assert(textOf(header).startsWith('CATALOG'), 'the crumb is CATALOG');
  assert(countOf(container) === null, 'no count is shown before the list has loaded');

  const form = need(header.querySelector<HTMLFormElement>('form[role="search"]'), 'the search form in the header');
  const search = need(form.querySelector<HTMLInputElement>('input'), 'the search field');
  const label = need(form.querySelector<HTMLLabelElement>('label'), 'the search label');
  assert(search.type === 'search', 'the search field is a search input');
  assert(
    search.getAttribute('aria-label') === 'Search streams by title or video ID',
    'the search field is named "Search streams by title or video ID", what it matches (the name the shell test and assistive tech find it by)',
  );
  assert(
    textOf(label) === 'Search streams' && search.id !== '' && label.htmlFor === search.id,
    'and has a visually hidden label "Search streams"',
  );
  assert(search.placeholder === 'Search by title or video ID…', 'the placeholder reads "Search by title or video ID…"');
  assert(need(buttonNamed(form, 'Search'), 'a Search button').type === 'submit', 'Search submits the form');

  const newStream = need(header.querySelector<HTMLAnchorElement>('a[href="/submit/stream"]'), 'the New stream link');
  assert(textOf(newStream) === 'New stream' && newStream.querySelector('svg') !== null, 'the link reads "New stream", with an icon');
  assert(newStream.className === buttonClasses({ variant: 'primary' }), 'the link looks like a primary button');

  // The status filter: a labelled group of chips in a toolbar under the header.
  const group = statusGroup(container);
  assert(!header.contains(group), 'the status filter is in a toolbar, not in the header');
  const labelId = need(group.getAttribute('aria-labelledby'), 'the status group label id');
  const visibleLabel = need(document.getElementById(labelId), 'the status group label');
  assert(textOf(visibleLabel) === 'Status' && group.contains(visibleLabel), 'the group is named by its visible "Status" label');
  assert(
    chipsOf(group) === 'All|Pending|Approved|Rejected|Excluded|Extracted',
    `the filter offers All and the five statuses, in that order (got ${chipsOf(group)})`,
  );
  assert(pressedOf(group) === 'true|false|false|false|false|false', 'All is the option in effect');
  assert(
    [...group.querySelectorAll('button')].every((button) => button.className.includes('rounded-radius-pill')),
    'the options are kit chips',
  );
  assert(yearGroup(container) === null, 'no year filter before the list says which years it has');
  assert(container.querySelector('select') === null, 'no native select');

  // A skeleton until the first response, and no table, no empty notice behind it.
  const skeleton = need(container.querySelector('[role="status"]'), 'a skeleton while the first load is out');
  assert(textOf(skeleton) === 'Loading streams…', 'the skeleton says what is loading');
  assert(container.querySelector('table') === null, 'no table before the first response');
  assert(!container.innerHTML.includes('No streams found.'), 'an unanswered list is not an empty one');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok(listBody(STREAMS)));
  assert(container.querySelector('[role="status"]') === null, 'the response ends the loading state');
  assert(rowTitles(container) === TITLES, `the rows are the five streams, newest date first (got ${rowTitles(container)})`);
  assert(listCalls().length === 1, 'nothing else is requested once the page has loaded');
  assert(countOf(container) === '5 streams', `the header counts the streams (got ${countOf(container)})`);

  // The year filter appears once there is more than one year to choose from.
  const years = need(yearGroup(container), 'the year filter');
  assert(!header.contains(years), 'the year filter is in the toolbar too');
  const yearLabelId = need(years.getAttribute('aria-labelledby'), 'the year group label id');
  assert(textOf(document.getElementById(yearLabelId)) === 'Year', 'the year group is named by its visible "Year" label');
  assert(chipsOf(years) === 'All|2026|2025|2024', `the years are All and each year, newest first (got ${chipsOf(years)})`);
  assert(pressedOf(years) === 'true|false|false|false', 'All years is the option in effect');

  // The table: a kit table in a glass card that clips but does not scroll, so the head stays sticky.
  const table = need(container.querySelector('table'), 'the table');
  assert(
    table.className.includes('table-fixed') && /max-xl:min-w-\[\d+px\]/.test(table.className),
    'the table is fixed-layout and keeps a minimum width, below which it scrolls',
  );
  // It fits its card at 1100 px, where the card shows 834 px of table (1100 less the 224 px sidebar, the page's two
  // 20 px gutters and the card's 1 px edges; measured in Chromium). At that minimum its columns leave the title at least
  // 74 px, its head with the sort chevron: the other columns are each as wide as their widest content, and no wider.
  const minWidth = Number(/max-xl:min-w-\[(\d+)px\]/.exec(table.className)?.[1] ?? Number.NaN);
  assert(minWidth <= 834, `the table's minimum width fits the card at 1100 px, 834 px (got ${minWidth})`);
  const colClasses = [...table.querySelectorAll('col')].map((col) => col.className);
  const fixedWidth = colClasses.reduce((sum, name) => sum + Number(/^w-\[(\d+)px\]$/.exec(name)?.[1] ?? 0), 0);
  const share = colClasses.reduce((sum, name) => sum + Number(/^w-\[(\d+)%\]$/.exec(name)?.[1] ?? 0), 0) / 100;
  const titleAtMinimum = minWidth - fixedWidth - share * minWidth;
  assert(titleAtMinimum >= 74, `at that minimum the title column keeps at least 74 px (got ${titleAtMinimum})`);
  const scroller = need(table.parentElement, 'the table scroller');
  assert(scroller.classList.contains('max-xl:overflow-x-auto'), 'the table scrolls inside its card below 1280 px');
  const card = need(scroller.parentElement, 'the table card');
  assert(
    card.classList.contains('glass-card') && card.classList.contains('overflow-clip') && !/overflow-(hidden|auto)/.test(card.className),
    'the card clips with overflow-clip, which is no scroll container',
  );
  assert(need(table.querySelector('thead'), 'a head').classList.contains('xl:sticky'), 'the head sticks from 1280 px');

  assert(headCells(container).map((cell) => textOf(cell)).join('|') === COLUMNS.join('|'), `a curator sees ${COLUMNS.join(', ')}`);
  assert(headCell(container, 'Actions').querySelector('.sr-only') !== null, 'the Actions head is a label for screen readers only');
  assert(
    ['Title', 'Date', 'Status', 'Created'].map((name) => sortOf(container, name)).join('|') === 'none|descending|none|none',
    'the list is sorted by Date, newest first, and only Title, Date, Status and Created can be sorted',
  );
  for (const name of ['Video ID', 'Submitted by', 'Actions']) {
    assert(headCell(container, name).getAttribute('aria-sort') === null, `${name} is not sortable`);
  }

  // The rows: a link to the stream, its date, the video as a mono link out to YouTube, a status pill,
  // the submitter (cut short, in full in the title) and the creation time.
  assert(
    bodyRows(container).map((row) => titleLink(row).getAttribute('href')).join('|') === STREAMS.map((row) => `/streams/${row.id}`).join('|'),
    'each title links to its stream',
  );
  assert(
    bodyRows(container).map((row) => textOf(cellOf(row, DATE))).join('|') === STREAMS.map((row) => row.date).join('|'),
    "each row shows the stream's own date as it is",
  );
  assert(
    bodyRows(container).map(statusOf).join('|') === 'Pending|Extracted|Approved|Rejected|Excluded',
    'each row shows its status as a pill',
  );
  assert(
    need(cellOf(rowFor(container, 'Excluded Stream'), STATUS).querySelector('span'), 'the excluded pill').classList.contains('line-through'),
    'an excluded stream is struck through',
  );
  for (const row of STREAMS) {
    const tr = rowFor(container, row.title);
    const video = need(cellOf(tr, VIDEO).querySelector<HTMLAnchorElement>('a'), `the video link of ${row.title}`);
    assert(textOf(video) === row.videoId && video.getAttribute('href') === row.youtubeUrl, `${row.title}: the video ID links to YouTube`);
    assert(
      video.target === '_blank' && video.rel === 'noopener noreferrer' && video.classList.contains('font-mono'),
      `${row.title}: the video link opens a new tab, safely, in mono`,
    );
    assert(video.querySelector('svg') !== null, `${row.title}: the video link carries the arrow-up-right icon`);
  }
  const submitted = cellOf(rowFor(container, 'Approved Stream'), SUBMITTER);
  assert(textOf(submitted) === APPROVED.submittedBy, 'a submitter is shown');
  assert(
    need(submitted.firstElementChild, 'the submitter text').classList.contains('truncate') &&
      submitted.firstElementChild?.getAttribute('title') === APPROVED.submittedBy,
    'a long submitter is cut short, with the full address in the title',
  );
  assert(textOf(cellOf(rowFor(container, 'Extracted Stream'), SUBMITTER)) === '—', 'no submitter reads "—"');

  // Dates: the short form in the cell, the full time and the exact instant beside it.
  const thisYear = need(cellOf(rowFor(container, 'Pending Stream'), CREATED).querySelector('time'), "the pending stream's time");
  assert(thisYear.getAttribute('datetime') === `${THIS_YEAR}-01-15T12:00:00.000Z`, 'the exact instant is in dateTime, as an ISO string');
  assert(/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/.test(textOf(thisYear)), `a time this year reads like "Jan 15, 12:00" (got ${textOf(thisYear)})`);
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(thisYear.getAttribute('title') ?? ''), 'the full time is in the title');
  const older = need(cellOf(rowFor(container, 'Extracted Stream'), CREATED).querySelector('time'), "the extracted stream's time");
  assert(older.getAttribute('datetime') === '2020-03-04T12:00:00.000Z', 'the exact instant is in dateTime for an older stream too');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(textOf(older)), `a time from another year reads like "2020-03-04" (got ${textOf(older)})`);

  // Actions are always there: a row's buttons, and what they sit in, are not revealed by hover.
  for (const row of bodyRows(container)) {
    const cell = cellOf(row, ACTIONS);
    for (const button of cell.querySelectorAll('button')) {
      for (let element: Element | null = button; element !== null && element !== cell; element = element.parentElement) {
        assert(
          !/(?:^|\s)(?:hidden|opacity-0|invisible)(?:\s|$)|group-hover|group-focus-within/.test(element.getAttribute('class') ?? ''),
          `${textOf(row.querySelector('a'))}: its actions are always visible, not hover-only`,
        );
      }
    }
  }

  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assert(toastsOf(container).length === 0, 'a load raises no toast');
  assert(container.querySelector('dialog[open]') === null, 'and asks nothing');
  assertNoRawColour(container.innerHTML, 'the loaded page');

  await unmount();
  console.log('✓ Streams: first request, header with search, count and New stream, filters, skeleton, kit table, dates, links');
}

async function eachStatusOffersItsActions(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  // Stream Detail's rules: one primary action, the rest in the ⋯ menu; approved offers Unapprove alone,
  // and nothing offers Exclude where the worker would refuse it.
  deepStrictEqual(
    STREAMS.map((row) => offerOf(rowFor(container, row.title))),
    [
      'Approve stream / Reject|Exclude',
      'Approve stream / Reject|Exclude',
      'Unapprove / -',
      'Restore / Exclude',
      'Restore / -',
    ],
  );

  const approvedRow = rowFor(container, 'Approved Stream');
  assert(moreOf(approvedRow) === null, 'an approved stream has no ⋯ menu');
  assert(!textOf(approvedRow).includes('Exclude') && !textOf(approvedRow).includes('Delete'), 'and no Exclude or Delete anywhere in its row');
  assert(!container.innerHTML.includes('Delete'), 'no row offers Delete: deleting a stream stays on its own page');
  for (const row of STREAMS) {
    const tr = rowFor(container, row.title);
    assert(!itemsOf(tr).some((item) => textOf(item) === textOf(primaryOf(tr))), `${row.title}: the menu repeats nothing the primary does`);
  }

  // The primary is a kit button that names its stream; Approve stream is the filled one.
  const approve = primaryOf(rowFor(container, 'Pending Stream'));
  assert(approve.getAttribute('aria-label') === 'Approve stream: Pending Stream', 'a row button names the stream it acts on');
  assert(approve.className.includes('bg-accent'), 'Approve stream is the filled primary button');
  assert(
    primaryOf(approvedRow).className.includes('bg-field') && primaryOf(rowFor(container, 'Excluded Stream')).className.includes('bg-field'),
    'Unapprove and Restore are secondary buttons',
  );
  assert(primaryOf(approvedRow).getAttribute('aria-label') === 'Unapprove: Approved Stream', 'Unapprove names its stream too');

  // The ⋯ button names its stream, and its menu is that stream's.
  const trigger = more(rowFor(container, 'Pending Stream'));
  assert(trigger.getAttribute('aria-label') === 'More actions for Pending Stream', 'the ⋯ button names its stream');
  assert(trigger.getAttribute('aria-haspopup') === 'menu' && !isOpen(trigger), 'and opens a menu, closed at first');
  assert(
    panelOf(trigger).querySelector('[role="menu"]')?.getAttribute('aria-label') === 'More actions for Pending Stream',
    'the menu is named after its stream',
  );

  // From the keyboard: Enter on the ⋯ opens the menu on its first item, Escape closes it and returns to the ⋯.
  await focus(trigger);
  await pressEnterOnButton(trigger);
  assert(isOpen(trigger), 'Enter on the ⋯ button opens its menu');
  const items = itemsOf(rowFor(container, 'Pending Stream'));
  assert(items.every((item) => item.getAttribute('role') === 'menuitem'), 'the items are menuitems');
  assert(focused() === items[0], 'the first item has the focus');
  await act(async () => {
    need(focused(), 'a focused item').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await settle();
  assert(!isOpen(trigger) && focused() === trigger, 'Escape closes the menu and returns the focus to the ⋯ button');
  assert(statusCalls().length === 0, 'nothing was sent');

  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assert(unexpected.length === 0, `nothing but the list is requested (${unexpected.join(', ')})`);
  assertNoRawColour(container.innerHTML, 'the page with its menus');

  await unmount();
  console.log('✓ Streams (curator): each status offers its primary action and ⋯ items; approved has no menu and no Exclude');
}

async function approveRunsTheCascade(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');
  const approve = primaryOf(row);
  const menuButton = more(row);

  // A keyboard user on Approve stream: it sends the status change, and is busy (still focusable) meanwhile.
  await focus(approve);
  const statusGate = held();
  statusReply = () => statusGate.reply;
  await click(approve, 'Approve stream');
  assert(statusCalls().length === 1, 'Approve stream sends one status request');
  const sent = need(statusCalls()[0], 'the status request');
  assert(sent.path === '/api/streams/st-pending/status' && sent.method === 'PATCH', 'it patches the stream status');
  deepStrictEqual(sent.body, { status: 'approved' });
  assert(isBusy(approve), 'the clicked button is busy, not disabled');
  assert(focused() === approve, 'Approve stream keeps the focus while its request is out');
  assert(isIdle(menuButton), 'the ⋯ button stays as it is: it may hold the keyboard focus');
  assert(itemsOf(row).length === 2 && itemsOf(row).every((item) => item.disabled), 'while a request is out its menu items are unavailable');
  await click(approve, 'the busy Approve stream');
  assert(statusCalls().length === 1, 'a second click on the busy button sends nothing');
  assert(statusOf(row) === 'Pending' && toastsOf(container).length === 0, 'the row reads Pending and nothing is announced yet');

  // The status change is followed by the cascade to the stream's songs and performances; the row
  // is busy for both, and shows its new status once the whole approval is done.
  const cascadeGate = held();
  approveReply = () => cascadeGate.reply;
  await respond(statusGate, ok({ id: 'st-pending', status: 'approved' }));
  assert(approveCalls().length === 1, 'the answer is followed by the approve-all request');
  const cascade = need(approveCalls()[0], 'the approve-all request');
  assert(cascade.path === '/api/streams/st-pending/approve-all', 'for the same stream');
  assert(isBusy(approve) && statusOf(row) === 'Pending', 'the button stays busy while the songs are approved');
  assert(toastsOf(container).length === 0, 'and nothing is announced before the songs are done');

  await respond(cascadeGate, ok({ ok: true, songs: 2, performances: 3 }));
  assert(statusOf(row) === 'Approved', 'the row shows the new status as a pill');
  assert(bodyRows(container).length === 5 && rowFor(container, 'Pending Stream') === row, 'the same row stays in place, with its title link');
  assert(
    primaryOf(row) === approve && textOf(approve) === 'Unapprove' && isIdle(approve),
    'the button stays, relabelled Unapprove, and is available again',
  );
  assert(focused() === approve, 'and keeps the focus it had');
  assert(moreOf(row) === null, 'an approved stream has no ⋯ menu');
  deepStrictEqual(summaryOf(container), [{ message: CASCADE_SUMMARY, detail: 'Pending Stream' }]);
  assert(listCalls().length === 1, 'the list is patched in place, not reloaded');
  assert(unexpected.length === 0, `nothing else is requested (${unexpected.join(', ')})`);

  // An extracted stream is approved the same way.
  const extractedRow = rowFor(container, 'Extracted Stream');
  await click(primaryOf(extractedRow), 'Approve stream on the extracted row');
  assert(need(statusCalls()[1], 'the second status request').path === '/api/streams/st-extracted/status', 'Approve stream works on an extracted stream');
  assert(need(approveCalls()[1], 'the second approve-all request').path === '/api/streams/st-extracted/approve-all', 'and approves its songs');
  assert(statusOf(extractedRow) === 'Approved', 'the extracted stream reads Approved');

  await unmount();
  console.log('✓ Streams (curator): Approve stream sends the status, then approves the songs — busy meanwhile, then pill, toast, focus');
}

/**
 * The worker answers a status change `{ id, status }` and nothing more. However the change is chosen,
 * the row afterwards is the same one with everything it showed — title link, date, video ID, submitter
 * and creation time — and only its status new.
 */
async function aRowKeepsItsFields(
  mountPage: MountPage,
  change: { via: string; perform: (row: HTMLElement) => Promise<void>; sends: string[]; status: string },
): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');
  const before = cellsOf(row).slice(0, ACTIONS).map(textOf);
  assert(before[TITLE] === 'Pending Stream' && before[DATE] === '2026-08-01', 'the pending stream is listed with its title and date');
  assert(before[VIDEO] === 'vidPending01' && before[SUBMITTER] === 'fan@example.com', 'with its video ID and submitter');
  assert(before[CREATED] !== '' && before[STATUS] === 'Pending', 'and its creation time and status');

  await change.perform(row);
  assert(
    calls.map((call) => `${call.method} ${call.path}`).join(' | ') === ['GET /api/streams', ...change.sends].join(' | '),
    `${change.via} sends ${change.sends.join(' and ')} (saw ${calls.map((call) => `${call.method} ${call.path}`).join(' | ')})`,
  );

  assert(bodyRows(container).length === 5 && bodyRows(container)[0] === row, 'the same row stays in place');
  const after = cellsOf(row).slice(0, ACTIONS).map(textOf);
  assert(after[TITLE] === before[TITLE], `${change.via}: the title link still reads "${before[TITLE]}" (got "${after[TITLE]}")`);
  assert(after[DATE] === before[DATE], `${change.via}: the date is still ${before[DATE]} (got "${after[DATE]}")`);
  assert(after[VIDEO] === before[VIDEO], `${change.via}: the video ID is still ${before[VIDEO]} (got "${after[VIDEO]}")`);
  assert(after[SUBMITTER] === before[SUBMITTER], `${change.via}: the submitter is still ${before[SUBMITTER]} (got "${after[SUBMITTER]}")`);
  assert(after[CREATED] === before[CREATED], `${change.via}: the creation time is still ${before[CREATED]} (got "${after[CREATED]}")`);
  assert(after[STATUS] === change.status, `${change.via}: the status reads ${change.status} (got "${after[STATUS]}")`);
  assert(
    cellOf(row, VIDEO).querySelector('a')?.getAttribute('href') === PENDING.youtubeUrl,
    `${change.via}: the video link still points at the stream's video`,
  );
  assert(unexpected.length === 0, `nothing else is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log(`✓ Streams: ${change.via} leaves the row its title, date, video ID, submitter and creation time`);
}

async function menuActionsAndFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  // Reject from the ⋯ menu: the menu stays (Exclude is still on it), so the focus is back on the ⋯ button.
  const pendingRow = rowFor(container, 'Pending Stream');
  const pendingMore = more(pendingRow);
  const pendingPrimary = primaryOf(pendingRow);
  await focus(pendingMore);
  await pressEnterOnButton(pendingMore);
  assert(isOpen(pendingMore), 'the menu is open');
  const rejectGate = held();
  statusReply = () => rejectGate.reply;
  const reject = need(itemsOf(pendingRow).find((item) => textOf(item) === 'Reject'), 'Reject in the menu');
  await focus(reject);
  await pressEnterOnButton(reject);
  assert(statusCalls().length === 1, 'Reject sends a status request');
  assert(need(statusCalls()[0], 'the status request').path === '/api/streams/st-pending/status', 'for the stream');
  deepStrictEqual(need(statusCalls()[0], 'the status request').body, { status: 'rejected' });
  assert(!isOpen(pendingMore) && focused() === pendingMore, 'the menu closes and the focus is back on the ⋯ button');
  assert(isInert(pendingPrimary), 'the primary action is unavailable (and keeps its place) while another request is out');
  assert(itemsOf(pendingRow).every((item) => item.disabled), 'so are the menu items');
  assert(isIdle(pendingMore), 'the ⋯ button itself stays enabled, so it can hold the focus');
  await click(pendingPrimary, 'the unavailable primary action');
  assert(statusCalls().length === 1, 'a click on it sends nothing');

  await respond(rejectGate, ok({ id: 'st-pending', status: 'rejected' }));
  statusReply = defaultStatusReply;
  assert(statusOf(pendingRow) === 'Rejected', 'the row shows the new status');
  assert(offerOf(pendingRow) === 'Restore / Exclude', 'a rejected stream offers Restore, with Exclude in its menu');
  assert(primaryOf(pendingRow) === pendingPrimary && moreOf(pendingRow) === pendingMore, 'both buttons are the ones that were there');
  assert(isIdle(pendingPrimary) && itemsOf(pendingRow).every((item) => !item.disabled), 'and everything is available again');
  assert(focused() === pendingMore, 'the focus is still on the ⋯ button');
  deepStrictEqual(summaryOf(container), [{ message: 'Stream rejected', detail: 'Pending Stream' }]);

  // Exclude from the ⋯ menu of a rejected stream: the row loses its menu, so the focus moves to its primary.
  await chooseFromMenu(pendingRow, 'Exclude');
  deepStrictEqual(need(statusCalls()[1], 'the second status request').body, { status: 'excluded' });
  assert(statusOf(pendingRow) === 'Excluded', 'the row reads Excluded');
  assert(moreOf(pendingRow) === null, 'an excluded stream has no ⋯ menu');
  assert(offerOf(pendingRow) === 'Restore / -', 'it offers Restore alone');
  assert(
    focused() === pendingPrimary,
    `the ⋯ button that held the focus is gone, so the row's primary takes it, not <body> (got ${focused()?.tagName})`,
  );
  assert(summaryOf(container).at(-1)?.message === 'Stream excluded', 'and the toast says Stream excluded');

  // Restore (primary): back to pending, where the row has its menu again; the focus never left the button.
  await focus(pendingPrimary);
  await click(pendingPrimary, 'Restore');
  deepStrictEqual(need(statusCalls()[2], 'the third status request').body, { status: 'pending' });
  assert(statusOf(pendingRow) === 'Pending', 'Restore sets the stream pending');
  assert(offerOf(pendingRow) === 'Approve stream / Reject|Exclude', 'and it is offered Approve stream again');
  assert(primaryOf(pendingRow) === pendingPrimary && focused() === pendingPrimary, 'on the same button, which keeps the focus');
  assert(summaryOf(container).at(-1)?.message === 'Stream restored', 'the toast says Stream restored');
  assert(approveCalls().length === 0, 'none of this approved any songs');

  // The other statuses' menus, by mouse.
  await chooseFromMenu(rowFor(container, 'Extracted Stream'), 'Exclude');
  assert(statusOf(rowFor(container, 'Extracted Stream')) === 'Excluded', 'an extracted stream can be excluded too');
  await chooseFromMenu(rowFor(container, 'Pending Stream'), 'Reject');
  assert(statusOf(rowFor(container, 'Pending Stream')) === 'Rejected', 'and a pending one rejected');

  // Unapprove (approved → pending): the row gains a menu, and its primary becomes Approve stream.
  const approvedRow = rowFor(container, 'Approved Stream');
  const unapprove = primaryOf(approvedRow);
  await focus(unapprove);
  await click(unapprove, 'Unapprove');
  assert(statusCalls().at(-1)?.path === '/api/streams/st-approved/status', 'Unapprove patches the stream');
  deepStrictEqual(statusCalls().at(-1)?.body, { status: 'pending' });
  assert(statusOf(approvedRow) === 'Pending' && offerOf(approvedRow) === 'Approve stream / Reject|Exclude', 'the stream is pending again');
  assert(primaryOf(approvedRow) === unapprove && focused() === unapprove, 'on the same button, with the focus');
  assert(summaryOf(container).at(-1)?.message === 'Stream unapproved', 'the toast says Stream unapproved');
  assert(approveCalls().length === 0, 'unapproving touches no songs');
  assert(listCalls().length === 1 && unexpected.length === 0, 'none of it reloads the list');
  assertNoRawColour(container.innerHTML, 'the page after its actions');

  await unmount();
  console.log('✓ Streams (curator): Reject, Exclude, Restore and Unapprove — pill, toast, and the focus stays on the ⋯ button or moves to the primary');
}

async function focusIsNeverLost(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  // A status this build does not know leaves the row with no action at all (the worker moved on first).
  // The focus goes to the title link then: from the primary that held it, and from the ⋯ button that held
  // it (the primary is gone too, so it cannot take it).
  statusReply = (_call, id) => ok({ id, status: 'archived' });
  const approvedRow = rowFor(container, 'Approved Stream');
  await focus(primaryOf(approvedRow));
  await click(primaryOf(approvedRow), 'Unapprove');
  assert(statusOf(approvedRow).toLowerCase() === 'archived', 'the row shows the status the worker saved');
  assert(cellOf(approvedRow, ACTIONS).querySelector('button') === null, 'a status the page does not know offers nothing');
  assert(focused() === titleLink(approvedRow), `the focus goes to the row's title link, not to <body> (got ${focused()?.tagName})`);
  assert(summaryOf(container).at(-1)?.message === 'Stream archived', 'the toast names the status that was saved');

  const rejectedRow = rowFor(container, 'Rejected Stream');
  await chooseFromMenu(rejectedRow, 'Exclude');
  assert(cellOf(rejectedRow, ACTIONS).querySelector('button') === null, 'the rejected row has nothing left either');
  assert(focused() === titleLink(rejectedRow), 'the focus goes to its title link too');
  statusReply = defaultStatusReply;

  // An answer that lands after the user has moved on takes nothing back.
  const pendingRow = rowFor(container, 'Pending Stream');
  const gate = held();
  statusReply = () => gate.reply;
  await chooseFromMenu(pendingRow, 'Exclude');
  assert(focused() === more(pendingRow), 'the focus is on the ⋯ button while the request is out');
  const search = need(container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field');
  await focus(search);
  await respond(gate, ok({ id: 'st-pending', status: 'excluded' }));
  assert(statusOf(pendingRow) === 'Excluded', 'the row still changes');
  assert(focused() === search, 'and the focus stays where the user put it');

  await unmount();
  console.log('✓ Streams: a row that loses its buttons hands the focus to its title link; a late answer never takes it back');
}

async function failedChangesOfferRetry(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');
  const approve = primaryOf(row);

  // A failed status change: the row is as it was, the toast carries the server's message and a Retry.
  statusReply = () => failure(400, 'Cannot transition from pending to approved');
  await focus(approve);
  await click(approve, 'Approve stream');
  assert(statusOf(row) === 'Pending', 'a failed action leaves the row as it was');
  assert(primaryOf(row) === approve && isIdle(approve) && itemsOf(row).every((item) => !item.disabled), 'and its buttons are available again');
  assert(focused() === approve, 'the focus never left Approve stream');
  assert(approveCalls().length === 0, 'the songs are not touched when the status change failed');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `a failure raises one toast (saw ${toasts.length})`);
  const failed = need(toasts[0], 'the failure toast');
  assert(failed.message === 'Cannot transition from pending to approved', `the toast carries the server's message (got "${failed.message}")`);
  assert(failed.retry !== null, 'and offers Retry');
  assert(
    need(container.querySelector('section[aria-label="Notifications"] li'), 'the toast').innerHTML.includes('bg-danger-solid'),
    'an error toast is the danger one',
  );

  // Retry sends the same call; its success replaces the failure.
  statusReply = defaultStatusReply;
  await click(failed.retry, 'Retry in the toast');
  assert(statusCalls().length === 2, 'Retry sends the call again');
  const retried = need(statusCalls()[1], 'the retried request');
  assert(retried.path === '/api/streams/st-pending/status', 'to the same stream');
  deepStrictEqual(retried.body, { status: 'approved' });
  assert(statusOf(row) === 'Approved', 'the row shows the new status');
  deepStrictEqual(summaryOf(container), [{ message: CASCADE_SUMMARY, detail: 'Pending Stream' }]);

  // A failed Reject retries as a Reject.
  const secondRow = rowFor(container, 'Extracted Stream');
  statusReply = () => failure(500, 'Database is locked');
  await chooseFromMenu(secondRow, 'Reject');
  const locked = toastWith(container, 'Database is locked');
  assert(statusOf(secondRow) === 'Extracted', 'the second stream is unchanged');
  statusReply = defaultStatusReply;
  await click(locked.retry, 'Retry in the toast');
  deepStrictEqual(statusCalls().at(-1)?.body, { status: 'rejected' });
  assert(statusOf(secondRow) === 'Rejected', 'the retried Reject takes effect');

  assert(listCalls().length === 1, 'the list was not reloaded');
  await unmount();
  console.log('✓ Streams (curator): a failed status change keeps the row, shows the server message and a Retry that sends the same call');
}

async function cascadeFailureRetriesOnlyTheCascade(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');
  const approve = primaryOf(row);

  // The status change lands and the songs do not: the stream is approved, and the toast says what is not.
  approveReply = () => failure(500, 'Songs are locked');
  await focus(approve);
  await click(approve, 'Approve stream');
  assert(statusCalls().length === 1 && approveCalls().length === 1, 'the status change and the cascade were each sent once');
  assert(statusOf(row) === 'Approved', 'the status change took effect, so the row reads Approved');
  assert(primaryOf(row) === approve && textOf(approve) === 'Unapprove' && isIdle(approve), 'and its button is Unapprove, available');
  assert(focused() === approve, 'with the focus where it was');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `one toast (saw ${toasts.length})`);
  const failed = need(toasts[0], 'the cascade failure toast');
  assert(
    failed.message === SONGS_LOCKED,
    `the toast says the stream is approved and its songs are not, with the reason (got "${failed.message}")`,
  );
  assert(failed.retry !== null, 'and offers Retry');
  assert(
    need(container.querySelector('section[aria-label="Notifications"] li'), 'the toast').innerHTML.includes('bg-danger-solid'),
    'as an error',
  );

  // Retry calls only the cascade: the status is already approved, so it is not asked for again.
  approveReply = defaultApproveReply;
  await click(failed.retry, 'Retry in the toast');
  assert(statusCalls().length === 1, 'Retry sends no second status change');
  assert(approveCalls().length === 2, 'it sends the cascade again');
  assert(need(approveCalls()[1], 'the retried cascade').path === '/api/streams/st-pending/approve-all', 'for the same stream');
  deepStrictEqual(summaryOf(container), [{ message: CASCADE_SUMMARY, detail: 'Pending Stream' }]);
  assert(statusOf(row) === 'Approved', 'the row still reads Approved');

  // And a Retry that fails again is a fresh failure toast with its own Retry.
  approveReply = () => failure(503, 'Songs are busy');
  await click(primaryOf(rowFor(container, 'Extracted Stream')), 'Approve stream on the extracted row');
  const firstBusy = toastWith(container, 'Stream approved, but its songs were not: Songs are busy');
  approveReply = () => failure(503, 'Songs are still busy');
  await click(firstBusy.retry, 'Retry in the toast');
  assert(
    toastWith(container, 'Stream approved, but its songs were not: Songs are still busy').retry !== null,
    'a Retry that fails again raises a new toast with a Retry',
  );
  assert(listCalls().length === 1 && unexpected.length === 0, 'the list was not reloaded');

  await unmount();
  console.log('✓ Streams (curator): a cascade that fails after the status change toasts the reason, and its Retry sends only the cascade');
}

/**
 * A failure toast with a Retry stays until it is dismissed, so it can outlive the state it was raised in. The
 * cascade's Retry would approve the songs and performances of a stream, and say so, on the strength of a status
 * that may be gone: it sends nothing unless the last status the page saw for the stream is approved.
 */
async function aStaleCascadeRetryApprovesNothing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // The cascade fails: the stream is approved, and the failure toast stays up with its Retry.
  approveReply = () => failure(500, 'Songs are locked');
  await click(primaryOf(row), 'Approve stream');
  const stale = toastWith(container, SONGS_LOCKED);
  assert(stale.retry !== null && statusOf(row) === 'Approved', 'the stream is approved and its songs are not, with a Retry up');

  // The curator then unapproves it. The toast is still there.
  approveReply = defaultApproveReply;
  await click(primaryOf(row), 'Unapprove');
  assert(statusOf(row) === 'Pending', 'the stream is pending again');
  assert(toastsOf(container).some((toast) => toast.message === SONGS_LOCKED), 'and the failure toast is still up');

  // Its Retry would approve the songs of a pending stream, and toast that the stream was approved: it does neither.
  const sent = calls.length;
  await click(stale.retry, 'the old Retry');
  assert(calls.length === sent && approveCalls().length === 1, 'the old Retry sends nothing, no second approve-all included');
  const notice = toastWith(container, NO_LONGER_APPROVED);
  assert(notice.detail === 'Pending Stream', 'it says which stream is no longer approved');
  assert(notice.retry === null, 'with nothing to retry');
  assert(
    !need(container.querySelector('section[aria-label="Notifications"]'), 'the notifications').innerHTML.includes('bg-danger-solid'),
    'as information, not an error',
  );
  assert(!toastsOf(container).some((toast) => toast.message === SONGS_LOCKED), 'the press took the failure toast down');
  assert(!toastsOf(container).some((toast) => toast.message.startsWith('Stream approved ·')), 'and no toast says the stream was approved');
  assert(statusOf(row) === 'Pending', 'the row is as it was');
  assert(unexpected.length === 0, `nothing else was requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams (curator): a cascade Retry pressed after the stream was unapproved sends nothing and says so');
}

/**
 * A filter or a search can leave a stream out of the list while its failure toast is still up. The page keeps the
 * last status it saw for every stream it has loaded or patched, so what the Retry reads does not depend on the
 * list on screen. A stream that is still approved goes through: the Retry approves its songs, once, and says how
 * that went.
 */
async function aCascadeRetryStillGoesThroughWhenTheListLeftTheStreamOut(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // The cascade fails: the stream is approved, and the failure toast stays up with its Retry.
  approveReply = () => failure(500, 'Songs are locked');
  await click(primaryOf(row), 'Approve stream');
  const failed = toastWith(container, SONGS_LOCKED);
  assert(failed.retry !== null && statusOf(row) === 'Approved', 'the stream is approved and its songs are not, with a Retry up');

  // The curator narrows the list to extracted streams: the approved stream is no longer in it.
  listReply = () => ok(listBody([EXTRACTED]));
  await click(chip(statusGroup(container), 'Extracted'), 'the Extracted chip');
  assert(rowTitles(container) === 'Extracted Stream', 'the approved stream has left the list');
  assert(statusCalls().length === 1 && approveCalls().length === 1, 'and nothing was sent for it');

  // Its Retry goes through: the stream is still approved. It approves the songs once, and says how it went.
  approveReply = defaultApproveReply;
  await click(failed.retry, 'the Retry of a stream the list left out');
  assert(statusCalls().length === 1, 'the Retry sends no status change');
  assert(approveCalls().length === 2, 'it sends the cascade once');
  assert(need(approveCalls()[1], 'the retried cascade').path === '/api/streams/st-pending/approve-all', 'for that stream');
  deepStrictEqual(summaryOf(container), [{ message: CASCADE_SUMMARY, detail: 'Pending Stream' }]);
  assert(!toastsOf(container).some((toast) => toast.message === NO_LONGER_APPROVED), 'and the stream is not called unapproved');
  assert(rowTitles(container) === 'Extracted Stream' && listCalls().length === 2, 'the list is as the filter left it');
  assert(unexpected.length === 0, `nothing else was requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams (curator): a cascade Retry for a still approved stream a filter left out of the list goes through, once');
}

/**
 * The other half: a stream the curator unapproved before the filter changed is still refused, though it is no
 * longer in the list to say so. The page saw it pending last, and it keeps that.
 */
async function aStaleCascadeRetryStaysRefusedWhenTheListLeftTheStreamOut(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // The cascade fails; the curator unapproves the stream; then the list is narrowed and it leaves.
  approveReply = () => failure(500, 'Songs are locked');
  await click(primaryOf(row), 'Approve stream');
  const stale = toastWith(container, SONGS_LOCKED);
  approveReply = defaultApproveReply;
  await click(primaryOf(row), 'Unapprove');
  assert(statusOf(row) === 'Pending', 'the stream is pending again');
  listReply = () => ok(listBody([EXTRACTED]));
  await click(chip(statusGroup(container), 'Extracted'), 'the Extracted chip');
  assert(rowTitles(container) === 'Extracted Stream', 'the unapproved stream has left the list');

  // Its old Retry sends nothing and says why, as it does while the row is listed.
  const before = calls.length;
  await click(stale.retry, 'the Retry of an unapproved stream the list left out');
  assert(calls.length === before && approveCalls().length === 1, 'the Retry sends nothing, no second approve-all included');
  const notice = toastWith(container, NO_LONGER_APPROVED);
  assert(notice.detail === 'Pending Stream' && notice.retry === null, 'it says which stream is no longer approved, with nothing to retry');
  assert(!toastsOf(container).some((toast) => toast.message === SONGS_LOCKED), 'the press took the failure toast down');
  assert(!toastsOf(container).some((toast) => toast.message.startsWith('Stream approved ·')), 'and no toast says the stream was approved');
  assert(unexpected.length === 0, `nothing else was requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams (curator): a cascade Retry for an unapproved stream a filter left out of the list is still refused');
}

/**
 * A status answer can land after its row has left the list: the curator narrows the list (a chip, a search) while
 * the request is out, and patching the row finds nothing to patch. The page still applies the status it was
 * answered, so what a cascade Retry reads is that status, not the one the row had when it left. Approving first:
 * the cascade then fails, and its Retry, for a stream that is approved, goes through.
 */
async function aCascadeRetryGoesThroughWhenTheApprovalLandsAfterTheRowLeft(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // Approve stream is pressed and its status request is held.
  const statusGate = held();
  statusReply = () => statusGate.reply;
  await click(primaryOf(row), 'Approve stream');
  assert(statusCalls().length === 1 && isBusy(primaryOf(row)), 'the status change is out');

  // The curator narrows the list meanwhile: the row leaves it.
  listReply = () => ok(listBody([EXTRACTED]));
  await click(chip(statusGroup(container), 'Extracted'), 'the Extracted chip');
  assert(rowTitles(container) === 'Extracted Stream', 'the stream has left the list');

  // The answer lands (approved), and then the songs fail.
  approveReply = () => failure(500, 'Songs are locked');
  await respond(statusGate, ok({ id: 'st-pending', status: 'approved' }));
  assert(approveCalls().length === 1, 'the answer is followed by the cascade');
  const failed = toastWith(container, SONGS_LOCKED);
  assert(failed.retry !== null, 'which fails, with a Retry up');
  assert(rowTitles(container) === 'Extracted Stream', 'and the list is as the filter left it');

  // Its Retry goes through: the stream is approved. It sends the cascade once more, and says how it went.
  approveReply = defaultApproveReply;
  await click(failed.retry, 'the Retry');
  assert(statusCalls().length === 1, 'the Retry sends no status change');
  assert(approveCalls().length === 2, 'it sends the cascade once more');
  assert(need(approveCalls()[1], 'the retried cascade').path === '/api/streams/st-pending/approve-all', 'for that stream');
  deepStrictEqual(summaryOf(container), [{ message: CASCADE_SUMMARY, detail: 'Pending Stream' }]);
  assert(!toastsOf(container).some((toast) => toast.message === NO_LONGER_APPROVED), 'and the stream is not called unapproved');
  assert(unexpected.length === 0, `nothing else was requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams (curator): an approval that lands after its row left the list still lets the cascade Retry through');
}

/**
 * The other direction: the stream is unapproved, the row leaves the list while that request is out, and the
 * answer lands after. The page applies it all the same, so the old Retry of the earlier cascade failure finds a
 * stream that is no longer approved, as it does while the row is listed.
 */
async function aStaleCascadeRetryStaysRefusedWhenTheUnapprovalLandsAfterTheRowLeft(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // The cascade fails: the stream is approved, and the failure toast stays up with its Retry.
  approveReply = () => failure(500, 'Songs are locked');
  await click(primaryOf(row), 'Approve stream');
  const stale = toastWith(container, SONGS_LOCKED);
  assert(stale.retry !== null && statusOf(row) === 'Approved', 'the stream is approved and its songs are not, with a Retry up');

  // Unapprove is pressed and its status request is held; the curator narrows the list meanwhile.
  const statusGate = held();
  statusReply = () => statusGate.reply;
  await click(primaryOf(row), 'Unapprove');
  assert(statusCalls().length === 2 && isBusy(primaryOf(row)), 'the status change is out');
  listReply = () => ok(listBody([EXTRACTED]));
  await click(chip(statusGroup(container), 'Extracted'), 'the Extracted chip');
  assert(rowTitles(container) === 'Extracted Stream', 'the stream has left the list');

  // The answer lands (pending) after the row has gone.
  await respond(statusGate, ok({ id: 'st-pending', status: 'pending' }));
  assert(toastsOf(container).some((toast) => toast.message === 'Stream unapproved'), 'the stream is unapproved');

  // The old Retry sends nothing and says why, as it does while the row is listed.
  const before = calls.length;
  await click(stale.retry, 'the old Retry');
  assert(calls.length === before && approveCalls().length === 1, 'no approve-all request is sent');
  const notice = toastWith(container, NO_LONGER_APPROVED);
  assert(notice.detail === 'Pending Stream' && notice.retry === null, 'it says which stream is no longer approved, with nothing to retry');
  assert(!toastsOf(container).some((toast) => toast.message === SONGS_LOCKED), 'the press took the failure toast down');
  assert(!toastsOf(container).some((toast) => toast.message.startsWith('Stream approved ·')), 'and no toast says the stream was approved');
  assert(unexpected.length === 0, `nothing else was requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams (curator): an unapproval that lands after its row left the list still refuses the stale cascade Retry');
}

/**
 * An approval is noted when all of it has settled, not when its status request is answered. Until the songs have
 * answered too, the row in the list is still pending (its button is busy for both requests), and any change to the
 * list in between, another row's patch say, merges that pending back over what was noted. Here the row also leaves
 * the list before the songs answer, so nothing would put the approval right afterwards: the Retry of the failure
 * that follows must still read an approved stream.
 */
async function aCascadeRetryKeepsTheApprovalThroughALaterMergeOfTheList(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // Approve stream is pressed: its status request is answered at once, and the songs' is held.
  const cascadeGate = held();
  approveReply = () => cascadeGate.reply;
  await click(primaryOf(row), 'Approve stream');
  assert(statusCalls().length === 1 && approveCalls().length === 1, 'the status change is answered and the cascade is out');
  assert(statusOf(row) === 'Pending' && isBusy(primaryOf(row)), 'the row is still pending, and busy, until the songs have answered');

  // Another row changes meanwhile, which merges the list again, the pending row as it still reads in it.
  await chooseFromMenu(rowFor(container, 'Extracted Stream'), 'Reject');
  assert(statusOf(rowFor(container, 'Extracted Stream')) === 'Rejected', 'the other row is rejected');
  assert(statusOf(row) === 'Pending', 'and this one still reads pending');

  // The curator narrows the list: the row leaves it. Then the songs fail.
  listReply = () => ok(listBody([EXTRACTED]));
  await click(chip(statusGroup(container), 'Extracted'), 'the Extracted chip');
  assert(rowTitles(container) === 'Extracted Stream', 'the stream has left the list');
  await respond(cascadeGate, failure(500, 'Songs are locked'));
  const failed = toastWith(container, SONGS_LOCKED);
  assert(failed.retry !== null, 'the songs failed, with a Retry up');

  // The stream is approved: its Retry goes through.
  approveReply = defaultApproveReply;
  await click(failed.retry, 'the Retry');
  assert(approveCalls().length === 2, 'it sends the cascade once more');
  assert(!toastsOf(container).some((toast) => toast.message === NO_LONGER_APPROVED), 'and the stream is not called unapproved');
  assert(toastsOf(container).some((toast) => toast.message === CASCADE_SUMMARY && toast.detail === 'Pending Stream'), 'it says how it went');
  assert(unexpected.length === 0, `nothing else was requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams (curator): the approval is noted once the songs have answered, so a merge of the list in between cannot undo it');
}

async function retryWhileTheRowIsBusySendsNothing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // A failure toast stays up with its Retry. Another request then goes out on the same row; the Retry
  // reaches the handler past the row's unavailable buttons, and must not start a second request beside it.
  statusReply = () => failure(500, 'Database is locked');
  await click(primaryOf(row), 'Approve stream');
  const firstFailure = toastWith(container, 'Database is locked');
  assert(firstFailure.retry !== null, 'the failed Approve stream left a toast with a Retry');

  const gate = held();
  statusReply = () => gate.reply;
  await chooseFromMenu(row, 'Reject');
  assert(statusCalls().length === 2, 'Reject is out');
  assert(isInert(primaryOf(row)), 'the row is busy');

  await click(firstFailure.retry, 'the old Retry');
  assert(statusCalls().length === 2 && approveCalls().length === 0, 'a Retry pressed while the row has a request out sends nothing');
  const raised = toastsOf(container).filter((toast) => toast.message === 'Database is locked');
  assert(raised.length === 1 && raised[0]?.retry !== null, 'the same failure is back up, with its Retry, so the retry is not lost');

  // Another row is not held by it.
  const other = rowFor(container, 'Extracted Stream');
  statusReply = (call, id) => (id === 'st-pending' ? gate.reply : defaultStatusReply(call, id));
  await click(primaryOf(other), 'Approve stream on the extracted row');
  assert(statusOf(other) === 'Approved', 'a request out on one row does not hold another');

  await respond(gate, ok({ id: 'st-pending', status: 'rejected' }));
  assert(statusOf(row) === 'Rejected' && isIdle(primaryOf(row)), 'the row takes the answer and is available again');
  assert(statusCalls().filter((call) => call.path === '/api/streams/st-pending/status').length === 2, 'only the two real requests were sent for it');

  // The same holds for the cascade's Retry.
  approveReply = () => failure(500, 'Songs are locked');
  statusReply = defaultStatusReply;
  const third = rowFor(container, 'Approved Stream');
  await click(primaryOf(third), 'Unapprove');
  await click(primaryOf(third), 'Approve stream');
  const cascadeFailure = toastWith(container, SONGS_LOCKED);
  const holdGate = held();
  statusReply = () => holdGate.reply;
  await click(primaryOf(third), 'Unapprove');
  const before = calls.length;
  await click(cascadeFailure.retry, 'the cascade Retry');
  assert(calls.length === before, 'a cascade Retry pressed while the row has a request out sends nothing either');
  assert(
    toastsOf(container).filter((toast) => toast.message === SONGS_LOCKED && toast.retry !== null).length === 1,
    'and its failure is back up with its Retry',
  );
  await respond(holdGate, ok({ id: 'st-approved', status: 'pending' }));

  await unmount();
  console.log('✓ Streams (curator): a toast Retry pressed while the row has a request out sends nothing and puts its failure back up');
}

/*
 * A change the worker made whose answer was lost on the way would otherwise read as failed, and an approval's cascade
 * to its songs would wait for a Retry. A failed change reads the stream back before it says anything, the row busy
 * meanwhile: the outcomes of that read.
 */

async function aFailedApprovalTheWorkerMadeRunsTheCascade(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');
  const approve = primaryOf(row);

  // The approval went through, but its answer was lost on the way back: a gateway error.
  const reading = held();
  statusReply = () => failure(504, 'Gateway timeout');
  detailReply = () => reading.reply;
  await focus(approve);
  await click(approve, 'Approve stream');
  assert(
    isBusy(approve) && statusOf(row) === 'Pending' && toastsOf(container).length === 0,
    'the failed change says nothing yet: the row stays busy and Pending while the stream is read back',
  );
  assert(detailCalls().length === 1 && detailCalls()[0]?.path === '/api/streams/st-pending/detail', 'the stream is read back');

  // It is approved: the approval is done, so its cascade runs, the row busy and Pending until that settles too.
  const cascadeGate = held();
  approveReply = () => cascadeGate.reply;
  await respond(reading, ok({ ...PENDING, status: 'approved', performances: [] }));
  assert(
    approveCalls().length === 1 && approveCalls()[0]?.path === '/api/streams/st-pending/approve-all',
    'the cascade to its songs runs',
  );
  assert(isBusy(approve) && statusOf(row) === 'Pending' && toastsOf(container).length === 0, 'the row stays busy and Pending meanwhile');
  await respond(cascadeGate, ok({ ok: true, songs: 2, performances: 3 }));
  assert(statusOf(row) === 'Approved', 'then the row reads Approved');
  deepStrictEqual(summaryOf(container), [{ message: CASCADE_SUMMARY, detail: 'Pending Stream' }]);
  assert(statusCalls().length === 1 && approveCalls().length === 1, 'one change and one cascade were sent, no second of either');
  assert(focused() === approve && textOf(approve) === 'Unapprove' && isIdle(approve), 'the button, relabelled Unapprove, keeps the focus');

  // A cascade that fails after such an approval keeps its own failure and its cascade-only Retry, which goes through:
  // the page has noted the stream as approved.
  const extracted = rowFor(container, 'Extracted Stream');
  detailReply = (_call, id) => ok({ ...EXTRACTED, id, status: 'approved', performances: [] });
  approveReply = () => failure(500, 'Songs are locked');
  await click(primaryOf(extracted), 'Approve stream on the extracted row');
  assert(statusOf(extracted) === 'Approved', 'the extracted stream reads Approved');
  const songsFailure = toastWith(container, SONGS_LOCKED);
  assert(songsFailure.retry !== null, "the cascade's failure is raised, with its Retry");
  approveReply = defaultApproveReply;
  await click(songsFailure.retry, 'the cascade Retry');
  assert(
    statusCalls().length === 2 && approveCalls().length === 3,
    'the Retry sends the cascade alone, and it goes through',
  );
  assert(listCalls().length === 1 && unexpected.length === 0, 'nothing else is asked for');

  await unmount();
  console.log('✓ Streams (curator): a failed Approve stream the worker has made after all runs its cascade and reads as done');
}

async function aFailedChangeOnAnUnchangedStreamStands(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // The stream is read back still pending: the failure stands, with its Retry, and no cascade runs.
  statusReply = () => failure(500, 'Database is locked');
  await click(primaryOf(row), 'Approve stream');
  assert(detailCalls().length === 1, 'the failed change reads the stream back');
  const locked = toastWith(container, 'Database is locked');
  assert(
    locked.retry !== null && statusOf(row) === 'Pending' && isIdle(primaryOf(row)),
    'the stream is unchanged: the failure stands, with its Retry, and the row is available again',
  );
  assert(approveCalls().length === 0, 'and no cascade runs');

  // A read that fails as well: the change's own failure, with its Retry, not the read's.
  statusReply = () => failure(503, 'Status store is down');
  detailReply = () => failure(500, 'Stream store is down');
  await click(primaryOf(rowFor(container, 'Extracted Stream')), 'Approve stream on the extracted row');
  assert(detailCalls().length === 2, 'that change tries to read its stream back too');
  assert(toastWith(container, 'Status store is down').retry !== null, 'its own failure is reported, with its Retry');
  assert(!toastsOf(container).some((toast) => toast.message === 'Stream store is down'), "not the read's");
  assert(approveCalls().length === 0, 'and still no cascade runs');

  // The Retry runs the whole change again, and it goes through, the cascade with it.
  statusReply = defaultStatusReply;
  await click(locked.retry, 'Retry in the toast');
  assert(statusOf(row) === 'Approved' && approveCalls().length === 1, 'the Retry approves the stream, and its songs');

  await unmount();
  console.log("✓ Streams (curator): a failed change on a stream read back unchanged, or not read at all, keeps its own failure and its Retry");
}

async function aFailedExcludeTheWorkerMadeIsDone(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const row = rowFor(container, 'Pending Stream');

  // Exclude went through, but its answer was lost: the stream is read back excluded, and the change is done.
  statusReply = () => failure(504, 'Gateway timeout');
  detailReply = (_call, id) => ok({ ...PENDING, id, status: 'excluded', performances: [] });
  await chooseFromMenu(row, 'Exclude');
  assert(statusOf(row) === 'Excluded', `the stream is already excluded: the row reads Excluded (got ${statusOf(row)})`);
  deepStrictEqual(summaryOf(container), [{ message: 'Stream excluded', detail: 'Pending Stream' }]);
  assert(detailCalls().length === 1, 'as the stream read back says');
  assert(statusCalls().length === 1 && approveCalls().length === 0, 'one change, and no cascade: it is no approval');

  await unmount();
  console.log('✓ Streams (curator): a failed Exclude the worker has made after all reads as done, after the stream is read back');
}

async function queryFollowsTheControls(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const search = need(container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field');

  // Typing alone asks for nothing, and the typed term does not ride along on another change.
  await typeInto(search, 'lemon');
  assert(listCalls().length === 1, 'typing a term sends no request');
  assert(locationOf(container) === '/streams', 'and puts nothing in the URL');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(listCalls().length === 2, 'choosing Pending sends one request');
  assert(lastList().params.get('status') === 'pending', 'for the Pending status');
  assert(lastList().params.get('search') === null, 'without the term that was typed and not submitted');
  assert(locationOf(container) === '/streams?status=pending', `the status is in the URL (got ${locationOf(container)})`);
  assert(pressedOf(statusGroup(container)) === 'false|true|false|false|false|false', 'Pending is the chip in effect');
  assert(search.value === 'lemon', 'the typed term is still in the box');

  // Submitting sends it, and puts it in the URL.
  await click(need(buttonNamed(container, 'Search'), 'Search'), 'Search');
  assert(listCalls().length === 3, 'submitting sends one request');
  assert(lastList().params.get('search') === 'lemon' && lastList().params.get('status') === 'pending', 'with the term and the status');
  assert(locationOf(container) === '/streams?status=pending&search=lemon', `the term is in the URL (got ${locationOf(container)})`);

  // The same term again refreshes the list.
  await click(need(buttonNamed(container, 'Search'), 'Search'), 'Search');
  assert(listCalls().length === 4, 'submitting the same term again reloads the list, once');
  assert(lastList().params.get('search') === 'lemon', 'for the same term');

  // A different status keeps the submitted term; an unsubmitted edit still does not ride along.
  await typeInto(search, 'other');
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(
    lastList().params.get('status') === 'approved' && lastList().params.get('search') === 'lemon',
    'the submitted term stays on, the typed one does not',
  );

  // Clearing the term and submitting drops it, and All sends no status.
  await typeInto(search, '');
  await click(need(buttonNamed(container, 'Search'), 'Search'), 'Search');
  assert(lastList().params.get('search') === null && lastList().params.get('status') === 'approved', 'an empty term is not sent, and the status stays');
  assert(locationOf(container) === '/streams?status=approved', `and leaves the URL (got ${locationOf(container)})`);
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  assert(lastList().params.get('status') === null, 'All sends no status');
  assert(locationOf(container) === '/streams', 'and leaves the URL');
  assert(unexpected.length === 0, `nothing but the list is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams: a typed term is fetched only when submitted (and a repeat reloads); the status chips send their own query');
}

/**
 * The search box shows the term the list is fetched for. A link to /streams?search=… followed while the list is open
 * (Submit Stream's duplicate link, say) changes the URL and the fetch: the box follows them, whatever it held.
 */
async function theSearchBoxFollowsTheUrl(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator, '/streams?search=lemon', '/streams?search=vidApproved1&status=');
  const search = need(container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field');
  // Read through a call: TypeScript keeps an asserted `search.value` narrowed to its literal afterwards.
  const box = (): string => search.value;
  assert(box() === 'lemon', 'the box reads the term in the URL');

  await typeInto(search, 'half-typed');
  await click(container.querySelector<HTMLAnchorElement>('a[data-jump]'), 'the link to another search');
  assert(locationOf(container) === '/streams?search=vidApproved1&status=', `the link moves the URL (got ${locationOf(container)})`);
  assert(lastList().params.get('search') === 'vidApproved1', 'and the list is fetched for its term');
  assert(search.isConnected && box() === 'vidApproved1', `the box follows: it reads the link's term (got "${box()}")`);

  // The box is still the curator's to edit, and a status chip leaves what they typed alone.
  await typeInto(search, 'typed again');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(box() === 'typed again', 'a change of status alone keeps what was typed in the box');
  assert(unexpected.length === 0, `nothing but the list is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams: the search box follows the term in the URL, a link followed while the list is open included');
}

/**
 * A row's ⋯ menu is the kit Popover's: its panel opens in the top layer, where no card or scroll box clips it,
 * and goes to the other side by itself where the viewport lacks room. Its hover label is in flow, so it opens
 * on top and lines up with the button's end, which keeps it inside the card even on the first row, over the
 * head. The page places nothing itself: wherever a row is in the list (the first, one in the middle, the last,
 * or the only one) its menu and its hover label take those defaults, and nothing is added under a short list.
 */
async function menusTakeTheKitsPlacement(mountPage: MountPage): Promise<void> {
  // A whole class each (the hover label's bridge carries `before:top-full`): `top-full` puts a panel below its
  // button, `bottom-full` above it; `right-0` lines it up with the button's end, `left-0` with its start.
  const placement = (element: Element): string =>
    ['top-full', 'bottom-full', 'left-0', 'right-0'].filter((token) => element.classList.contains(token)).join(' ');
  const lists: { name: string; rows: Stream[]; menus: number }[] = [
    { name: 'five rows', rows: STREAMS, menus: 3 },
    { name: 'three rows, a menu on each', rows: [PENDING, EXTRACTED, REJECTED], menus: 3 },
    { name: 'two rows', rows: [PENDING, EXTRACTED], menus: 2 },
    { name: 'a single row', rows: [PENDING], menus: 1 },
  ];
  for (const { name, rows, menus } of lists) {
    reset();
    listReply = () => ok(listBody(rows));
    const { container, unmount } = await mountPage(curator);
    let seen = 0;
    for (const row of rows) {
      const trigger = moreOf(rowFor(container, row.title));
      if (trigger === null) continue;
      seen += 1;
      const menu = placement(panelOf(trigger));
      const label = placement(need(trigger.parentElement?.querySelector('[role="tooltip"]'), 'the ⋯ hover label'));
      assert(
        menu === 'top-full right-0',
        `${name}, ${row.title}: the menu takes the kit's default side, below its button, lined up with the button's end (got "${menu}")`,
      );
      assert(
        label === 'bottom-full right-0',
        `${name}, ${row.title}: the hover label opens on top, lined up with the button's end (got "${label}")`,
      );
    }
    assert(seen === menus, `${name}: ${menus} rows have a ⋯ menu (saw ${seen})`);
    assert(container.querySelector('tfoot') === null, `${name}: nothing is added under the rows`);
    await unmount();
  }

  console.log("✓ Streams (curator): every ⋯ menu and hover label takes the kit's placement wherever its row is, and nothing is added under a short list");
}

async function yearsSortAndRememberedFilter(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const years = need(yearGroup(container), 'the year filter');

  // The year is narrowed in the browser: no request, the count follows, and only storage remembers it.
  await click(chip(years, '2025'), 'the 2025 chip');
  assert(listCalls().length === 1, 'choosing a year sends no request');
  assert(rowTitles(container) === 'Approved Stream|Rejected Stream', `only 2025 streams remain (got ${rowTitles(container)})`);
  assert(countOf(container) === '2 of 5 streams', `the count reads how many of all (got ${countOf(container)})`);
  assert(pressedOf(years) === 'false|false|true|false', '2025 is the chip in effect');
  deepStrictEqual(savedFilter(), { status: '', year: '2025' });
  assert(locationOf(container) === '/streams', 'the year is not in the URL');
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  deepStrictEqual(savedFilter(), { status: 'approved', year: '2025' });
  await click(chip(yearGroup(container), 'All'), 'the All years chip');
  assert(rowTitles(container) === TITLES && countOf(container) === '5 streams', 'All years shows everything again');
  deepStrictEqual(savedFilter(), { status: 'approved', year: '' });

  // Sorting is in the browser too: a new column starts ascending, the same one flips.
  const before = listCalls().length;
  await click(sortButton(container, 'Title'), 'the Title head');
  assert(
    rowTitles(container) === 'Approved Stream|Excluded Stream|Extracted Stream|Pending Stream|Rejected Stream',
    'the Title head sorts by title, ascending',
  );
  assert(sortOf(container, 'Title') === 'ascending' && sortOf(container, 'Date') === 'none', 'and shows the direction');
  await click(sortButton(container, 'Title'), 'the Title head again');
  assert(rowTitles(container).startsWith('Rejected Stream|Pending Stream') && sortOf(container, 'Title') === 'descending', 'again, descending');
  await click(sortButton(container, 'Date'), 'the Date head');
  assert(rowTitles(container).startsWith('Excluded Stream') && sortOf(container, 'Date') === 'ascending', 'the Date head sorts the oldest first');
  await click(sortButton(container, 'Status'), 'the Status head');
  assert(rowTitles(container).startsWith('Approved Stream') && sortOf(container, 'Status') === 'ascending', 'the Status head sorts by status');
  await click(sortButton(container, 'Created'), 'the Created head');
  assert(sortOf(container, 'Created') === 'ascending' && sortOf(container, 'Status') === 'none', 'the Created head sorts by creation time');
  assert(listCalls().length === before, 'none of it sends a request');

  await unmount();

  // The remembered filter is only a fallback: what the URL says wins, and the year is read from storage alone.
  reset();
  storage.set(STREAMS_FILTER_KEY, JSON.stringify({ status: 'approved', year: '2025' }));
  const remembered = await mountPage(curator);
  assert(lastList().params.get('status') === 'approved', 'the remembered status is the first request');
  assert(pressedOf(statusGroup(remembered.container)) === 'false|false|true|false|false|false', 'and the chip in effect');
  assert(pressedOf(need(yearGroup(remembered.container), 'the year filter')) === 'false|false|true|false', 'the remembered year is the one in effect');
  assert(countOf(remembered.container) === '2 of 5 streams', 'and narrows the list');
  await remembered.unmount();

  reset();
  storage.set(STREAMS_FILTER_KEY, JSON.stringify({ status: 'approved', year: '2025' }));
  const fromUrl = await mountPage(curator, '/streams?status=pending&search=hello');
  assert(
    lastList().params.get('status') === 'pending' && lastList().params.get('search') === 'hello',
    'the URL beats the remembered status, and its term is sent',
  );
  assert(need(fromUrl.container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field').value === 'hello', 'and fills the search box');
  assert(pressedOf(statusGroup(fromUrl.container)) === 'false|true|false|false|false|false', 'Pending is the chip in effect');
  await fromUrl.unmount();

  // A link from VOD Export: ?streamer= names the streamer, and status and search narrow to the video.
  reset();
  const repair = await mountPage(curator, '/streams?streamer=aozora&status=approved&search=vidApproved1');
  assert(
    lastList().params.get('streamer') === 'aozora' &&
      lastList().params.get('status') === 'approved' &&
      lastList().params.get('search') === 'vidApproved1',
    `the first request is for the streamer, status and video the link names (got ${lastList().params.toString()})`,
  );
  assert(listCalls().length === 1, 'and it is the only one');
  await repair.unmount();
  setStreamer('mizuki');

  console.log('✓ Streams: the year and the sort are client-side, the remembered filter is a fallback, the URL and VOD Export links win');
}

/**
 * The link Submit Stream offers for a duplicate video is /streams?search=<video ID>&status=, and this is what it
 * relies on. A link with no `status` falls back to the status chip remembered in storage, so a curator whose last
 * chip was Pending would open the list on a duplicate that is Approved and find "No streams found." An explicit
 * empty `status` is the All option, and it beats the remembered chip.
 */
async function aLinkWithAnEmptyStatusOpensEveryStatus(mountPage: MountPage): Promise<void> {
  reset();
  storage.set(STREAMS_FILTER_KEY, JSON.stringify({ status: 'pending', year: '' }));
  // What the worker answers: the streams in the status asked for, if any, whose video matches the search.
  listReply = (call) => {
    const status = call.params.get('status');
    const term = call.params.get('search');
    return ok(listBody(STREAMS.filter((row) => (status === null || row.status === status) && (term === null || row.videoId.includes(term)))));
  };
  const { container, unmount } = await mountPage(curator, '/streams?search=vidApproved1&status=');

  assert(listCalls().length === 1, 'the link makes one request');
  assert(lastList().params.get('status') === null, `which carries no status filter, so it is for every status (got ${lastList().params.toString()})`);
  assert(lastList().params.get('search') === 'vidApproved1', 'and the search for the video');
  assert(
    pressedOf(statusGroup(container)) === 'true|false|false|false|false|false',
    `All is the chip in effect, not the Pending that storage remembers (got ${pressedOf(statusGroup(container))})`,
  );
  assert(
    need(container.querySelector<HTMLInputElement>('input[type="search"]'), 'the search field').value === 'vidApproved1',
    'the search box reads the video ID',
  );
  assert(rowTitles(container) === 'Approved Stream', `the list holds the duplicate, which is Approved (got ${rowTitles(container)})`);
  assert(statusOf(rowFor(container, 'Approved Stream')) === 'Approved', 'in the status it has');
  assert(!container.innerHTML.includes('No streams found.'), 'so the list is not the empty one');
  assert(locationOf(container) === '/streams?search=vidApproved1&status=', `and the page leaves the URL as the link wrote it (got ${locationOf(container)})`);
  assert(unexpected.length === 0, `nothing but the list is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Streams: a link with an empty status (the one Submit Stream offers for a duplicate) opens every status, whatever chip storage remembers');
}

async function laterLoadsKeepTheRows(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  assert(rowTitles(container) === TITLES, 'the list is loaded');

  const next = held();
  listReply = () => next.reply;
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(rowTitles(container) === TITLES, 'the rows stay while the next load is out');
  assert(container.querySelector('[role="status"]') === null, 'a later load shows no skeleton');
  assert(chip(statusGroup(container), 'Approved').getAttribute('aria-pressed') === 'true', 'the chip already reads as chosen');

  await respond(next, ok(listBody([APPROVED])));
  assert(rowTitles(container) === 'Approved Stream', 'the new rows replace them once they arrive');
  assert(countOf(container) === '1 stream', `the count follows, in the singular (got ${countOf(container)})`);
  assert(yearGroup(container) === null, 'one year is nothing to choose between, so the year filter goes');

  // An empty result is a notice in the table.
  listReply = () => ok(listBody([]));
  await click(chip(statusGroup(container), 'Excluded'), 'the Excluded chip');
  const emptyRow = need(bodyRows(container)[0], 'an empty row');
  assert(bodyRows(container).length === 1 && textOf(emptyRow) === 'No streams found.', 'an empty result reads "No streams found."');
  assert(emptyRow.querySelector('td')?.getAttribute('colspan') === '7', "the notice spans a curator's seven columns");
  assert(countOf(container) === '0 streams', 'the count reads 0 streams');
  assertNoRawColour(container.innerHTML, 'the empty page');

  await unmount();
  console.log('✓ Streams: a later load keeps the rows until the new ones arrive; an empty result says so');
}

async function contributorView(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);

  assert(rowTitles(container) === TITLES, 'a contributor sees the same streams');
  assert(
    headCells(container).map((cell) => textOf(cell)).join('|') === COLUMNS.slice(0, ACTIONS).join('|'),
    'a contributor has no Actions column',
  );
  assert(!container.innerHTML.includes('Actions'), 'and no hidden one either');
  assert(bodyRows(container).every((row) => cellsOf(row).length === 6), 'each row has six cells');
  assert(
    container.querySelector('button[aria-haspopup="menu"]') === null &&
      buttonNamed(container, 'Approve stream') === null &&
      buttonNamed(container, 'Unapprove') === null &&
      buttonNamed(container, 'Restore') === null,
    'no row offers an action, pending or not',
  );
  assert(titleLink(rowFor(container, 'Pending Stream')).getAttribute('href') === '/streams/st-pending', 'a contributor can still open a stream');
  assert(textOf(need(container.querySelector('a[href="/submit/stream"]'), 'the New stream link')) === 'New stream', 'and submit a new one');
  assertNoRawColour(container.innerHTML, "a contributor's page");

  listReply = () => ok(listBody([]));
  await click(chip(statusGroup(container), 'Rejected'), 'the Rejected chip');
  assert(
    need(bodyRows(container)[0]?.querySelector('td'), 'the empty notice').getAttribute('colspan') === '6',
    "an empty result spans a contributor's six columns",
  );
  assert(statusCalls().length === 0, 'a contributor sends no status change');

  await unmount();
  console.log('✓ Streams (contributor): same list, no Actions column, no actions');
}

async function loadFailure(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => failure(500, 'Streams are unavailable');
  const { container, unmount } = await mountPage(curator);

  const note = need(alertOf(container), 'a danger alert for a failed load');
  assert(textOf(note).includes('Streams are unavailable'), "the alert carries the server's message");
  assert(note.classList.contains('border-tone-danger-line'), 'the alert is a danger note');
  assert(container.querySelector('table') === null, 'with nothing loaded there is no table');
  assert(container.querySelector('[role="status"]') === null, 'and no skeleton either');
  assert(!container.innerHTML.includes('No streams found.'), 'a failure is not an empty list');
  assert(
    pageHeader(container).querySelector('input[type="search"]') !== null && statusGroup(container).isConnected,
    'the header with its search, and the filter, stay',
  );
  assertNoRawColour(container.innerHTML, 'the failed page');

  // Retry asks again, with the same query. The alert leaves with it, so the focus it held goes to the heading.
  const retry = noteRetry(container);
  await focus(retry);
  const again = held();
  listReply = () => again.reply;
  await click(retry, 'Retry');
  assert(listCalls().length === 2, 'Retry reloads the list');
  assert(listCalls()[1]?.params.toString() === listCalls()[0]?.params.toString(), 'with the same query');
  assert(focused() === container.querySelector('h1'), `the focus goes to the page heading, not to <body> (got ${focused()?.tagName})`);
  assert(container.querySelector('[role="status"]') !== null, 'the skeleton shows while the retry is out');
  await respond(again, ok(listBody(STREAMS)));
  assert(alertOf(container) === null && rowTitles(container) === TITLES, 'a successful retry clears the alert and shows the rows');

  // A failure after rows are on screen keeps them, with the alert above.
  listReply = () => failure(503, 'Streams are busy');
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(textOf(alertOf(container)).includes('Streams are busy'), 'a later failure raises the alert too');
  assert(rowTitles(container) === TITLES, 'and leaves the last rows in place');
  listReply = () => ok(listBody([APPROVED]));
  await click(noteRetry(container), 'Retry');
  assert(lastList().params.get('status') === 'approved', 'Retry asks again for the filter now in effect');
  assert(alertOf(container) === null && rowTitles(container) === 'Approved Stream', 'and the new rows replace the old ones');
  assert(toastsOf(container).length === 0, 'a load failure is an alert, not a toast');

  await unmount();
  console.log('✓ Streams: a load failure is a danger alert with a Retry that reloads and hands its focus to the heading');
}

async function main(): Promise<void> {
  const win = installDom();
  // A submit that navigates (the search writes its term to the URL) runs inside a transition, and React then
  // builds a FormData from the form. Node's own FormData does not take a happy-dom form, so use happy-dom's.
  Object.defineProperty(globalThis, 'FormData', { configurable: true, writable: true, value: win.FormData });
  installLocalStorage();
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  setStreamer = setCurrentStreamer;
  setStreamer('mizuki');
  const { default: StreamsList } = await import('../src/pages/StreamsList');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');

  // The legacy slate pieces this page was the last to use are gone.
  for (const gone of ['components/StatusBadge.tsx', 'components/SortHeader.tsx']) {
    assert(!existsSync(new URL(`../src/${gone}`, import.meta.url)), `src/${gone} is deleted: nothing uses it any more`);
  }

  // `jumpTo`: an in-app link to that URL beside the page, as Submit Stream's duplicate link is.
  const { Link } = await import('react-router-dom');
  const mountPage: MountPage = (user, url = '/streams', jumpTo) =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[url]}>
            <Routes>
              <Route path="/streams" element={<StreamsList user={user} />} />
              <Route path="/streams/:id" element={<p>Stream page</p>} />
            </Routes>
            <LocationProbe />
            {jumpTo === undefined ? null : (
              <Link to={jumpTo} data-jump="">
                Jump
              </Link>
            )}
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>,
    );

  await firstLoadAndLayout(mountPage);
  await eachStatusOffersItsActions(mountPage);
  await approveRunsTheCascade(mountPage);
  await aRowKeepsItsFields(mountPage, {
    via: 'Exclude',
    perform: (row) => chooseFromMenu(row, 'Exclude'),
    sends: ['PATCH /api/streams/st-pending/status'],
    status: 'Excluded',
  });
  await aRowKeepsItsFields(mountPage, {
    via: 'Approve stream',
    perform: (row) => click(primaryOf(row), 'Approve stream'),
    sends: ['PATCH /api/streams/st-pending/status', 'POST /api/streams/st-pending/approve-all'],
    status: 'Approved',
  });
  await menuActionsAndFocus(mountPage);
  await focusIsNeverLost(mountPage);
  await failedChangesOfferRetry(mountPage);
  await cascadeFailureRetriesOnlyTheCascade(mountPage);
  await aStaleCascadeRetryApprovesNothing(mountPage);
  await aCascadeRetryStillGoesThroughWhenTheListLeftTheStreamOut(mountPage);
  await aStaleCascadeRetryStaysRefusedWhenTheListLeftTheStreamOut(mountPage);
  await aCascadeRetryGoesThroughWhenTheApprovalLandsAfterTheRowLeft(mountPage);
  await aStaleCascadeRetryStaysRefusedWhenTheUnapprovalLandsAfterTheRowLeft(mountPage);
  await aCascadeRetryKeepsTheApprovalThroughALaterMergeOfTheList(mountPage);
  await retryWhileTheRowIsBusySendsNothing(mountPage);
  await aFailedApprovalTheWorkerMadeRunsTheCascade(mountPage);
  await aFailedChangeOnAnUnchangedStreamStands(mountPage);
  await aFailedExcludeTheWorkerMadeIsDone(mountPage);
  await menusTakeTheKitsPlacement(mountPage);
  await queryFollowsTheControls(mountPage);
  await theSearchBoxFollowsTheUrl(mountPage);
  await yearsSortAndRememberedFilter(mountPage);
  await aLinkWithAnEmptyStatusOpensEveryStatus(mountPage);
  await laterLoadsKeepTheRows(mountPage);
  await contributorView(mountPage);
  await loadFailure(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  for (const file of ['pages/StreamsList.tsx', 'components/StatusFilterBar.tsx']) {
    assertNoRawColour(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), `src/${file}`);
  }
  console.log('✓ Streams: no raw palette class and no arbitrary hex, in the markup or the source');
}

await main();
