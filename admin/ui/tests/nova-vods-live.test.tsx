/**
 * The Nova VODs inbox on the studio kit (spec §8.9), mounted live the way App.tsx mounts every page (a
 * ToastProvider and a ConfirmProvider around it) against a stubbed fetch: the header and its count pills, the
 * toolbar, the streamer groups and the timeline, a row's summary and its detail, what an approval, a
 * rejection and a delete do (the control that is busy, the confirm, the toast, where the focus goes), a request
 * the worker refuses, two rows with a request out at once, a failed load and an empty list. tests/nova-vod-row
 * renders one row with no providers at all, tests/inbox-counts pins the requests an action makes for the
 * sidebar's badge, and tests/row-drafts the notes that outlive a row.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser, NovaStatus, NovaVodSong, NovaVodSubmission } from '../../shared/types';
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

/** The kit's focus ring for a control that spans a clipping card edge to edge: inside it (FindingsPanel's INSET_FOCUS). */
const INSET_FOCUS = 'focus-visible:shadow-[inset_0_0_0_2px_var(--accent-fg)]';

// --- Fixtures ---

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

const THIS_YEAR = new Date().getFullYear();

interface VodFields {
  id: string;
  slug: string;
  title: string;
  status: NovaStatus;
  submittedAt: string;
  date?: string;
  thumbnail?: string;
  note?: string;
  reviewerNote?: string;
  reviewedAt?: string | null;
}

function vod(fields: VodFields): NovaVodSubmission {
  const videoId = `vid-${fields.id.slice(2)}`;
  return {
    id: fields.id,
    streamer_slug: fields.slug,
    video_id: videoId,
    video_url: `https://www.youtube.com/watch?v=${videoId}`,
    stream_title: fields.title,
    stream_date: fields.date ?? '2026-03-01',
    thumbnail_url: fields.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    submitter_note: fields.note ?? '',
    status: fields.status,
    submitted_at: fields.submittedAt,
    reviewed_at: fields.reviewedAt ?? null,
    reviewer_note: fields.reviewerNote ?? '',
  };
}

// Stored times are UTC ("YYYY-MM-DD HH:MM:SS"), as D1 writes them. The first is from this year, the rest are not.
const KARAOKE = vod({
  id: 'v-karaoke',
  slug: 'mizuki',
  title: 'Karaoke night',
  status: 'pending',
  submittedAt: `${THIS_YEAR}-03-04 09:30:00`,
  note: 'Please check\nthe times',
});
const BIRTHDAY = vod({
  id: 'v-birthday',
  slug: 'mizuki',
  title: 'Birthday stream',
  status: 'pending',
  submittedAt: '2020-01-02 10:00:00',
});
const LATE = vod({
  id: 'v-late',
  slug: 'aozora',
  title: 'Late night songs',
  status: 'pending',
  submittedAt: '2020-03-03 10:00:00',
  date: '',
  thumbnail: '',
});
const MORNING = vod({
  id: 'v-morning',
  slug: 'aozora',
  title: 'Morning chat',
  status: 'approved',
  submittedAt: '2020-03-02 08:00:00',
  reviewedAt: '2020-03-05T10:00:00.000Z',
  reviewerNote: 'Fine as it is',
});
const OLD = vod({
  id: 'v-old',
  slug: 'hoshi',
  title: 'Old collab',
  status: 'rejected',
  submittedAt: '2020-02-01 08:00:00',
  reviewerNote: 'Wrong streamer',
});
// As the worker lists them; the page groups them by streamer, newest submission first.
const VODS = [KARAOKE, BIRTHDAY, LATE, MORNING, OLD];
/** Pending first by streamer, as the default view shows them: mizuki's two, then aozora's one. */
const PENDING_TITLES = 'Karaoke night|Birthday stream|Late night songs';

const SONGS: NovaVodSong[] = [
  {
    id: 's-1',
    vod_submission_id: 'v-karaoke',
    song_title: 'Secret Base',
    original_artist: 'ZONE',
    start_timestamp: 65,
    end_timestamp: 310,
    sort_order: 0,
  },
  {
    id: 's-2',
    vod_submission_id: 'v-karaoke',
    song_title: 'Lemon',
    original_artist: '',
    start_timestamp: 3725,
    end_timestamp: null,
    sort_order: 1,
  },
];

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

const defaultListReply = (): Reply => ok({ data: VODS, total: VODS.length });

/** What the worker answers a detail request: the VOD with its songs (Karaoke night has two). */
const defaultDetailReply = (_call: Call, id: string): Reply => {
  const target = VODS.find((row) => row.id === id);
  if (target === undefined) return failure(404, 'VOD not found');
  return ok({ ...target, songs: id === 'v-karaoke' ? SONGS : [] });
};

/** What the worker answers a status change: the VOD, in the status that was asked for. */
const defaultStatusReply = (call: Call, id: string): Reply => {
  const target = VODS.find((row) => row.id === id);
  if (target === undefined) return failure(404, 'VOD not found');
  const status = (call.body as { status: NovaStatus }).status;
  return ok({ ...target, status, reviewed_at: status === 'pending' ? null : '2026-09-02T10:00:00.000Z' });
};

const defaultDeleteReply = (): Reply => ok({ ok: true });

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let listReply: (call: Call) => Reply | Promise<Reply> = defaultListReply;
let detailReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultDetailReply;
let statusReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultStatusReply;
let deleteReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultDeleteReply;

function reset(): void {
  calls.length = 0;
  listReply = defaultListReply;
  detailReply = defaultDetailReply;
  statusReply = defaultStatusReply;
  deleteReply = defaultDeleteReply;
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
      const statusId = /^\/api\/nova\/vods\/([^/]+)\/status$/.exec(url.pathname)?.[1];
      const oneId = /^\/api\/nova\/vods\/([^/]+)$/.exec(url.pathname)?.[1];
      let reply: Reply | Promise<Reply> | undefined;
      if (method === 'GET' && url.pathname === '/api/nova/vods') reply = listReply(call);
      else if (method === 'GET' && oneId !== undefined) reply = detailReply(call, decodeURIComponent(oneId));
      else if (method === 'PATCH' && statusId !== undefined) reply = statusReply(call, decodeURIComponent(statusId));
      else if (method === 'DELETE' && oneId !== undefined) reply = deleteReply(call, decodeURIComponent(oneId));
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

const listCalls = (): Call[] => calls.filter((call) => call.method === 'GET' && call.path === '/api/nova/vods');
const detailCalls = (): Call[] => calls.filter((call) => call.method === 'GET' && call.path !== '/api/nova/vods');
const statusCalls = (): Call[] => calls.filter((call) => call.method === 'PATCH');
const deleteCalls = (): Call[] => calls.filter((call) => call.method === 'DELETE');

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
    container.querySelector<HTMLElement>('[role="group"][aria-labelledby="nova-vod-status-filter-label"]'),
    'the status filter',
  );
}

function viewGroup(container: HTMLElement): HTMLElement {
  return need(container.querySelector<HTMLElement>('[role="group"][aria-label="View"]'), 'the view toggle');
}

function streamerSelect(container: HTMLElement): HTMLSelectElement {
  return need(container.querySelector<HTMLSelectElement>('select'), 'the streamer filter');
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
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls^="nova-vod-details-"]')];
}

function titles(container: HTMLElement): string {
  return nameButtons(container)
    .map((button) => textOf(button))
    .join('|');
}

function nameOf(container: HTMLElement, title: string): HTMLButtonElement {
  return need(
    nameButtons(container).find((button) => textOf(button) === title),
    `the name button of ${title}`,
  );
}

function summaryOf(container: HTMLElement, title: string): HTMLTableRowElement {
  return need(nameOf(container, title).closest('tr'), `the summary row of ${title}`);
}

function detailsOf(id: string): HTMLElement | null {
  return document.getElementById(`nova-vod-details-${id}`);
}

function groupButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls^="nova-vod-group-"]')];
}

function groupButton(container: HTMLElement, slug: string): HTMLButtonElement {
  return need(
    container.querySelector<HTMLButtonElement>(`button[aria-controls="nova-vod-group-${slug}"]`),
    `the ${slug} group header`,
  );
}

/** A quick action of a collapsed row: its icon button, named by what it does. */
function quick(container: HTMLElement, title: string, label: string): HTMLButtonElement {
  return need(labelled(summaryOf(container, title), label), `the ${label} button of ${title}`);
}

function noteBox(container: HTMLElement): HTMLTextAreaElement {
  return need(container.querySelector<HTMLTextAreaElement>('textarea'), 'a reviewer note box');
}

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"]');
}

function confirmDialog(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('dialog[open]');
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

/** The header's count row: the VOD and VTuber totals, then a pill per status. */
function countsOf(container: HTMLElement): string {
  return textOf(pageHeader(container).querySelector('h1')?.parentElement?.children[2]);
}

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user?: AuthUser) => Promise<Mounted>;

async function focus(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
  });
}

async function expand(container: HTMLElement, title: string): Promise<void> {
  await click(nameOf(container, title), `the name button of ${title}`);
}

/** Picks `value` in a (React-controlled) select the way a user does: through the value setter, then a `change`. */
async function selectOption(select: HTMLSelectElement, value: string): Promise<void> {
  let setValue: ((next: string) => void) | undefined;
  for (let proto: object | null = Object.getPrototypeOf(select); proto && !setValue; proto = Object.getPrototypeOf(proto)) {
    setValue = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  }
  await act(async () => {
    if (setValue) setValue.call(select, value);
    else select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

/** The pressed chip of the status group: where the focus goes when a delete leaves no row to go to. */
function statusChipInEffect(container: HTMLElement): HTMLButtonElement {
  return need(
    statusGroup(container).querySelector<HTMLButtonElement>('button[aria-pressed="true"]'),
    'the status chip in effect',
  );
}

// --- Scenarios ---

async function firstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const first = held();
  listReply = () => first.reply;
  const { container, unmount } = await mountPage();

  // One request on mount: the whole list, for no streamer in particular (the inboxes are site-wide).
  assert(calls.length === 1 && listCalls().length === 1, 'mounting asks for the list once and for nothing else');
  const initial = need(listCalls()[0], 'the list request');
  assert(!initial.params.has('streamer'), 'the list is the unfiltered, site-wide one');

  // The header is there before any data, with the crumb and the title and nothing else to show yet.
  const header = pageHeader(container);
  const root = need(container.firstElementChild as HTMLElement | null, 'a page root');
  assert(root.firstElementChild === header, 'the header is the page first child, so it sticks to <main>');
  assert(!/overflow|blur|transform|filter/.test(root.className), 'the page root has no blur, transform or overflow');
  const gutter = need(root.children[1], 'the page gutter');
  assert(
    gutter.classList.contains('p-4') && gutter.classList.contains('lg:px-5'),
    'the studio frame gives a page no gutter of its own, so the page brings it',
  );
  assert(!container.innerHTML.includes('legacy-frame'), 'the page renders in no legacy frame');
  assert(container.querySelectorAll('h1').length === 1, 'the page has exactly one <h1>');
  assert(textOf(header.querySelector('h1')) === 'Nova VODs', 'the <h1> is "Nova VODs"');
  assert(textOf(header) === 'INBOXNova VODs', `an unloaded header holds the crumb and the title only (got ${textOf(header)})`);

  // The toolbar, under the header, before any data too: the status chips behind a visible label, the view
  // toggle and the streamer filter (its label is for assistive technology alone).
  const status = statusGroup(container);
  const view = viewGroup(container);
  const select = streamerSelect(container);
  assert(!header.contains(status) && !header.contains(view) && !header.contains(select), 'the filters are in the page, not in the header');
  const toolbar = need(status.parentElement, 'the toolbar');
  assert(toolbar.contains(view) && toolbar.contains(select), 'one toolbar row holds the chips, the view toggle and the streamer filter');
  const statusLabel = need(status.querySelector('#nova-vod-status-filter-label'), 'the status label');
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
  const viewButtons = [...view.querySelectorAll('button')];
  assert(
    viewButtons.map((button) => textOf(button)).join('|') === 'By VTuber|Timeline' &&
      viewButtons.map((button) => button.getAttribute('aria-pressed')).join('|') === 'true|false' &&
      viewButtons.every((button) => button.querySelector('svg') !== null),
    'the view toggle: By VTuber in effect, then Timeline, each with its icon',
  );
  const selectLabel = need(container.querySelector(`label[for="${select.id}"]`), 'the streamer filter label');
  assert(
    selectLabel.classList.contains('sr-only') && textOf(selectLabel) === 'Filter VOD submissions by streamer',
    'the streamer filter keeps its label for assistive technology',
  );
  assert(
    [...select.options].map((option) => `${option.value}=${textOf(option)}`).join('|') === '=All streamers',
    'with no VOD loaded the streamer filter offers All streamers',
  );

  // A skeleton until the first response, and no list, no empty notice and no counts behind it.
  const skeleton = need(container.querySelector('[role="status"]'), 'a skeleton while the first load is out');
  assert(textOf(skeleton) === 'Loading VODs…', 'the skeleton says what is loading');
  assert(nameButtons(container).length === 0 && groupButtons(container).length === 0, 'no rows before the first response');
  assert(!container.innerHTML.includes('No VOD submissions found.'), 'an unanswered list is not an empty one');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok({ data: VODS, total: VODS.length }));
  assert(container.querySelector('[role="status"]') === null, 'the response ends the loading state');
  assert(listCalls().length === 1, 'nothing else is requested once the page has loaded');

  // The counts count every VOD, whatever the filters keep: the totals, then one pill per status.
  const counts = need(header.querySelector('h1')?.parentElement?.children[2], 'the count row under the title');
  assert(
    textOf(counts) === '5 VODs · 3 VTubers3 Pending1 Approved1 Rejected',
    `the header counts the VODs and the VTubers, then the statuses (got ${textOf(counts)})`,
  );
  const pills = [...counts.querySelectorAll('span')].filter((span) => span.className.includes('rounded-radius-pill'));
  assert(
    pills.map((pill) => (pill.className.includes('bg-tone-warn-bg') ? 'warn' : pill.className.includes('bg-tone-ok-bg') ? 'ok' : pill.className.includes('bg-tone-danger-bg') ? 'danger' : '?')).join('|') ===
      'warn|ok|danger',
    'Pending is a warn pill, Approved an ok one, Rejected a danger one: the tones of the row pills',
  );
  assert(
    [...select.options].map((option) => option.value).join('|') === '|aozora|hoshi|mizuki',
    'the streamer filter lists every streamer with a VOD, alphabetically',
  );

  // The groups: the streamers with a pending VOD, the one with the newest submission first.
  const groups = groupButtons(container);
  assert(
    groups.map((button) => textOf(button)).join('|') === 'mizuki2 VODs2 pending|aozora1 VOD1 pending',
    `a card per streamer in the Pending view (got ${groups.map((button) => textOf(button)).join('|')})`,
  );
  const mizuki = groupButton(container, 'mizuki');
  assert(
    mizuki.getAttribute('aria-expanded') === 'true' && mizuki.getAttribute('aria-controls') === 'nova-vod-group-mizuki',
    'a group with a pending VOD starts open, and names the body it opens',
  );
  const avatar = need(mizuki.querySelector('span[aria-hidden="true"]'), 'the group avatar');
  assert(
    avatar.className.includes('bg-accent') && avatar.className.includes('h-12') && avatar.querySelector('svg') !== null,
    'the avatar is a 48 px accent tile with its glyph: a streamer has no image here',
  );
  const groupPills = [...mizuki.querySelectorAll('span')].filter((span) => span.className.includes('rounded-radius-pill'));
  assert(
    groupPills.map((pill) => textOf(pill)).join('|') === '2 VODs|2 pending' &&
      groupPills[0]?.className.includes('bg-tone-neutral-bg') === true &&
      groupPills[1]?.className.includes('bg-tone-warn-bg') === true,
    'a neutral "N VODs" pill, then a warn "N pending" one',
  );
  const card = need(mizuki.closest('.glass-card'), 'a glass card around the group');
  const body = need(document.getElementById('nova-vod-group-mizuki'), 'the group body');
  assert(card.contains(body) && body.className.includes('border-line-soft'), 'the table sits in its group card, under a hairline');
  // The card clips what falls outside it and its header spans it edge to edge, so the header's focus ring is the
  // kit's inset one: an outer ring is cut away (which happy-dom, with no layout, cannot show: the classes are the pin).
  assert(card.className.includes('overflow-clip'), 'the card clips what falls outside it');
  assert(
    groupButtons(container).every((header) => header.className.includes(INSET_FOCUS) && !header.className.includes('shadow-focus')),
    'every card header draws its focus ring inside the card, as the kit does for a control that spans a clipping card',
  );

  // The table: native, one <tbody> a row, a head row in the kit's head style, and it scrolls inside its card.
  const table = need(body.querySelector('table'), 'the group table');
  assert(table.getAttribute('aria-label') === 'VOD submissions for mizuki', 'the table is named for its streamer');
  assert(table.className.includes('min-w-[820px]'), 'the table keeps its minimum width');
  const scroller = need(table.closest('.overflow-x-auto'), 'the scroller around the table');
  assert(card.contains(scroller), 'and scrolls inside its card');
  assert(scroller.className.includes('[container-type:inline-size]'), 'the scroller is a size container, for the detail below 1024 px');
  const heads = [...table.querySelectorAll('thead th')];
  assert(
    heads.map((head) => textOf(head)).join('|') === 'Thumbnail|VOD|Songs|Status|Submitted|Actions|Details' &&
      heads.every((head) => head.getAttribute('scope') === 'col'),
    'seven column heads',
  );
  assert(
    heads.filter((head) => head.querySelector('.sr-only') !== null).map((head) => textOf(head)).join('|') === 'Thumbnail|Actions|Details',
    'three of them (thumbnail, actions, details) are for assistive technology alone',
  );
  assert(
    heads.filter((head) => head.querySelector('.sr-only') === null).every((head) => head.className.includes(MICRO_LABEL)),
    'the visible heads wear the kit head label',
  );
  assert(table.querySelectorAll('tbody').length === 2, 'one <tbody> per row');
  assert(
    [...table.querySelectorAll('tbody')].every((rows) => rows.querySelector('tr')?.querySelectorAll(':scope > td').length === 7),
    'a summary row of seven cells',
  );

  // The rows: the pending VODs, in the server's order within their streamers.
  assert(titles(container) === PENDING_TITLES, `the rows are the pending VODs (got ${titles(container)})`);

  // Each row: thumbnail, the title (a button), "video id · date", songs, status, submitted, quick actions.
  const karaoke = summaryOf(container, 'Karaoke night');
  assert(karaoke.className.includes('hover:bg-row-hover'), 'a row takes its hover from the row-hover token');
  const cells = [...karaoke.querySelectorAll(':scope > td')];
  assert(
    need(cells[0]?.querySelector('img'), 'the thumbnail').getAttribute('src') === 'https://i.ytimg.com/vi/vid-karaoke/hqdefault.jpg',
    'the thumbnail is the YouTube one',
  );
  const name = nameOf(container, 'Karaoke night');
  assert(
    name.getAttribute('aria-label') === '展開 Karaoke night' &&
      name.getAttribute('aria-expanded') === 'false' &&
      name.getAttribute('aria-controls') === 'nova-vod-details-v-karaoke',
    'the title is the accessible toggle: collapsed, naming the detail it opens (the Chinese label stays)',
  );
  const link = need(cells[1]?.querySelector('a'), 'the video link');
  assert(
    textOf(link) === 'vid-karaoke' &&
      link.getAttribute('href') === 'https://www.youtube.com/watch?v=vid-karaoke' &&
      link.getAttribute('target') === '_blank' &&
      link.getAttribute('rel') === 'noopener noreferrer',
    'the video id links to the video, in a new tab',
  );
  assert(textOf(cells[1]).includes('2026-03-01'), "the stream's own date reads as it is");
  assert(textOf(cells[2]) === '—', 'the songs cell is a dash until the detail is open');
  assert(textOf(cells[3]) === 'Pending' && need(cells[3]?.querySelector('span'), 'the status pill').className.includes(TONE_BOX_CLASS.warn), 'a Pending VOD is a warn pill');
  const when = need(cells[4]?.querySelector('time'), 'the submitted time');
  assert(
    when.getAttribute('datetime') === storedTimeIso(KARAOKE.submitted_at) &&
      when.getAttribute('title') === formatFullTime(KARAOKE.submitted_at) &&
      textOf(when) === formatWhen(KARAOKE.submitted_at, new Date()),
    'the submitted time is a <time>: the exact instant, the full time on hover, the short form',
  );
  assert(
    [...(cells[5]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Approve|Reject|Delete',
    'a pending VOD offers Approve, Reject and Delete, each named for what it does',
  );
  assert(
    need(labelled(karaoke, 'Approve'), 'Approve').className.includes('text-tone-ok-fg') &&
      need(labelled(karaoke, 'Delete'), 'Delete').className.includes('text-tone-danger-fg'),
    'Approve is an ok icon button and Delete a danger one',
  );
  assert(
    cells[6]?.querySelector('button')?.getAttribute('aria-hidden') === 'true' && cells[6]?.querySelector('button')?.getAttribute('tabindex') === '-1',
    'the chevron is a mouse-only duplicate of the title: hidden from assistive technology and out of the tab order',
  );

  // A VOD with no date says so, and one with no thumbnail shows a tile.
  const late = summaryOf(container, 'Late night songs');
  const noDate = [...late.querySelectorAll('span')].find((span) => textOf(span) === 'No date');
  assert(noDate !== undefined && noDate.className.includes('text-tone-warn-fg'), 'a VOD with no date says "No date" in the warn colour');
  const lateTile = need(late.querySelector(':scope > td'), 'the thumbnail cell');
  assert(lateTile.querySelector('img') === null && lateTile.querySelector('svg') !== null, 'a VOD with no thumbnail shows a film tile instead');
  assertNoRawColour(container.innerHTML, 'the loaded page');

  await unmount();
  console.log('✓ Nova VODs: header and counts, toolbar, skeleton, streamer groups and their tables, and rows');
}

async function filtersAndViews(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const status = statusGroup(container);
  const select = streamerSelect(container);

  // All: every status. The rejected streamer's group has nothing pending, so it starts closed.
  await click(chip(status, 'All'), 'the All chip');
  assert(titles(container) === 'Karaoke night|Birthday stream|Late night songs|Morning chat', `All shows every open group's rows (got ${titles(container)})`);
  assert(pressed(status) === 'All', 'the chip in effect follows');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'mizuki2 VODs2 pending|aozora2 VODs1 pending|hoshi1 VODAll reviewed',
    'each group counts what the filter keeps; a group with nothing pending says "All reviewed"',
  );
  const hoshi = groupButton(container, 'hoshi');
  assert(hoshi.getAttribute('aria-expanded') === 'false' && document.getElementById('nova-vod-group-hoshi') === null, 'a group with nothing pending starts closed');
  assert(
    need([...hoshi.querySelectorAll('span')].find((span) => textOf(span) === 'All reviewed'), 'the All reviewed pill').className.includes('bg-tone-ok-bg'),
    '"All reviewed" is an ok pill',
  );
  await click(hoshi, 'the hoshi group header');
  assert(hoshi.getAttribute('aria-expanded') === 'true' && titles(container).endsWith('Old collab'), 'a closed group opens on a press, and shows its row');
  await click(hoshi, 'the hoshi group header');
  assert(hoshi.getAttribute('aria-expanded') === 'false' && !titles(container).includes('Old collab'), 'and closes on the next');
  const mizuki = groupButton(container, 'mizuki');
  await click(mizuki, 'the mizuki group header');
  assert(mizuki.getAttribute('aria-expanded') === 'false' && titles(container) === 'Late night songs|Morning chat', 'an open group closes, and its rows leave');
  await click(mizuki, 'the mizuki group header');

  // Approved and Rejected: no group has a pending VOD, so every group starts closed; a press opens it.
  await click(chip(status, 'Approved'), 'the Approved chip');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'aozora1 VODAll reviewed' && titles(container) === '',
    "Approved shows the approved VOD's group, closed",
  );
  await click(groupButton(container, 'aozora'), 'the aozora group header');
  assert(titles(container) === 'Morning chat', 'which opens on a press');
  const morning = [...summaryOf(container, 'Morning chat').querySelectorAll(':scope > td')];
  assert(
    textOf(morning[3]).startsWith('Approved') && need(morning[3]?.querySelector('span'), 'the status pill').className.includes(TONE_BOX_CLASS.ok),
    'an Approved VOD is an ok pill',
  );
  assert(
    [...(morning[5]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Revert to Pending|Delete',
    'a reviewed VOD offers Revert to Pending and Delete',
  );
  await click(chip(status, 'Rejected'), 'the Rejected chip');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'hoshi1 VODAll reviewed' && titles(container) === '',
    "Rejected shows the rejected VOD's group, closed",
  );

  // The streamer filter narrows every status; the two filters combine.
  await click(chip(status, 'All'), 'the All chip');
  await selectOption(select, 'aozora');
  assert(groupButtons(container).map((button) => textOf(button)).join('|') === 'aozora2 VODs1 pending', 'the streamer filter keeps one streamer');
  assert(titles(container) === 'Late night songs|Morning chat', 'and its rows');
  await click(chip(status, 'Approved'), 'the Approved chip');
  assert(titles(container) === 'Morning chat', 'the two filters combine (the group stays open, as it was opened)');

  // Nothing matches: the empty state, with the filters still there to change.
  await selectOption(select, 'mizuki');
  assert(nameButtons(container).length === 0 && groupButtons(container).length === 0, 'no VOD matches an approved mizuki VOD');
  assert(textOf(container.querySelector('h4')) === 'No VOD submissions found.', 'the list says so, in the empty state');
  assert(statusGroup(container).isConnected && streamerSelect(container).isConnected, 'the filters stay');
  assert(container.querySelector('[role="status"]') === null && alertOf(container) === null, 'with no skeleton and no alert');

  // The timeline: one table of every row, each carrying its streamer; the view toggle moves back and forth.
  await selectOption(select, '');
  await click(chip(status, 'All'), 'the All chip');
  const view = viewGroup(container);
  await click(chip(view, 'Timeline'), 'the Timeline button');
  assert(pressed(view) === 'Timeline', 'the view in effect follows');
  assert(container.querySelectorAll('table').length === 1, 'the timeline is one table');
  const timeline = need(container.querySelector('table'), 'the timeline table');
  assert(
    timeline.getAttribute('aria-label') === 'VOD submissions' && timeline.className.includes('min-w-[820px]') && timeline.closest('.overflow-x-auto') !== null,
    'named for the whole list, as wide as a group table, scrolling inside its card',
  );
  assert(timeline.closest('.glass-card') !== null && groupButtons(container).length === 0, 'in one glass card, with no group headers');
  assert(titles(container) === 'Karaoke night|Birthday stream|Late night songs|Morning chat|Old collab', 'every VOD, in the server order');
  const slugs = [...timeline.querySelectorAll('tbody')].map((rows) => rows.querySelector('span.font-mono')?.textContent ?? '');
  assert(slugs.join('|') === 'mizuki|mizuki|aozora|aozora|hoshi', `each row names its streamer (got ${slugs.join('|')})`);
  await click(chip(view, 'By VTuber'), 'the By VTuber button');
  assert(container.querySelectorAll('table').length === 2, "back to a table per open group (hoshi's is closed)");

  // The header counts the whole list, not what the filters keep; and none of it asks the worker again.
  assert(countsOf(container) === '5 VODs · 3 VTubers3 Pending1 Approved1 Rejected', 'the counts ignore the filters');
  assert(listCalls().length === 1 && calls.length === 1, "filtering is the browser's work: no further request");
  assertNoRawColour(container.innerHTML, 'the filtered pages');

  await unmount();
  console.log('✓ Nova VODs: the status, streamer and view filters combine in the browser; groups open and close; an empty result is an empty state');
}

async function rowDetail(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const name = nameOf(container, 'Karaoke night');

  await click(name, 'the name button');
  assert(name.getAttribute('aria-expanded') === 'true' && name.getAttribute('aria-label') === '收合 Karaoke night', 'the row opens, and its label turns to collapse (the Chinese label stays)');
  const details = need(detailsOf('v-karaoke'), 'the detail the row controls');
  assert(name.getAttribute('aria-controls') === details.id, 'the title controls it');
  assert(
    details.tagName === 'TD' && details.getAttribute('colspan') === '7' && details.closest('tr')?.parentElement?.tagName === 'TBODY',
    'the detail is one cell across the row group',
  );
  assert(need(name.closest('tbody'), 'the row group').classList.contains('bg-selected'), 'an open row wears the selected-row tint');
  assert(name.classList.contains('text-accent-fg'), 'and its title the accent');
  assert(detailCalls().length === 1 && need(detailCalls()[0], 'the detail request').path === '/api/nova/vods/v-karaoke', 'opening a VOD asks for its songs, once');
  assert(listCalls().length === 1, 'and nothing else');
  assert(summaryOf(container, 'Karaoke night').querySelector('button[aria-label="Approve"]') === null, 'the quick actions give way to the review card while it is open');

  // Left: the thumbnail and the fields, a kit detail list.
  assert(
    details.className.includes('grid-cols-1') &&
      details.className.includes('lg:grid-cols-[240px_minmax(0,1fr)]') &&
      details.className.includes('xl:grid-cols-[240px_minmax(0,1fr)_320px]'),
    'the detail is one column below 1024 px, two from there up and three from 1280 px',
  );
  assert(details.className.includes(' sticky left-0 w-[100cqw] '), 'and as wide as the scroller shows, pinned to its left edge');
  const left = need(details.children[0], 'the details column');
  assert(need(left.querySelector('img'), 'the thumbnail').getAttribute('src') === 'https://i.ytimg.com/vi/vid-karaoke/hqdefault.jpg', 'with the thumbnail');
  const fields = [...left.querySelectorAll('dl > div')];
  assert(
    fields.map((field) => textOf(field.querySelector('dt'))).join('|') === 'Video URL|Stream Title|Stream Date|Submitter Note|Reviewer Note|Reviewed At',
    'the fields: Video URL, Stream Title, Stream Date, Submitter Note, Reviewer Note, Reviewed At',
  );
  const valueOf = (label: string) => need(fields.find((field) => textOf(field.querySelector('dt')) === label)?.querySelector('dd'), `the ${label} value`);
  const videoUrl = need(valueOf('Video URL').querySelector('a'), 'the video link');
  assert(videoUrl.getAttribute('href') === KARAOKE.video_url && videoUrl.getAttribute('target') === '_blank', 'the video URL is a link in a new tab');
  assert(textOf(valueOf('Stream Title')) === 'Karaoke night' && textOf(valueOf('Stream Date')) === '2026-03-01', 'the title and the stream date as they are');
  assert(valueOf('Submitter Note').textContent === 'Please check\nthe times', 'the submitter note keeps its line break');
  assert(
    textOf(valueOf('Reviewer Note')) === '—' && textOf(valueOf('Reviewed At')) === '—',
    'a field with no value reads as a dash',
  );

  // Middle: the songs the detail request returned.
  const songs = need(details.children[1], 'the songs column');
  const songRows = [...songs.children].slice(1);
  assert(textOf(songs.children[0]).includes('Songs · 2'), 'the song list says how many songs there are');
  assert(
    songRows.map((row) => textOf(row)).join('|') === '1Secret BaseZONE1:055:10|2Lemon—1:02:05—',
    `each song with its artist (a dash if none), start and end (got ${songRows.map((row) => textOf(row)).join('|')})`,
  );
  assert(songRows.every((row) => row.className.includes('hover:bg-row-hover')), 'a song row takes the row-hover token');
  const songsCell = need(summaryOf(container, 'Karaoke night').querySelectorAll(':scope > td')[2], 'the songs cell');
  assert(
    textOf(songsCell) === '2 songs' && need(songsCell.querySelector('span'), 'the songs pill').className.includes(TONE_BOX_CLASS.neutral),
    "the row's songs cell is a neutral \"N songs\" pill once they are loaded",
  );

  // Right: the review card of a pending VOD.
  const review = need(details.children[2], 'the review card');
  assert(review.classList.contains('glass-card'), 'a glass card');
  assert(
    review.classList.contains('lg:col-span-2') && review.classList.contains('xl:col-span-1'),
    'which spans both columns from 1024 px and is the third column from 1280 px',
  );
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
  assertNoRawColour(container.innerHTML, 'the opened VOD');

  // Closing and opening again asks for nothing (the songs are held), and only one row is open at a time.
  await click(name, 'the name button');
  assert(detailsOf('v-karaoke') === null && name.getAttribute('aria-expanded') === 'false', 'a second press closes it');
  await click(name, 'the name button');
  assert(detailCalls().length === 1, 'opening it again asks for nothing: the songs are already loaded');
  await expand(container, 'Birthday stream');
  assert(detailsOf('v-karaoke') === null && detailsOf('v-birthday') !== null, 'opening another closes the first');
  assert(detailCalls().length === 2, 'and loads its songs');
  const second = need(detailsOf('v-birthday'), 'the second detail');
  assert(textOf(second).includes('No song timestamps submitted.'), 'a VOD with no songs says so');
  assert(textOf(need(second.querySelectorAll('dd')[2], 'its date')) === '2026-03-01', 'and has its own fields');
  assert(textOf(need(second.querySelectorAll('dd')[3], 'its submitter note')) === '—', 'a VOD with no submitter note reads a dash');
  assert(textOf(summaryOf(container, 'Birthday stream').querySelectorAll(':scope > td')[2]) === '—', 'its songs cell stays a dash');

  // The chevron is a mouse-only duplicate: it toggles too.
  const chevron = need(summaryOf(container, 'Birthday stream').querySelector<HTMLButtonElement>('button[aria-hidden="true"]'), 'the chevron');
  await click(chevron, 'the chevron');
  assert(detailsOf('v-birthday') === null, 'a press on the chevron closes the row');

  // A reviewed VOD: its fields, its reviewed time, and a card with Revert and Delete only.
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  await expand(container, 'Morning chat');
  const reviewed = need(detailsOf('v-morning'), 'the reviewed VOD detail');
  const reviewedFields = [...reviewed.querySelectorAll('dl > div')];
  const reviewedAt = need(reviewedFields.find((field) => textOf(field.querySelector('dt')) === 'Reviewed At')?.querySelector('time'), 'the reviewed time');
  assert(
    reviewedAt.getAttribute('datetime') === storedTimeIso(MORNING.reviewed_at ?? '') && reviewedAt.getAttribute('title') === formatFullTime(MORNING.reviewed_at ?? ''),
    'Reviewed At is a <time> with the exact instant and the full time',
  );
  assert(
    textOf(reviewedFields.find((field) => textOf(field.querySelector('dt')) === 'Reviewer Note')?.querySelector('dd')) === 'Fine as it is',
    'and the reviewer note shows',
  );
  const reviewedCard = need(reviewed.children[2], 'the review card');
  assert(reviewedCard.querySelector('textarea') === null && textOf(reviewedCard).startsWith('Review'), 'a reviewed VOD asks for no note: its card is labelled Review');
  assert([...reviewedCard.querySelectorAll('button')].map((button) => textOf(button)).join('|') === 'Revert to Pending|Delete', 'with Revert to Pending and Delete');

  assert(statusCalls().length === 0 && deleteCalls().length === 0, 'none of it changed anything');
  await unmount();
  console.log('✓ Nova VODs: a row opens into its fields, its songs and its review card, one at a time, and asks for its songs once');
}

async function aSongListThatWillNotLoad(mountPage: MountPage): Promise<void> {
  reset();
  detailReply = () => failure(500, 'Detail store is down');
  const { container, unmount } = await mountPage();

  await expand(container, 'Birthday stream');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `a song list that will not load raises one toast (saw ${toasts.length})`);
  const refused = need(toasts[0], 'the toast');
  assert(refused.message === '無法載入歌曲清單', 'which says so in Chinese, as the page always has');
  assert(refused.detail === 'Detail store is down', "and carries the worker's reason");
  assert(refused.danger && refused.retry === null, 'an error toast with no Retry: opening the row again asks again');
  assert(alertOf(container) === null, 'and no line of its own on the page');
  const failedDetail = need(detailsOf('v-birthday'), 'the detail');
  assert(
    textOf(failedDetail).includes("Couldn't load the songs.") &&
      buttonNamed(failedDetail, 'Retry') !== null &&
      !textOf(failedDetail).includes('No song timestamps submitted.'),
    'the row stays open, its songs column saying they did not load, with a Retry: not that there are none',
  );

  // A row whose songs did not load asks again when it is opened again; with the worker back, the songs come.
  await click(nameOf(container, 'Karaoke night'), 'another row');
  assert(detailCalls().length === 2, 'another row asks for its own');
  detailReply = defaultDetailReply;
  await click(nameOf(container, 'Karaoke night'), 'the row, to close it');
  await click(nameOf(container, 'Karaoke night'), 'the row, to open it again');
  assert(detailCalls().length === 3, 'a row whose songs did not load asks again when it is opened again');
  assert(textOf(need(detailsOf('v-karaoke'), 'the detail')).includes('Secret Base'), 'and shows them');
  assert(unexpected.length === 0, 'no stray request');

  await unmount();
  console.log('✓ Nova VODs: a song list that will not load is an error toast with the worker\'s reason, and the row asks again when reopened');
}

/*
 * An open VOD's songs are loading (no list yet: that is not "none"), failed (a line that says so, with a Retry, beside
 * the toast), loaded with none (the one case that says there are none) or loaded with songs.
 */

async function songsStillLoadingSaySo(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const gate = held();
  detailReply = () => gate.reply;
  await expand(container, 'Karaoke night');
  const detail = need(detailsOf('v-karaoke'), 'the detail');
  assert(textOf(detail).includes('Loading songs…'), `while the request is out the songs column says they are loading (got "${textOf(detail.children[1])}")`);
  assert(!textOf(detail).includes('No song timestamps submitted.'), 'and not that there are none');
  await respond(gate, defaultDetailReply(need(detailCalls()[0], 'the request'), 'v-karaoke'));
  assert(textOf(need(detailsOf('v-karaoke'), 'the detail')).includes('Secret Base'), 'then the songs');

  await unmount();
  console.log('✓ Nova VODs: songs still loading say so, not that there are none');
}

async function songsThatFailedOfferARetry(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const name = nameOf(container, 'Karaoke night');

  // The request fails: the songs column says so, with a Retry, beside the toast (which keeps its reason).
  detailReply = () => failure(500, 'Detail store is down');
  await focus(name);
  await click(name, 'the name button');
  const failed = need(detailsOf('v-karaoke'), 'the detail');
  assert(
    textOf(failed).includes("Couldn't load the songs.") && !textOf(failed).includes('No song timestamps submitted.'),
    `the songs column says they could not be loaded, not that there are none (got "${textOf(failed.children[1])}")`,
  );
  const retry = need(buttonNamed(failed, 'Retry'), 'a Retry in the songs column');
  assert(retry.getAttribute('type') === 'button', 'a typed button');
  assert(toastsOf(container).some((toast) => toast.message === '無法載入歌曲清單'), 'and the toast still says why');

  // Retry loads them again. It gives way to the loading line, and the focus it held goes to the row's name button.
  const gate = held();
  detailReply = () => gate.reply;
  await focus(retry);
  await click(retry, 'Retry');
  assert(detailCalls().length === 2, 'Retry asks for the songs again');
  assert(
    !retry.isConnected && textOf(need(detailsOf('v-karaoke'), 'the detail')).includes('Loading songs…'),
    'the Retry gives way to the loading line',
  );
  assert(focused() === name, `the focus the Retry held goes to the row's name button, not to <body> (got ${focused()?.tagName})`);
  assert(name.getAttribute('aria-expanded') === 'true', 'and the row stays open');
  await respond(gate, defaultDetailReply(need(detailCalls()[1], 'the retried request'), 'v-karaoke'));
  assert(textOf(need(detailsOf('v-karaoke'), 'the detail')).includes('Secret Base'), 'the songs come');

  // A VOD loaded with no songs is the one that says there are none.
  detailReply = defaultDetailReply;
  await expand(container, 'Birthday stream');
  assert(textOf(need(detailsOf('v-birthday'), 'the detail')).includes('No song timestamps submitted.'), 'a VOD with no songs says so');
  assert(unexpected.length === 0, `no stray request (${unexpected.join(', ')})`);

  await unmount();
  console.log("✓ Nova VODs: songs that failed to load say so in their column with a Retry, which loads them and hands its focus to the name button");
}

async function approvingFromTheRow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const approve = quick(container, 'Karaoke night', 'Approve');
  const reject = quick(container, 'Karaoke night', 'Reject');
  const remove = quick(container, 'Karaoke night', 'Delete');
  const name = nameOf(container, 'Karaoke night');

  // Pressed on the keyboard, Approve sends the status and is busy while the worker answers.
  const answer = held();
  statusReply = () => answer.reply;
  await focus(approve);
  await click(approve, 'Approve');
  assert(statusCalls().length === 1, 'Approve sends one request');
  const sent = need(statusCalls()[0], 'the status request');
  assert(sent.path === '/api/nova/vods/v-karaoke/status', 'to the VOD');
  deepStrictEqual(sent.body, { status: 'approved' });
  assert(isBusy(approve), 'Approve is busy (aria-busy), not disabled');
  assert(approve.className.includes('animate-spin') && !remove.className.includes('animate-spin'), 'and it alone spins');
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
  assert(isBusy(quick(container, 'Karaoke night', 'Approve')), 'Approve is still busy when the row is closed again');

  await focus(quick(container, 'Karaoke night', 'Approve'));
  await respond(answer, ok({ ...KARAOKE, status: 'approved', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'VOD approved', detail: 'Karaoke night' }],
  );
  assert(!need(toastsOf(container)[0], 'the toast').danger, 'a toast of success, not of failure');
  const cells = [...summaryOf(container, 'Karaoke night').querySelectorAll(':scope > td')];
  assert(textOf(cells[3]).startsWith('Approved'), 'the VOD now reads Approved');
  assert(titles(container) === PENDING_TITLES, 'and stays in the Pending view until a filter changes');
  assert(countsOf(container) === '5 VODs · 3 VTubers2 Pending2 Approved1 Rejected', `the header counts follow (got ${countsOf(container)})`);
  assert(
    [...(cells[5]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Revert to Pending|Delete',
    'its quick actions are now Revert to Pending and Delete',
  );
  assert(
    focused() === name,
    `the focus that Approve held goes to the row's name button, not to <body> (got ${focused()?.tagName})`,
  );
  assert(statusCalls().length === 1 && listCalls().length === 1 && unexpected.length === 0, 'one request, and the list is patched in place');

  // Revert is the same call the other way, with its own toast; the focus hands off again.
  statusReply = defaultStatusReply;
  const revert = quick(container, 'Karaoke night', 'Revert to Pending');
  await focus(revert);
  await click(revert, 'Revert to Pending');
  deepStrictEqual(need(statusCalls()[1], 'the second request').body, { status: 'pending' });
  assert(messagesOf(container) === 'VOD approved|VOD reverted to pending', `Revert toasts too (got ${messagesOf(container)})`);
  assert(textOf([...summaryOf(container, 'Karaoke night').querySelectorAll(':scope > td')][3]).startsWith('Pending'), 'the VOD reads Pending again');
  assert(focused() === name, 'and the focus is on the name button again');

  await unmount();
  console.log('✓ Nova VODs: Approve and Revert are busy while out, toast what happened, and hand the focus to the name button');
}

async function rejectingFromTheRow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const reject = quick(container, 'Birthday stream', 'Reject');
  const name = nameOf(container, 'Birthday stream');

  // Reject sends the (empty) note; when it lands the same node turns into Delete, and the focus must not stay on it.
  await focus(reject);
  await click(reject, 'Reject');
  deepStrictEqual(need(statusCalls()[0], 'the status request').body, { status: 'rejected', reviewer_note: '' });
  assert(messagesOf(container) === 'VOD rejected', `a rejection toasts "VOD rejected" (got ${messagesOf(container)})`);
  assert(need(toastsOf(container)[0], 'the toast').detail === 'Birthday stream', 'naming the VOD');
  const after = [...summaryOf(container, 'Birthday stream').querySelectorAll(':scope > td')];
  assert(textOf(after[3]).startsWith('Rejected') && need(after[3]?.querySelector('span'), 'the status pill').className.includes(TONE_BOX_CLASS.danger), 'the VOD now reads Rejected, in the danger tone');
  assert(
    [...(after[5]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Revert to Pending|Delete',
    'it offers Revert to Pending and Delete',
  );
  assert(
    focused() === name && !(focused() instanceof HTMLElement && focused()?.getAttribute('aria-label') === 'Delete'),
    `the focus goes to the name button, not to the Delete control that took Reject's place (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova VODs: Reject toasts and hands the focus to the name button, not to the Delete that takes its place');
}

async function reviewingFromTheCard(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Birthday stream');
  const details = need(detailsOf('v-birthday'), 'the detail');
  const approve = need(buttonNamed(details, 'Approve'), 'Approve');
  const reject = need(buttonNamed(details, 'Reject'), 'Reject');
  const remove = need(buttonNamed(details, 'Delete'), 'Delete');
  const name = nameOf(container, 'Birthday stream');

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

  await respond(answer, ok({ ...BIRTHDAY, status: 'rejected', reviewer_note: 'Wrong streamer', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container) === 'VOD rejected', 'the rejection toasts');
  const card = need(need(detailsOf('v-birthday'), 'the detail').children[2], 'the review card');
  assert(card.querySelector('textarea') === null && buttonNamed(card, 'Revert to Pending') !== null, "the card turns to a reviewed VOD's: no note box, Revert to Pending");
  assert(buttonNamed(card, 'Reject') === null && !reject.isConnected, 'the Reject button is gone');
  assert(focused() === name, `the focus that Reject held goes to the row's name button (got ${focused()?.tagName})`);
  assert(
    textOf(need(detailsOf('v-birthday'), 'the detail').querySelectorAll('dd')[4]) === 'Wrong streamer',
    'the reviewer note is shown with the VOD',
  );

  // Revert from the card: the same card turns back, with an empty note box.
  statusReply = defaultStatusReply;
  const revert = need(buttonNamed(card, 'Revert to Pending'), 'Revert to Pending');
  await focus(revert);
  await click(revert, 'Revert to Pending');
  deepStrictEqual(need(statusCalls()[1], 'the second request').body, { status: 'pending' });
  assert(messagesOf(container) === 'VOD rejected|VOD reverted to pending', 'Revert toasts');
  assert(noteBox(container).value === '', "the note box is empty: the rejection used the note up");
  assert(focused() === name, 'and the focus is on the name button again');

  // Approve from the card sends no note.
  await click(need(buttonNamed(need(detailsOf('v-birthday'), 'the detail'), 'Approve'), 'Approve'), 'Approve');
  deepStrictEqual(need(statusCalls()[2], 'the third request').body, { status: 'approved' });
  assertNoRawColour(container.innerHTML, 'the page after its reviews');

  await unmount();
  console.log('✓ Nova VODs: the review card sends the note with a rejection, is busy while out, toasts and hands the focus to the name button');
}

async function aNoteOutlivesItsRow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Birthday stream');
  await typeInto(noteBox(container), 'Half-written reason');

  // Closing the group unmounts the row; the note is in the page's store and comes back with it.
  await click(groupButton(container, 'mizuki'), 'the mizuki group header');
  assert(nameButtons(container).length === 1, "the group's rows are gone");
  await click(groupButton(container, 'mizuki'), 'the mizuki group header');
  assert(detailsOf('v-birthday') !== null, 'the row is still the open one');
  assert(noteBox(container).value === 'Half-written reason', 'the note comes back with the row');

  // So does a switch of view, which unmounts every row.
  await click(chip(viewGroup(container), 'Timeline'), 'the Timeline button');
  assert(noteBox(container).value === 'Half-written reason', 'and across the By VTuber / Timeline toggle');

  // A rejection that landed uses it up.
  await click(need(buttonNamed(need(detailsOf('v-birthday'), 'the detail'), 'Reject'), 'Reject'), 'Reject');
  deepStrictEqual(need(statusCalls()[0], 'the request').body, { status: 'rejected', reviewer_note: 'Half-written reason' });
  await click(chip(viewGroup(container), 'By VTuber'), 'the By VTuber button');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(titles(container) === 'Karaoke night|Late night songs', 'the rejected VOD left the Pending view');

  await unmount();
  console.log('✓ Nova VODs: a reviewer note outlives its row (a closed group, the view toggle) until its rejection lands');
}

/** Another streamer, like another status, is a new question: the VODs held over from the last action go. */
async function aStreamerPickDropsTheHeldRows(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await click(quick(container, 'Karaoke night', 'Approve'), 'Approve');
  assert(titles(container) === PENDING_TITLES, 'the VOD just approved is held in the Pending view');
  await selectOption(streamerSelect(container), 'aozora');
  assert(titles(container) === 'Late night songs', `picking a streamer asks the question again: the held VOD goes (got ${titles(container)})`);
  await selectOption(streamerSelect(container), '');
  assert(titles(container) === 'Late night songs|Birthday stream', 'and it stays gone when every streamer is back');
  assert(statusCalls().length === 1 && listCalls().length === 1, 'none of it sends a request');

  await unmount();
  console.log('✓ Nova VODs: picking a streamer drops the VODs held over from the last action');
}

async function aRefusedRequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const approve = quick(container, 'Karaoke night', 'Approve');
  const name = nameOf(container, 'Karaoke night');

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
  assert(textOf([...summaryOf(container, 'Karaoke night').querySelectorAll(':scope > td')][3]).startsWith('Pending'), 'the VOD is as it was');
  assert(countsOf(container) === '5 VODs · 3 VTubers3 Pending1 Approved1 Rejected', 'and so are the counts');
  assert(listCalls().length === 1, 'and nothing reloads');

  // Pressed again, with the worker back, it goes through.
  statusReply = defaultStatusReply;
  await click(approve, 'Approve');
  assert(statusCalls().length === 2 && messagesOf(container) === 'Review store is down|VOD approved', 'the same press, later, approves');
  assert(focused() === name, 'and now the focus moves on');

  // A delete the worker refuses: the confirm closes, the row stays, the error is a toast, the focus stays.
  const remove = quick(container, 'Birthday stream', 'Delete');
  deleteReply = () => failure(500, 'Delete store is down');
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1, 'confirming sent the request');
  assert(
    messagesOf(container) === 'Delete store is down|Review store is down|VOD approved',
    `a refused delete toasts the worker's message (got ${messagesOf(container)})`,
  );
  const refusedDelete = need(toastsOf(container).find((toast) => toast.message === 'Delete store is down'), 'the toast for the refused delete');
  assert(refusedDelete.danger && refusedDelete.retry === null, 'a failure toast with no Retry');
  assert(remove.isConnected && isIdle(remove) && titles(container).includes('Birthday stream'), 'the row stays, its Delete available again');
  assert(focused() === remove, 'the focus never left Delete');
  assert(confirmDialog(container) === null, 'the confirm is closed');

  await unmount();
  console.log('✓ Nova VODs: a refused approval or delete is an error toast with no Retry; the row and its button stay');
}

async function deletingARow(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const remove = quick(container, 'Karaoke night', 'Delete');
  const nextName = nameOf(container, 'Birthday stream');

  // The kit confirm, in the danger tone, names the VOD by its id and its title.
  await focus(remove);
  await click(remove, 'Delete');
  const dialog = need(confirmDialog(container), 'the confirm');
  const dialogText = textOf(dialog);
  assert(dialogText.includes('v-karaoke') && dialogText.includes('Karaoke night'), 'the confirm names the VOD: its id and its title');
  assert(dialogText.includes('This cannot be undone.'), 'and says it cannot be undone');
  assert(dialog.innerHTML.includes('bg-danger-solid'), 'a danger confirm');
  assert(need(buttonNamed(dialog, 'Delete'), "the confirm's Delete").className.includes('bg-danger-solid'), 'whose Delete is the danger button');
  assert(focused() === buttonNamed(dialog, 'Cancel'), 'it starts on Cancel, the least destructive answer');
  assert(deleteCalls().length === 0, 'asking sends nothing');

  // Cancel sends nothing and keeps the focus on the control that asked.
  await click(buttonNamed(dialog, 'Cancel'), 'Cancel');
  assert(confirmDialog(container) === null && deleteCalls().length === 0, 'Cancel closes the confirm and sends nothing');
  assert(titles(container) === PENDING_TITLES && remove.isConnected, 'the row stays');
  assert(focused() === remove, "and the focus stays on the row's Delete control");
  assert(toastsOf(container).length === 0, 'with nothing announced');

  // Confirm: one DELETE; the control is busy meanwhile and keeps the focus (the answer is held, as it is in life).
  const answer = held();
  deleteReply = () => answer.reply;
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1 && need(deleteCalls()[0], 'the DELETE').path === '/api/nova/vods/v-karaoke', 'confirming sends one DELETE, to the VOD');
  assert(isBusy(remove), 'the Delete control is busy while the request is out');
  assert(focused() === remove, 'the confirm handed the focus back to it');
  assert(isUnavailable(quick(container, 'Karaoke night', 'Approve')) && isUnavailable(quick(container, 'Karaoke night', 'Reject')), 'the row is otherwise unavailable');
  assert(titles(container) === PENDING_TITLES, 'and the row is still on show');

  await respond(answer, ok({ ok: true }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'VOD deleted', detail: 'Karaoke night' }],
  );
  // (Groups are ordered by their newest submission: with Karaoke night gone, aozora's comes first.)
  assert(titles(container) === 'Late night songs|Birthday stream', `the row is gone (got ${titles(container)})`);
  assert(countsOf(container) === '4 VODs · 3 VTubers2 Pending1 Approved1 Rejected', `and the header counts follow (got ${countsOf(container)})`);
  assert(
    focused() === nextName,
    `the focus goes to the next row's name button (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );
  assert(listCalls().length === 1 && deleteCalls().length === 1 && unexpected.length === 0, 'one DELETE, and the list is patched in place');

  // The row deleted next is the last of its streamer: the one after it is the first row of the next group.
  await click(quick(container, 'Late night songs', 'Delete'), 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(titles(container) === 'Birthday stream' && groupButtons(container).length === 1, "aozora's last VOD is gone, and with it the group");
  assert(focused() === nextName, "from a group's last row the focus goes to the first row of the next group");

  // The last row on show: no row to go to, so the focus goes to the status chip in effect.
  await click(quick(container, 'Birthday stream', 'Delete'), 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(nameButtons(container).length === 0 && textOf(container.querySelector('h4')) === 'No VOD submissions found.', 'the list is empty');
  assert(
    focused() === statusChipInEffect(container) && textOf(focused()) === 'Pending',
    `with no row left the focus goes to the status chip in effect, Pending (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );
  assertNoRawColour(container.innerHTML, 'the page after its deletes');

  await unmount();
  console.log('✓ Nova VODs: Delete asks through the kit confirm; Cancel keeps the focus; Confirm is busy, toasts and hands the focus to the next row, or the status chip');
}

async function deletingFromTheCard(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Late night songs');
  const details = need(detailsOf('v-late'), 'the detail');
  const remove = need(buttonNamed(details, 'Delete'), 'the card Delete');

  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  assert(textOf(need(confirmDialog(container), 'the confirm')).includes('v-late'), 'the card Delete asks through the same confirm');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(isBusy(remove) && focused() === remove, 'the card Delete is busy and keeps the focus');
  assert(isUnavailable(need(buttonNamed(details, 'Approve'), 'Approve')) && isUnavailable(need(buttonNamed(details, 'Reject'), 'Reject')), 'with Approve and Reject unavailable beside it');
  await respond(answer, ok({ ok: true }));
  assert(titles(container) === 'Karaoke night|Birthday stream' && detailsOf('v-late') === null, 'the row and its detail are gone');
  assert(messagesOf(container) === 'VOD deleted', 'with a toast');
  assert(
    focused() === statusChipInEffect(container),
    `Late night songs was the last row: the focus goes to the Pending chip (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova VODs: the review card Delete asks and hands the focus on the same way');
}

async function focusIsNeverStolen(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // The keyboard goes elsewhere while a status change is out: the answer must not pull it back.
  const answer = held();
  statusReply = () => answer.reply;
  const approve = quick(container, 'Karaoke night', 'Approve');
  await focus(approve);
  await click(approve, 'Approve');
  const elsewhere = chip(statusGroup(container), 'Pending');
  await focus(elsewhere);
  await respond(answer, ok({ ...KARAOKE, status: 'approved', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container) === 'VOD approved', 'the approval still lands');
  assert(focused() === elsewhere, 'the focus stays where the user put it');
  assert(focused() !== nameOf(container, 'Karaoke night'), 'and the name button did not take it');

  // Another row's name button is the user's too, and so is the Delete beside an Approve that is out: it is
  // the one control of the row that is still there when the answer lands.
  const another = held();
  statusReply = () => another.reply;
  const secondApprove = quick(container, 'Birthday stream', 'Approve');
  await focus(secondApprove);
  await click(secondApprove, 'Approve');
  const lateName = nameOf(container, 'Late night songs');
  await focus(lateName);
  await respond(another, ok({ ...BIRTHDAY, status: 'approved', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(focused() === lateName, "the focus stays on another row's name button");
  const third = held();
  statusReply = () => third.reply;
  const lateApprove = quick(container, 'Late night songs', 'Approve');
  await focus(lateApprove);
  await click(lateApprove, 'Approve');
  const lateDelete = quick(container, 'Late night songs', 'Delete');
  await focus(lateDelete);
  await respond(third, ok({ ...LATE, status: 'approved', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container).split('|').length === 3, 'the third approval lands');
  assert(quick(container, 'Late night songs', 'Delete') === lateDelete, "the row's Delete is the same control after the answer");
  assert(focused() === lateDelete, "the focus stays on it: a control the answer does not replace is the user's to keep");

  await unmount();
  console.log('✓ Nova VODs: an answer that lands after the focus has moved on does not take it back');
}

/**
 * Reviewing a streamer card's last pending VOD does not close the card around the row it has kept on screen: the
 * row is still there, with its new status and its Revert control, and the focus ends on its name button.
 */
async function aCardStaysOpenAfterItsLastPendingVod(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const aozora = groupButton(container, 'aozora');
  const approve = quick(container, 'Late night songs', 'Approve');
  await focus(approve);
  await click(approve, 'Approve');
  assert(messagesOf(container) === 'VOD approved', 'the approval lands');
  assert(groupButton(container, 'aozora') === aozora && aozora.getAttribute('aria-expanded') === 'true', 'the card of its last pending VOD stays open');
  assert(textOf(aozora) === 'aozora1 VODAll reviewed', 'and its header says nothing is left to review');
  const cells = [...summaryOf(container, 'Late night songs').querySelectorAll(':scope > td')];
  assert(textOf(cells[3]).startsWith('Approved'), 'the row is there with its new status');
  assert(
    [...(cells[5]?.querySelectorAll('button') ?? [])].map((button) => button.getAttribute('aria-label')).join('|') === 'Revert to Pending|Delete',
    'and its Revert to Pending control',
  );
  assert(focused() === nameOf(container, 'Late night songs'), `the focus ends on the row's name button, which exists (got ${focused()?.tagName})`);

  // The curator can still close a card that is only open for the VOD they have just reviewed, and open it again.
  await click(aozora, 'the aozora header');
  assert(aozora.getAttribute('aria-expanded') === 'false' && !titles(container).includes('Late night songs'), 'the curator can close it');
  await click(aozora, 'the aozora header');
  assert(aozora.getAttribute('aria-expanded') === 'true' && titles(container).includes('Late night songs'), 'and open it again');

  // The same from the review card and for a rejection, a card at a time.
  const mizuki = groupButton(container, 'mizuki');
  await expand(container, 'Karaoke night');
  const cardApprove = need(buttonNamed(need(detailsOf('v-karaoke'), 'the detail'), 'Approve'), 'Approve');
  await focus(cardApprove);
  await click(cardApprove, 'Approve');
  assert(mizuki.getAttribute('aria-expanded') === 'true' && focused() === nameOf(container, 'Karaoke night'), 'a card with another pending VOD stays open: the focus goes to the name button');
  await click(nameOf(container, 'Karaoke night'), 'the name button');
  await expand(container, 'Birthday stream');
  const cardReject = need(buttonNamed(need(detailsOf('v-birthday'), 'the detail'), 'Reject'), 'Reject');
  await focus(cardReject);
  await click(cardReject, 'Reject');
  assert(mizuki.getAttribute('aria-expanded') === 'true', 'its last pending VOD rejected, the card stays open');
  assert(titles(container) === 'Karaoke night|Birthday stream|Late night songs', `with the two rows reviewed in it (got ${titles(container)})`);
  assert(buttonNamed(need(detailsOf('v-birthday'), 'the detail'), 'Revert to Pending') !== null, 'and the rejected one offers Revert to Pending');
  assert(focused() === nameOf(container, 'Birthday stream'), 'the focus ends on the name button');

  await unmount();
  console.log('✓ Nova VODs: a streamer card stays open after its last pending VOD is reviewed, and the focus ends on the row');
}

/** A filter change empties the held rows, so the card's own default applies again: with nothing pending, it closes. */
async function aFilterChangeLetsTheCardDefaultApply(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const aozora = groupButton(container, 'aozora');
  await click(quick(container, 'Late night songs', 'Approve'), 'Approve');
  assert(aozora.getAttribute('aria-expanded') === 'true', 'the card is held open by the VOD just reviewed');

  await click(chip(statusGroup(container), 'All'), 'the All chip');
  assert(
    aozora.getAttribute('aria-expanded') === 'false' && textOf(aozora) === 'aozora2 VODsAll reviewed',
    'a new filter is a new question: nothing is held, nothing is pending, so the card is closed again',
  );
  assert(!titles(container).includes('Late night songs') && !titles(container).includes('Morning chat'), 'and its rows are not on the page');

  // What the curator chose stays chosen: a card they open keeps open, one they close keeps closed.
  await click(aozora, 'the aozora header');
  assert(aozora.getAttribute('aria-expanded') === 'true' && titles(container).includes('Morning chat'), 'a card the curator opens is open');
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(
    groupButton(container, 'aozora').getAttribute('aria-expanded') === 'true' && titles(container) === 'Late night songs|Morning chat',
    'and stays open, with its rows, when the filter changes',
  );
  await click(groupButton(container, 'aozora'), 'the aozora header');
  assert(groupButton(container, 'aozora').getAttribute('aria-expanded') === 'false' && titles(container) === '', 'and a card the curator closes is closed');
  assert(statusCalls().length === 1 && listCalls().length === 1, 'none of it asks the worker again');

  await unmount();
  console.log("✓ Nova VODs: a filter change lets a card's default apply again; the curator's own choice stays");
}

/**
 * A card the curator closes while a request is out takes the row's name button with it, and the button that held
 * the focus: when the answer lands the focus goes to the card's header, and the card stays as the curator left it.
 */
async function aCardClosedUnderARequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const aozora = groupButton(container, 'aozora');
  const answer = held();
  statusReply = () => answer.reply;
  const approve = quick(container, 'Late night songs', 'Approve');
  await focus(approve);
  await click(approve, 'Approve');
  await click(aozora, 'the aozora header');
  assert(aozora.getAttribute('aria-expanded') === 'false' && !titles(container).includes('Late night songs'), 'the card is closed while its request is out');
  assert(!approve.isConnected && (focused() === document.body || focused() === null), 'the button that held the focus left with its row, and the focus fell to <body>');

  await respond(answer, ok({ ...LATE, status: 'approved', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container) === 'VOD approved', 'the answer lands');
  assert(aozora.getAttribute('aria-expanded') === 'false', "the card stays as the curator left it: their choice outranks the held VOD's");
  assert(focused() === aozora, `the focus goes to the card's header: the row's name button is not on the page (got ${focused()?.tagName})`);

  await unmount();
  console.log("✓ Nova VODs: a card closed under a request hands the focus to its header");
}

/** A review box the curator is writing in goes with the answer: the focus must not fall to <body> with it. */
async function aBoxThatLeavesWithTheAnswer(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Birthday stream');
  const rejecting = held();
  statusReply = () => rejecting.reply;
  const reject = need(buttonNamed(need(detailsOf('v-birthday'), 'the detail'), 'Reject'), 'Reject');
  await focus(reject);
  await click(reject, 'Reject');
  const box = noteBox(container);
  await focus(box);
  await typeInto(box, 'Half-written');
  await respond(rejecting, ok({ ...BIRTHDAY, status: 'rejected', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container) === 'VOD rejected', 'the rejection lands');
  assert(!box.isConnected, 'a rejected VOD has no note box: it went with the answer');
  assert(
    focused() === nameOf(container, 'Birthday stream'),
    `the focus the box held goes to the name button, not to <body> (got ${focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova VODs: a review box that leaves with the answer hands its focus to the name button');
}

async function aDeleteDoesNotStealFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const remove = quick(container, 'Karaoke night', 'Delete');
  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  const elsewhere = nameOf(container, 'Late night songs');
  await focus(elsewhere);
  await respond(answer, ok({ ok: true }));
  assert(titles(container) === 'Late night songs|Birthday stream', 'the delete lands (aozora, with the newer submission, now comes first)');
  assert(focused() === elsewhere, 'the focus stays where the user moved it');
  assert(focused() !== nameOf(container, 'Birthday stream'), 'and the next row did not take it');

  await unmount();
  console.log('✓ Nova VODs: a delete that lands after the focus has moved on does not take it back');
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
  const remove = quick(container, 'Karaoke night', 'Delete');
  const nextName = nameOf(container, 'Birthday stream');
  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1 && isBusy(remove) && focused() === remove, 'the delete is out, its control busy and holding the focus');

  // Another status is pressed while it is out: the pending rows leave the page, the deleted one and the next with them.
  await click(chip(statusGroup(container), 'Approved'), 'the Approved chip');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'aozora1 VODAll reviewed' && titles(container) === '',
    'the Approved view lists the approved VOD only, in its closed card',
  );
  assert(!remove.isConnected && !nextName.isConnected, 'the row being deleted and the row after it are off the page');
  assert(focused() === document.body || focused() === null, 'the Delete that held the focus left with its row, and the focus fell to <body>');
  assert(deleteCalls().length === 1, 'the delete is still out');

  await respond(answer, ok({ ok: true }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'VOD deleted', detail: 'Karaoke night' }],
  );
  assert(countsOf(container) === '4 VODs · 3 VTubers2 Pending1 Approved1 Rejected', `the header counts follow (got ${countsOf(container)})`);
  assert(
    focused() === statusChipInEffect(container) && textOf(focused()) === 'Approved',
    `with no next row on the page the focus goes to the chip just pressed, Approved (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );
  assert(deleteCalls().length === 1 && statusCalls().length === 0 && listCalls().length === 1 && unexpected.length === 0, 'one DELETE, and nothing else was asked');

  await unmount();
  console.log('✓ Nova VODs: a delete that lands after a filter change hands the focus to the status chip just pressed');
}

/**
 * A delete's next row is read when the answer lands, not when the delete is confirmed: a card the curator closes and
 * opens again while the request is out remounts its rows, and the button that was next at the confirm is a node that
 * is no longer on the page. The focus goes to the next row as the page has it now. (The close takes the Delete that
 * held the focus with its row, so the focus is on <body> when the answer lands.)
 */
async function aDeleteLandsAfterTheRowsRemounted(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const remove = quick(container, 'Karaoke night', 'Delete');
  const answer = held();
  deleteReply = () => answer.reply;
  await focus(remove);
  await click(remove, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(deleteCalls().length === 1 && isBusy(remove), 'the delete is out, its control busy');
  const staleNext = nameOf(container, 'Birthday stream');

  // The card is closed and opened again while it is out: its rows are new nodes, and the request is still the page's.
  const mizuki = groupButton(container, 'mizuki');
  await click(mizuki, 'the mizuki header');
  await click(mizuki, 'the mizuki header');
  assert(titles(container) === PENDING_TITLES, `the card is open again with its rows (got ${titles(container)})`);
  assert(!staleNext.isConnected && !remove.isConnected, 'the rows are new nodes: the button that was next and the Delete left the page');
  assert(isBusy(quick(container, 'Karaoke night', 'Delete')), "the new Delete control is busy again: the request is the page's, not the row's");
  assert(focused() === document.body || focused() === null, 'the Delete that held the focus left with its row, and the focus fell to <body>');

  await respond(answer, ok({ ok: true }));
  assert(messagesOf(container) === 'VOD deleted', 'the delete lands');
  assert(
    focused() === nameOf(container, 'Birthday stream'),
    `the focus goes to the next row's name button as the page has it now, not to the one read at the confirm (got ${focused()?.getAttribute('aria-label') ?? focused()?.tagName})`,
  );

  await unmount();
  console.log('✓ Nova VODs: a delete answered after its rows remounted hands the focus to the next row now on the page');
}

async function twoVodsInFlight(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // An approval is out for the first VOD, a delete for the second.
  const approving = held();
  const deleting = held();
  statusReply = () => approving.reply;
  deleteReply = () => deleting.reply;
  const firstApprove = quick(container, 'Karaoke night', 'Approve');
  await focus(firstApprove);
  await click(firstApprove, 'Approve');
  const secondDelete = quick(container, 'Birthday stream', 'Delete');
  await focus(secondDelete);
  await click(secondDelete, 'Delete');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), 'Delete'), "the confirm's Delete");
  assert(statusCalls().length === 1 && deleteCalls().length === 1, 'one request out for each VOD');
  assert(isBusy(firstApprove) && isBusy(secondDelete), 'each row has its own busy control');
  assert(isIdle(quick(container, 'Late night songs', 'Approve')), 'a third row is untouched');

  // The first answer lands while the second request is out: the second row's control, with the focus, is untouched.
  await focus(secondDelete);
  await respond(approving, ok({ ...KARAOKE, status: 'approved', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container) === 'VOD approved', 'the first row toasts its own result');
  assert(isBusy(secondDelete) && focused() === secondDelete, "the second row's Delete is still busy, and keeps the focus");

  // The second lands: both rows are idle, and each toast names its own result.
  await respond(deleting, ok({ ok: true }));
  assert(messagesOf(container) === 'VOD approved|VOD deleted', `each result has its toast (got ${messagesOf(container)})`);
  assert(titles(container) === 'Karaoke night|Late night songs', 'the deleted row is gone, the approved one stays');
  assert(focused() === nameOf(container, 'Late night songs'), 'the delete handed its focus on to the next row');
  assert(statusCalls().length === 1 && deleteCalls().length === 1 && listCalls().length === 1, 'no request was sent twice');

  await unmount();
  console.log('✓ Nova VODs: two rows with a request out each keep their own busy controls, toasts and focus');
}

async function theFilterChangesMidRequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // A rejection is out for a pending VOD.
  const rejecting = held();
  statusReply = () => rejecting.reply;
  const reject = quick(container, 'Karaoke night', 'Reject');
  await focus(reject);
  await click(reject, 'Reject');
  assert(isBusy(reject), 'Reject is busy');

  // The curator picks another status: the pending VOD leaves the list, its row and its streamer's card with it
  // (the one approved VOD's card has nothing pending, so it starts closed).
  const approved = chip(statusGroup(container), 'Approved');
  await focus(approved);
  await click(approved, 'the Approved chip');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'aozora1 VODAll reviewed' && titles(container) === '',
    'the Approved view lists the approved VOD only, in its closed card',
  );
  assert(statusCalls().length === 1, 'its request is the only one');

  // The answer lands for a row that is not there: the VOD comes back, held in view as any VOD just acted on is
  // (it is rejected, which the Approved view does not list), its streamer's card open around it, and the keyboard
  // stays on the chip.
  await respond(rejecting, ok({ ...KARAOKE, status: 'rejected', reviewed_at: '2026-09-02T10:00:00.000Z' }));
  assert(messagesOf(container) === 'VOD rejected', 'the toast says what happened');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'mizuki1 VODAll reviewed|aozora1 VODAll reviewed',
    `the VOD just rejected is back in the Approved view, in its streamer's card (got ${groupButtons(container).map((button) => textOf(button)).join('|')})`,
  );
  assert(titles(container) === 'Karaoke night', `which is open for it, and shows the row (got ${titles(container)})`);
  assert(focused() === approved, 'the focus stays on the chip that was pressed');

  // The next chip press asks the question again, and the VOD goes; none of it sent a request twice.
  await click(approved, 'the Approved chip again');
  assert(
    groupButtons(container).map((button) => textOf(button)).join('|') === 'aozora1 VODAll reviewed' && titles(container) === '',
    'the next chip press drops the held VOD, and its card',
  );
  assert(statusCalls().length === 1 && listCalls().length === 1, 'no request was sent twice');

  await unmount();
  console.log('✓ Nova VODs: a filter changed while a request is out lets the answer land, and the VOD stays until the next chip press');
}

async function contributorView(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);

  // The route keeps contributors out, but the page does not rely on it: it offers a contributor no action.
  const quickRow = summaryOf(container, 'Karaoke night');
  assert(quickRow.querySelectorAll('button[aria-label="Approve"], button[aria-label="Reject"], button[aria-label="Delete"]').length === 0, 'no quick actions');
  await expand(container, 'Karaoke night');
  const details = need(detailsOf('v-karaoke'), 'the detail');
  assert(container.querySelector('textarea') === null && buttonNamed(details, 'Approve') === null && buttonNamed(details, 'Delete') === null, 'no review card');
  assert(details.children.length === 2, 'the detail has its fields and its songs only');
  assert(
    details.className.includes('lg:grid-cols-[240px_minmax(0,1fr)]') &&
      !details.className.includes('320px') &&
      !details.className.includes('xl:grid-cols'),
    'two columns from 1024 px, and no third',
  );
  assert(textOf(details).includes('Secret Base'), 'the songs are there');
  assert(statusCalls().length === 0 && deleteCalls().length === 0, 'and nothing is sent');

  await unmount();
  console.log("✓ Nova VODs: a contributor's page offers no action and no review card");
}

async function loadFailure(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => failure(503, 'VODs are unavailable');
  const { container, unmount } = await mountPage();

  const alert = need(alertOf(container), 'a danger alert');
  assert(textOf(alert).includes("Couldn't load VODs.") && textOf(alert).includes('VODs are unavailable'), 'the alert says what failed and why');
  assert(alert.className.includes('bg-tone-danger-bg'), 'a danger note');
  assert(container.querySelector('[role="status"]') === null, 'no skeleton once the load has failed');
  assert(nameButtons(container).length === 0 && !container.innerHTML.includes('No VOD submissions found.'), 'no rows, and a failure is not an empty list');
  assert(textOf(pageHeader(container)) === 'INBOXNova VODs', 'the header has no counts to show');
  assert(statusGroup(container).isConnected && viewGroup(container).isConnected, 'the filters stay');
  assert(toastsOf(container).length === 0, 'a load failure is an alert, not a toast');
  assertNoRawColour(container.innerHTML, 'the failed page');

  // A Retry that does not hold the focus asks again and leaves the focus where it is; a retry that fails
  // is an alert again, with its message.
  listReply = () => failure(503, 'VODs are still unavailable');
  await click(need(buttonNamed(alert, 'Retry'), 'a Retry in the alert'), 'Retry');
  assert(listCalls().length === 2, 'Retry reloads the list');
  assert(focused() !== container.querySelector('h1'), 'the heading takes the focus only from a Retry that held it');
  assert(textOf(alertOf(container)).includes('VODs are still unavailable'), 'a retry that fails raises the alert again');

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
  await respond(again, ok({ data: VODS, total: VODS.length }));
  assert(alertOf(container) === null, 'a successful retry clears the alert');
  assert(titles(container) === PENDING_TITLES, 'and shows the rows');
  assert(countsOf(container) === '5 VODs · 3 VTubers3 Pending1 Approved1 Rejected', 'and the counts');

  await unmount();
  console.log('✓ Nova VODs: a load failure is a danger alert whose Retry reloads and hands its focus to the heading');
}

async function emptyList(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => ok({ data: [], total: 0 });
  const { container, unmount } = await mountPage();

  assert(textOf(container.querySelector('h4')) === 'No VOD submissions found.', 'an inbox with no VODs says so');
  assert(container.querySelector('[role="status"]') === null && alertOf(container) === null, 'with no skeleton and no alert');
  assert(countsOf(container) === '0 VODs · 0 VTubers0 Pending0 Approved0 Rejected', `and counts of zero (got ${countsOf(container)})`);
  assert(
    [...streamerSelect(container).options].map((option) => option.value).join('|') === '',
    'the streamer filter offers All streamers only',
  );
  assertNoRawColour(container.innerHTML, 'the empty page');
  await unmount();

  reset();
  listReply = () => ok({ data: [OLD], total: 1 });
  const one = await mountPage();
  assert(countsOf(one.container) === '1 VOD · 1 VTuber0 Pending0 Approved1 Rejected', `one VOD is a VOD, one streamer a VTuber (got ${countsOf(one.container)})`);
  await one.unmount();
  console.log('✓ Nova VODs: an empty inbox is an empty state with counts of zero');
}

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { default: NovaVodSubmissions } = await import('../src/pages/NovaVodSubmissions');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES, routeElement } = await import('../src/lib/routes');

  // The route sits in the studio frame, behind the curator gate: the page brings its own header and
  // gutter, no legacy card wraps it, and a contributor never reaches it.
  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/nova/vods'), 'the /nova/vods route');
  assert(route.frame === 'studio', '/nova/vods is a studio route');
  assert(route.curatorOnly === true, '/nova/vods is curator-only');
  const framed = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/nova/vods']}>
      <Routes>
        <Route path="/nova/vods" element={routeElement(route, curator)} />
      </Routes>
    </MemoryRouter>,
  );
  assert(framed !== '' && !framed.includes('legacy-frame'), 'the route renders with no LegacyFrame around it');
  console.log('✓ Nova VODs: its route is a studio route, curator-only');

  const mountPage: MountPage = (user = curator) =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <ConfirmProvider>
          <NovaVodSubmissions user={user} />
        </ConfirmProvider>
      </ToastProvider>,
    );

  await firstLoadAndLayout(mountPage);
  await filtersAndViews(mountPage);
  await rowDetail(mountPage);
  await aSongListThatWillNotLoad(mountPage);
  await songsStillLoadingSaySo(mountPage);
  await songsThatFailedOfferARetry(mountPage);
  await approvingFromTheRow(mountPage);
  await rejectingFromTheRow(mountPage);
  await reviewingFromTheCard(mountPage);
  await aNoteOutlivesItsRow(mountPage);
  await aStreamerPickDropsTheHeldRows(mountPage);
  await aRefusedRequest(mountPage);
  await deletingARow(mountPage);
  await deletingFromTheCard(mountPage);
  await focusIsNeverStolen(mountPage);
  await aCardStaysOpenAfterItsLastPendingVod(mountPage);
  await aFilterChangeLetsTheCardDefaultApply(mountPage);
  await aCardClosedUnderARequest(mountPage);
  await aBoxThatLeavesWithTheAnswer(mountPage);
  await aDeleteDoesNotStealFocus(mountPage);
  await aDeleteLandsAfterAFilterChange(mountPage);
  await aDeleteLandsAfterTheRowsRemounted(mountPage);
  await twoVodsInFlight(mountPage);
  await theFilterChangesMidRequest(mountPage);
  await contributorView(mountPage);
  await loadFailure(mountPage);
  await emptyList(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  const source = readFileSync(new URL('../src/pages/NovaVodSubmissions.tsx', import.meta.url), 'utf8');
  assertNoRawColour(source, 'the page source');
  assert(!source.includes('components/prism'), 'the page imports nothing from the prism kit');
  assert(!source.includes('hover-row') && source.includes('hover:bg-row-hover'), 'a row takes its hover from the row-hover token');
  console.log('✓ Nova VODs: no raw palette class and no arbitrary hex, in the markup or the source; nothing from the prism kit');
}

await main();
