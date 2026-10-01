/**
 * The Crystal ticket inbox on the studio kit (spec §8.9), mounted live the way App.tsx mounts every
 * page (a ToastProvider around it) against a stubbed fetch: the header and its count chips, the two
 * filter groups, a ticket's summary row and its detail, what a reply and a status change do (the
 * button that is busy, the toast, where the focus goes), a request the worker refuses, a failed load
 * and an empty list. tests/crystal-tickets-ui renders the same page with no providers at all, and
 * tests/inbox-counts pins the requests an action makes for the sidebar's badge.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser, CrystalTicket, CrystalTicketStatus, CrystalTicketType } from '../../shared/types';
import { TONE_BOX_CLASS, TONE_TEXT_CLASS } from '../src/components/ui/pill-core';
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

interface TicketFields {
  id: string;
  type: CrystalTicketType;
  title: string;
  status: CrystalTicketStatus;
  submittedAt: string;
  nickname?: string;
  contact?: string;
  isPublic?: boolean;
  contextUrl?: string;
  body?: string;
  reply?: string;
  repliedAt?: string | null;
}

function ticket(fields: TicketFields): CrystalTicket {
  return {
    id: fields.id,
    type: fields.type,
    title: fields.title,
    body: fields.body ?? 'It stops after a minute.',
    nickname: fields.nickname ?? '',
    contact: fields.contact ?? '',
    is_public_reply_allowed: fields.isPublic ? 1 : 0,
    context_url: fields.contextUrl ?? '',
    status: fields.status,
    admin_reply: fields.reply ?? '',
    replied_at: fields.repliedAt ?? null,
    submitted_at: fields.submittedAt,
    closed_at: fields.status === 'closed' ? '2026-01-03 09:00:00' : null,
  };
}

// Stored times are UTC ("YYYY-MM-DD HH:MM:SS"), as D1 writes them. The first is from this year, the rest are not.
const BROKEN = ticket({
  id: 't-broken',
  type: 'bug',
  title: 'Player stops',
  status: 'pending',
  submittedAt: `${THIS_YEAR}-01-15 12:30:00`,
  nickname: 'fan',
  contact: 'fan@example.com',
  isPublic: true,
  contextUrl: 'https://example.com/live?x=1',
  body: 'It stops\nafter a minute.',
});
const IDEA = ticket({
  id: 't-idea',
  type: 'feat',
  title: 'Add a dark mode',
  status: 'pending',
  submittedAt: '2020-03-04 08:15:00',
});
const LAYOUT = ticket({
  id: 't-layout',
  type: 'ui',
  title: 'Buttons overlap',
  status: 'replied',
  submittedAt: '2020-03-03 08:15:00',
  nickname: 'tester',
  reply: 'Fixed in the next deploy.',
  repliedAt: '2020-03-05 10:00:00',
});
const OTHER = ticket({
  id: 't-other',
  type: 'other',
  title: 'Thank you',
  status: 'closed',
  submittedAt: '2020-03-02 08:15:00',
  nickname: 'kind',
});
const TWEAK = ticket({
  id: 't-tweak',
  type: 'ui',
  title: 'Tweak the tabs',
  status: 'pending',
  submittedAt: '2020-03-01 08:15:00',
});
// Pending first, as the worker lists them (newest first within each is not what matters here).
const TICKETS = [BROKEN, IDEA, LAYOUT, OTHER, TWEAK];
const PENDING_TITLES = 'Player stops|Add a dark mode|Tweak the tabs';

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

const defaultListReply = (): Reply => ok({ data: TICKETS, total: TICKETS.length });

/** What the worker answers a reply: the ticket, replied, with the text it was sent. */
const defaultReplyReply = (call: Call, id: string): Reply => {
  const target = TICKETS.find((row) => row.id === id);
  if (target === undefined) return failure(404, 'Ticket not found');
  const text = (call.body as { admin_reply: string }).admin_reply;
  return ok({ ...target, status: 'replied', admin_reply: text, replied_at: '2026-09-02 10:00:00' });
};

/** What the worker answers a status change: the ticket, in the status that was asked for. */
const defaultStatusReply = (call: Call, id: string): Reply => {
  const target = TICKETS.find((row) => row.id === id);
  if (target === undefined) return failure(404, 'Ticket not found');
  return ok({ ...target, status: (call.body as { status: CrystalTicketStatus }).status });
};

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let listReply: (call: Call) => Reply | Promise<Reply> = defaultListReply;
let replyReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultReplyReply;
let statusReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultStatusReply;

function reset(): void {
  calls.length = 0;
  listReply = defaultListReply;
  replyReply = defaultReplyReply;
  statusReply = defaultStatusReply;
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
      const replyId = /^\/api\/crystal\/tickets\/([^/]+)\/reply$/.exec(url.pathname)?.[1];
      const statusId = /^\/api\/crystal\/tickets\/([^/]+)\/status$/.exec(url.pathname)?.[1];
      let reply: Reply | Promise<Reply> | undefined;
      if (method === 'GET' && url.pathname === '/api/crystal/tickets') reply = listReply(call);
      else if (method === 'POST' && replyId !== undefined) reply = replyReply(call, decodeURIComponent(replyId));
      else if (method === 'PATCH' && statusId !== undefined) reply = statusReply(call, decodeURIComponent(statusId));
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
  return calls.filter((call) => call.method === 'GET');
}

function replyCalls(): Call[] {
  return calls.filter((call) => call.method === 'POST');
}

function statusCalls(): Call[] {
  return calls.filter((call) => call.method === 'PATCH');
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
    container.querySelector<HTMLElement>('[role="group"][aria-labelledby="crystal-ticket-status-filter-label"]'),
    'the status filter',
  );
}

function typeGroup(container: HTMLElement): HTMLElement {
  return need(
    container.querySelector<HTMLElement>('[role="group"][aria-labelledby="crystal-ticket-type-filter-label"]'),
    'the type filter',
  );
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

function chip(group: HTMLElement, name: string): HTMLButtonElement {
  return need(buttonNamed(group, name), `the ${name} chip`);
}

/** The ticket rows: one list item each, the summary button first. */
function rowItems(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('ul > li')].filter((item) => item.querySelector('button[aria-expanded]') !== null);
}

function summaryOf(container: HTMLElement, title: string): HTMLButtonElement {
  return need(
    [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((button) =>
      textOf(button).includes(title),
    ),
    `the summary row of ${title}`,
  );
}

function titles(container: HTMLElement): string {
  return rowItems(container)
    .map((item) => textOf(item.querySelector('button[aria-expanded]')?.children[1]?.children[0]))
    .join('|');
}

function detailsOf(id: string): HTMLElement | null {
  return document.getElementById(`crystal-ticket-details-${id}`);
}

function replyBox(container: HTMLElement): HTMLTextAreaElement {
  return need(container.querySelector<HTMLTextAreaElement>('textarea'), 'a reply box');
}

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"]');
}

function isBusy(button: HTMLButtonElement): boolean {
  return (
    button.getAttribute('aria-busy') === 'true' &&
    button.getAttribute('aria-disabled') === 'true' &&
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

/** The header's count row: the total, then a pill per status. */
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

async function expand(container: HTMLElement, title: string): Promise<void> {
  await click(summaryOf(container, title), `the summary row of ${title}`);
}

async function typeReply(container: HTMLElement, text: string): Promise<void> {
  await typeInto(replyBox(container), text);
}

async function focus(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
  });
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
  assert(initial.path === '/api/crystal/tickets' && !initial.params.has('streamer'), 'the list is the unfiltered, site-wide one');

  // The header is there before any data, with the crumb and the title and nothing else to show yet.
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
  assert(textOf(header.querySelector('h1')) === 'Crystal', 'the <h1> is "Crystal"');
  assert(textOf(header) === 'INBOXCrystal', `an unloaded header holds the crumb and the title only (got ${textOf(header)})`);

  // The filters sit under the header, each group named by a visible label, before any data too.
  const status = statusGroup(container);
  const type = typeGroup(container);
  assert(!header.contains(status) && !header.contains(type), 'the filters are in the page, not in the header');
  assert(status.parentElement === type.parentElement, 'both groups share one toolbar row');
  assert(
    textOf(status.querySelector('#crystal-ticket-status-filter-label')) === 'Status' &&
      textOf(type.querySelector('#crystal-ticket-type-filter-label')) === 'Type',
    'each group opens with its label',
  );
  assert(
    !status.querySelector('#crystal-ticket-status-filter-label')?.classList.contains('sr-only'),
    'the label is there to be read, not only to be announced',
  );
  assert(
    [...status.querySelectorAll('button')].map((button) => textOf(button)).join('|') === 'All|Pending|Replied|Closed' &&
      [...type.querySelectorAll('button')].map((button) => textOf(button)).join('|') === 'All types|Bug|Feature|UI|Other',
    'the status chips and the type chips, in order',
  );
  assert(
    [...status.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed')).join('|') === 'false|true|false|false' &&
      [...type.querySelectorAll('button')].map((button) => button.getAttribute('aria-pressed')).join('|') === 'true|false|false|false|false',
    'Pending and All types are in effect',
  );

  // A skeleton until the first response, and no list, no empty notice and no counts behind it.
  const skeleton = need(container.querySelector('[role="status"]'), 'a skeleton while the first load is out');
  assert(textOf(skeleton) === 'Loading tickets…', 'the skeleton says what is loading');
  assert(rowItems(container).length === 0, 'no rows before the first response');
  assert(!container.innerHTML.includes('No tickets found.'), 'an unanswered list is not an empty one');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok({ data: TICKETS, total: TICKETS.length }));
  assert(container.querySelector('[role="status"]') === null, 'the response ends the loading state');
  assert(listCalls().length === 1, 'nothing else is requested once the page has loaded');

  // The counts count every ticket, whatever the filters keep: the total, then one pill per status.
  const counts = need(header.querySelector('h1')?.parentElement?.children[2], 'the count row under the title');
  assert(textOf(counts) === '5 tickets3 Pending1 Replied1 Closed', `the header counts the tickets (got ${textOf(counts)})`);
  const pills = [...counts.querySelectorAll('span')].filter((span) => span.className.includes('rounded-radius-pill'));
  assert(pills.length === 3, 'one pill per status');
  assert(
    pills.map((pill) => pill.className.includes('bg-tone-warn-bg') ? 'warn' : pill.className.includes('bg-tone-ok-bg') ? 'ok' : pill.className.includes('bg-tone-neutral-bg') ? 'neutral' : '?').join('|') ===
      'warn|ok|neutral',
    'Pending is a warn pill, Replied an ok one, Closed a neutral one: the tones of the row pills',
  );

  // The rows: the pending tickets, in the server's order.
  assert(titles(container) === PENDING_TITLES, `the rows are the pending tickets (got ${titles(container)})`);
  const list = need(container.querySelector('ul'), 'the list');
  assert(
    need(list.closest('.glass-card'), 'a glass card around the list').classList.contains('glass-card'),
    'the rows sit in one glass card',
  );

  // Each row: a tone-coloured tile for its type, the title, "Type · who · when", Public, the status.
  const broken = summaryOf(container, 'Player stops');
  const tile = need(broken.children[0], 'the type tile');
  assert(tile.className.includes(TONE_BOX_CLASS.danger) && tile.querySelector('svg') !== null, 'a bug is a danger tile with its icon');
  const meta = need(broken.children[1]?.children[1], 'the meta line');
  const typeWord = need(meta.children[0], 'the type word');
  assert(textOf(typeWord) === 'Bug' && typeWord.className.includes(TONE_TEXT_CLASS.danger), 'the type word wears the tile tone');
  assert(textOf(meta.children[2]) === 'fan', 'the nickname follows the type');
  const when = need(meta.querySelector('time'), 'the submitted time');
  assert(when.getAttribute('datetime') === storedTimeIso(BROKEN.submitted_at), 'the time carries the exact instant');
  assert(when.getAttribute('title') === formatFullTime(BROKEN.submitted_at), 'and the full time on hover');
  assert(textOf(when) === formatWhen(BROKEN.submitted_at, new Date()), 'and reads as the short form');
  assert(textOf(broken.children[2]).startsWith('Public'), 'a ticket that allows a public reply says Public');
  assert(textOf(broken.children[2]).endsWith('Pending'), 'and shows its status as a pill');
  const idea = summaryOf(container, 'Add a dark mode');
  assert(
    need(idea.children[0], 'the feature tile').className.includes(TONE_BOX_CLASS.violet) &&
      need(idea.children[1]?.children[1]?.children[0], 'the type word').className.includes(TONE_TEXT_CLASS.violet),
    'a feature is a violet tile',
  );
  assert(textOf(idea.children[1]?.children[1]?.children[2]) === 'anon', 'a ticket with no nickname is anon');
  assert(!textOf(idea.children[2]).includes('Public'), 'and one that allows no public reply says nothing of it');
  assert(
    need(summaryOf(container, 'Tweak the tabs').children[0], 'the UI tile').className.includes(TONE_BOX_CLASS.info),
    'a UI ticket is an info tile',
  );
  assert(
    summaryOf(container, 'Tweak the tabs').getAttribute('aria-expanded') === 'false' &&
      summaryOf(container, 'Tweak the tabs').getAttribute('aria-controls') === 'crystal-ticket-details-t-tweak',
    'every row is collapsed, and names the detail it opens',
  );
  assertNoRawColour(container.innerHTML, 'the loaded page');

  await unmount();
  console.log('✓ Crystal: header and counts, filter groups, skeleton, and ticket rows on tone tiles');
}

async function filtersNarrowTheList(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const status = statusGroup(container);
  const type = typeGroup(container);
  const pressed = (group: HTMLElement) =>
    [...group.querySelectorAll('button')].filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => textOf(button)).join('|');

  await click(chip(status, 'All'), 'the All chip');
  assert(titles(container) === 'Player stops|Add a dark mode|Buttons overlap|Thank you|Tweak the tabs', 'All shows every ticket');
  assert(pressed(status) === 'All' && pressed(type) === 'All types', 'one chip of each group is in effect');
  assert(
    rowItems(container)
      .map((item) => textOf(item.querySelector('button[aria-expanded]')?.children[2]).replace(/^Public/, ''))
      .join('|') === 'Pending|Pending|Replied|Closed|Pending',
    'each row shows its own status',
  );
  const other = summaryOf(container, 'Thank you');
  assert(
    need(other.children[0], 'the Other tile').className.includes(TONE_BOX_CLASS.neutral) &&
      need(other.children[1]?.children[1]?.children[0], 'the type word').className.includes(TONE_TEXT_CLASS.neutral),
    'an Other ticket is a neutral tile',
  );
  await click(chip(status, 'Replied'), 'the Replied chip');
  assert(titles(container) === 'Buttons overlap', 'Replied shows the replied ticket');
  await click(chip(status, 'Closed'), 'the Closed chip');
  assert(titles(container) === 'Thank you', 'Closed shows the closed ticket');

  await click(chip(status, 'All'), 'the All chip');
  await click(chip(type, 'UI'), 'the UI chip');
  assert(titles(container) === 'Buttons overlap|Tweak the tabs', 'a type narrows every status');
  await click(chip(status, 'Pending'), 'the Pending chip');
  assert(titles(container) === 'Tweak the tabs', 'and the two filters combine');
  assert(pressed(status) === 'Pending' && pressed(type) === 'UI', 'the chips in effect follow');

  // Nothing matches: the empty state, with the filters still there to change.
  await click(chip(type, 'Bug'), 'the Bug chip');
  await click(chip(status, 'Closed'), 'the Closed chip');
  assert(rowItems(container).length === 0, 'no row matches a closed bug');
  assert(textOf(container).includes('No tickets found.'), 'the list says so');
  assert(container.querySelector('h4') !== null && textOf(container.querySelector('h4')) === 'No tickets found.', 'in the empty state');
  assert(statusGroup(container).isConnected && typeGroup(container).isConnected, 'the filters stay');

  // The header counts the whole list, not what the filters keep; and none of it asks the worker again.
  assert(countsOf(container) === '5 tickets3 Pending1 Replied1 Closed', 'the counts ignore the filters');
  assert(listCalls().length === 1 && calls.length === 1, 'filtering is the browser\'s work: no further request');
  assertNoRawColour(container.innerHTML, 'the empty page');

  await unmount();
  console.log('✓ Crystal: the status and type filters combine in the browser, and an empty result is an empty state');
}

async function ticketDetail(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // A pending bug with a contact, a context URL, a multi-line body and a public reply allowed.
  const summary = summaryOf(container, 'Player stops');
  await click(summary, 'the summary row');
  assert(summary.getAttribute('aria-expanded') === 'true', 'the row opens');
  const details = need(detailsOf('t-broken'), 'the detail the row controls');
  assert(summary.getAttribute('aria-controls') === details.id, 'the row controls it');
  assert(
    need(summary.closest('div'), 'the row').classList.contains('bg-selected'),
    'an open row wears the selected-row tint',
  );
  assert(
    need(summary.children[1]?.children[0], 'the title').classList.contains('text-accent-fg'),
    'and its title the accent',
  );
  assert(listCalls().length === 1 && calls.length === 1, 'opening a ticket asks for nothing');

  const fields = [...details.querySelectorAll('dl > div')];
  assert(
    fields.map((field) => textOf(field.querySelector('dt'))).join('|') === 'ID|Contact|Submitted|Context URL|Description',
    'the detail lists ID, Contact, Submitted, Context URL and Description, in order',
  );
  const valueOf = (label: string) =>
    need(fields.find((field) => textOf(field.querySelector('dt')) === label)?.querySelector('dd'), `the ${label} value`);
  assert(textOf(valueOf('ID')) === 't-broken' && need(valueOf('ID').firstElementChild, 'the ID text').classList.contains('font-mono'), 'the ID is mono');
  assert(textOf(valueOf('Contact')) === 'fan@example.com', 'the contact');
  const submitted = need(valueOf('Submitted').querySelector('time'), 'the submitted time');
  assert(
    submitted.getAttribute('datetime') === storedTimeIso(BROKEN.submitted_at) &&
      submitted.getAttribute('title') === formatFullTime(BROKEN.submitted_at),
    'a <time> with the exact instant and the full time',
  );
  assert(textOf(valueOf('Context URL')) === 'https://example.com/live?x=1', 'the context URL');
  assert(details.querySelector('a') === null, 'which is text, not a link: it is whatever a visitor typed');
  assert(
    need(valueOf('Description').querySelector('p'), 'the body').classList.contains('whitespace-pre-wrap') &&
      valueOf('Description').textContent === 'It stops\nafter a minute.',
    'the description keeps its line breaks',
  );
  assert(
    details.classList.contains('grid-cols-1') &&
      details.classList.contains('xl:grid-cols-[minmax(0,1fr)_360px]') &&
      !details.className.includes('lg:grid-cols'),
    'the detail stacks below 1280 px and sits beside the reply card from there up',
  );
  assert(need(details.querySelector('dl'), 'the grid').className.includes('sm:grid-cols-3'), 'its fields take three columns from 640 px');

  // The reply card: a labelled box and its two buttons.
  const box = replyBox(container);
  assert(box.getAttribute('rows') === '4' && box.placeholder === 'Write a reply...', 'a four-row reply box with its prompt');
  assert((box.getAttribute('aria-label') ?? '') !== '', 'which has an accessible name');
  assert(textOf(details).includes('Reply'), 'under a Reply label');
  const send = need(buttonNamed(details, 'Send Reply'), 'Send Reply');
  assert(send.hasAttribute('disabled') && send.querySelector('svg') !== null, 'Send Reply, with its icon, waits for text');
  await typeReply(container, '   ');
  assert(send.hasAttribute('disabled'), 'a reply of spaces is no reply');
  await typeReply(container, 'Thanks!');
  assert(isIdle(send), 'a reply to send enables the button');
  const close = need(buttonNamed(details, 'Close'), 'Close');
  assert(isIdle(close) && close.getAttribute('type') === 'button', 'Close is there beside it');
  assert(buttonNamed(details, 'Reopen') === null, 'and Reopen is not');
  assertNoRawColour(container.innerHTML, 'the opened ticket');

  // Only one row is open at a time; a ticket with no contact or context URL says what it lacks.
  await expand(container, 'Add a dark mode');
  assert(summary.getAttribute('aria-expanded') === 'false' && detailsOf('t-broken') === null, 'opening another closes the first');
  const second = need(detailsOf('t-idea'), 'the second detail');
  const secondFields = [...second.querySelectorAll('dl > div')].map((field) => textOf(field.querySelector('dt')));
  assert(secondFields.join('|') === 'ID|Contact|Submitted|Description', 'no context URL field when there is none');
  assert(
    textOf(second.querySelectorAll('dd')[1]) === '—',
    'a missing contact reads as a dash',
  );
  assert(replyBox(container).value === '', 'and its reply box starts empty');
  await click(summaryOf(container, 'Add a dark mode'), 'the open summary row');
  assert(detailsOf('t-idea') === null && rowItems(container).length === 3, 'a second press closes it');

  // A replied ticket shows its reply, and the box and the button turn to Update; a closed one offers Reopen.
  await click(chip(statusGroup(container), 'All'), 'the All chip');
  await expand(container, 'Buttons overlap');
  const repliedDetails = need(detailsOf('t-layout'), 'the replied ticket detail');
  assert(textOf(repliedDetails).includes('Fixed in the next deploy.'), 'the reply is shown');
  const replyPill = [...repliedDetails.querySelectorAll('span')].find((span) => textOf(span) === 'Reply' && span.className.includes('rounded-radius-pill'));
  assert(
    replyPill !== undefined && replyPill.className.includes('bg-tone-neutral-bg'),
    'under a neutral Reply pill',
  );
  assert(
    need(repliedDetails.querySelector('time[datetime]'), 'a time').getAttribute('datetime') === storedTimeIso('2020-03-03 08:15:00') &&
      [...repliedDetails.querySelectorAll('time')].some((time) => time.getAttribute('datetime') === storedTimeIso(LAYOUT.replied_at ?? '')),
    'with the time it was sent',
  );
  assert(replyBox(container).placeholder === 'Update reply...', 'the box asks for an updated reply');
  assert(buttonNamed(repliedDetails, 'Update Reply') !== null && buttonNamed(repliedDetails, 'Send Reply') === null, 'and the button says Update Reply');
  assert(buttonNamed(repliedDetails, 'Close') !== null, 'a replied ticket can still be closed');
  await expand(container, 'Thank you');
  const closedDetails = need(detailsOf('t-other'), 'the closed ticket detail');
  assert(buttonNamed(closedDetails, 'Reopen') !== null && buttonNamed(closedDetails, 'Close') === null, 'a closed ticket offers Reopen, not Close');
  assert(textOf(closedDetails.querySelectorAll('dd')[1]) === '—', 'with no contact');
  assert(
    closedDetails.querySelectorAll('time').length === 1 &&
      ![...closedDetails.querySelectorAll('span')].some((span) => textOf(span) === 'Reply'),
    'and no reply block',
  );
  assertNoRawColour(container.innerHTML, 'the opened tickets');

  assert(calls.length === 1, 'none of it asked the worker for anything');
  await unmount();
  console.log('✓ Crystal: a ticket opens into its fields, its reply and its reply card, one at a time');
}

async function sendingAReply(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Player stops');
  const details = need(detailsOf('t-broken'), 'the detail');
  const send = need(buttonNamed(details, 'Send Reply'), 'Send Reply');
  const close = need(buttonNamed(details, 'Close'), 'Close');
  const summary = summaryOf(container, 'Player stops');

  // Pressed on the keyboard, Send Reply sends the trimmed text and is busy while the worker answers.
  await typeReply(container, '  Thanks for the report!  ');
  const answer = held();
  replyReply = () => answer.reply;
  await focus(send);
  assert(focused() === send, 'the keyboard is on Send Reply');
  await click(send, 'Send Reply');
  assert(replyCalls().length === 1, 'Send Reply sends one request');
  const sent = need(replyCalls()[0], 'the reply request');
  assert(sent.path === '/api/crystal/tickets/t-broken/reply', 'to the ticket');
  deepStrictEqual(sent.body, { admin_reply: 'Thanks for the report!' });
  assert(isBusy(send), 'the button is busy, not disabled');
  assert(textOf(send) === 'Send Reply', 'and still says what it does');
  assert(focused() === send, 'it keeps the focus while the request is out');
  assert(close.getAttribute('aria-disabled') === 'true' && close.getAttribute('aria-busy') === null, 'Close is unavailable, not busy');
  assert(replyBox(container).value === '  Thanks for the report!  ', 'the text stays where it was typed');
  await click(send, 'the busy Send Reply');
  await click(close, 'the unavailable Close');
  assert(replyCalls().length === 1 && statusCalls().length === 0, 'a press on either sends nothing');
  assert(toastsOf(container).length === 0, 'and nothing is announced yet');

  // The request is the page's, not the row's: closing the ticket and opening it again finds it still out.
  await click(summary, 'the summary row');
  await click(summary, 'the summary row');
  const reopenedSend = need(buttonNamed(need(detailsOf('t-broken'), 'the detail again'), 'Send Reply'), 'Send Reply');
  assert(isBusy(reopenedSend), 'Send Reply is still busy when the ticket is opened again');
  assert(replyBox(container).value === '  Thanks for the report!  ', 'with its draft');
  await click(reopenedSend, 'the busy Send Reply');
  assert(replyCalls().length === 1, 'and still takes no second press');

  await focus(reopenedSend);
  await respond(answer, ok({ ...BROKEN, status: 'replied', admin_reply: 'Thanks for the report!', replied_at: '2026-09-02 10:00:00' }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Reply sent', detail: '' }],
  );
  assert(!need(toastsOf(container)[0], 'the toast').danger, 'a toast of success, not of failure');
  assert(textOf(summary.children[2]).endsWith('Replied'), 'the ticket now reads Replied');
  assert(titles(container) === PENDING_TITLES, 'and stays in the Pending view until the filter changes');
  assert(countsOf(container) === '5 tickets2 Pending2 Replied1 Closed', `the header counts follow (got ${countsOf(container)})`);
  const after = need(detailsOf('t-broken'), 'the detail after the reply');
  assert(textOf(after).includes('Thanks for the report!'), 'the reply is shown with the ticket');
  assert(buttonNamed(after, 'Update Reply') !== null && buttonNamed(after, 'Send Reply') === null, 'and the button turned to Update Reply');
  assert(isIdle(need(buttonNamed(after, 'Update Reply'), 'Update Reply')) === false, 'which waits for new text');
  assert(replyBox(container).value === '' && replyBox(container).placeholder === 'Update reply...', 'the box is empty and asks for an update');
  assert(
    focused() === summary,
    `the focus that Send Reply held goes to the ticket's summary row, not to <body> (got ${focused()?.tagName})`,
  );
  assert(replyCalls().length === 1 && listCalls().length === 1 && unexpected.length === 0, 'one request, and the list is patched in place');

  // Updating the reply is the same call, and says so.
  await typeReply(container, 'Update: fixed.');
  const updateButton = need(buttonNamed(after, 'Update Reply'), 'Update Reply');
  await focus(updateButton);
  await click(updateButton, 'Update Reply');
  assert(replyCalls().length === 2, 'Update Reply sends a second request');
  assert(
    messagesOf(container) === 'Reply sent|Reply updated',
    `and toasts "Reply updated" (got ${messagesOf(container)})`,
  );
  assert(focused() === summary, 'the focus goes to the summary row again');
  assertNoRawColour(container.innerHTML, 'the page after its replies');

  await unmount();
  console.log('✓ Crystal: Send Reply is busy while it is out, toasts what happened and hands its focus to the summary row');
}

async function changingTheStatus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Player stops');
  const details = need(detailsOf('t-broken'), 'the detail');
  const close = need(buttonNamed(details, 'Close'), 'Close');
  const summary = summaryOf(container, 'Player stops');
  await typeReply(container, 'Working on it');
  const send = need(buttonNamed(details, 'Send Reply'), 'Send Reply');

  // Close, from the keyboard: busy while the request is out, the reply button unavailable beside it.
  const answer = held();
  statusReply = () => answer.reply;
  await focus(close);
  await click(close, 'Close');
  assert(statusCalls().length === 1, 'Close sends one request');
  const sent = need(statusCalls()[0], 'the status request');
  assert(sent.path === '/api/crystal/tickets/t-broken/status', 'to the ticket');
  deepStrictEqual(sent.body, { status: 'closed' });
  assert(isBusy(close) && textOf(close) === 'Close', 'Close is busy, not disabled');
  assert(focused() === close, 'and keeps the focus');
  assert(send.getAttribute('aria-disabled') === 'true' && send.getAttribute('aria-busy') === null, 'Send Reply is unavailable, not busy');
  await click(close, 'the busy Close');
  await click(send, 'the unavailable Send Reply');
  assert(statusCalls().length === 1 && replyCalls().length === 0, 'a press on either sends nothing');
  assert(toastsOf(container).length === 0, 'nothing is announced yet');

  statusReply = defaultStatusReply;
  await respond(answer, ok({ ...BROKEN, status: 'closed' }));
  deepStrictEqual(
    toastsOf(container).map(({ message, detail }) => ({ message, detail })),
    [{ message: 'Ticket closed', detail: '' }],
  );
  assert(textOf(summary.children[2]).endsWith('Closed'), 'the ticket now reads Closed');
  assert(titles(container) === PENDING_TITLES, 'and stays in the Pending view');
  assert(countsOf(container) === '5 tickets2 Pending1 Replied2 Closed', `the header counts follow (got ${countsOf(container)})`);
  const closedDetails = need(detailsOf('t-broken'), 'the detail');
  assert(buttonNamed(closedDetails, 'Close') === null, 'Close is gone');
  const reopen = need(buttonNamed(closedDetails, 'Reopen'), 'Reopen in its place');
  assert(isIdle(reopen) && reopen.querySelector('svg') !== null, 'with its icon, and available');
  assert(replyBox(container).value === 'Working on it', 'the draft is untouched: closing is not replying');
  assert(
    focused() === summary,
    `the focus that Close held goes to the ticket's summary row, not to <body> (got ${focused()?.tagName})`,
  );

  // Reopen puts it back to pending: busy while it is out, with Send Reply unavailable beside it.
  const reopening = held();
  statusReply = () => reopening.reply;
  await focus(reopen);
  await click(reopen, 'Reopen');
  const reopened = need(statusCalls()[1], 'the second status request');
  deepStrictEqual(reopened.body, { status: 'pending' });
  assert(isBusy(reopen) && textOf(reopen) === 'Reopen', 'Reopen is busy while it is out');
  assert(focused() === reopen, 'and keeps the focus');
  assert(send.getAttribute('aria-disabled') === 'true' && send.getAttribute('aria-busy') === null, 'Send Reply is unavailable beside it');
  await click(reopen, 'the busy Reopen');
  assert(statusCalls().length === 2, 'a second press sends nothing');
  statusReply = defaultStatusReply;
  await respond(reopening, ok({ ...BROKEN, status: 'pending' }));
  assert(messagesOf(container) === 'Ticket closed|Ticket reopened', `and toasts "Ticket reopened" (got ${messagesOf(container)})`);
  assert(textOf(summary.children[2]).endsWith('Pending'), 'the ticket reads Pending again');
  assert(buttonNamed(need(detailsOf('t-broken'), 'the detail'), 'Close') !== null, 'with Close back');
  assert(focused() === summary, 'and the focus on the summary row again');
  assert(listCalls().length === 1 && unexpected.length === 0, 'the list is patched in place, never reloaded');

  // A press that left the focus nowhere (a mouse click in Safari focuses no button) still lands on the summary row.
  await act(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  assert(focused() === document.body || focused() === null, 'nothing holds the focus');
  await click(need(buttonNamed(need(detailsOf('t-broken'), 'the detail'), 'Close'), 'Close'), 'Close');
  assert(textOf(summary.children[2]).endsWith('Closed'), 'the ticket is closed again');
  assert(focused() === summary, `the focus lands on the summary row, not on <body> (got ${focused()?.tagName})`);

  // A closed ticket can be replied to; Reopen waits for the reply.
  const replying = held();
  replyReply = () => replying.reply;
  const closedAgain = need(detailsOf('t-broken'), 'the detail');
  await click(need(buttonNamed(closedAgain, 'Send Reply'), 'Send Reply'), 'Send Reply');
  const reopenAgain = need(buttonNamed(closedAgain, 'Reopen'), 'Reopen');
  assert(
    reopenAgain.getAttribute('aria-disabled') === 'true' && reopenAgain.getAttribute('aria-busy') === null,
    'Reopen is unavailable while a reply is out',
  );
  await click(reopenAgain, 'the unavailable Reopen');
  assert(statusCalls().length === 3, 'a press on it sends nothing');
  await respond(replying, ok({ ...BROKEN, status: 'replied', admin_reply: 'Working on it', replied_at: '2026-09-02 10:00:00' }));
  assertNoRawColour(container.innerHTML, 'the page after its status changes');

  await unmount();
  console.log('✓ Crystal: Close and Reopen are busy while they are out, toast what happened and hand their focus to the summary row');
}

async function aRefusedRequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Player stops');
  const details = need(detailsOf('t-broken'), 'the detail');
  const send = need(buttonNamed(details, 'Send Reply'), 'Send Reply');
  const close = need(buttonNamed(details, 'Close'), 'Close');
  const summary = summaryOf(container, 'Player stops');

  // A reply the worker refuses: its message is a toast, with nothing to retry; the draft and the button stay.
  await typeReply(container, 'Thanks!');
  replyReply = () => failure(500, 'Reply store is down');
  await focus(send);
  await click(send, 'Send Reply');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `a refused reply raises one toast (saw ${toasts.length})`);
  const refused = need(toasts[0], 'the toast');
  assert(refused.message === 'Reply store is down' && refused.detail === '', "which is the worker's message");
  assert(refused.danger, 'a failure toast');
  assert(refused.retry === null, 'with no Retry: the draft and the button are still there to press again');
  assert(alertOf(container) === null, 'and no line of its own on the page');
  assert(replyBox(container).value === 'Thanks!' && send.isConnected && isIdle(send), 'the draft stays, and the button is available again');
  assert(focused() === send, 'the focus never left Send Reply');
  assert(textOf(summary.children[2]).endsWith('Pending') && countsOf(container) === '5 tickets3 Pending1 Replied1 Closed', 'the ticket and the counts are as they were');
  assert(listCalls().length === 1, 'and nothing reloads');

  // Pressed again, with the worker back, it goes through.
  replyReply = defaultReplyReply;
  await click(send, 'Send Reply');
  assert(replyCalls().length === 2 && messagesOf(container) === 'Reply sent|Reply store is down', 'the same press, later, sends the reply');
  assert(focused() === summary, 'and now the focus moves on');

  // A status change the worker refuses: the same.
  statusReply = () => failure(500, 'Cannot close this ticket');
  await focus(close);
  await click(close, 'Close');
  assert(
    messagesOf(container) === 'Cannot close this ticket|Reply sent|Reply store is down',
    `a refused status change toasts the worker's message (got ${messagesOf(container)})`,
  );
  const refusedClose = need(
    toastsOf(container).find((toast) => toast.message === 'Cannot close this ticket'),
    'the toast for the refused status change',
  );
  assert(refusedClose.danger && refusedClose.retry === null, 'a failure toast with no Retry');
  assert(close.isConnected && isIdle(close) && textOf(summary.children[2]).endsWith('Replied'), 'Close stays, available again, and the ticket as it was');
  assert(focused() === close, 'the focus never left Close');
  assert(alertOf(container) === null, 'still no line on the page');

  await unmount();
  console.log('✓ Crystal: a refused reply or status change is an error toast with no Retry; the draft and the button stay');
}

async function focusIsNeverStolen(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Player stops');
  const details = need(detailsOf('t-broken'), 'the detail');
  const summary = summaryOf(container, 'Player stops');
  await typeReply(container, 'Thanks!');

  // The keyboard goes elsewhere while the request is out: the answer must not pull it back.
  const answer = held();
  replyReply = () => answer.reply;
  const send = need(buttonNamed(details, 'Send Reply'), 'Send Reply');
  await focus(send);
  await click(send, 'Send Reply');
  const elsewhere = chip(statusGroup(container), 'Replied');
  await focus(elsewhere);
  await respond(answer, ok({ ...BROKEN, status: 'replied', admin_reply: 'Thanks!', replied_at: '2026-09-02 10:00:00' }));
  assert(messagesOf(container) === 'Reply sent', 'the reply still lands');
  assert(focused() === elsewhere, 'the focus stays where the user put it');
  assert(focused() !== summary, 'and the summary row did not take it');

  // Same for a status change, and for a ticket the user has closed in the meantime.
  const close = need(buttonNamed(need(detailsOf('t-broken'), 'the detail'), 'Close'), 'Close');
  const status = held();
  statusReply = () => status.reply;
  await focus(close);
  await click(close, 'Close');
  await click(summary, 'the summary row');
  assert(detailsOf('t-broken') === null, 'the ticket is closed while its request is out');
  await focus(summary);
  await respond(status, ok({ ...BROKEN, status: 'closed' }));
  assert(messagesOf(container) === 'Reply sent|Ticket closed', 'the change lands');
  assert(focused() === summary, 'the focus is on the summary row, where the user left it');

  await unmount();
  console.log('✓ Crystal: an answer that lands after the focus has moved on does not take it back');
}

async function aCuratorWritingKeepsTheFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await expand(container, 'Player stops');
  const details = need(detailsOf('t-broken'), 'the detail');
  const summary = summaryOf(container, 'Player stops');
  const box = replyBox(container);

  // A Close is out, and the curator clicks into the reply box and starts to write. The answer lands under
  // their hands: the focus stays in the box, and the summary row does not take it.
  const closing = held();
  statusReply = () => closing.reply;
  const close = need(buttonNamed(details, 'Close'), 'Close');
  await focus(close);
  await click(close, 'Close');
  await focus(box);
  await typeReply(container, 'Half-written');
  await respond(closing, ok({ ...BROKEN, status: 'closed' }));
  assert(messagesOf(container) === 'Ticket closed', 'the change lands');
  assert(textOf(summary.children[2]).endsWith('Closed'), 'the ticket now reads Closed');
  assert(focused() === box, `the focus stays in the reply box (got ${focused()?.tagName})`);
  assert(focused() !== summary, 'and the summary row did not take it');
  assert(box.value === 'Half-written', 'with what was typed');

  // The same with a reply out: the box keeps the focus.
  const replying = held();
  replyReply = () => replying.reply;
  const send = need(buttonNamed(details, 'Send Reply'), 'Send Reply');
  await focus(send);
  await click(send, 'Send Reply');
  await focus(box);
  await respond(replying, ok({ ...BROKEN, status: 'replied', admin_reply: 'Half-written', replied_at: '2026-09-02 10:00:00' }));
  assert(messagesOf(container) === 'Reply sent|Ticket closed', 'the reply lands');
  assert(focused() === box, 'a reply that lands leaves the focus in the reply box too');

  // Another control in the detail is the user's as well: with a reply out, the keyboard is on the unavailable Close.
  await typeReply(container, 'One more');
  const again = held();
  replyReply = () => again.reply;
  const update = need(buttonNamed(details, 'Update Reply'), 'Update Reply');
  await focus(update);
  await click(update, 'Update Reply');
  const sibling = need(buttonNamed(details, 'Close'), 'Close');
  await focus(sibling);
  await respond(again, ok({ ...BROKEN, status: 'replied', admin_reply: 'One more', replied_at: '2026-09-02 10:00:00' }));
  assert(focused() === sibling, 'the focus stays on the sibling button the user moved to');

  // And the hand-off itself is not lost: focus still on the button that sent the request goes to the summary row.
  await typeReply(container, 'Last one');
  const last = held();
  replyReply = () => last.reply;
  const lastSend = need(buttonNamed(details, 'Update Reply'), 'Update Reply');
  await focus(lastSend);
  await click(lastSend, 'Update Reply');
  await respond(last, ok({ ...BROKEN, status: 'replied', admin_reply: 'Last one', replied_at: '2026-09-02 10:00:00' }));
  assert(focused() === summary, 'focus on Update Reply goes to the summary row');

  await unmount();
  console.log('✓ Crystal: focus in the reply box or on another control stays there when an answer lands');
}

async function twoTicketsInFlight(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // A reply is out for the first ticket.
  await expand(container, 'Player stops');
  await typeReply(container, 'Thanks!');
  const replyOfFirst = held();
  replyReply = () => replyOfFirst.reply;
  await click(need(buttonNamed(need(detailsOf('t-broken'), 'the first detail'), 'Send Reply'), 'Send Reply'), 'Send Reply');

  // A Close is out for the second, whose detail takes the first one's place.
  await expand(container, 'Add a dark mode');
  const closeOfSecond = held();
  statusReply = () => closeOfSecond.reply;
  const secondClose = need(buttonNamed(need(detailsOf('t-idea'), 'the second detail'), 'Close'), 'Close');
  await focus(secondClose);
  await click(secondClose, 'Close');
  assert(replyCalls().length === 1 && statusCalls().length === 1, 'one request out for each ticket');
  assert(isBusy(secondClose), "the second ticket's Close is busy");

  // Each ticket keeps its own request while the other is on show.
  await expand(container, 'Player stops');
  const firstDetails = need(detailsOf('t-broken'), 'the first detail again');
  assert(isBusy(need(buttonNamed(firstDetails, 'Send Reply'), 'Send Reply')), "the first ticket's Send Reply is still busy");
  assert(need(buttonNamed(firstDetails, 'Close'), 'Close').getAttribute('aria-disabled') === 'true', 'and its Close is unavailable');
  await expand(container, 'Add a dark mode');
  const secondDetails = need(detailsOf('t-idea'), 'the second detail again');
  const secondClosing = need(buttonNamed(secondDetails, 'Close'), 'Close');
  assert(isBusy(secondClosing), "the second ticket's Close is still busy");
  assert(need(buttonNamed(secondDetails, 'Send Reply'), 'Send Reply').getAttribute('aria-disabled') === 'true', 'and its Send Reply is unavailable');

  // The first answer lands while the second ticket is on show: the second one's request is untouched, and the
  // keyboard, on its Close, stays there.
  await focus(secondClosing);
  await respond(replyOfFirst, ok({ ...BROKEN, status: 'replied', admin_reply: 'Thanks!', replied_at: '2026-09-02 10:00:00' }));
  assert(messagesOf(container) === 'Reply sent', 'the first ticket toasts its own result');
  assert(isBusy(secondClosing), "the second ticket's Close is still busy after the first answer");
  assert(focused() === secondClosing, "the first answer leaves the keyboard on the second ticket's Close");
  await expand(container, 'Player stops');
  const repliedDetails = need(detailsOf('t-broken'), 'the first detail after its answer');
  const update = need(buttonNamed(repliedDetails, 'Update Reply'), 'Update Reply');
  assert(
    update.getAttribute('aria-busy') === null && update.getAttribute('aria-disabled') === null,
    "the first ticket's button is idle (disabled only for want of text)",
  );
  await typeReply(container, 'More');
  assert(isIdle(update) && isIdle(need(buttonNamed(repliedDetails, 'Close'), 'Close')), 'its two buttons take a press again');
  await expand(container, 'Add a dark mode');
  const waiting = need(buttonNamed(need(detailsOf('t-idea'), 'the second detail'), 'Close'), 'Close');
  assert(isBusy(waiting), 'and the second ticket is still waiting for its answer');

  // The second answer lands: both tickets are idle, each toast names its own result.
  await focus(waiting);
  await respond(closeOfSecond, ok({ ...IDEA, status: 'closed' }));
  assert(messagesOf(container) === 'Reply sent|Ticket closed', `each result has its toast (got ${messagesOf(container)})`);
  const reopen = need(buttonNamed(need(detailsOf('t-idea'), 'the second detail'), 'Reopen'), 'Reopen');
  assert(isIdle(reopen), "the second ticket's button is available again");
  assert(focused() === summaryOf(container, 'Add a dark mode'), 'and its focus went to its own summary row');
  assert(replyCalls().length === 1 && statusCalls().length === 1 && listCalls().length === 1, 'no request was sent twice');

  await unmount();
  console.log('✓ Crystal: two tickets with a request out each keep their own busy buttons, toasts and focus');
}

async function theFilterChangesMidRequest(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // A Close is out for a pending ticket.
  await expand(container, 'Player stops');
  const closing = held();
  statusReply = () => closing.reply;
  const close = need(buttonNamed(need(detailsOf('t-broken'), 'the detail'), 'Close'), 'Close');
  await focus(close);
  await click(close, 'Close');
  assert(isBusy(close), 'Close is busy');

  // The curator picks another status: the pending ticket leaves the list, its row and detail with it.
  const replied = chip(statusGroup(container), 'Replied');
  await focus(replied);
  await click(replied, 'the Replied chip');
  assert(titles(container) === 'Buttons overlap', `the Replied view lists the replied ticket only (got ${titles(container)})`);
  assert(detailsOf('t-broken') === null, 'the ticket being closed is no longer on show');
  assert(statusCalls().length === 1, 'its request is the only one');

  // The answer lands for a row that is not there: the ticket comes back, held in view as any ticket just acted on
  // is, and the keyboard stays on the chip.
  await respond(closing, ok({ ...BROKEN, status: 'closed' }));
  assert(messagesOf(container) === 'Ticket closed', 'the toast says what happened');
  assert(titles(container) === 'Player stops|Buttons overlap', `the ticket just closed is back in the Replied view (got ${titles(container)})`);
  assert(textOf(summaryOf(container, 'Player stops').children[2]).endsWith('Closed'), 'with its new status');
  assert(focused() === replied, 'the focus stays on the chip that was pressed');
  const reopen = need(buttonNamed(need(detailsOf('t-broken'), 'the detail'), 'Reopen'), 'Reopen');
  assert(isIdle(reopen), 'and its button is available, not stuck busy');

  // The next chip press asks the question again, and the ticket goes; none of it sent a request twice.
  await click(replied, 'the Replied chip again');
  assert(titles(container) === 'Buttons overlap', 'the next chip press drops the held ticket');
  assert(statusCalls().length === 1 && replyCalls().length === 0 && listCalls().length === 1, 'no request was sent twice');

  await unmount();
  console.log('✓ Crystal: a filter changed while a request is out lets the answer land, and the ticket stays until the next chip press');
}

async function aTicketActedOnStaysUntilTheFilterChanges(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // Closing a pending ticket would take it out of the Pending view the moment it landed: it stays instead.
  await expand(container, 'Player stops');
  await click(need(buttonNamed(need(detailsOf('t-broken'), 'the detail'), 'Close'), 'Close'), 'Close');
  assert(titles(container) === PENDING_TITLES, 'the closed ticket stays in the Pending view');

  // Choosing a status asks the question again, the one in effect included: the held ticket goes.
  await click(chip(statusGroup(container), 'Pending'), 'the Pending chip');
  assert(titles(container) === 'Add a dark mode|Tweak the tabs', `the closed ticket leaves when the status filter is chosen (got ${titles(container)})`);

  // And so does choosing a type.
  await expand(container, 'Add a dark mode');
  await click(need(buttonNamed(need(detailsOf('t-idea'), 'the detail'), 'Close'), 'Close'), 'Close');
  assert(titles(container) === 'Add a dark mode|Tweak the tabs', 'the second closed ticket stays too');
  await click(chip(typeGroup(container), 'All types'), 'the All types chip');
  assert(titles(container) === 'Tweak the tabs', `the closed ticket leaves when the type filter is chosen (got ${titles(container)})`);
  assert(listCalls().length === 1, 'none of it reloads the list');

  await unmount();
  console.log('✓ Crystal: a ticket acted on stays in its view until a filter is chosen');
}

async function contributorView(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);

  // The route keeps contributors out, but the page does not rely on it: it offers a contributor no action.
  await expand(container, 'Player stops');
  const details = need(detailsOf('t-broken'), 'the detail');
  assert(container.querySelector('textarea') === null, 'no reply box');
  assert(buttonNamed(details, 'Send Reply') === null && buttonNamed(details, 'Close') === null, 'no Send Reply and no Close');
  assert(
    details.classList.contains('grid-cols-1') && !details.className.includes('xl:grid-cols') && !details.className.includes('lg:grid-cols'),
    'the fields take the whole width',
  );
  assert(textOf(details).includes('fan@example.com'), 'the fields are there');
  assert(replyCalls().length === 0 && statusCalls().length === 0, 'and nothing is sent');

  await unmount();
  console.log("✓ Crystal: a contributor's page offers no reply and no status change");
}

async function loadFailure(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => failure(503, 'Tickets are unavailable');
  const { container, unmount } = await mountPage();

  const alert = need(alertOf(container), 'a danger alert');
  assert(textOf(alert).includes("Couldn't load tickets.") && textOf(alert).includes('Tickets are unavailable'), 'the alert says what failed and why');
  assert(alert.className.includes('bg-tone-danger-bg'), 'a danger note');
  assert(container.querySelector('[role="status"]') === null, 'no skeleton once the load has failed');
  assert(rowItems(container).length === 0 && !container.innerHTML.includes('No tickets found.'), 'no rows, and a failure is not an empty list');
  assert(textOf(pageHeader(container)) === 'INBOXCrystal', 'the header has no counts to show');
  assert(statusGroup(container).isConnected && typeGroup(container).isConnected, 'the filters stay');
  assert(toastsOf(container).length === 0, 'a load failure is an alert, not a toast');
  assertNoRawColour(container.innerHTML, 'the failed page');

  // A Retry that does not hold the focus asks again and leaves the focus where it is; a retry that fails
  // is an alert again, with its message.
  listReply = () => failure(503, 'Tickets are still unavailable');
  await click(need(buttonNamed(alert, 'Retry'), 'a Retry in the alert'), 'Retry');
  assert(listCalls().length === 2, 'Retry reloads the list');
  assert(focused() !== container.querySelector('h1'), 'the heading takes the focus only from a Retry that held it');
  assert(textOf(alertOf(container)).includes('Tickets are still unavailable'), 'a retry that fails raises the alert again');

  // Retry asks again. The alert leaves with it, so the focus it held goes to the heading.
  const retry = need(buttonNamed(need(alertOf(container), 'the alert'), 'Retry'), 'a Retry in the alert');
  await focus(retry);
  assert(focused() === retry, 'the keyboard is on Retry');
  const again = held();
  listReply = () => again.reply;
  await click(retry, 'Retry');
  assert(listCalls().length === 3, 'Retry reloads the list again');
  assert(
    focused() === container.querySelector('h1'),
    `the focus goes to the page heading, not to <body> (got ${focused()?.tagName})`,
  );
  assert(container.querySelector('[role="status"]') !== null, 'the skeleton shows while the retry is out');
  await respond(again, ok({ data: TICKETS, total: TICKETS.length }));
  assert(alertOf(container) === null, 'a successful retry clears the alert');
  assert(titles(container) === PENDING_TITLES, 'and shows the rows');
  assert(countsOf(container) === '5 tickets3 Pending1 Replied1 Closed', 'and the counts');

  await unmount();
  console.log('✓ Crystal: a load failure is a danger alert whose Retry reloads and hands its focus to the heading');
}

async function emptyList(mountPage: MountPage): Promise<void> {
  reset();
  listReply = () => ok({ data: [], total: 0 });
  const { container, unmount } = await mountPage();

  assert(textOf(container.querySelector('h4')) === 'No tickets found.', 'an inbox with no tickets says so');
  assert(container.querySelector('[role="status"]') === null && alertOf(container) === null, 'with no skeleton and no alert');
  assert(countsOf(container) === '0 tickets0 Pending0 Replied0 Closed', `and counts of zero (got ${countsOf(container)})`);
  assertNoRawColour(container.innerHTML, 'the empty page');

  await unmount();

  reset();
  listReply = () => ok({ data: [OTHER], total: 1 });
  const one = await mountPage();
  assert(countsOf(one.container) === '1 ticket0 Pending0 Replied1 Closed', `one ticket is a ticket, not tickets (got ${countsOf(one.container)})`);
  await one.unmount();
  console.log('✓ Crystal: an empty inbox is an empty state with counts of zero');
}

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { default: CrystalTickets } = await import('../src/pages/CrystalTickets');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES, routeElement } = await import('../src/lib/routes');

  // The route renders through `routeElement`, behind the curator gate: the page brings its own header
  // and gutter, and a contributor never reaches it.
  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/crystal'), 'the /crystal route');
  assert(route.curatorOnly === true, '/crystal is curator-only');
  const rendered = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/crystal']}>
      <Routes>
        <Route path="/crystal" element={routeElement(route, curator)} />
      </Routes>
    </MemoryRouter>,
  );
  assert(rendered !== '', 'the route renders');
  console.log('✓ Crystal: its route renders, curator-only');

  const mountPage: MountPage = (user = curator) =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <CrystalTickets user={user} />
      </ToastProvider>,
    );

  await firstLoadAndLayout(mountPage);
  await filtersNarrowTheList(mountPage);
  await ticketDetail(mountPage);
  await sendingAReply(mountPage);
  await changingTheStatus(mountPage);
  await aRefusedRequest(mountPage);
  await focusIsNeverStolen(mountPage);
  await aCuratorWritingKeepsTheFocus(mountPage);
  await twoTicketsInFlight(mountPage);
  await theFilterChangesMidRequest(mountPage);
  await aTicketActedOnStaysUntilTheFilterChanges(mountPage);
  await contributorView(mountPage);
  await loadFailure(mountPage);
  await emptyList(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  const source = readFileSync(new URL('../src/pages/CrystalTickets.tsx', import.meta.url), 'utf8');
  assertNoRawColour(source, 'the page source');
  assert(!source.includes('components/prism'), 'the page imports nothing from the prism kit');
  assert(!source.includes('hover-row') && source.includes('hover:bg-row-hover'), 'a row takes its hover from the row-hover token');
  console.log('✓ Crystal: no raw palette class and no arbitrary hex, in the markup or the source; nothing from the prism kit');
}

await main();
