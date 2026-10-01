/**
 * The Nova inbox on the studio kit (spec §8.9), mounted live the way App.tsx mounts every page (a ToastProvider
 * and a ConfirmProvider around it, inside a router, since its status and search live in the URL) against a
 * stubbed fetch: the header, its count pills and its bulk refresh, the toolbar and its URL state, the table and
 * its rows, a row's view and its editor, what an approval, a rejection and a delete do (the control that is
 * busy, the confirm, the toast, where the focus goes), a request the worker refuses, two rows with a request out
 * at once, a failed load and an empty list. tests/nova-submissions-links renders one row with no providers at
 * all, tests/inbox-counts pins the requests an action makes for the sidebar's badge, and tests/row-drafts the
 * notes that outlive a row.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  AuthUser,
  BulkFetchSubscribersResponse,
  NovaStatus,
  NovaSubmission,
} from '../../shared/types';
import { MICRO_LABEL } from '../src/components/ui/micro-label';
import { TONE_BOX_CLASS } from '../src/components/ui/pill-core';
import { formatFullTime, formatWhen, storedTimeIso } from '../src/lib/dates';
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

const AVATAR = 'https://yt3.ggpht.com/alpha=s240';

function submission(fields: Partial<NovaSubmission> & { id: string; display_name: string; status: NovaStatus }): NovaSubmission {
  const slug = fields.display_name.toLowerCase();
  return {
    youtube_channel_url: `https://www.youtube.com/@${slug}`,
    youtube_channel_id: `UC-${slug}`,
    youtube_channel_verified_id: null,
    youtube_channel_verified_at: null,
    slug,
    brand_name: `${fields.display_name} Brand`,
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
    submitted_at: '2020-01-02 10:00:00',
    reviewed_at: null,
    reviewer_note: '',
    ...fields,
  };
}

// Stored times are UTC ("YYYY-MM-DD HH:MM:SS"), as D1 writes them. The first is from this year, the rest are not.
const ALPHA = submission({
  id: 'n-alpha',
  display_name: 'Alpha',
  status: 'pending',
  submitted_at: `${THIS_YEAR}-03-04 09:30:00`,
  avatar_url: AVATAR,
  subscriber_count: '12.3K',
  description: 'Sings\nevery night',
  group: 'Prism',
  link_youtube: 'https://www.youtube.com/@alpha',
  link_twitter: 'https://x.com/alpha',
  link_facebook: 'javascript:alert(1)',
  link_instagram: '',
  link_twitch: 'https://www.twitch.tv/alpha',
  theme_json: JSON.stringify({ accentPrimary: '#FF00AA', bgPageStart: '#112233' }),
});
const BETA = submission({
  id: 'n-beta',
  display_name: 'Beta',
  status: 'pending',
  submitted_at: '2020-01-03 10:00:00',
  youtube_channel_url: 'data:text/html,nope',
  youtube_channel_id: '',
  brand_name: '',
});
const GAMMA = submission({
  id: 'n-gamma',
  display_name: 'Gamma',
  status: 'approved',
  submitted_at: '2020-01-04 10:00:00',
  reviewed_at: '2020-03-05T10:00:00.000Z',
  reviewer_note: 'Fine as it is',
  enabled: 0,
  display_order: 3,
  youtube_channel_verified_id: 'UC-gamma',
  youtube_channel_verified_at: '2020-02-01T01:02:03.000Z',
});
const DELTA = submission({
  id: 'n-delta',
  display_name: 'Delta',
  status: 'rejected',
  submitted_at: '2020-01-05 10:00:00',
  reviewer_note: 'Not a VTuber',
});
// As the worker lists them; the page shows them in that order.
const SUBMISSIONS = [ALPHA, BETA, GAMMA, DELTA];
/** What the default view, Pending, shows. */
const PENDING_NAMES = 'Alpha|Beta';

const BULK_RESULT: BulkFetchSubscribersResponse = {
  updated: 2,
  failed: 1,
  results: [
    { id: 'n-alpha', display_name: 'Alpha', subscriber_count: '99.9K', avatar_url: AVATAR },
    { id: 'n-gamma', display_name: 'Gamma', subscriber_count: '5', avatar_url: null },
    { id: 'n-beta', display_name: 'Beta', subscriber_count: null, avatar_url: null, error: 'No channel id' },
  ],
};

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

const find = (id: string): NovaSubmission | undefined => SUBMISSIONS.find((row) => row.id === id);
const notFound = (): Reply => failure(404, 'Submission not found');

const defaultListReply = (): Reply => ok({ data: SUBMISSIONS, total: SUBMISSIONS.length });

/** What the worker answers a status change: the submission, in the status that was asked for. */
const defaultStatusReply = (call: Call, id: string): Reply => {
  const target = find(id);
  if (target === undefined) return notFound();
  const status = (call.body as { status: NovaStatus }).status;
  return ok({ ...target, status, reviewed_at: status === 'pending' ? null : '2026-09-02T10:00:00.000Z' });
};

const defaultDeleteReply = (): Reply => ok({ ok: true });

/** What the worker answers a save: the submission with the changed fields applied. */
const defaultSaveReply = (call: Call, id: string): Reply => {
  const target = find(id);
  return target === undefined ? notFound() : ok({ ...target, ...(call.body as object) });
};

const defaultSubscribersReply = (_call: Call, id: string): Reply => {
  const target = find(id);
  return target === undefined ? notFound() : ok({ ...target, subscriber_count: '99.9K', avatar_url: 'https://yt3.ggpht.com/refreshed=s240' });
};

const defaultVerifyReply = (_call: Call, id: string): Reply => {
  const target = find(id);
  return target === undefined
    ? notFound()
    : ok({ ...target, youtube_channel_verified_id: target.youtube_channel_id, youtube_channel_verified_at: '2026-09-02T10:00:00.000Z' });
};

const defaultBulkReply = (): Reply => ok(BULK_RESULT);

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let listReply: (call: Call) => Reply | Promise<Reply> = defaultListReply;
let statusReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultStatusReply;
let deleteReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultDeleteReply;
let saveReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultSaveReply;
let subscribersReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultSubscribersReply;
let verifyReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultVerifyReply;
let bulkReply: (call: Call) => Reply | Promise<Reply> = defaultBulkReply;

function reset(): void {
  calls.length = 0;
  listReply = defaultListReply;
  statusReply = defaultStatusReply;
  deleteReply = defaultDeleteReply;
  saveReply = defaultSaveReply;
  subscribersReply = defaultSubscribersReply;
  verifyReply = defaultVerifyReply;
  bulkReply = defaultBulkReply;
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
      const path = url.pathname;
      const statusId = /^\/api\/nova\/submissions\/([^/]+)\/status$/.exec(path)?.[1];
      const subscribersId = /^\/api\/nova\/submissions\/([^/]+)\/fetch-subscribers$/.exec(path)?.[1];
      const verifyId = /^\/api\/nova\/submissions\/([^/]+)\/verify-youtube-channel$/.exec(path)?.[1];
      const oneId = /^\/api\/nova\/submissions\/([^/]+)$/.exec(path)?.[1];
      let reply: Reply | Promise<Reply> | undefined;
      if (method === 'GET' && path === '/api/nova/submissions') reply = listReply(call);
      else if (method === 'POST' && path === '/api/nova/submissions/fetch-all-subscribers') reply = bulkReply(call);
      else if (method === 'PATCH' && statusId !== undefined) reply = statusReply(call, decodeURIComponent(statusId));
      else if (method === 'POST' && subscribersId !== undefined) reply = subscribersReply(call, decodeURIComponent(subscribersId));
      else if (method === 'POST' && verifyId !== undefined) reply = verifyReply(call, decodeURIComponent(verifyId));
      else if (method === 'PUT' && oneId !== undefined) reply = saveReply(call, decodeURIComponent(oneId));
      else if (method === 'DELETE' && oneId !== undefined) reply = deleteReply(call, decodeURIComponent(oneId));
      if (reply === undefined) {
        unexpected.push(`${method} ${path}${url.search}`);
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

const listCalls = (): Call[] => calls.filter((call) => call.method === 'GET' && call.path === '/api/nova/submissions');
const statusCalls = (): Call[] => calls.filter((call) => call.method === 'PATCH');
const deleteCalls = (): Call[] => calls.filter((call) => call.method === 'DELETE');
const saveCalls = (): Call[] => calls.filter((call) => call.method === 'PUT');
const subscribersCalls = (): Call[] => calls.filter((call) => call.path.endsWith('/fetch-subscribers'));
const verifyCalls = (): Call[] => calls.filter((call) => call.path.endsWith('/verify-youtube-channel'));
const bulkCalls = (): Call[] => calls.filter((call) => call.path.endsWith('/fetch-all-subscribers'));

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
    container.querySelector<HTMLElement>('[role="group"][aria-labelledby="nova-status-filter-label"]'),
    'the status filter',
  );
}

function searchForm(container: HTMLElement): HTMLFormElement {
  return need(container.querySelector<HTMLFormElement>('main form, form'), 'the search form');
}

function searchBox(container: HTMLElement): HTMLInputElement {
  return need(searchForm(container).querySelector<HTMLInputElement>('input[type="search"]'), 'the search box');
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

function labelled(root: ParentNode, label: string): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function chip(group: HTMLElement, name: string): HTMLButtonElement {
  return need(buttonNamed(group, name), `the ${name} chip`);
}

function pressed(group: HTMLElement): string {
  return [...group.querySelectorAll('button')]
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => textOf(button))
    .join('|');
}

/** The name button of every row on show, in the order the page shows them: each row's accessible toggle. */
function nameButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls^="nova-submission-details-"]')];
}

/** The display names of the rows on show, read from the Chinese label every name button keeps. */
function names(container: HTMLElement): string {
  return nameButtons(container)
    .map((button) => (button.getAttribute('aria-label') ?? '').replace(/^(展開|收合) /, ''))
    .join('|');
}

function nameOf(container: HTMLElement, name: string): HTMLButtonElement {
  return need(
    nameButtons(container).find((button) => (button.getAttribute('aria-label') ?? '').replace(/^(展開|收合) /, '') === name),
    `the name button of ${name}`,
  );
}

function summaryOf(container: HTMLElement, name: string): HTMLTableRowElement {
  return need(nameOf(container, name).closest('tr'), `the summary row of ${name}`);
}

function detailsOf(id: string): HTMLElement | null {
  return document.getElementById(`nova-submission-details-${id}`);
}

/** A quick action of a collapsed row: its icon button, named by what it does. */
function quick(container: HTMLElement, name: string, label: string): HTMLButtonElement {
  return need(labelled(summaryOf(container, name), label), `the ${label} button of ${name}`);
}

function noteBox(container: HTMLElement): HTMLTextAreaElement {
  return need(container.querySelector<HTMLTextAreaElement>('textarea'), 'a reviewer note box');
}

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"]');
}

function alertsIn(root: ParentNode): string {
  return [...root.querySelectorAll('[role="alert"]')].map((alert) => textOf(alert)).join('|');
}

function confirmDialog(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('dialog[open]');
}

/** The result note of "Fetch All Channel Info" (a plain note, not a live region), or null while there is none. */
function bulkNote(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('#nova-fetch-all-result > div');
}

/** How many live regions (a status or alert role, or aria-live) hold `text`: what a screen reader announces it from. */
function liveRegionsHolding(container: HTMLElement, text: string): number {
  return [...container.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].filter((region) => textOf(region).includes(text)).length;
}

/** The pressed chip of the status group: where the focus goes when a delete leaves no row to go to. */
function statusChipInEffect(container: HTMLElement): HTMLButtonElement {
  return need(
    statusGroup(container).querySelector<HTMLButtonElement>('button[aria-pressed="true"]'),
    'the status chip in effect',
  );
}

function isBusy(button: HTMLButtonElement): boolean {
  return (
    button.getAttribute('aria-busy') === 'true' &&
    button.getAttribute('aria-disabled') === 'true' &&
    !button.hasAttribute('disabled')
  );
}

/** Unavailable but not busy: another request of the same row is out. */
function isUnavailable(button: HTMLButtonElement): boolean {
  return (
    button.getAttribute('aria-disabled') === 'true' &&
    button.getAttribute('aria-busy') === null &&
    !button.hasAttribute('disabled')
  );
}

/** Neither busy nor unavailable: a button that takes a press. */
function isIdle(button: HTMLButtonElement): boolean {
  return (
    button.getAttribute('aria-busy') === null &&
    button.getAttribute('aria-disabled') === null &&
    !button.hasAttribute('disabled')
  );
}

interface ToastView {
  message: string;
  detail: string;
  retry: HTMLButtonElement | null;
  danger: boolean;
}

function toastsOf(container: HTMLElement): ToastView[] {
  const section = container.querySelector('section[aria-label="Notifications"]');
  return [...(section?.querySelectorAll<HTMLElement>('li') ?? [])].map((item) => {
    const lines = [...item.querySelectorAll('p')].map((line) => textOf(line));
    return {
      message: lines[0] ?? '',
      detail: lines[1] ?? '',
      retry: buttonNamed(item, 'Retry'),
      danger: item.innerHTML.includes('bg-danger-solid'),
    };
  });
}

/**
 * The toast messages, in alphabetical order: the kit lists success toasts and error toasts in two
 * regions, so the order on screen is not the order they came in.
 */
function messagesOf(container: HTMLElement): string {
  return toastsOf(container)
    .map((toast) => toast.message)
    .sort()
    .join('|');
}

/** The header's count row: the submission total, then a pill per status. */
function countsOf(container: HTMLElement): string {
  return textOf(pageHeader(container).querySelector('h1')?.parentElement?.children[2]);
}

/** The address bar of the router the page is mounted in. */
function addressOf(): string {
  return textOf(document.getElementById('location-probe'));
}

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user?: AuthUser, url?: string, jumpTo?: string) => Promise<Mounted>;

async function focus(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
  });
}

async function expand(container: HTMLElement, name: string): Promise<void> {
  await click(nameOf(container, name), `the name button of ${name}`);
}

/** Submits the search form the way Enter in its box does. */
async function submitSearch(container: HTMLElement, term: string): Promise<void> {
  await typeInto(searchBox(container), term);
  await act(async () => {
    searchForm(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** The labelled control of the editor: a field by the text of its label. */
function fieldOf(root: ParentNode, label: string): HTMLInputElement | HTMLTextAreaElement {
  const target = [...root.querySelectorAll('label')].find((candidate) => textOf(candidate).replace(/\*$/, '').trim() === label);
  const labelFor = need(target, `the label ${label}`).getAttribute('for');
  return need(
    labelFor === null ? null : document.getElementById(labelFor),
    `the control of ${label}`,
  ) as HTMLInputElement | HTMLTextAreaElement;
}

function LocationProbe() {
  const location = useLocation();
  return <output id="location-probe">{`${location.pathname}${location.search}`}</output>;
}

// --- Scenarios ---

async function firstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const first = held();
  listReply = () => first.reply;
  const { container, unmount } = await mountPage();

  // One request on mount: the whole list, for no streamer in particular (the inboxes are site-wide).
  assert(calls.length === 1 && listCalls().length === 1, 'mounting asks for the list once and for nothing else');
  assert(!need(listCalls()[0], 'the list request').params.has('streamer'), 'the list is the unfiltered, site-wide one');

  // The header is there before any data, with the crumb, the title and the curator's bulk refresh.
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
  assert(textOf(header.querySelector('h1')) === 'Nova', 'the <h1> is "Nova"');
  assert(
    textOf(header) === 'INBOXNovaFetch All Channel Info',
    `an unloaded header holds the crumb, the title and the bulk refresh (got ${textOf(header)})`,
  );
  const fetchAll = need(buttonNamed(header, 'Fetch All Channel Info'), 'the Fetch All Channel Info button');
  assert(header.contains(fetchAll) && fetchAll.querySelector('svg') !== null, 'the bulk refresh is in the header, with its icon');
  assert(isUnavailable(fetchAll), 'and unavailable (not disabled) while the list is loading');

  // The toolbar, under the header, before any data too: the status chips behind a visible label, and the search.
  const status = statusGroup(container);
  assert(!header.contains(status) && !header.contains(searchForm(container)), 'the filters are in the page, not in the header');
  const toolbar = need(status.parentElement, 'the toolbar');
  assert(toolbar.contains(searchForm(container)), 'one toolbar row holds the chips and the search');
  const statusLabel = need(status.querySelector('#nova-status-filter-label'), 'the status label');
  assert(textOf(statusLabel) === 'Status', 'the status group opens with its label, with no colon');
  assert(
    !statusLabel.classList.contains('sr-only') && statusLabel.className.includes(MICRO_LABEL),
    'the label is a visible micro label, there to be read and not only to be announced',
  );
  assert(
    [...status.querySelectorAll('button')].map((button) => textOf(button)).join('|') === 'All|Pending|Approved|Rejected' &&
      [...status.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed')).join('|') === 'false|true|false|false',
    'the status chips, in order, with Pending in effect',
  );
  const box = searchBox(container);
  const boxLabel = need(container.querySelector(`label[for="${box.id}"]`), 'the search label');
  assert(
    boxLabel.classList.contains('sr-only') && textOf(boxLabel) === 'Search submissions' && box.placeholder === 'Search ID, slug, channel...' && box.value === '',
    'the search box keeps its label for assistive technology and its prompt, and starts empty',
  );

  // A skeleton until the first response, and no table, no empty notice and no counts behind it.
  const skeleton = need(container.querySelector('[role="status"]'), 'a skeleton while the first load is out');
  assert(textOf(skeleton) === 'Loading submissions…', 'the skeleton says what is loading');
  assert(nameButtons(container).length === 0 && container.querySelector('table') === null, 'no rows before the first response');
  assert(!container.innerHTML.includes('No submissions found.'), 'an unanswered list is not an empty one');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok({ data: SUBMISSIONS, total: SUBMISSIONS.length }));
  assert(container.querySelector('[role="status"]') === null, 'the response ends the loading state');
  assert(listCalls().length === 1, 'nothing else is requested once the page has loaded');
  assert(isIdle(fetchAll), 'the bulk refresh is available once the list is there');

  // The counts count every submission, whatever the filters keep: the total, then one pill per status.
  const counts = need(header.querySelector('h1')?.parentElement?.children[2], 'the count row under the title');
  assert(
    textOf(counts) === '4 submissions2 Pending1 Approved1 Rejected',
    `the header counts the submissions, then the statuses (got ${textOf(counts)})`,
  );
  const pills = [...counts.querySelectorAll('span')].filter((span) => span.className.includes('rounded-radius-pill'));
  assert(
    pills.map((pill) => (pill.className.includes('bg-tone-warn-bg') ? 'warn' : pill.className.includes('bg-tone-ok-bg') ? 'ok' : pill.className.includes('bg-tone-danger-bg') ? 'danger' : '?')).join('|') ===
      'warn|ok|danger',
    'Pending is a warn pill, Approved an ok one, Rejected a danger one: the tones of the row pills',
  );

  // The table: native, one <tbody> a row, a head row in the kit's head style, and it scrolls inside its card.
  const table = need(container.querySelector('table'), 'the table');
  assert(table.getAttribute('aria-label') === 'VTuber submissions', 'the table is named');
  assert(table.className.includes('min-w-[880px]'), 'the table keeps its minimum width');
  const scroller = need(table.closest('.overflow-x-auto'), 'the scroller around the table');
  const card = need(scroller.closest('.glass-card'), 'a glass card around the table');
  assert(card.className.includes('overflow-clip'), 'the table sits in its card, which clips what falls outside it');
  assert(scroller.className.includes('[container-type:inline-size]'), 'and scrolls inside it; the scroller is a size container, for the detail below 1280 px');
  const heads = [...table.querySelectorAll('thead th')];
  assert(
    heads.map((head) => textOf(head)).join('|') === 'Avatar|VTuber|Channel|Subscribers|Status|Submitted|Actions|Details' &&
      heads.every((head) => head.getAttribute('scope') === 'col'),
    'eight column heads',
  );
  assert(
    heads.filter((head) => head.querySelector('.sr-only') !== null).map((head) => textOf(head)).join('|') === 'Avatar|Actions|Details',
    'three of them (avatar, actions, details) are for assistive technology alone',
  );
  assert(
    heads.filter((head) => head.querySelector('.sr-only') === null).every((head) => head.className.includes(MICRO_LABEL)),
    'the visible heads wear the kit head label',
  );
  assert(table.querySelectorAll('tbody').length === 2, 'one <tbody> per row');
  assert(
    [...table.querySelectorAll('tbody')].every((rows) => rows.querySelector('tr')?.querySelectorAll(':scope > td').length === 8),
    'a summary row of eight cells',
  );
  assert(names(container) === PENDING_NAMES, `the rows are the pending submissions (got ${names(container)})`);

  // Each row: avatar, the name (a button) over its slug, the channel, subscribers, status, submitted, quick actions.
  const alpha = summaryOf(container, 'Alpha');
  assert(alpha.className.includes('hover:bg-row-hover'), 'a row takes its hover from the row-hover token');
  const cells = [...alpha.querySelectorAll(':scope > td')];
  assert(need(cells[0]?.querySelector('img'), 'the avatar').getAttribute('src') === AVATAR, 'the avatar is the YouTube one');
  const name = nameOf(container, 'Alpha');
  assert(
    name.getAttribute('aria-label') === '展開 Alpha' &&
      name.getAttribute('aria-expanded') === 'false' &&
      name.getAttribute('aria-controls') === 'nova-submission-details-n-alpha' &&
      name.getAttribute('tabindex') === '0' &&
      textOf(name) === 'Alphaalpha',
    'the name is the accessible toggle: collapsed, naming the detail it opens, over the slug (the Chinese label stays)',
  );
  const channel = need(cells[2]?.querySelector('a'), 'the channel link');
  assert(
    channel.getAttribute('href') === 'https://www.youtube.com/@alpha' &&
      channel.getAttribute('target') === '_blank' &&
      channel.getAttribute('rel') === 'noopener noreferrer' &&
      textOf(channel) === 'Alpha Brand' &&
      need(channel.querySelector('svg'), 'the YouTube mark').getAttribute('class')?.includes('text-tone-danger-fg') === true,
    'the brand links to the channel, in a new tab, behind the YouTube mark in the danger tone',
  );
  assert(textOf(cells[3]) === '12.3K', 'the subscribers');
  assert(textOf(cells[4]) === 'Pending' && need(cells[4]?.querySelector('span'), 'the status pill').className.includes(TONE_BOX_CLASS.warn), 'a Pending submission is a warn pill');
  const when = need(cells[5]?.querySelector('time'), 'the submitted time');
  assert(
    when.getAttribute('datetime') === storedTimeIso(ALPHA.submitted_at) &&
      when.getAttribute('title') === formatFullTime(ALPHA.submitted_at) &&
      textOf(when) === formatWhen(ALPHA.submitted_at, new Date()),
    'the submitted time is a <time>: the exact instant, the full time on hover, the short form',
  );
  assert(
    [...(cells[6]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Approve|Reject|Delete',
    'a pending submission offers Approve, Reject and Delete, each named for what it does',
  );
  assert(
    need(labelled(alpha, 'Approve'), 'Approve').className.includes('text-tone-ok-fg') &&
      need(labelled(alpha, 'Delete'), 'Delete').className.includes('text-tone-danger-fg'),
    'Approve is an ok icon button and Delete a danger one',
  );
  assert(
    cells[7]?.querySelector('button')?.getAttribute('aria-hidden') === 'true' && cells[7]?.querySelector('button')?.getAttribute('tabindex') === '-1',
    'the chevron is a mouse-only duplicate of the name: hidden from assistive technology and out of the tab order',
  );

  // A submission with no avatar shows a tile; one with no safe channel link shows its text; no subscribers is a dash.
  const beta = [...summaryOf(container, 'Beta').querySelectorAll(':scope > td')];
  assert(beta[0]?.querySelector('img') === null && beta[0]?.querySelector('svg') !== null, 'a submission with no avatar shows a tile instead');
  assert(beta[2]?.querySelector('a') === null && textOf(beta[2]) === 'data:text/html,nope', 'an unsafe channel URL is text, never a link');
  assert(textOf(beta[3]) === '—', 'a submission with no subscriber count shows a dash');
  assertNoRawColour(container.innerHTML, 'the loaded page');

  await unmount();
  console.log('✓ Nova: header and counts, toolbar, skeleton, the table and its rows');
}

async function filtersAndSearch(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const status = statusGroup(container);

  // The status is a filter in the URL: Pending is the default and so leaves no parameter, All is an empty one.
  assert(addressOf() === '/nova' && pressed(status) === 'Pending', 'the default view is Pending, with no parameter');
  await click(chip(status, 'All'), 'the All chip');
  assert(names(container) === 'Alpha|Beta|Gamma|Delta', `All shows every submission (got ${names(container)})`);
  assert(pressed(status) === 'All' && addressOf() === '/nova?status=', 'the chip in effect follows, and the URL spells All as an empty status');
  await click(chip(status, 'Approved'), 'the Approved chip');
  assert(names(container) === 'Gamma' && addressOf() === '/nova?status=approved', 'Approved shows the approved submission, and the URL says so');
  await click(chip(status, 'Rejected'), 'the Rejected chip');
  assert(names(container) === 'Delta' && addressOf() === '/nova?status=rejected', 'Rejected shows the rejected one');
  await click(chip(status, 'Pending'), 'the Pending chip');
  assert(names(container) === PENDING_NAMES && addressOf() === '/nova', 'Pending is the default again: the parameter goes');

  // The search narrows the table when it is submitted, not while it is typed; it matches the id, the slug, the name
  // and the channel id, in any case, and it is in the URL too (beside the status).
  await click(chip(status, 'All'), 'the All chip');
  await typeInto(searchBox(container), 'bet');
  assert(names(container) === 'Alpha|Beta|Gamma|Delta' && addressOf() === '/nova?status=', 'typing alone narrows nothing');
  await submitSearch(container, 'bet');
  assert(names(container) === 'Beta' && addressOf() === '/nova?status=&search=bet', `a submitted term narrows the table and the URL (got ${names(container)} at ${addressOf()})`);
  await submitSearch(container, 'N-DELTA');
  assert(names(container) === 'Delta', 'the id matches, whatever its case');
  await submitSearch(container, 'uc-gam');
  assert(names(container) === 'Gamma', 'and so does the channel id');
  await submitSearch(container, 'zzz');
  assert(nameButtons(container).length === 0 && container.querySelector('table') === null, 'no submission matches zzz');
  assert(textOf(container.querySelector('h4')) === 'No submissions found.', 'the list says so, in the empty state');
  assert(statusGroup(container).isConnected && searchBox(container).value === 'zzz', 'the filters stay');
  assert(container.querySelector('[role="status"]') === null && alertOf(container) === null, 'with no skeleton and no alert');
  await submitSearch(container, '');
  assert(names(container) === 'Alpha|Beta|Gamma|Delta' && addressOf() === '/nova?status=', 'an emptied search shows every submission again, and drops its parameter');

  // The header counts the whole list, not what the filters keep; and none of it asks the worker again.
  assert(countsOf(container) === '4 submissions2 Pending1 Approved1 Rejected', 'the counts ignore the filters');
  assert(listCalls().length === 1 && calls.length === 1, "filtering is the browser's work: no further request");
  await unmount();

  // A link with both parameters opens on them: the chip, the box and the rows.
  const linked = await mountPage(curator, '/nova?status=approved&search=gam');
  assert(pressed(statusGroup(linked.container)) === 'Approved', 'the URL status is in effect');
  assert(searchBox(linked.container).value === 'gam' && names(linked.container) === 'Gamma', 'and its search is in the box and narrows the rows');
  await linked.unmount();
  const unknown = await mountPage(curator, '/nova?status=bogus');
  assert(pressed(statusGroup(unknown.container)) === 'Pending', 'a status this page does not know falls back to Pending');
  await unknown.unmount();
  console.log('✓ Nova: the status and the search are URL state; they combine in the browser and an empty result is an empty state');
}

async function aSearchDropsTheHeldRows(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await click(quick(container, 'Alpha', 'Approve'), 'Approve');
  assert(names(container) === PENDING_NAMES, 'the submission just approved is held in the Pending view');
  await submitSearch(container, '');
  assert(names(container) === 'Beta', `a search is a new question: the held submission goes (got ${names(container)})`);
  assert(statusCalls().length === 1 && listCalls().length === 1, 'none of it sends another request');
  await unmount();
  console.log('✓ Nova: submitting a search drops the submissions held over from the last action');
}

/**
 * The search box shows the term the rows are filtered by. The URL's term can change under the open page (Back or
 * Forward, a link): the rows follow it, and so does the box, whatever it held, so the next Search applies that term
 * rather than writing a stale one over it.
 */
async function theSearchBoxFollowsTheUrl(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator, '/nova?status=&search=bet', '/nova?status=&search=gam');
  // Read through a call: TypeScript keeps an asserted value narrowed to its literal afterwards.
  const box = (): string => searchBox(container).value;
  assert(box() === 'bet' && names(container) === 'Beta', 'the box and the rows read the term in the URL');

  await typeInto(searchBox(container), 'half-typed');
  await click(container.querySelector<HTMLAnchorElement>('a[data-jump]'), 'the link to another search');
  assert(
    addressOf() === '/nova?status=&search=gam' && names(container) === 'Gamma',
    `the rows follow the URL (got ${names(container)} at ${addressOf()})`,
  );
  assert(box() === 'gam', `the box follows too: it reads the URL's term (got "${box()}")`);

  // The next Search applies the term on show, so the URL keeps it.
  await act(async () => {
    searchForm(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  assert(
    addressOf() === '/nova?status=&search=gam' && names(container) === 'Gamma',
    `the next Search applies that term, not the one typed before it (got ${names(container)} at ${addressOf()})`,
  );

  // A status chip leaves what is typed alone.
  await typeInto(searchBox(container), 'typed again');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(box() === 'typed again', 'a change of status alone keeps what was typed in the box');
  assert(listCalls().length === 1 && calls.length === 1, 'and none of it asks the worker again');

  await unmount();
  console.log('✓ Nova: the search box follows the term in the URL, changed under the open page included, and the next Search applies it');
}

async function rowDetail(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const name = nameOf(container, 'Alpha');

  await click(name, 'the name button');
  assert(name.getAttribute('aria-expanded') === 'true' && name.getAttribute('aria-label') === '收合 Alpha', 'the row opens, and its label turns to collapse (the Chinese label stays)');
  const details = need(detailsOf('n-alpha'), 'the detail the row controls');
  assert(name.getAttribute('aria-controls') === details.id, 'the name controls it');
  assert(
    details.tagName === 'TD' && details.getAttribute('colspan') === '8' && details.closest('tr')?.parentElement?.tagName === 'TBODY',
    'the detail is one cell across the row group',
  );
  assert(need(name.closest('tbody'), 'the row group').classList.contains('bg-selected'), 'an open row wears the selected-row tint');
  assert(name.querySelector('span')?.classList.contains('text-accent-fg') === true, 'and its name the accent');
  assert(listCalls().length === 1 && calls.length === 1, 'opening a row asks the worker for nothing');
  assert(summaryOf(container, 'Alpha').querySelector('button[aria-label="Approve"]') === null, 'the quick actions give way to the review card while it is open');
  assert(
    details.className.includes('grid-cols-1') &&
      details.className.includes('xl:grid-cols-[minmax(0,1fr)_360px]') &&
      !details.className.includes('lg:grid-cols'),
    "the detail is one column below 1280 px, where a curator's review card becomes a second column of 360px",
  );
  assert(details.className.includes(' sticky left-0 w-[100cqw]'), 'as wide as the scroller shows, pinned to its left edge, at every width');

  // Left: who it is, the curator's controls, the fields.
  const form = need(details.children[0], 'the fields column');
  assert(form.tagName === 'FORM' && form.hasAttribute('novalidate'), "the fields are one form, with the browser's own validation off");
  const avatar = need(form.querySelector('img'), 'the avatar');
  assert(avatar.getAttribute('src') === AVATAR && avatar.getAttribute('alt') === 'Alpha' && avatar.className.includes('h-16 w-16'), 'the 64 px avatar, named for the VTuber');
  const heading = need(form.querySelector('p'), 'the name');
  assert(textOf(heading) === 'Alpha' && heading.className.includes('text-xl'), 'the name, large');
  const meta = need(heading.nextElementSibling, 'the line under the name');
  assert(textOf(meta).includes('Alpha Brand') && textOf(meta).includes('Prism'), 'the brand and the group');
  const verification = need([...meta.querySelectorAll('span')].find((span) => textOf(span) === 'Not verified'), 'the verification pill');
  assert(verification.className.includes(TONE_BOX_CLASS.neutral) && verification.querySelector('svg') !== null, 'an unverified channel is a neutral pill with its shield');
  const edit = need(buttonNamed(form, 'Edit'), 'Edit');
  const verify = need(buttonNamed(form, 'Verify channel'), 'Verify channel');
  assert(edit.getAttribute('type') === 'button' && verify.getAttribute('type') === 'button' && isIdle(verify), 'Edit and Verify channel are buttons, and available');

  const facts = [...form.querySelectorAll('dl')];
  const labels = (list: Element | undefined) => [...(list?.querySelectorAll('dt') ?? [])].map((term) => textOf(term)).join('|');
  assert(
    labels(facts[0]) === 'Brand Name|Group|Enabled|Display Order|YouTube Channel URL|YouTube Channel ID|Channel verification|Subscriber Count|Description',
    'the fields, as a kit detail list',
  );
  const valueOf = (label: string) => need([...form.querySelectorAll('dl > div')].find((field) => textOf(field.querySelector('dt')) === label)?.querySelector('dd'), `the ${label} value`);
  const urlLink = need(valueOf('YouTube Channel URL').querySelector('a'), 'the channel link');
  assert(urlLink.getAttribute('href') === 'https://www.youtube.com/@alpha' && urlLink.getAttribute('target') === '_blank', 'the channel URL is a link in a new tab');
  assert(textOf(valueOf('Brand Name')) === 'Alpha Brand' && textOf(valueOf('Group')) === 'Prism', 'the brand and group as they are');
  assert(textOf(valueOf('Enabled')) === 'Yes' && textOf(valueOf('Display Order')) === '0', 'whether it is enabled and its order');
  assert(textOf(valueOf('YouTube Channel ID')) === 'UC-alpha' && textOf(valueOf('Subscriber Count')) === '12.3K', 'the channel id and the subscribers');
  assert(textOf(valueOf('Channel verification')) === 'Not verified', 'the verification');
  assert(valueOf('Description').textContent === 'Sings\nevery night', 'the description keeps its line break');

  // Social links: a pill that opens each safe link, a warn one for a link that is not safe, a struck one for none.
  const social = need(
    [...form.querySelectorAll('p')].find((p) => textOf(p) === 'Social Links')?.nextElementSibling,
    'the social link pills under a Social Links label',
  );
  assert(textOf(social) === 'YouTubeTwitterInvalid FacebookInstagramTwitch', `a pill per network (got ${textOf(social)})`);
  const anchors = [...social.querySelectorAll('a')];
  assert(
    anchors.map((anchor) => anchor.getAttribute('href')).join('|') === 'https://www.youtube.com/@alpha|https://x.com/alpha|https://www.twitch.tv/alpha' &&
      anchors.every((anchor) => anchor.getAttribute('target') === '_blank' && anchor.getAttribute('rel') === 'noopener noreferrer' && anchor.className.includes(TONE_BOX_CLASS.info)),
    'a safe link is an info pill that opens in a new tab',
  );
  const pillsOf = [...social.querySelectorAll('span.rounded-radius-pill')];
  const invalid = need(pillsOf.find((pill) => textOf(pill) === 'Invalid Facebook'), 'the invalid pill');
  assert(invalid.className.includes(TONE_BOX_CLASS.warn) && invalid.parentElement?.getAttribute('title') === 'javascript:alert(1)', 'an unsafe link is a warn pill that keeps what was submitted in its title');
  const missing = need(pillsOf.find((pill) => textOf(pill) === 'Instagram'), 'the missing pill');
  assert(missing.className.includes(TONE_BOX_CLASS.neutral) && missing.className.includes('line-through'), 'a missing link is a struck neutral pill');
  assert(social.querySelector('a[href^="javascript"]') === null, 'and nothing links to it');

  // The colours the VTuber chose, as swatches; then the review fields.
  const swatches = [...form.querySelectorAll<HTMLElement>('div[title*=": #"]')];
  const swatchTitles = swatches.map((swatch) => swatch.getAttribute('title'));
  assert(
    swatches.length === 12 &&
      swatchTitles[0] === 'accentPrimary: #FF00AA' &&
      swatchTitles[1] === 'accentPrimaryDark: #000000' &&
      swatchTitles.includes('bgPageStart: #112233') &&
      swatches.every((swatch) => swatch.style.backgroundColor !== '' && swatch.className.includes('border-line-soft')),
    `a swatch per colour of the theme (the twelve, the ones the VTuber left alone as black), on a token border (got ${swatchTitles.join('|')})`,
  );
  assert(textOf(valueOf('Reviewed At')) === '—' && textOf(valueOf('Reviewer Note')) === '—', 'a submission nobody has reviewed has dashes for both');

  // Right: the review card of a pending submission.
  const review = need(details.children[1], 'the review card');
  assert(review.classList.contains('glass-card'), 'a glass card');
  assert(textOf(review).includes('Reviewer Note (optional, shown on reject)'), 'with the reviewer note label');
  const box = noteBox(container);
  assert(box.getAttribute('rows') === '3' && box.placeholder === 'Reason for rejection...', 'a three-row note box with its prompt');
  assert(need(container.querySelector(`label[for="${box.id}"]`), 'its label').textContent?.includes('Reviewer Note') === true, 'the label is the box name');
  assert(
    [...review.querySelectorAll('button')].map((button) => textOf(button)).join('|') === 'Approve|Reject|Delete' &&
      [...review.querySelectorAll('button')].every((button) => button.getAttribute('type') === 'button' && button.querySelector('svg') !== null),
    'Approve, Reject and Delete, each with its icon',
  );
  const cardButtons = [...review.querySelectorAll('button')];
  assert(
    cardButtons[0]?.className.includes('bg-accent') === true &&
      cardButtons[1]?.className.includes('border-field-line') === true &&
      cardButtons[2]?.className.includes('bg-transparent') === true,
    'Approve is the primary button, Reject a secondary one and Delete a ghost one',
  );
  assertNoRawColour(container.innerHTML, 'the opened submission');

  // Only one row is open at a time; the chevron is a mouse-only duplicate of the name.
  await expand(container, 'Beta');
  assert(detailsOf('n-alpha') === null && detailsOf('n-beta') !== null && name.getAttribute('aria-expanded') === 'false', 'opening another closes the first');
  const second = need(detailsOf('n-beta'), 'the second detail');
  assert(textOf(second).includes('Not verified') && second.querySelector('img') === null && second.querySelector('svg') !== null, 'a submission with no avatar has the tile, and its own fields');
  const chevron = need(summaryOf(container, 'Beta').querySelector<HTMLButtonElement>('button[aria-hidden="true"]'), 'the chevron');
  await click(chevron, 'the chevron');
  assert(detailsOf('n-beta') === null, 'a press on the chevron closes the row');

  // A reviewed, verified submission: its fields, its times, and a card with Revert and Delete only.
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  await expand(container, 'Gamma');
  const reviewed = need(detailsOf('n-gamma'), 'the reviewed detail');
  const reviewedFacts = [...reviewed.querySelectorAll('dl > div')];
  const reviewedValue = (label: string) => need(reviewedFacts.find((field) => textOf(field.querySelector('dt')) === label)?.querySelector('dd'), `the ${label} value`);
  assert(textOf(reviewedValue('Enabled')) === 'No' && textOf(reviewedValue('Display Order')) === '3', 'a hidden submission and its order');
  const verifiedAt = need(reviewedValue('Channel verification').querySelector('time'), 'the verification time');
  assert(
    textOf(reviewedValue('Channel verification')).startsWith('Verified') &&
      verifiedAt.getAttribute('datetime') === storedTimeIso(GAMMA.youtube_channel_verified_at ?? '') &&
      verifiedAt.getAttribute('title') === formatFullTime(GAMMA.youtube_channel_verified_at ?? ''),
    'a verified channel says when, as a <time>',
  );
  const reviewedAt = need(reviewedValue('Reviewed At').querySelector('time'), 'the reviewed time');
  assert(
    reviewedAt.getAttribute('datetime') === storedTimeIso(GAMMA.reviewed_at ?? '') &&
      reviewedAt.getAttribute('title') === formatFullTime(GAMMA.reviewed_at ?? '') &&
      textOf(reviewedAt) === formatWhen(GAMMA.reviewed_at ?? '', new Date()),
    'Reviewed At is a <time> with the exact instant and the full time',
  );
  assert(textOf(reviewedValue('Reviewer Note')) === 'Fine as it is', 'and the reviewer note shows');
  const verifiedPill = need([...reviewed.querySelectorAll('span')].find((span) => textOf(span) === 'Verified'), 'the Verified pill');
  assert(verifiedPill.className.includes(TONE_BOX_CLASS.ok), 'a verified channel is an ok pill');
  const done = need(buttonNamed(reviewed, 'Channel verified'), 'the verified control');
  assert(isUnavailable(done), 'a verified channel offers no second verification: the control says so and is unavailable');
  const reviewedCard = need(reviewed.children[1], 'the review card');
  assert(reviewedCard.querySelector('textarea') === null && textOf(reviewedCard).startsWith('Review'), 'a reviewed submission asks for no note: its card is labelled Review');
  assert([...reviewedCard.querySelectorAll('button')].map((button) => textOf(button)).join('|') === 'Revert to Pending|Delete', 'with Revert to Pending and Delete');

  // A channel nobody gave an id has nothing to verify.
  await expand(container, 'Beta');
  assert(need(buttonNamed(need(detailsOf('n-beta'), 'the detail'), 'Verify channel'), 'Verify channel').hasAttribute('disabled'), 'a submission with no channel id has nothing to verify: the control is disabled');

  assert(statusCalls().length === 0 && deleteCalls().length === 0 && saveCalls().length === 0 && calls.length === 1, 'none of it changed anything');
  await unmount();
  console.log('✓ Nova: a row opens into its fields, its links and its review card, one at a time, and asks the worker for nothing');
}

/** The form of an open row: its fields column, with the toolbar and the editor in it. */
function formOf(id: string): HTMLFormElement {
  return need(detailsOf(id)?.querySelector('form'), `the form of the open row ${id}`);
}

function colourOf(form: ParentNode, key: string): HTMLInputElement {
  return need(form.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${key} theme color"]`), `the ${key} colour`);
}

async function submitForm(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Opens a row and puts it in edit mode with the keyboard on Edit, as a keyboard user does. */
async function openEditor(container: HTMLElement, id: string, name: string): Promise<HTMLFormElement> {
  await expand(container, name);
  const form = formOf(id);
  const edit = need(buttonNamed(form, 'Edit'), 'Edit');
  await focus(edit);
  await click(edit, 'Edit');
  return form;
}

const FIELD_LABELS = [
  'Display Name',
  'Slug',
  'Brand Name',
  'Group',
  'YouTube Channel URL',
  'YouTube Channel ID',
  'Description',
  'Avatar URL',
  'Subscriber Count',
  'Link: YouTube',
  'Link: Twitter',
  'Link: Facebook',
  'Link: Instagram',
  'Link: Twitch',
  'External URL',
];

async function theEditor(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Alpha');
  const details = need(detailsOf('n-alpha'), 'the detail');
  const form = formOf('n-alpha');
  const edit = need(buttonNamed(form, 'Edit'), 'Edit');
  await focus(edit);
  await click(edit, 'Edit');

  // Edit gives way to Save and Cancel, which are other elements, and the focus goes to the first field.
  assert(!edit.isConnected, 'Edit is replaced by Save and Cancel, not relabelled');
  const save = need(buttonNamed(form, 'Save'), 'Save');
  const cancel = need(buttonNamed(form, 'Cancel'), 'Cancel');
  assert(save.getAttribute('type') === 'submit' && cancel.getAttribute('type') === 'button', 'Save is the form\'s submit button; Cancel is not');
  assert(save.className.includes('bg-accent') && isIdle(save) && isIdle(cancel), 'Save is the primary button, and both are available');
  assert(buttonNamed(form, 'Verify channel') === null, 'Verify channel gives way too');
  assert(focused() === fieldOf(form, 'Display Name'), 'the focus is on the first field, not on <body>');
  assert(details.children.length === 1 && !details.className.includes('xl:grid-cols'), 'while it is edited the submission has no review card beside it');
  assert(form.querySelector('img') === null && form.querySelector('dl') === null, 'and its view gives way to the editor');

  // A form with the browser's own checks off, and fifteen labelled fields in a grid that is one column on a phone.
  assert(form.hasAttribute('novalidate'), 'the editor is a form with novalidate');
  assert(form.querySelector('[required]') === null, 'no field carries `required`: the browser\'s bubble cannot pre-empt the inline errors');
  assert(
    [...form.querySelectorAll('label[for^="nova-n-alpha-"]')].map((label) => textOf(label)).join('|') === FIELD_LABELS.join('|'),
    'the fifteen fields, each with its label, in order',
  );
  const grid = need(form.querySelector('label[for="nova-n-alpha-slug"]')?.closest('.grid'), 'the fields grid');
  assert(grid.className.includes('grid-cols-1') && grid.className.includes('sm:grid-cols-2'), 'one column below 640 px, two from there');
  const display = fieldOf(form, 'Display Name');
  const description = fieldOf(form, 'Description');
  assert(display.tagName === 'INPUT' && display.value === 'Alpha' && fieldOf(form, 'Slug').value === 'alpha', 'each field holds what was submitted');
  assert(description.tagName === 'TEXTAREA' && description.getAttribute('rows') === '3' && description.value === 'Sings\nevery night', 'the description is a three-row textarea');
  assert(description.closest('.sm\\:col-span-2') !== null, 'which spans both columns');
  assert(fieldOf(form, 'Link: Facebook').value === 'javascript:alert(1)', 'an unsafe link is shown as it was submitted, to be fixed');

  // The registry settings: Enabled (the kit checkbox, with what it means) and the order.
  const checkbox = need(form.querySelector<HTMLInputElement>('input[type="checkbox"]'), 'the Enabled checkbox');
  assert(checkbox.checked && textOf(checkbox.closest('label')) === 'Enabled', 'Enabled is a labelled checkbox, checked for an enabled submission');
  const stateText = need(form.querySelector(`#${checkbox.id}-state`), 'what Enabled means');
  assert(textOf(stateText) === 'Visible on site' && checkbox.getAttribute('aria-describedby') === stateText.id, 'which says it is visible, and is the box\'s description');
  const order = fieldOf(form, 'Order') as HTMLInputElement;
  assert(order.type === 'number' && order.value === '0', 'the order is a number input');
  assert(order.getAttribute('aria-required') === 'true' && !order.hasAttribute('required') && order.getAttribute('aria-invalid') === null, 'it is aria-required, never required, and valid');
  assert(textOf(form.querySelector(`#${order.id}-hint`)) === 'Lower = first' && order.getAttribute('aria-describedby') === `${order.id}-hint`, 'and says what it means');

  // The twelve colours, native colour inputs on token borders, with their values as text.
  const colours = [...form.querySelectorAll<HTMLInputElement>('input[type="color"]')];
  assert(colours.length === 12, 'twelve colour inputs');
  assert(colours.every((colour) => colour.className.includes('border-field-line') && (colour.getAttribute('aria-label') ?? '').endsWith(' theme color')), 'each is named, on a token border');
  assert(colourOf(form, 'accentPrimary').value.toUpperCase() === '#FF00AA' && colourOf(form, 'accentPrimaryDark').value.toUpperCase() === '#000000', 'holding the theme the VTuber chose');
  assert(textOf(colourOf(form, 'accentPrimary').nextElementSibling).includes('#FF00AA'), 'and showing it');
  assertNoRawColour(container.innerHTML, 'the editor');

  // A display order that is not a number is said inline, beside its field, and blocks Save.
  await typeInto(order, '');
  assert(order.getAttribute('aria-invalid') === 'true' && order.getAttribute('aria-required') === 'true', 'an emptied order is aria-invalid');
  const orderError = need(form.querySelector(`#${order.id}-error`), 'the order error');
  assert(textOf(orderError) === 'Enter a number' && orderError.className.includes('text-tone-danger-fg'), 'it says Enter a number, in the danger tone');
  assert(order.getAttribute('aria-describedby') === `${order.id}-error` && form.querySelector(`#${order.id}-hint`) === null, 'the error describes it, in place of the hint');
  assert(save.hasAttribute('disabled') && alertsIn(form) === '', 'Save is disabled; there is nothing to announce, and a browser sends no implicit submission through a disabled button');
  await typeInto(order, '5');
  assert(order.getAttribute('aria-invalid') === null && !save.hasAttribute('disabled') && form.querySelector(`#${order.id}-error`) === null, 'a number makes it valid again, and Save available');

  // Save sends the fields that changed, and only those; it is busy while out and keeps the focus.
  await typeInto(display, 'Alpha Prime');
  await click(checkbox, 'the Enabled checkbox');
  assert(!checkbox.checked && textOf(form.querySelector(`#${checkbox.id}-state`)) === 'Hidden from site', 'unchecking Enabled says the submission is hidden');
  await typeInto(colourOf(form, 'accentPrimary'), '#00ff00');
  const answer = held();
  saveReply = () => answer.reply;
  await focus(save);
  await click(save, 'Save');
  assert(saveCalls().length === 1, 'Save sends one request');
  const sent = need(saveCalls()[0], 'the save request');
  assert(sent.path === '/api/nova/submissions/n-alpha' && sent.method === 'PUT', 'a PUT to the submission');
  const body = sent.body as Record<string, unknown>;
  assert(
    Object.keys(body).sort().join('|') === 'display_name|display_order|enabled|theme_json' && body.display_name === 'Alpha Prime' && body.display_order === 5 && body.enabled === 0,
    `only what changed is sent (got ${Object.keys(body).sort().join('|')})`,
  );
  const sentTheme = JSON.parse(String(body.theme_json)) as Record<string, string>;
  assert(
    Object.keys(sentTheme).length === 12 && sentTheme.accentPrimary === '#00FF00' && sentTheme.bgPageStart === '#112233' && sentTheme.accentPrimaryDark === '#000000',
    'the theme is sent whole, with the one colour changed',
  );
  assert(isBusy(save) && save.getAttribute('type') === 'submit' && textOf(save) === 'Save', 'Save is busy, not disabled, and still says Save');
  assert(focused() === save, 'it keeps the focus while the request is out');
  assert(isUnavailable(cancel), 'Cancel is unavailable beside it');
  await click(cancel, 'the unavailable Cancel');
  await click(save, 'the busy Save');
  await submitForm(form);
  assert(saveCalls().length === 1 && fieldOf(form, 'Display Name').value === 'Alpha Prime' && save.isConnected, 'a press on either, or a submit, sends nothing and leaves the editor as it was');

  await respond(answer, ok({ ...ALPHA, display_name: 'Alpha Prime', enabled: 0, display_order: 5, theme_json: JSON.stringify(sentTheme) }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Submission saved', detail: 'Alpha Prime' }],
  );
  assert(!need(toastsOf(container)[0], 'the toast').danger, 'a toast of success');
  assert(buttonNamed(form, 'Save') === null && form.querySelector('dl') !== null && !save.isConnected, 'the editor is gone: the view is back');
  const after = need(buttonNamed(form, 'Edit'), 'Edit again');
  assert(focused() === after, `the focus that Save held goes back to Edit, not to <body> (got ${focused()?.tagName})`);
  assert(names(container) === 'Alpha Prime|Beta' && nameOf(container, 'Alpha Prime').getAttribute('aria-label') === '收合 Alpha Prime', 'the row shows the new name');
  const viewValue = (label: string) => need([...form.querySelectorAll('dl > div')].find((field) => textOf(field.querySelector('dt')) === label)?.querySelector('dd'), `the ${label} value`);
  assert(textOf(viewValue('Enabled')) === 'No' && textOf(viewValue('Display Order')) === '5', 'and the view shows what was saved');
  assert(listCalls().length === 1 && countsOf(container) === '4 submissions2 Pending1 Approved1 Rejected', 'the list is patched in place, with no reload');
  assert(alertOf(container) === null, 'and nothing is raised as an error');

  // Cancel throws the drafts away, sends nothing, and hands the focus back to Edit.
  await focus(after);
  await click(after, 'Edit');
  await typeInto(fieldOf(form, 'Display Name'), 'Scratch');
  const cancelAgain = need(buttonNamed(form, 'Cancel'), 'Cancel');
  await focus(cancelAgain);
  await click(cancelAgain, 'Cancel');
  assert(saveCalls().length === 1 && buttonNamed(form, 'Save') === null, 'Cancel sends nothing and closes the editor');
  const edit3 = need(buttonNamed(form, 'Edit'), 'Edit');
  assert(focused() === edit3, 'the focus goes back to Edit');
  await click(edit3, 'Edit');
  assert(fieldOf(form, 'Display Name').value === 'Alpha Prime', 'the next edit starts from what is saved, not from the abandoned draft');

  // A save with nothing changed sends nothing, says nothing and closes the editor.
  const toastsBefore = toastsOf(container).length;
  await focus(need(buttonNamed(form, 'Save'), 'Save'));
  await click(need(buttonNamed(form, 'Save'), 'Save'), 'Save');
  assert(saveCalls().length === 1 && buttonNamed(form, 'Save') === null, 'a save with no change sends no request and closes the editor');
  assert(toastsOf(container).length === toastsBefore, 'it says nothing: nothing was saved');
  assert(focused() === buttonNamed(form, 'Edit'), 'the focus goes to Edit');

  await unmount();
  console.log('✓ Nova: the editor is a novalidate form; Save sends what changed, is busy while out, toasts, and hands the focus back to Edit with Cancel');
}

async function aSaveThatFails(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  const name = fieldOf(form, 'Display Name');
  await typeInto(name, 'Alpha Prime');

  // A refused save is a line beside the buttons, not a toast: the curator is looking at the editor.
  saveReply = () => failure(500, 'Save store is down');
  const save = need(buttonNamed(form, 'Save'), 'Save');
  await focus(save);
  await click(save, 'Save');
  assert(saveCalls().length === 1, 'the save was sent');
  assert(alertsIn(form) === 'Save store is down', `a refused save says why, beside its buttons (got ${alertsIn(form)})`);
  const line = need(form.querySelector('[role="alert"]'), 'the line');
  assert(line.className.includes('text-tone-danger-fg') && save.parentElement?.contains(line) === true, 'in the danger tone, in the toolbar the buttons are in');
  assert(toastsOf(container).length === 0, 'and no toast');
  assert(save.isConnected && isIdle(save) && focused() === save, 'Save is available again, and never lost the focus');
  assert(name.value === 'Alpha Prime' && buttonNamed(form, 'Cancel') !== null, 'the editor stays open, with what was typed');

  // Submitted again (Enter in a field does that), with the worker back, it goes through, and the line goes.
  saveReply = defaultSaveReply;
  await submitForm(form);
  assert(saveCalls().length === 2 && alertsIn(form) === '' && messagesOf(container) === 'Submission saved', 'the same save, later, lands: a toast, and no line');
  assert(buttonNamed(form, 'Edit') !== null, 'the editor closed');

  await unmount();
  console.log('✓ Nova: a refused save is a line beside Save, with the editor kept; Enter in a field saves');
}

async function aSaveDoesNotStealFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  await typeInto(fieldOf(form, 'Display Name'), 'Alpha Prime');
  const answer = held();
  saveReply = () => answer.reply;
  const save = need(buttonNamed(form, 'Save'), 'Save');
  await focus(save);
  await click(save, 'Save');

  // The keyboard goes to another row while the save is out: the answer must not pull it back to Edit.
  const elsewhere = nameOf(container, 'Beta');
  await focus(elsewhere);
  await respond(answer, ok({ ...ALPHA, display_name: 'Alpha Prime' }));
  assert(messagesOf(container) === 'Submission saved', 'the save still lands');
  assert(focused() === elsewhere, 'the focus stays where the user put it');
  assert(focused() !== buttonNamed(formOf('n-alpha'), 'Edit'), 'and Edit did not take it');

  await unmount();
  console.log('✓ Nova: a save that lands after the focus has moved on does not take it back');
}

async function fetchingSubscribers(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  const fetch = need(buttonNamed(form, 'Fetch'), 'Fetch');
  assert(fetch.getAttribute('title') === 'Fetch subscriber count & avatar from YouTube' && isIdle(fetch), 'Fetch sits beside the subscriber count, and says what it does');

  // Busy while out, and it keeps the focus; the worker's answer fills the draft and says so in a toast.
  const answer = held();
  subscribersReply = () => answer.reply;
  await focus(fetch);
  await click(fetch, 'Fetch');
  assert(subscribersCalls().length === 1 && need(subscribersCalls()[0], 'the request').path === '/api/nova/submissions/n-alpha/fetch-subscribers', 'one request, for the submission');
  assert(isBusy(fetch) && textOf(fetch) === 'Fetch' && focused() === fetch, 'Fetch is busy, not disabled, still says Fetch and keeps the focus');
  await click(fetch, 'the busy Fetch');
  assert(subscribersCalls().length === 1, 'a second press sends nothing');
  await respond(answer, defaultSubscribersReply(need(subscribersCalls()[0], 'the request'), 'n-alpha'));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Channel info updated', detail: 'Alpha' }],
  );
  assert(fieldOf(form, 'Subscriber Count').value === '99.9K' && fieldOf(form, 'Avatar URL').value === 'https://yt3.ggpht.com/refreshed=s240', 'the count and the avatar fill the drafts');
  assert(isIdle(fetch) && focused() === fetch && alertsIn(form) === '', 'Fetch is available again, with the focus, and nothing is raised as an error');

  // A refusal is a line under the field, which describes it; no toast.
  subscribersReply = () => failure(502, 'YouTube is down');
  await click(fetch, 'Fetch');
  const subscribers = fieldOf(form, 'Subscriber Count');
  assert(alertsIn(form) === 'YouTube is down', `a refused fetch says why, under its field (got ${alertsIn(form)})`);
  assert(subscribers.getAttribute('aria-describedby') === `${subscribers.id}-error` && subscribers.getAttribute('aria-invalid') === null, 'the field is described by it, and is not invalid: its value is fine');
  assert(messagesOf(container) === 'Channel info updated', 'no toast for it');
  assert(isIdle(fetch) && focused() === fetch, 'Fetch is available again, with the focus');
  await unmount();

  // With no channel id there is nothing to fetch from.
  reset();
  const none = await mountPage();
  const betaForm = await openEditor(none.container, 'n-beta', 'Beta');
  const noChannel = need(buttonNamed(betaForm, 'Fetch'), 'Fetch');
  assert(noChannel.hasAttribute('disabled') && noChannel.getAttribute('title') === 'Set YouTube Channel ID first', 'a submission with no channel id has nothing to fetch from, and says what to do');
  await none.unmount();
  console.log('✓ Nova: Fetch in the editor is busy while out, toasts what it did, fills the drafts and keeps the focus; a refusal is a line under the field');
}

async function verifyingTheChannel(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Alpha');
  const form = formOf('n-alpha');
  const verify = need(buttonNamed(form, 'Verify channel'), 'Verify channel');

  // Busy while out (its label stays), and the focus stays on it.
  const answer = held();
  verifyReply = () => answer.reply;
  await focus(verify);
  await click(verify, 'Verify channel');
  assert(verifyCalls().length === 1 && need(verifyCalls()[0], 'the request').path === '/api/nova/submissions/n-alpha/verify-youtube-channel', 'one request, for the submission');
  assert(isBusy(verify) && textOf(verify) === 'Verify channel' && focused() === verify, 'the control is busy, not disabled, and keeps its label and the focus');
  await click(verify, 'the busy control');
  assert(verifyCalls().length === 1, 'a second press sends nothing');

  // The control stays the same element, now saying the channel is verified and unavailable; the focus never leaves it.
  await respond(answer, defaultVerifyReply(need(verifyCalls()[0], 'the request'), 'n-alpha'));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Channel verified', detail: 'Alpha' }],
  );
  assert(verify.isConnected && textOf(verify) === 'Channel verified' && isUnavailable(verify), 'the same control now says Channel verified, and is unavailable');
  assert(focused() === verify, `the focus stays on it, which needs no hand-off (got ${focused()?.tagName})`);
  const pill = need([...form.querySelectorAll('span')].find((span) => textOf(span) === 'Verified'), 'the Verified pill');
  assert(pill.className.includes(TONE_BOX_CLASS.ok), 'the header shows an ok Verified pill');
  const verifiedField = need([...form.querySelectorAll('dl > div')].find((field) => textOf(field.querySelector('dt')) === 'Channel verification'), 'the verification field');
  assert(textOf(verifiedField.querySelector('dd')).startsWith('Verified') && verifiedField.querySelector('time') !== null, 'and the field says when');
  await click(verify, 'the verified control');
  assert(verifyCalls().length === 1, 'a verified channel is not verified twice');
  await unmount();

  // A refusal is a line beside the buttons, not a toast, and the control is available again.
  reset();
  verifyReply = () => failure(502, 'YouTube refused the channel');
  const refused = await mountPage();
  await expand(refused.container, 'Alpha');
  const refusedForm = formOf('n-alpha');
  const again = need(buttonNamed(refusedForm, 'Verify channel'), 'Verify channel');
  await focus(again);
  await click(again, 'Verify channel');
  assert(alertsIn(refusedForm) === 'YouTube refused the channel', `a refused verification says why, beside the buttons (got ${alertsIn(refusedForm)})`);
  assert(toastsOf(refused.container).length === 0, 'with no toast');
  assert(isIdle(again) && textOf(again) === 'Verify channel' && focused() === again, 'the control is available again, with the focus');
  verifyReply = defaultVerifyReply;
  await click(again, 'Verify channel');
  assert(verifyCalls().length === 2 && alertsIn(refusedForm) === '' && messagesOf(refused.container) === 'Channel verified', 'the same press, later, verifies, and the line goes');
  await refused.unmount();
  console.log('✓ Nova: Verify channel is busy while out and keeps its label, its focus and, once done, its place; a refusal is a line beside it');
}

const REVIEWED_AT = '2026-09-02T10:00:00.000Z';

/** The body of the save an editor's submit sent, read as the fields it carries. */
function savedBody(index: number): Record<string, unknown> {
  return need(saveCalls()[index], `save request ${index + 1}`).body as Record<string, unknown>;
}

/**
 * What a save sent, apart from the theme. The editor sends its twelve colours whole when the curator changed one, so
 * the theme is read on its own, by `savedTheme`.
 */
function savedFields(index: number): Record<string, unknown> {
  return Object.fromEntries(Object.entries(savedBody(index)).filter(([key]) => key !== 'theme_json'));
}

/** The colours a save sent, by name. */
function savedTheme(index: number): Record<string, string> {
  return JSON.parse(String(savedBody(index).theme_json ?? '{}')) as Record<string, string>;
}

/**
 * A submission that changes under an open editor (here by the editor's own Fetch, a verification, a review, a list
 * reload) is merged into the drafts: what the curator changed stays, even where the worker changed it too; what they
 * left alone takes the worker's value. Each trigger has a scenario; a save afterwards sends only what the curator changed.
 */
async function aFetchLandsWhileEditing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  await typeInto(fieldOf(form, 'Display Name'), 'Alpha Prime');
  await typeInto(fieldOf(form, 'Group'), 'Curator group');

  const answer = held();
  subscribersReply = () => answer.reply;
  const fetch = need(buttonNamed(form, 'Fetch'), 'Fetch');
  await focus(fetch);
  await click(fetch, 'Fetch');
  await respond(answer, defaultSubscribersReply(need(subscribersCalls()[0], 'the request'), 'n-alpha'));
  assert(messagesOf(container) === 'Channel info updated', 'the fetch lands');

  assert(
    fieldOf(form, 'Display Name').value === 'Alpha Prime' && fieldOf(form, 'Group').value === 'Curator group',
    "the curator's unsaved edits survive the fetch",
  );
  assert(
    fieldOf(form, 'Subscriber Count').value === '99.9K' && fieldOf(form, 'Avatar URL').value === 'https://yt3.ggpht.com/refreshed=s240',
    'and the fetched fields take the fetched values',
  );
  assert(buttonNamed(form, 'Save') !== null && isIdle(fetch) && focused() === fetch, 'the editor stays open, with the focus on Fetch');

  await submitForm(form);
  deepStrictEqual(
    savedBody(0),
    { display_name: 'Alpha Prime', group: 'Curator group' },
    'a save sends what the curator changed, and no theme: the fetch left the colours alone, and so did they',
  );
  await unmount();
  console.log('✓ Nova: a fetch that lands while the editor is open keeps the unsaved edits and updates the fetched fields');
}

/**
 * The editor's own Fetch reaches the drafts as any changed submission does: a field the curator edits while it is out
 * keeps what they typed, and one they leave alone takes the fetched value.
 */
async function aFieldEditedWhileTheFetchIsOutKeepsTheEdit(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  const answer = held();
  subscribersReply = () => answer.reply;
  const fetch = need(buttonNamed(form, 'Fetch'), 'Fetch');
  await focus(fetch);
  await click(fetch, 'Fetch');

  // While the fetch is out, the curator types the count themselves, and leaves the avatar alone.
  await typeInto(fieldOf(form, 'Subscriber Count'), '13K');
  await respond(answer, defaultSubscribersReply(need(subscribersCalls()[0], 'the request'), 'n-alpha'));
  assert(messagesOf(container) === 'Channel info updated', 'the fetch lands');
  assert(
    fieldOf(form, 'Subscriber Count').value === '13K',
    `the count typed while the fetch was out stays (got ${fieldOf(form, 'Subscriber Count').value})`,
  );
  assert(fieldOf(form, 'Avatar URL').value === 'https://yt3.ggpht.com/refreshed=s240', 'the avatar left alone takes the fetched value');

  // A save then sends the typed count, and none of the fields the fetch already stored.
  await submitForm(form);
  deepStrictEqual(savedFields(0), { subscriber_count: '13K' }, 'a save sends the count the curator typed, and no fetched field');
  await unmount();
  console.log("✓ Nova: a field edited while the editor's Fetch is out keeps the edit; one left alone takes the fetched value");
}

async function aReviewLandsWhileEditing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // An approval is out for Alpha; while it is, the curator opens the row, presses Edit and changes some fields.
  const answer = held();
  statusReply = () => answer.reply;
  const approve = quick(container, 'Alpha', 'Approve');
  await focus(approve);
  await click(approve, 'Approve');
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  const typing = fieldOf(form, 'Display Name');
  await typeInto(typing, 'Alpha Prime');
  const enabled = need(form.querySelector<HTMLInputElement>('input[type="checkbox"]'), 'the Enabled checkbox');
  await click(enabled, 'the Enabled checkbox');
  await typeInto(fieldOf(form, 'Order'), '5');
  await typeInto(colourOf(form, 'accentPrimary'), '#00ff00');
  await focus(typing);

  // The answer says Alpha is approved, and that the worker's group is another one.
  await respond(answer, ok({ ...ALPHA, status: 'approved', reviewed_at: REVIEWED_AT, group: 'Worker group' }));
  assert(messagesOf(container) === 'Submission approved', 'the approval lands');
  assert(textOf([...summaryOf(container, 'Alpha').querySelectorAll(':scope > td')][4]).startsWith('Approved'), 'the row shows the new status');
  assert(
    fieldOf(form, 'Display Name').value === 'Alpha Prime' &&
      !enabled.checked &&
      fieldOf(form, 'Order').value === '5' &&
      colourOf(form, 'accentPrimary').value.toUpperCase() === '#00FF00',
    "the curator's unsaved edits survive the review: a field, Enabled, the order and a colour",
  );
  assert(fieldOf(form, 'Group').value === 'Worker group', 'a field they left alone takes the worker\'s value');
  assert(focused() === typing, 'the focus is still where they were typing');

  await submitForm(form);
  deepStrictEqual(savedFields(0), { display_name: 'Alpha Prime', enabled: 0, display_order: 5 });
  assert(savedTheme(0).accentPrimary === '#00FF00', "a save sends what the curator changed (and the colour they chose), and neither the worker's group nor the status");
  await unmount();
  console.log('✓ Nova: a review that lands while the editor is open keeps the unsaved edits and shows the new status');
}

async function aVerificationLandsWhileEditing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Alpha');
  const form = formOf('n-alpha');

  // A verification is out; while it is, the curator presses Edit (Verify channel gives way to Save and Cancel) and types.
  const answer = held();
  verifyReply = () => answer.reply;
  const verify = need(buttonNamed(form, 'Verify channel'), 'Verify channel');
  await focus(verify);
  await click(verify, 'Verify channel');
  assert(verifyCalls().length === 1, 'the verification is out');
  await click(need(buttonNamed(form, 'Edit'), 'Edit'), 'Edit');
  await typeInto(fieldOf(form, 'Display Name'), 'Alpha Prime');
  await typeInto(fieldOf(form, 'Description'), 'What the curator wrote');

  await respond(answer, defaultVerifyReply(need(verifyCalls()[0], 'the request'), 'n-alpha'));
  assert(messagesOf(container) === 'Channel verified', 'the verification lands');
  assert(
    fieldOf(form, 'Display Name').value === 'Alpha Prime' && fieldOf(form, 'Description').value === 'What the curator wrote',
    "the curator's unsaved edits survive the verification",
  );
  assert(need([...form.querySelectorAll('span')].find((span) => textOf(span) === 'Verified'), 'the Verified pill').className.includes(TONE_BOX_CLASS.ok), 'and the header shows the channel verified');

  await submitForm(form);
  deepStrictEqual(savedFields(0), { display_name: 'Alpha Prime', description: 'What the curator wrote' });
  await unmount();
  console.log('✓ Nova: a verification that lands while the editor is open keeps the unsaved edits');
}

async function aFieldBothSidesChangedKeepsTheCurators(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const answer = held();
  statusReply = () => answer.reply;
  const reject = quick(container, 'Alpha', 'Reject');
  await focus(reject);
  await click(reject, 'Reject');
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  await typeInto(fieldOf(form, 'Description'), 'What the curator wrote');

  // The worker's answer changes the same description, and the group the curator did not touch.
  await respond(answer, ok({ ...ALPHA, status: 'rejected', reviewed_at: REVIEWED_AT, description: 'What the worker has', group: 'Worker group' }));
  assert(messagesOf(container) === 'Submission rejected', 'the rejection lands');
  assert(fieldOf(form, 'Description').value === 'What the curator wrote', 'a field both sides changed keeps the curator\'s value: they are about to save it');
  assert(fieldOf(form, 'Group').value === 'Worker group', 'and the one only the worker changed takes the worker\'s');

  await submitForm(form);
  deepStrictEqual(savedFields(0), { description: 'What the curator wrote' });
  await unmount();
  console.log("✓ Nova: a field both the curator and the worker changed keeps the curator's value");
}

/** A save leaves the editor holding what the worker stored, which can differ from what was typed. */
async function aSaveShowsWhatWasStored(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  await typeInto(fieldOf(form, 'Display Name'), 'Alpha Prime  ');

  // The worker stores what it is sent, but trims the name.
  saveReply = (call) => ok({ ...ALPHA, ...(call.body as object), display_name: 'Alpha Prime' });
  await submitForm(form);
  assert(saveCalls().length === 1 && messagesOf(container) === 'Submission saved', 'the save lands');
  assert(nameOf(container, 'Alpha Prime') !== null, 'the row shows the stored name');

  const edit = need(buttonNamed(form, 'Edit'), 'Edit');
  await focus(edit);
  await click(edit, 'Edit');
  assert(fieldOf(form, 'Display Name').value === 'Alpha Prime', 'the next edit starts from what was stored, not from what was typed');
  await submitForm(form);
  assert(saveCalls().length === 1, 'and a save of it sends nothing: there is nothing to change');
  await unmount();
  console.log('✓ Nova: a save leaves the editor holding what the worker stored');
}

/**
 * A save sends the theme only when the curator changed a colour: colour by colour against the theme the drafts started
 * from, not against the stored string. The editor reads a submission with no theme as twelve blacks, and a stored theme
 * of another shape (fewer keys, another order) as the colours it holds: neither is a change, and neither is written.
 */
async function anUntouchedThemeIsNotSent(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // Beta has no theme. A name edit saves the name, and no twelve blacks with it.
  const beta = await openEditor(container, 'n-beta', 'Beta');
  await typeInto(fieldOf(beta, 'Display Name'), 'Beta Prime');
  await submitForm(beta);
  assert(saveCalls().length === 1 && messagesOf(container) === 'Submission saved', 'the save lands');
  deepStrictEqual(savedBody(0), { display_name: 'Beta Prime' }, 'a themeless submission saved with a name edit sends the name alone');

  // A colour the curator changes is a change: the theme goes whole, with the eleven they left black.
  const edit = need(buttonNamed(beta, 'Edit'), 'Edit');
  await focus(edit);
  await click(edit, 'Edit');
  await typeInto(colourOf(beta, 'bgPageStart'), '#123456');
  await submitForm(beta);
  assert(Object.keys(savedBody(1)).join() === 'theme_json', `a colour edit sends the theme alone (got ${Object.keys(savedBody(1)).join()})`);
  const theme = savedTheme(1);
  assert(
    Object.keys(theme).length === 12 && theme.bgPageStart === '#123456' && theme.accentPrimary === '#000000',
    'the theme goes whole: twelve colours, the one changed',
  );

  // Alpha's stored theme names two colours, not the editor's twelve. Saved untouched, it stays as it is stored.
  const alpha = await openEditor(container, 'n-alpha', 'Alpha');
  await typeInto(fieldOf(alpha, 'Display Name'), 'Alpha Prime');
  await submitForm(alpha);
  deepStrictEqual(savedBody(2), { display_name: 'Alpha Prime' }, 'a theme stored in another shape, saved untouched, is not sent');

  await unmount();
  console.log('✓ Nova: a save sends the theme only when a colour changed: no theme stored, or one stored in another shape, stays as it is');
}

async function aReloadLandsWhileEditing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const form = await openEditor(container, 'n-alpha', 'Alpha');
  await typeInto(fieldOf(form, 'Display Name'), 'Alpha Prime');

  // "Fetch All Channel Info" reloads the whole list, so every row is handed a new submission; Alpha has a new count.
  listReply = () => ok({ data: [{ ...ALPHA, subscriber_count: '1.5M' }, BETA, GAMMA, DELTA], total: SUBMISSIONS.length });
  await click(need(buttonNamed(pageHeader(container), 'Fetch All Channel Info'), 'Fetch All Channel Info'), 'Fetch All Channel Info');
  assert(listCalls().length === 2, 'the list is reloaded');
  assert(fieldOf(form, 'Display Name').value === 'Alpha Prime', "the curator's unsaved edit survives the reload");
  assert(fieldOf(form, 'Subscriber Count').value === '1.5M', 'and the field they left alone takes the reloaded value');

  await submitForm(form);
  deepStrictEqual(savedFields(0), { display_name: 'Alpha Prime' });
  await unmount();
  console.log('✓ Nova: a list reload while the editor is open keeps the unsaved edits');
}

async function approvingFromTheRow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const approve = quick(container, 'Alpha', 'Approve');
  const reject = quick(container, 'Alpha', 'Reject');
  const remove = quick(container, 'Alpha', 'Delete');
  const name = nameOf(container, 'Alpha');

  // Pressed on the keyboard, Approve sends the status and is busy while the worker answers.
  const answer = held();
  statusReply = () => answer.reply;
  await focus(approve);
  await click(approve, 'Approve');
  assert(statusCalls().length === 1, 'Approve sends one request');
  const sent = need(statusCalls()[0], 'the status request');
  assert(sent.path === '/api/nova/submissions/n-alpha/status', 'to the submission');
  deepStrictEqual(sent.body, { status: 'approved' });
  assert(isBusy(approve), 'Approve is busy (aria-busy), not disabled');
  assert(
    approve.querySelector('svg')?.classList.contains('animate-spin') === true && remove.querySelector('svg')?.classList.contains('animate-spin') !== true,
    'and it alone spins: its icon is the spinner',
  );
  assert(approve.getAttribute('aria-label') === 'Approve' && approve.querySelector('svg') !== null, 'and still says what it does');
  assert(focused() === approve, 'it keeps the focus while the request is out');
  assert(isUnavailable(reject) && isUnavailable(remove), 'Reject and Delete are unavailable beside it');
  assert(approve.className.includes('aria-disabled:opacity-50'), 'and every one of them dims');
  await click(approve, 'the busy Approve');
  await click(reject, 'the unavailable Reject');
  await click(remove, 'the unavailable Delete');
  assert(statusCalls().length === 1 && deleteCalls().length === 0 && confirmDialog(container) === null, 'a press on any of them sends and asks nothing');
  assert(toastsOf(container).length === 0, 'and nothing is announced yet');

  // The request is the page's, not the row's: opening the row and closing it again finds it still out.
  await click(name, 'the name button');
  await click(name, 'the name button');
  assert(isBusy(quick(container, 'Alpha', 'Approve')), 'Approve is still busy when the row is closed again');

  await focus(quick(container, 'Alpha', 'Approve'));
  await respond(answer, ok({ ...ALPHA, status: 'approved', reviewed_at: REVIEWED_AT }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Submission approved', detail: 'Alpha' }],
  );
  assert(!need(toastsOf(container)[0], 'the toast').danger, 'a toast of success, not of failure');
  const cells = [...summaryOf(container, 'Alpha').querySelectorAll(':scope > td')];
  assert(textOf(cells[4]).startsWith('Approved'), 'the submission now reads Approved');
  assert(names(container) === PENDING_NAMES, 'and stays in the Pending view until a filter changes');
  assert(countsOf(container) === '4 submissions1 Pending2 Approved1 Rejected', `the header counts follow (got ${countsOf(container)})`);
  assert(
    [...(cells[6]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Revert to Pending|Delete',
    'its quick actions are now Revert to Pending and Delete',
  );
  assert(focused() === name, `the focus that Approve held goes to the row's name button, not to <body> (got ${focused()?.tagName})`);
  assert(statusCalls().length === 1 && listCalls().length === 1 && unexpected.length === 0, 'one request, and the list is patched in place');

  // Revert is the same call the other way, with its own toast; the focus hands off again.
  statusReply = defaultStatusReply;
  const revert = quick(container, 'Alpha', 'Revert to Pending');
  await focus(revert);
  await click(revert, 'Revert to Pending');
  deepStrictEqual(need(statusCalls()[1], 'the second request').body, { status: 'pending' });
  assert(messagesOf(container) === 'Submission approved|Submission reverted to pending', `Revert toasts too (got ${messagesOf(container)})`);
  assert(textOf([...summaryOf(container, 'Alpha').querySelectorAll(':scope > td')][4]).startsWith('Pending'), 'the submission reads Pending again');
  assert(focused() === name, 'and the focus is on the name button again');

  await unmount();
  console.log('✓ Nova: Approve and Revert are busy while out, toast what happened, and hand the focus to the name button');
}

async function rejectingFromTheRow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const reject = quick(container, 'Beta', 'Reject');
  const name = nameOf(container, 'Beta');

  // Reject sends the (empty) note; when it lands the same node turns into Delete, and the focus must not stay on it.
  await focus(reject);
  await click(reject, 'Reject');
  deepStrictEqual(need(statusCalls()[0], 'the status request').body, { status: 'rejected', reviewer_note: '' });
  assert(messagesOf(container) === 'Submission rejected', `a rejection toasts "Submission rejected" (got ${messagesOf(container)})`);
  assert(need(toastsOf(container)[0], 'the toast').detail === 'Beta', 'naming the submission');
  const after = [...summaryOf(container, 'Beta').querySelectorAll(':scope > td')];
  assert(textOf(after[4]).startsWith('Rejected') && need(after[4]?.querySelector('span'), 'the status pill').className.includes(TONE_BOX_CLASS.danger), 'the submission now reads Rejected, in the danger tone');
  assert(
    [...(after[6]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Revert to Pending|Delete',
    'it offers Revert to Pending and Delete',
  );
  assert(
    focused() === name && focused()?.getAttribute('aria-label') !== 'Delete',
    `the focus goes to the name button, not to the Delete control that took Reject's place (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova: Reject toasts and hands the focus to the name button, not to the Delete that takes its place');
}

async function reviewingFromTheCard(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Beta');
  const details = need(detailsOf('n-beta'), 'the detail');
  const approve = need(buttonNamed(details, 'Approve'), 'Approve');
  const reject = need(buttonNamed(details, 'Reject'), 'Reject');
  const remove = need(buttonNamed(details, 'Delete'), 'Delete');
  const name = nameOf(container, 'Beta');

  // Reject sends the note that was typed, is busy while out, and makes its siblings unavailable.
  await typeInto(noteBox(container), 'Wrong streamer');
  const answer = held();
  statusReply = () => answer.reply;
  await focus(reject);
  await click(reject, 'Reject');
  deepStrictEqual(need(statusCalls()[0], 'the status request').body, { status: 'rejected', reviewer_note: 'Wrong streamer' });
  assert(isBusy(reject) && textOf(reject) === 'Reject', 'Reject is busy, not disabled, and still says Reject');
  assert(focused() === reject, 'it keeps the focus');
  assert(isUnavailable(approve) && isUnavailable(remove), 'Approve and Delete are unavailable beside it');
  assert(noteBox(container).value === 'Wrong streamer', 'the note stays where it was typed');
  await click(approve, 'the unavailable Approve');
  await click(reject, 'the busy Reject');
  assert(statusCalls().length === 1, 'a press on any of them sends nothing');

  await respond(answer, ok({ ...BETA, status: 'rejected', reviewer_note: 'Wrong streamer', reviewed_at: REVIEWED_AT }));
  assert(messagesOf(container) === 'Submission rejected', 'the rejection toasts');
  const card = need(need(detailsOf('n-beta'), 'the detail').children[1], 'the review card');
  assert(card.querySelector('textarea') === null && buttonNamed(card, 'Revert to Pending') !== null, "the card turns to a reviewed submission's: no note box, Revert to Pending");
  assert(buttonNamed(card, 'Reject') === null && !reject.isConnected, 'the Reject button is gone');
  assert(focused() === name, `the focus that Reject held goes to the row's name button (got ${focused()?.tagName})`);
  const reviewerNote = need([...need(detailsOf('n-beta'), 'the detail').querySelectorAll('dl > div')].find((field) => textOf(field.querySelector('dt')) === 'Reviewer Note')?.querySelector('dd'), 'the reviewer note');
  assert(textOf(reviewerNote) === 'Wrong streamer', 'the reviewer note is shown with the submission');

  // Revert from the card: the same card turns back, with an empty note box.
  statusReply = defaultStatusReply;
  const revert = need(buttonNamed(card, 'Revert to Pending'), 'Revert to Pending');
  await focus(revert);
  await click(revert, 'Revert to Pending');
  deepStrictEqual(need(statusCalls()[1], 'the second request').body, { status: 'pending' });
  assert(messagesOf(container) === 'Submission rejected|Submission reverted to pending', 'Revert toasts');
  assert(noteBox(container).value === '', 'the note box is empty: the rejection used the note up');
  assert(focused() === name, 'and the focus is on the name button again');

  // Approve from the card sends no note.
  await click(need(buttonNamed(need(detailsOf('n-beta'), 'the detail'), 'Approve'), 'Approve'), 'Approve');
  deepStrictEqual(need(statusCalls()[2], 'the third request').body, { status: 'approved' });
  assertNoRawColour(container.innerHTML, 'the page after its reviews');

  await unmount();
  console.log('✓ Nova: the review card sends the note with a rejection, is busy while out, toasts and hands the focus to the name button');
}

async function aNoteOutlivesItsRow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Beta');
  await typeInto(noteBox(container), 'Half-written reason');

  // Another status takes the row off the page, and the Pending chip brings it back: the note is in the page's store.
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(names(container) === 'Gamma' && detailsOf('n-beta') === null, "the row, and its detail, are gone from the Approved view");
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(detailsOf('n-beta') !== null, 'the row is still the open one');
  assert(noteBox(container).value === 'Half-written reason', 'the note comes back with the row');

  // A rejection that landed uses it up.
  await click(need(buttonNamed(need(detailsOf('n-beta'), 'the detail'), 'Reject'), 'Reject'), 'Reject');
  deepStrictEqual(need(statusCalls()[0], 'the request').body, { status: 'rejected', reviewer_note: 'Half-written reason' });
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(names(container) === 'Alpha', 'the rejected submission left the Pending view');

  await unmount();
  console.log('✓ Nova: a reviewer note outlives its row (a filter change) until its rejection lands');
}

async function aRefusedRequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const approve = quick(container, 'Alpha', 'Approve');
  const name = nameOf(container, 'Alpha');

  // A status change the worker refuses: its message is a toast, with nothing to retry; the button stays.
  statusReply = () => failure(500, 'Review store is down');
  await focus(approve);
  await click(approve, 'Approve');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `a refused approval raises one toast (saw ${toasts.length})`);
  const refused = need(toasts[0], 'the toast');
  assert(refused.message === 'Review store is down' && refused.detail === '', "which is the worker's message");
  assert(refused.danger, 'a failure toast');
  assert(refused.retry === null, 'with no Retry: the button is still there to press again');
  assert(alertOf(container) === null, 'and no line of its own on the page');
  assert(approve.isConnected && isIdle(approve), 'the button is available again');
  assert(focused() === approve, 'the focus never left Approve');
  assert(textOf([...summaryOf(container, 'Alpha').querySelectorAll(':scope > td')][4]).startsWith('Pending'), 'the submission is as it was');
  assert(countsOf(container) === '4 submissions2 Pending1 Approved1 Rejected', 'and so are the counts');
  assert(listCalls().length === 1, 'and nothing reloads');

  // Pressed again, with the worker back, it goes through.
  statusReply = defaultStatusReply;
  await click(approve, 'Approve');
  assert(statusCalls().length === 2 && messagesOf(container) === 'Review store is down|Submission approved', 'the same press, later, approves');
  assert(focused() === name, 'and now the focus moves on');

  // A delete the worker refuses: the confirm closes, the row stays, the error is a toast, the focus stays.
  const remove = quick(container, 'Beta', 'Delete');
  deleteReply = () => failure(500, 'Delete store is down');
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1, 'confirming sent the request');
  assert(
    messagesOf(container) === 'Delete store is down|Review store is down|Submission approved',
    `a refused delete toasts the worker's message (got ${messagesOf(container)})`,
  );
  const refusedDelete = need(toastsOf(container).find((toast) => toast.message === 'Delete store is down'), 'the toast for the refused delete');
  assert(refusedDelete.danger && refusedDelete.retry === null, 'a failure toast with no Retry');
  assert(remove.isConnected && isIdle(remove) && names(container).includes('Beta'), 'the row stays, its Delete available again');
  assert(focused() === remove, 'the focus never left Delete');
  assert(confirmDialog(container) === null, 'the confirm is closed');

  await unmount();
  console.log('✓ Nova: a refused approval or delete is an error toast with no Retry; the row and its button stay');
}

async function deletingARow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const remove = quick(container, 'Alpha', 'Delete');
  const nextName = nameOf(container, 'Beta');

  // The kit confirm, in the danger tone, names the submission by its id and its name.
  await focus(remove);
  await click(remove, 'Delete');
  const dialog = need(confirmDialog(container), 'the confirm');
  const dialogText = textOf(dialog);
  assert(dialogText.includes('n-alpha') && dialogText.includes('Alpha'), 'the confirm names the submission: its id and its name');
  assert(dialogText.includes('Delete this submission?') && dialogText.includes('This cannot be undone.'), 'it asks, and says it cannot be undone');
  assert(dialog.innerHTML.includes('bg-danger-solid'), 'a danger confirm');
  assert(need(buttonNamed(dialog, 'Delete'), "the confirm's Delete").className.includes('bg-danger-solid'), 'whose Delete is the danger button');
  assert(focused() === buttonNamed(dialog, 'Cancel'), 'it starts on Cancel, the least destructive answer');
  assert(deleteCalls().length === 0, 'asking sends nothing');

  // Cancel sends nothing and keeps the focus on the control that asked.
  await click(buttonNamed(dialog, 'Cancel'), 'Cancel');
  assert(confirmDialog(container) === null && deleteCalls().length === 0, 'Cancel closes the confirm and sends nothing');
  assert(names(container) === PENDING_NAMES && remove.isConnected, 'the row stays');
  assert(focused() === remove, "and the focus stays on the row's Delete control");
  assert(toastsOf(container).length === 0, 'with nothing announced');

  // Confirm: one DELETE; the control is busy meanwhile and keeps the focus (the answer is held, as it is in life).
  const answer = held();
  deleteReply = () => answer.reply;
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1 && need(deleteCalls()[0], 'the DELETE').path === '/api/nova/submissions/n-alpha', 'confirming sends one DELETE, to the submission');
  assert(isBusy(remove), 'the Delete control is busy while the request is out');
  assert(focused() === remove, 'the confirm handed the focus back to it');
  assert(isUnavailable(quick(container, 'Alpha', 'Approve')) && isUnavailable(quick(container, 'Alpha', 'Reject')), 'the row is otherwise unavailable');
  assert(names(container) === PENDING_NAMES, 'and the row is still on show');

  await respond(answer, ok({ ok: true }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Submission deleted', detail: 'Alpha' }],
  );
  assert(names(container) === 'Beta', `the row is gone (got ${names(container)})`);
  assert(countsOf(container) === '3 submissions1 Pending1 Approved1 Rejected', `and the header counts follow (got ${countsOf(container)})`);
  assert(focused() === nextName, `the focus goes to the next row's name button (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`);
  assert(listCalls().length === 1 && deleteCalls().length === 1 && unexpected.length === 0, 'one DELETE, and the list is patched in place');

  // The last row on show: no row to go to, so the focus goes to the status chip in effect.
  await click(quick(container, 'Beta', 'Delete'), 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(nameButtons(container).length === 0 && textOf(container.querySelector('h4')) === 'No submissions found.', 'the list is empty');
  assert(
    focused() === statusChipInEffect(container) && textOf(focused()) === 'Pending',
    `with no row left the focus goes to the status chip in effect, Pending (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );
  assertNoRawColour(container.innerHTML, 'the page after its deletes');

  await unmount();
  console.log('✓ Nova: Delete asks through the kit confirm; Cancel keeps the focus; Confirm is busy, toasts and hands the focus to the next row, or the status chip');
}

async function deletingFromTheCard(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Beta');
  const details = need(detailsOf('n-beta'), 'the detail');
  const remove = need(buttonNamed(details, 'Delete'), 'the card Delete');

  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  assert(textOf(need(confirmDialog(container), 'the confirm')).includes('n-beta'), 'the card Delete asks through the same confirm');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(isBusy(remove) && focused() === remove, 'the card Delete is busy and keeps the focus');
  assert(isUnavailable(need(buttonNamed(details, 'Approve'), 'Approve')) && isUnavailable(need(buttonNamed(details, 'Reject'), 'Reject')), 'with Approve and Reject unavailable beside it');
  await respond(answer, ok({ ok: true }));
  assert(names(container) === 'Alpha' && detailsOf('n-beta') === null, 'the row and its detail are gone');
  assert(messagesOf(container) === 'Submission deleted', 'with a toast');
  assert(
    focused() === statusChipInEffect(container),
    `Beta was the last row: the focus goes to the Pending chip (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova: the review card Delete asks and hands the focus on the same way');
}

async function focusIsNeverStolen(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // The keyboard goes elsewhere while a status change is out: the answer must not pull it back.
  const answer = held();
  statusReply = () => answer.reply;
  const approve = quick(container, 'Alpha', 'Approve');
  await focus(approve);
  await click(approve, 'Approve');
  const elsewhere = chip(statusGroup(container), 'Pending');
  await focus(elsewhere);
  await respond(answer, ok({ ...ALPHA, status: 'approved', reviewed_at: REVIEWED_AT }));
  assert(messagesOf(container) === 'Submission approved', 'the approval still lands');
  assert(focused() === elsewhere, 'the focus stays where the user put it');
  assert(focused() !== nameOf(container, 'Alpha'), 'and the name button did not take it');

  // Another row's name button is the user's too, and so is the Delete beside an Approve that is out: it is
  // the one control of the row that is still there when the answer lands.
  const another = held();
  statusReply = () => another.reply;
  const betaApprove = quick(container, 'Beta', 'Approve');
  await focus(betaApprove);
  await click(betaApprove, 'Approve');
  const alphaName = nameOf(container, 'Alpha');
  await focus(alphaName);
  await respond(another, ok({ ...BETA, status: 'approved', reviewed_at: REVIEWED_AT }));
  assert(focused() === alphaName, "the focus stays on another row's name button");

  reset();
  const third = held();
  statusReply = () => third.reply;
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  await click(quick(container, 'Delta', 'Revert to Pending'), 'Revert to Pending');
  const deltaDelete = quick(container, 'Delta', 'Delete');
  await focus(deltaDelete);
  await respond(third, ok({ ...DELTA, status: 'pending', reviewed_at: null }));
  assert(quick(container, 'Delta', 'Delete') === deltaDelete, "the row's Delete is the same control after the answer");
  assert(focused() === deltaDelete, "the focus stays on it: a control the answer does not replace is the user's to keep");

  await unmount();
  console.log('✓ Nova: an answer that lands after the focus has moved on does not take it back');
}

async function aDeleteDoesNotStealFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  const remove = quick(container, 'Alpha', 'Delete');
  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  const elsewhere = nameOf(container, 'Gamma');
  await focus(elsewhere);
  await respond(answer, ok({ ok: true }));
  assert(names(container) === 'Beta|Gamma|Delta', 'the delete lands');
  assert(focused() === elsewhere, 'the focus stays where the user moved it');
  assert(focused() !== nameOf(container, 'Beta'), 'and the next row did not take it');

  await unmount();
  console.log('✓ Nova: a delete that lands after the focus has moved on does not take it back');
}

/**
 * A delete whose answer lands after the curator has pressed another status chip finds the deleted row off the page,
 * and the row after it too: the last fallback is the chip in effect, the one just pressed. The press leaves the focus
 * where it was (Safari and Firefox on macOS do not focus a button on a click), so the Delete that held it leaves with
 * its row and the focus is on <body> when the answer lands.
 */
async function aDeleteLandsAfterAFilterChange(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const remove = quick(container, 'Alpha', 'Delete');
  const nextName = nameOf(container, 'Beta');
  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1 && isBusy(remove) && focused() === remove, 'the delete is out, its control busy and holding the focus');

  // Another status is pressed while it is out: the pending rows leave the page, the deleted one and the next with them.
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(names(container) === 'Gamma', 'the Approved view lists the approved submission only');
  assert(!remove.isConnected && !nextName.isConnected, 'the row being deleted and the row after it are off the page');
  assert(focused() === document.body || focused() === null, 'the Delete that held the focus left with its row, and the focus fell to <body>');
  assert(deleteCalls().length === 1, 'the delete is still out');

  await respond(answer, ok({ ok: true }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Submission deleted', detail: 'Alpha' }],
  );
  assert(countsOf(container) === '3 submissions1 Pending1 Approved1 Rejected', `the header counts follow (got ${countsOf(container)})`);
  assert(
    focused() === statusChipInEffect(container) && textOf(focused()) === 'Approved',
    `with no next row on the page the focus goes to the chip just pressed, Approved (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );
  assert(deleteCalls().length === 1 && statusCalls().length === 0 && listCalls().length === 1 && unexpected.length === 0, 'one DELETE, and nothing else was asked');

  await unmount();
  console.log('✓ Nova: a delete that lands after a filter change hands the focus to the status chip just pressed');
}

/**
 * A delete's next row is read when the answer lands, not when the delete is confirmed: a filter pressed and pressed back
 * while the request is out remounts the rows, and the button that was next at the confirm is a node that is no longer on
 * the page. The focus goes to the next row as the page has it now. (The first press takes the Delete that held the focus
 * with its row, so the focus is on <body> when the answer lands.)
 */
async function aDeleteLandsAfterTheRowsRemounted(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const remove = quick(container, 'Alpha', 'Delete');
  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1 && isBusy(remove), 'the delete is out, its control busy');
  const staleNext = nameOf(container, 'Beta');

  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(names(container) === PENDING_NAMES, `the Pending view is back with its rows (got ${names(container)})`);
  assert(!staleNext.isConnected && !remove.isConnected, 'the rows are new nodes: the button that was next and the Delete left the page');
  assert(isBusy(quick(container, 'Alpha', 'Delete')), "the new Delete control is busy again: the request is the page's, not the row's");
  assert(focused() === document.body || focused() === null, 'the Delete that held the focus left with its row, and the focus fell to <body>');

  await respond(answer, ok({ ok: true }));
  assert(messagesOf(container) === 'Submission deleted', 'the delete lands');
  assert(
    focused() === nameOf(container, 'Beta'),
    `the focus goes to the next row's name button as the page has it now, not to the one read at the confirm (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova: a delete answered after its rows remounted hands the focus to the next row now on the page');
}

async function twoSubmissionsInFlight(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await click(chip(statusGroup(container), 'All'), 'the All chip');

  // An approval is out for the first submission, a delete for the second.
  const approving = held();
  const deleting = held();
  statusReply = () => approving.reply;
  deleteReply = () => deleting.reply;
  const firstApprove = quick(container, 'Alpha', 'Approve');
  await focus(firstApprove);
  await click(firstApprove, 'Approve');
  const secondDelete = quick(container, 'Beta', 'Delete');
  await focus(secondDelete);
  await click(secondDelete, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(statusCalls().length === 1 && deleteCalls().length === 1, 'one request out for each submission');
  assert(isBusy(firstApprove) && isBusy(secondDelete), 'each row has its own busy control');
  assert(isIdle(quick(container, 'Gamma', 'Revert to Pending')), 'a third row is untouched');

  // The first answer lands while the second request is out: the second row's control, with the focus, is untouched.
  await focus(secondDelete);
  await respond(approving, ok({ ...ALPHA, status: 'approved', reviewed_at: REVIEWED_AT }));
  assert(messagesOf(container) === 'Submission approved', 'the first row toasts its own result');
  assert(isBusy(secondDelete) && focused() === secondDelete, "the second row's Delete is still busy, and keeps the focus");

  // The second lands: both rows are idle, and each toast names its own result.
  await respond(deleting, ok({ ok: true }));
  assert(messagesOf(container) === 'Submission approved|Submission deleted', `each result has its toast (got ${messagesOf(container)})`);
  assert(names(container) === 'Alpha|Gamma|Delta', 'the deleted row is gone, the approved one stays');
  assert(focused() === nameOf(container, 'Gamma'), 'the delete handed its focus on to the next row');
  assert(statusCalls().length === 1 && deleteCalls().length === 1 && listCalls().length === 1, 'no request was sent twice');

  await unmount();
  console.log('✓ Nova: two rows with a request out each keep their own busy controls, toasts and focus');
}

async function theFilterChangesMidRequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // A rejection is out for a pending submission.
  const rejecting = held();
  statusReply = () => rejecting.reply;
  const reject = quick(container, 'Alpha', 'Reject');
  await focus(reject);
  await click(reject, 'Reject');
  assert(isBusy(reject), 'Reject is busy');

  // The curator picks another status: the pending submission leaves the list, its row with it.
  const approved = chip(statusGroup(container), 'Approved');
  await focus(approved);
  await click(approved, 'the Approved chip');
  assert(names(container) === 'Gamma', 'the Approved view lists the approved submission only');
  assert(statusCalls().length === 1, 'its request is the only one');

  // The answer lands for a row that is not there: the submission comes back, held in view as any one just acted on is
  // (it is rejected, which the Approved view does not list), and the keyboard stays on the chip.
  await respond(rejecting, ok({ ...ALPHA, status: 'rejected', reviewed_at: REVIEWED_AT }));
  assert(messagesOf(container) === 'Submission rejected', 'the toast says what happened');
  assert(names(container) === 'Alpha|Gamma', `the submission just rejected is back in the Approved view (got ${names(container)})`);
  assert(focused() === approved, 'the focus stays on the chip that was pressed');

  // The next chip press asks the question again, and the submission goes; none of it sent a request twice.
  await click(approved, 'the Approved chip again');
  assert(names(container) === 'Gamma', 'the next chip press drops the held submission');
  assert(statusCalls().length === 1 && listCalls().length === 1, 'no request was sent twice');

  await unmount();
  console.log('✓ Nova: a filter changed while a request is out lets the answer land, and the submission stays until the next chip press');
}

async function fetchingEveryChannel(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const header = pageHeader(container);
  const fetchAll = need(buttonNamed(header, 'Fetch All Channel Info'), 'Fetch All Channel Info');

  // Busy while out, with its label and the focus; a second press sends nothing.
  const answer = held();
  bulkReply = () => answer.reply;
  await focus(fetchAll);
  await click(fetchAll, 'Fetch All Channel Info');
  assert(bulkCalls().length === 1 && need(bulkCalls()[0], 'the request').method === 'POST', 'one POST');
  assert(isBusy(fetchAll) && textOf(fetchAll) === 'Fetch All Channel Info' && focused() === fetchAll, 'the button is busy, not disabled, and keeps its label and the focus');
  await click(fetchAll, 'the busy button');
  assert(bulkCalls().length === 1, 'a second press sends nothing');

  // The list reloads once the answer is in; its rows stay on screen meanwhile, and the button is unavailable but keeps the focus.
  const reload = held();
  listReply = () => reload.reply;
  await respond(answer, ok(BULK_RESULT));
  assert(listCalls().length === 2, 'the page reloads its list, once');
  assert(names(container) === PENDING_NAMES && container.querySelector('table') !== null, 'the rows stay on screen while it does');
  assert(!container.innerHTML.includes('Loading submissions…'), 'with no skeleton over them: that is for the first load only');
  assert(isUnavailable(fetchAll) && focused() === fetchAll, 'the button is unavailable while the list reloads, and has not lost the focus');
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Updated 2, failed 1', detail: '' }],
  );

  // The result stays on the page, in a note: how many, and which. The toast is what announces it, so the note is the
  // record that stays on screen and no live region of its own: one announcement, not two.
  const note = need(bulkNote(container), 'the result note');
  assert(textOf(note).includes('Updated 2, failed 1'), 'the note holds the result');
  assert(!note.hasAttribute('role') && note.querySelector('[role], [aria-live]') === null, 'the note is no live region');
  assert(liveRegionsHolding(container, 'Updated 2, failed 1') === 1, 'so the result is announced once, from the toast region');
  assert(note.className.includes(TONE_BOX_CLASS.warn), 'a warn note, since one channel failed');
  assert(textOf(note.querySelector('b')) === 'Updated 2, failed 1', 'which says how many were updated and how many failed');
  assert(textOf(note.querySelector('summary')) === 'Show details (3 streamers)', 'its details are one press away');
  const lines = [...note.querySelectorAll('li')];
  assert(
    lines.map((line) => textOf(line)).join('|') === 'Alpha: 99.9K (avatar updated)|Gamma: 5|Beta: No channel id',
    `a line per streamer, with its count and whether its avatar changed, or why it failed (got ${lines.map((line) => textOf(line)).join('|')})`,
  );
  assert(
    lines[2]?.className.includes('text-tone-danger-fg') === true && lines[0]?.className.includes('text-tone-danger-fg') !== true,
    'the failed one stands out in the danger tone',
  );
  await respond(reload, defaultListReply());
  assert(isIdle(fetchAll) && focused() === fetchAll, 'the button is available again once the list is back, with the focus');

  // Pressed again, it clears the old result while it is out.
  const again = held();
  bulkReply = () => again.reply;
  listReply = defaultListReply;
  await click(fetchAll, 'Fetch All Channel Info');
  assert(bulkNote(container) === null, 'the old result is gone while the next is out');
  await respond(again, ok({ updated: 0, failed: 0, results: [] }));
  const clean = need(bulkNote(container), 'the new result note');
  assert(textOf(clean).includes('Updated 0, failed 0'), 'the new note holds the new result');
  assert(clean.className.includes(TONE_BOX_CLASS.ok) && clean.querySelector('details') === null, 'a result with no failure is an ok note, with no details to show');
  assert(messagesOf(container) === 'Updated 0, failed 0|Updated 2, failed 1', 'and a toast of its own');
  await unmount();

  // A refusal is an error toast with no Retry and no note; the button is available again and the list is not reloaded.
  reset();
  bulkReply = () => failure(500, 'Quota exceeded');
  const refused = await mountPage();
  const refusedButton = need(buttonNamed(pageHeader(refused.container), 'Fetch All Channel Info'), 'Fetch All Channel Info');
  await focus(refusedButton);
  await click(refusedButton, 'Fetch All Channel Info');
  const refusal = toastsOf(refused.container);
  assert(refusal.length === 1 && need(refusal[0], 'the toast').message === 'Quota exceeded' && need(refusal[0], 'the toast').danger && need(refusal[0], 'the toast').retry === null, "the worker's message, in a failure toast with no Retry");
  assert(bulkNote(refused.container) === null, 'no result note');
  assert(isIdle(refusedButton) && focused() === refusedButton && listCalls().length === 1, 'the button is available again, with the focus, and the list was not reloaded');
  await refused.unmount();
  console.log('✓ Nova: Fetch All Channel Info is busy while out, toasts and keeps a result note, reloads the list with its rows on screen, and a refusal is an error toast');
}

async function contributorView(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);

  // The route keeps contributors out, but the page does not rely on it: it offers a contributor no action.
  assert(buttonNamed(pageHeader(container), 'Fetch All Channel Info') === null, 'no bulk refresh');
  const quickRow = summaryOf(container, 'Alpha');
  assert(quickRow.querySelectorAll('button[aria-label="Approve"], button[aria-label="Reject"], button[aria-label="Delete"]').length === 0, 'no quick actions');
  await expand(container, 'Alpha');
  const details = need(detailsOf('n-alpha'), 'the detail');
  assert(container.querySelector('textarea') === null && buttonNamed(details, 'Approve') === null && buttonNamed(details, 'Delete') === null, 'no review card');
  assert(buttonNamed(details, 'Edit') === null && buttonNamed(details, 'Verify channel') === null, 'no Edit and no Verify channel');
  assert(details.children.length === 1 && details.className.includes('grid-cols-1') && !details.className.includes('xl:grid-cols'), 'the detail is its fields alone, in one column');
  assert(textOf(details).includes('Alpha Brand') && textOf(details).includes('Social Links'), 'the fields are there');
  assert(statusCalls().length === 0 && deleteCalls().length === 0 && saveCalls().length === 0, 'and nothing is sent');

  await unmount();
  console.log("✓ Nova: a contributor's page offers no action, no editor and no review card");
}

async function loadFailure(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => failure(503, 'Submissions are unavailable');
  const { container, unmount } = await mountPage();

  const alert = need(alertOf(container), 'a danger alert');
  assert(textOf(alert).includes("Couldn't load submissions.") && textOf(alert).includes('Submissions are unavailable'), 'the alert says what failed and why');
  assert(alert.className.includes('bg-tone-danger-bg'), 'a danger note');
  assert(container.querySelector('[role="status"]') === null, 'no skeleton once the load has failed');
  assert(nameButtons(container).length === 0 && !container.innerHTML.includes('No submissions found.'), 'no rows, and a failure is not an empty list');
  assert(textOf(pageHeader(container)) === 'INBOXNovaFetch All Channel Info', 'the header has no counts to show');
  assert(statusGroup(container).isConnected && searchBox(container).isConnected, 'the filters stay');
  assert(toastsOf(container).length === 0, 'a load failure is an alert, not a toast');
  assertNoRawColour(container.innerHTML, 'the failed page');

  // A Retry that does not hold the focus asks again and leaves the focus where it is; a retry that fails
  // is an alert again, with its message.
  listReply = () => failure(503, 'Submissions are still unavailable');
  await click(need(buttonNamed(alert, 'Retry'), 'a Retry in the alert'), 'Retry');
  assert(listCalls().length === 2, 'Retry reloads the list');
  assert(focused() !== container.querySelector('h1'), 'the heading takes the focus only from a Retry that held it');
  assert(textOf(alertOf(container)).includes('Submissions are still unavailable'), 'a retry that fails raises the alert again');

  // Retry asks again. The alert leaves with it, so the focus it held goes to the heading.
  const retry = need(buttonNamed(need(alertOf(container), 'the alert'), 'Retry'), 'a Retry in the alert');
  await focus(retry);
  assert(focused() === retry, 'the keyboard is on Retry');
  const again = held();
  listReply = () => again.reply;
  await click(retry, 'Retry');
  assert(listCalls().length === 3, 'Retry reloads the list again');
  assert(focused() === container.querySelector('h1'), `the focus goes to the page heading, not to <body> (got ${focused()?.tagName})`);
  assert(container.querySelector('[role="status"]') !== null, 'the skeleton shows while the retry is out');
  await respond(again, ok({ data: SUBMISSIONS, total: SUBMISSIONS.length }));
  assert(alertOf(container) === null, 'a successful retry clears the alert');
  assert(names(container) === PENDING_NAMES, 'and shows the rows');
  assert(countsOf(container) === '4 submissions2 Pending1 Approved1 Rejected', 'and the counts');

  await unmount();
  console.log('✓ Nova: a load failure is a danger alert whose Retry reloads and hands its focus to the heading');
}

async function emptyList(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => ok({ data: [], total: 0 });
  const { container, unmount } = await mountPage();

  assert(textOf(container.querySelector('h4')) === 'No submissions found.', 'an inbox with no submissions says so');
  assert(container.querySelector('[role="status"]') === null && alertOf(container) === null, 'with no skeleton and no alert');
  assert(countsOf(container) === '0 submissions0 Pending0 Approved0 Rejected', `and counts of zero (got ${countsOf(container)})`);
  assertNoRawColour(container.innerHTML, 'the empty page');
  await unmount();

  reset();
  listReply = () => ok({ data: [DELTA], total: 1 });
  const one = await mountPage();
  assert(countsOf(one.container) === '1 submission0 Pending0 Approved1 Rejected', `one submission is a submission (got ${countsOf(one.container)})`);
  await one.unmount();
  console.log('✓ Nova: an empty inbox is an empty state with counts of zero');
}

async function main(): Promise<void> {
  const win = installDom();
  // The search is a router state change, so React hands its default-prevented submit to `new FormData(form)`, and Node's
  // FormData does not take a happy-dom form.
  Object.defineProperty(globalThis, 'FormData', { value: win.FormData, configurable: true, writable: true });
  installFetchStub();

  const { default: NovaSubmissions } = await import('../src/pages/NovaSubmissions');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES } = await import('../src/lib/routes');

  // Behind the curator gate: a contributor never reaches the page.
  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/nova'), 'the /nova route');
  assert(route.curatorOnly === true, '/nova is curator-only');
  console.log('✓ Nova: its route is curator-only');

  // `jumpTo`: an in-app link to that URL beside the page, which changes the URL under it as Back or Forward does.
  const { Link } = await import('react-router-dom');
  const mountPage: MountPage = (user = curator, url = '/nova', jumpTo) =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <ConfirmProvider>
          <MemoryRouter initialEntries={[url]}>
            <NovaSubmissions user={user} />
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
  await filtersAndSearch(mountPage);
  await aSearchDropsTheHeldRows(mountPage);
  await theSearchBoxFollowsTheUrl(mountPage);
  await rowDetail(mountPage);
  await theEditor(mountPage);
  await aSaveThatFails(mountPage);
  await aSaveDoesNotStealFocus(mountPage);
  await fetchingSubscribers(mountPage);
  await verifyingTheChannel(mountPage);
  await aFetchLandsWhileEditing(mountPage);
  await aFieldEditedWhileTheFetchIsOutKeepsTheEdit(mountPage);
  await aReviewLandsWhileEditing(mountPage);
  await aVerificationLandsWhileEditing(mountPage);
  await aFieldBothSidesChangedKeepsTheCurators(mountPage);
  await aReloadLandsWhileEditing(mountPage);
  await aSaveShowsWhatWasStored(mountPage);
  await anUntouchedThemeIsNotSent(mountPage);
  await approvingFromTheRow(mountPage);
  await rejectingFromTheRow(mountPage);
  await reviewingFromTheCard(mountPage);
  await aNoteOutlivesItsRow(mountPage);
  await aRefusedRequest(mountPage);
  await deletingARow(mountPage);
  await deletingFromTheCard(mountPage);
  await focusIsNeverStolen(mountPage);
  await aDeleteDoesNotStealFocus(mountPage);
  await aDeleteLandsAfterAFilterChange(mountPage);
  await aDeleteLandsAfterTheRowsRemounted(mountPage);
  await twoSubmissionsInFlight(mountPage);
  await theFilterChangesMidRequest(mountPage);
  await fetchingEveryChannel(mountPage);
  await contributorView(mountPage);
  await loadFailure(mountPage);
  await emptyList(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  const source = readFileSync(new URL('../src/pages/NovaSubmissions.tsx', import.meta.url), 'utf8');
  assertNoRawColour(source, 'the page source');
  assert(source.includes('hover:bg-row-hover'), 'a row takes its hover from the row-hover token');
  console.log('✓ Nova: no raw palette class and no arbitrary hex, in the markup or the source; a row hovers with the row-hover token');
}

await main();
