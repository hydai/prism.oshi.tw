/**
 * The review page of a Nova VOD correction (spec §6.6), mounted live at /nova/vods/vod-1/review the way App.tsx
 * mounts every page (a ToastProvider and a ConfirmProvider around it, in a router) against a stubbed fetch. The
 * data is the ichii correction (tests/fixtures/vod-correction.ts): seven rows on the stream and six submitted, six
 * pairs whose times moved, one typo in a title (Late Niqht Drive) and one row the submission leaves out (A Tender
 * Moon Tempo). Loaded (`ichiiLoadedView`: the contributor loaded the list, and a revision confirmed it), the page
 * opens with six time changes ticked, the typo ignored and the delete unticked. As Nova stored it, with no base, the
 * page's guard opens it with nothing ticked, as it does any review no revision confirmed (`loaded` confirms one).
 *
 * What the curator sees (the compact rows in time order, their chips, the marks of rows changed since the submission,
 * never seen by the contributor, not on the site or held back by the guard, its banners and 全選, and the footer's
 * counts; the stream's facts and banners), what
 * each control does to the draft (a tick, pressed while a time is typed too, a time typed, a title choice, a song
 * picked, re-pairing), what holds the apply back (a time that does not read, a row that needs an end), what an
 * apply sends and what each answer does (success, stale, invalid operations, would_publish_hidden, would_unpublish,
 * would_publish_endless, a 502 that reached the catalog and its recovery, already_applied, no_target_stream), a review
 * that opens on an apply which reached the catalog, a rejection, a seek, a failed load and the guard a contributor meets.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, NovaVodSubmission, Song, Status } from '../../shared/types';
import { matchCorrection, summarizeCorrection } from '../../shared/vod-correction';
import type { CorrectionApplyBody, CorrectionApplyResult, CorrectionProposedRow, NovaVodCorrectionView } from '../../shared/vod-correction';
import { reviewRows, staysOffSite, type PairRow } from '../src/components/vod-correction/review-rows';
import { draftFlags, initialDraft } from '../src/lib/vod-correction-draft';
import {
  baseRow,
  correctionView,
  countedReadsView,
  ichiiCorrectionView,
  ichiiLoadedView,
  liveRow,
  loaded,
  row,
  startOnlyCorrectionView,
  type ReadCounts,
  type RowFields,
} from './fixtures/vod-correction';
import { click, installDom, mount, press, settle, typeInto } from './helpers/dom';
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

/** The player's letterbox is the one raw colour on the page, and it is the player's own (YouTubePlayer.tsx). */
function withoutThePlayersBlack(markup: string): string {
  return markup.replace(/class="([^"]*)"/g, (_match, classes: string) => `class="${classes.split(' ').filter((name) => name !== 'bg-black').join(' ')}"`);
}

// --- Fixtures ---

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

/** What the worker answers an apply that landed: the submission, approved, and the summary it wrote. */
function applied(view: NovaVodCorrectionView, body: CorrectionApplyBody): CorrectionApplyResult {
  return {
    submission: { ...view.submission, status: 'approved', reviewed_at: '2026-11-14 10:00:00' },
    summary: summarizeCorrection(body.operations, body.skipped),
  };
}

function song(id: string, title: string, status: Status): Song {
  return {
    id,
    workId: null,
    title,
    originalArtist: 'Unknown',
    tags: [],
    status,
    submittedBy: null,
    reviewedBy: null,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
  };
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
const failure = (status: number, body: Record<string, unknown>): Reply => ({ status, body });

const calls: Call[] = [];
const unexpected: string[] = [];

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let correctionReply: (call: Call) => Reply | Promise<Reply> = () => ok(ichiiCorrectionView());
let applyReply: (call: Call) => Reply | Promise<Reply> = () => failure(404, { error: 'not stubbed' });
let statusReply: (call: Call) => Reply | Promise<Reply> = () => failure(404, { error: 'not stubbed' });
let songSearchReply: (call: Call) => Reply | Promise<Reply> = () => failure(404, { error: 'not stubbed' });

/** The page as it opens on `view` (a fresh ichii correction unless given), with nothing else answering yet. */
function reset(view: NovaVodCorrectionView = ichiiCorrectionView()): void {
  calls.length = 0;
  correctionReply = () => ok(view);
  applyReply = () => failure(404, { error: 'not stubbed' });
  statusReply = () => failure(404, { error: 'not stubbed' });
  songSearchReply = () => failure(404, { error: 'not stubbed' });
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
      let reply: Reply | Promise<Reply> | undefined;
      if (method === 'GET' && /^\/api\/nova\/vods\/[^/]+\/correction$/.test(url.pathname)) reply = correctionReply(call);
      else if (method === 'POST' && /^\/api\/nova\/vods\/[^/]+\/apply$/.test(url.pathname)) reply = applyReply(call);
      else if (method === 'PATCH' && /^\/api\/nova\/vods\/[^/]+\/status$/.test(url.pathname)) reply = statusReply(call);
      else if (method === 'GET' && url.pathname === '/api/songs') reply = songSearchReply(call);
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

const correctionCalls = (): Call[] => calls.filter((call) => call.method === 'GET' && call.path.endsWith('/correction'));
const applyCalls = (): Call[] => calls.filter((call) => call.method === 'POST');
const statusCalls = (): Call[] => calls.filter((call) => call.method === 'PATCH');
const searchCalls = (): Call[] => calls.filter((call) => call.path === '/api/songs');

/** The body of the last apply the page sent. */
function lastApply(): CorrectionApplyBody {
  return need(applyCalls().at(-1), 'an apply request').body as CorrectionApplyBody;
}

// --- A YouTube IFrame API stand-in: a player that records where it is asked to seek ---

const seeks: number[] = [];

function installYouTubeStub(): void {
  class Player {
    constructor(_element: HTMLElement, options: { events?: { onReady?: () => void } }) {
      queueMicrotask(() => options.events?.onReady?.());
    }

    seekTo(seconds: number): void {
      seeks.push(seconds);
    }

    loadVideoById(): void {}

    getCurrentTime(): number {
      return 0;
    }

    destroy(): void {}
  }
  Object.assign(window, { YT: { Player } });
}

// --- DOM lookups ---

function textOf(node: Element | null | undefined): string {
  return node?.textContent?.trim() ?? '';
}

/** Read through a call, so that an assertion on one element does not narrow the next one's type. */
function focused(): Element | null {
  return document.activeElement;
}

/** A button by its accessible name: its label where it has one, else its text. */
function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => (button.getAttribute('aria-label') ?? textOf(button)) === name,
    ) ?? null
  );
}

function linkNamed(root: ParentNode, name: string): HTMLAnchorElement | null {
  return [...root.querySelectorAll<HTMLAnchorElement>('a')].find((anchor) => textOf(anchor) === name) ?? null;
}

/** The pills (chips and status marks) under `root`, by their text. */
function pillsOf(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>('span')]
    .filter((span) => span.className.includes('rounded-radius-pill'))
    .map((span) => textOf(span));
}

function rowList(container: HTMLElement): HTMLOListElement {
  return need(container.querySelector<HTMLOListElement>('ol[aria-label="逐首對照"]'), 'the list of rows');
}

function rowsOf(container: HTMLElement): HTMLLIElement[] {
  return [...rowList(container).children] as HTMLLIElement[];
}

/** A row's one line: the tick, the number, the title, the times, the chips and the expand control. */
function compactOf(row: HTMLLIElement): HTMLElement {
  return need(row.firstElementChild as HTMLElement | null, 'the compact line of a row');
}

function titleOf(row: HTMLLIElement): string {
  return textOf(compactOf(row).querySelector('b'));
}

function rowNamed(container: HTMLElement, title: string): HTMLLIElement {
  return need(
    rowsOf(container).find((row) => titleOf(row) === title),
    `the row of ${title}`,
  );
}

function checkboxOf(row: HTMLLIElement): HTMLInputElement | null {
  return compactOf(row).querySelector<HTMLInputElement>('input[type="checkbox"]');
}

/** The names of the seeks under `root`, in order: 「跳到 {time}」, after 「目前：」 or 「改為：」 where a time changes. */
function seekLabels(root: ParentNode): string {
  return [...root.querySelectorAll('button[aria-label*="跳到 "]')].map((button) => button.getAttribute('aria-label')).join('|');
}

function expandOf(row: HTMLLIElement): HTMLButtonElement {
  return need(compactOf(row).querySelector<HTMLButtonElement>('button[aria-expanded]'), 'the expand control of a row');
}

function panelOf(row: HTMLLIElement): HTMLElement | null {
  const id = expandOf(row).getAttribute('aria-controls');
  return id === null ? null : document.getElementById(id);
}

async function expand(container: HTMLElement, title: string): Promise<HTMLElement> {
  const row = rowNamed(container, title);
  await click(expandOf(row), `the expand control of ${title}`);
  return need(panelOf(row), `the panel of ${title}`);
}

/** The labels of a panel's radios, in order. */
function radioLabels(panel: HTMLElement): string {
  return [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => textOf(radio.closest('label'))).join('|');
}

function radioNamed(panel: HTMLElement, label: string): HTMLInputElement {
  return need(
    [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((radio) => textOf(radio.closest('label')) === label),
    `the radio ${label}`,
  );
}

/** Read through a call, so that an assertion on a field's value does not narrow the next read of it. */
function valueOf(input: HTMLInputElement): string {
  return input.value;
}

function inputNamed(root: ParentNode, label: string): HTMLInputElement {
  return need(root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`), `the ${label} field`);
}

function footerCounts(container: HTMLElement): string {
  return textOf([...container.querySelectorAll('p')].find((line) => textOf(line).startsWith('已勾選')));
}

function noteBox(container: HTMLElement): HTMLTextAreaElement {
  return need(container.querySelector<HTMLTextAreaElement>('textarea'), 'the reviewer note box');
}

function alertWith(container: HTMLElement, text: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>('[role="alert"]')].find((alert) => textOf(alert).includes(text)) ?? null;
}

function confirmDialog(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('dialog[open]');
}

function whereOf(container: HTMLElement): string {
  return textOf(container.querySelector('output[aria-label="Location"]'));
}

function isBusy(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-busy') === 'true' && button.getAttribute('aria-disabled') === 'true' && !button.disabled;
}

/** Unavailable without losing the focus: `aria-disabled`, not busy, not `disabled`. */
function isUnavailable(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-disabled') === 'true' && button.getAttribute('aria-busy') === null && !button.disabled;
}

function isIdle(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-busy') === null && button.getAttribute('aria-disabled') === null && !button.disabled;
}

interface ToastView {
  message: string;
  detail: string;
  danger: boolean;
}

function toastsOf(container: HTMLElement): ToastView[] {
  const section = container.querySelector('section[aria-label="Notifications"]');
  return [...(section?.querySelectorAll<HTMLElement>('li') ?? [])].map((item) => {
    const lines = [...item.querySelectorAll('p')].map((line) => textOf(line));
    return { message: lines[0] ?? '', detail: lines[1] ?? '', danger: item.innerHTML.includes('bg-danger-solid') };
  });
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

async function focus(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
  });
}

/** Leaves a field the user has typed in (typeInto does not move the focus, so the field takes it first). */
async function blur(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
  });
  await act(async () => {
    element.blur();
  });
  await settle();
}

/**
 * A mouse press on `target` while `field` has the focus, as a browser runs one: the `mousedown`, then the field loses
 * the focus, which commits the time typed in it, then the `click`. happy-dom moves no focus on a mousedown, so the
 * blur is dispatched here, between the two.
 */
async function pressWhileTyping(field: HTMLElement, target: HTMLElement, what: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    field.blur();
  });
  await settle();
  await click(target, what);
}

const PENDING_HINT = '這首歌目前待審，套用後會一併通過';
const NEEDS_END = '需要結束時間';
const UNSENT_END = '勾選「時間」才會送出';
const NOTHING_SEEN = '投稿時這場直播還沒有公開的歌曲，以下各列投稿者都沒看過。';
const NOT_ON_SITE = '這場演出目前未公開，套用不會讓它公開';
const HELD_DELETE = '這首歌套用後會一併通過，而這一行沒有結束時間。請勾選刪除這一行，或取消會讓這首歌通過的項目。';

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

/** Where the router is: the page sends the curator back to the list once a review has landed. */
function Location() {
  return <output aria-label="Location">{useLocation().pathname}</output>;
}

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user?: AuthUser) => Promise<Mounted>;

// --- Scenarios ---

async function rendersThePairs(mountPage: MountPage): Promise<void> {
  reset();
  const first = held();
  correctionReply = () => first.reply;
  const { container, unmount } = await mountPage();

  // One request on mount, for the VOD's review and no streamer in particular (the VOD says whose it is).
  assert(calls.length === 1 && correctionCalls().length === 1, 'mounting asks for the review once and for nothing else');
  const read = need(correctionCalls()[0], 'the review request');
  assert(read.path === '/api/nova/vods/vod-1/correction', `the review of the VOD in the URL (got ${read.path})`);
  assert(!read.params.has('streamer'), 'naming no streamer');

  // The header is there before the data: a way back to the list and the page's title, then a skeleton.
  const header = need(container.querySelector('header'), 'its header');
  const root = need(container.firstElementChild as HTMLElement | null, 'a page root');
  assert(root.firstElementChild === header, 'the header is the page root first child, so it sticks to <main>');
  assert(container.querySelectorAll('h1').length === 1 && textOf(header.querySelector('h1')) === '修正審核', 'the <h1> is 修正審核');
  assert(need(linkNamed(header, 'Nova VODs'), 'the way back').getAttribute('href') === '/nova/vods', 'the crumb goes back to the Nova VODs list');
  assert(textOf(container.querySelector('[role="status"]')) === 'Loading correction…', 'a skeleton says what is loading');
  assert(container.querySelector('ol[aria-label="逐首對照"]') === null, 'and no rows before the answer');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok(ichiiLoadedView()));
  assert(container.querySelector('[role="status"]') === null, 'the answer ends the loading state');
  assert(pillsOf(header).includes('修正'), 'the header says the VOD is a correction');
  assert(textOf(header).includes('ichii') && textOf(header).includes('vod-1'), 'and whose it is, and which submission');

  // The list's heading says how its rows were paired: by title first, then by time.
  const heading = need([...container.querySelectorAll('h2')].find((h2) => textOf(h2) === '逐首對照'), 'the heading of the rows');
  assert(textOf(heading.nextElementSibling) === '依歌名與時間自動配對', `the pairing is by title and time (got ${textOf(heading.nextElementSibling)})`);

  // Seven rows in time order: the six pairs under their current titles, the row the submission leaves out among them.
  const rows = rowsOf(container);
  assert(rows.length === 7, `7 rows (got ${rows.length})`);
  assert(
    rows.map(titleOf).join('|') === 'Late Night Drive|私奔到月球|A Tender Moon Tempo|Moon Halo|月の向こうの世界|Fly Me To The Moon|Moon River',
    `the rows in time order (got ${rows.map(titleOf).join('|')})`,
  );
  const chips = rows.flatMap((row) => pillsOf(compactOf(row)));
  const counted = (name: string) => chips.filter((chip) => chip === name).length;
  assert(
    counted('時間') === 6 && counted('歌名') === 1 && counted('刪除') === 1 && counted('新增') === 0,
    `chips 時間 ×6, 歌名 ×1, 刪除 ×1 and no 新增 (got ${chips.join(',')})`,
  );
  assert(pillsOf(compactOf(rowNamed(container, 'Late Night Drive'))).join('|') === '時間|歌名', 'the typo row shows both its chips');
  assert(pillsOf(compactOf(rowNamed(container, 'A Tender Moon Tempo'))).join('|') === '刪除', 'the row left out is a delete');

  // A compact row: the tick, its number, the title and artist, each time old → new, each time a seek.
  const typo = rowNamed(container, 'Late Night Drive');
  assert(checkboxOf(typo)?.checked === true, 'a time change is ticked');
  assert(textOf(compactOf(typo)).startsWith('1Late Night DriveUnknown'), `the number, the title and the artist (got ${textOf(compactOf(typo))})`);
  // The old and new looks are only seen: each name says which of the two a time is.
  assert(
    seekLabels(compactOf(typo)) === '目前：跳到 14:42|改為：跳到 14:41|目前：跳到 17:06|改為：跳到 17:04',
    `start and end, old then new, each named for which it is (got ${seekLabels(compactOf(typo))})`,
  );
  const late = rowNamed(container, 'Moon River');
  assert(seekLabels(compactOf(late)) === '目前：跳到 1:29:37|改為：跳到 1:29:28|目前：跳到 1:32:25|改為：跳到 1:31:12', 'past the hour the times grow an hours field');
  const removed = rowNamed(container, 'A Tender Moon Tempo');
  assert(checkboxOf(removed)?.checked === false, 'a delete starts unticked');
  assert(seekLabels(compactOf(removed)) === '跳到 31:41|跳到 36:27', 'a delete shows the times it has now');
  assert(rows.every((row) => expandOf(row).getAttribute('aria-expanded') === 'false' && panelOf(row) === null), 'every row starts collapsed');
  assert(!textOf(container).includes('未變更'), 'no pair is left as it was, so nothing collapses');

  // The footer: the counts, 退回 and the apply.
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `the footer counts (got ${footerCounts(container)})`);
  assert(isIdle(need(buttonNamed(container, '套用 6 項'), 'the apply button')), 'the apply is available');
  assert(isIdle(need(buttonNamed(container, '退回'), 'the reject button')), 'and so is 退回');
  assert(noteBox(container).value === '', 'with an empty reviewer note');

  // The left column: the stream as it is and as submitted, its counts, the submitter note, and no banner.
  assert(textOf(container).includes('目前 7 首 → 投稿 6 首'), 'the song counts, current and submitted');
  assert(textOf(container).includes('Submitter Note'), 'the submitter note has its place');
  assert(!textOf(container).includes('這場 stream 目前不是公開狀態'), 'a public stream has no warning');
  assert(!textOf(container).includes('份待審修正'), 'nor does a VOD with no other correction pending');
  assert(container.querySelector('[role="alert"]') === null, 'nothing is alerting');

  assertNoRawColour(withoutThePlayersBlack(container.innerHTML), 'the review page');
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await unmount();
  console.log('✓ review page: renders the pairs (7 rows in time order, chips 時間 ×6, 歌名 ×1, 刪除 ×1, footer 已勾選 6 項 · 未勾 2 項)');
}

async function applySendsTheOperations(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const view = ichiiCorrectionView();
  const { container, unmount } = await mountPage();
  const answer = held();
  applyReply = () => answer.reply;

  const apply = need(buttonNamed(container, '套用 6 項'), 'the apply button');
  const reject = need(buttonNamed(container, '退回'), 'the reject button');
  await focus(apply);
  await click(apply, '套用 6 項');

  assert(applyCalls().length === 1, 'one apply');
  const post = need(applyCalls()[0], 'the apply request');
  assert(post.path === '/api/nova/vods/vod-1/apply' && !post.params.has('streamer'), `posted to the VOD (got ${post.path}?${post.params.toString()})`);
  const body = post.body as CorrectionApplyBody;
  assert(body.fingerprint === 'f'.repeat(64), 'with the fingerprint the review was read with');
  assert(body.operations.length === 6, `six operations (got ${body.operations.length})`);
  assert(body.operations.every((operation) => operation.op === 'setTimes'), 'all of them time changes');
  deepStrictEqual(body.operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 881, endTimestamp: 1024 });
  deepStrictEqual(body.skipped, { time: 0, title: 1, add: 0, delete: 1 });
  assert(!('reviewerNote' in body), 'an empty note is not sent');

  assert(isBusy(apply) && focused() === apply, 'the apply is busy while the answer is out, and keeps the focus');
  assert(isUnavailable(reject), '退回 is unavailable beside it');
  assert(toastsOf(container).length === 0, 'nothing is announced yet');

  const result = applied(view, body);
  await respond(answer, ok(result));
  deepStrictEqual(toastsOf(container).map(({ message, detail, danger }) => ({ message, detail, danger })), [
    { message: '修正已套用', detail: '套用 6 項（時間 6）；略過 2 項（歌名 1、刪除 1）', danger: false },
  ]);
  assert(whereOf(container) === '/nova/vods', `then back to the list (got ${whereOf(container)})`);
  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);
  await unmount();
  console.log('✓ review page: apply sends the operations (6, skipped time 0 / title 1 / add 0 / delete 1), toasts 修正已套用 with the summary and goes back to the list');
}

async function staleShowsAReloadBanner(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();

  // A selection to lose: the first row unticked.
  await click(checkboxOf(rowNamed(container, 'Late Night Drive')), "the first row's tick");
  assert(footerCounts(container) === '已勾選 5 項 · 未勾 3 項', `an untick moves one count to the other (got ${footerCounts(container)})`);

  applyReply = () => failure(409, { error: 'stale' });
  await click(buttonNamed(container, '套用 5 項'), '套用 5 項');
  const banner = need(alertWith(container, '這場歌單在你審核時被改過'), 'the stale banner');
  const reload = need(buttonNamed(banner, '重新載入'), 'its reload');
  assert(isUnavailable(need(buttonNamed(container, '套用 5 項'), 'the apply')), 'the apply waits for the reload: the draft is of a list that changed');
  assert(toastsOf(container).length === 0, 'the banner says it; no toast');
  assert(whereOf(container) === '/nova/vods/vod-1/review', 'and the page stays');

  // 重新載入: another GET; the fresh view replaces the draft and the banner goes with the old one.
  const fresh = held();
  correctionReply = () => fresh.reply;
  await click(reload, '重新載入');
  assert(correctionCalls().length === 2, `重新載入 issues another GET (got ${correctionCalls().length})`);
  assert(isBusy(reload), 'and is busy until it answers');
  const next = ichiiLoadedView();
  next.fingerprint = 'e'.repeat(64);
  await respond(fresh, ok(next));
  assert(alertWith(container, '這場歌單在你審核時被改過') === null, 'the banner is gone with the old list');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `the draft starts again from the new list (got ${footerCounts(container)})`);
  assert(checkboxOf(rowNamed(container, 'Late Night Drive'))?.checked === true, 'the untick is reset');

  applyReply = (call) => ok(applied(next, call.body as CorrectionApplyBody));
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  assert(lastApply().fingerprint === 'e'.repeat(64), 'the next apply sends the new fingerprint');
  assert(whereOf(container) === '/nova/vods', 'and lands');
  await unmount();
  console.log('✓ review page: stale shows a reload banner, 重新載入 issues another GET and resets the draft');
}

async function invalidOperationsShowsTheServersDetail(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () =>
    failure(400, { error: 'invalid_operations', details: ['operation 0: end must be greater than start', 'operation 3: end must be greater than start'] });
  const apply = need(buttonNamed(container, '套用 6 項'), 'the apply button');
  await click(apply, '套用 6 項');

  const toasts = toastsOf(container);
  assert(toasts.length === 1, `one toast (got ${toasts.length})`);
  const toast = need(toasts[0], 'the toast');
  assert(toast.danger, 'an error toast');
  assert(toast.detail === 'operation 0: end must be greater than start', `with the first detail (got "${toast.detail}")`);
  assert(isIdle(apply), 'the apply is available again');
  assert(whereOf(container) === '/nova/vods/vod-1/review', 'and the page stays, the draft as it was');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'the counts are unchanged');

  // A 400 that names no operation (the body itself was refused) reads as its message.
  applyReply = () => failure(400, { error: 'Invalid operations: expected at least one operation' });
  await click(apply, '套用 6 項');
  assert(toastsOf(container).some((item) => item.detail === 'Invalid operations: expected at least one operation'), 'a refusal without details shows its message');
  await unmount();
  console.log("✓ review page: invalid operations shows the server's detail");
}

async function expandingTheTitleRowOffersTheFourChoices(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Late Night Drive');
  const row = rowNamed(container, 'Late Night Drive');
  assert(expandOf(row).getAttribute('aria-expanded') === 'true', 'the row says it is open');
  assert(
    compactOf(row).className.includes('bg-selected') && !row.className.includes('bg-selected') && !panel.className.includes('bg-selected'),
    "the open row's line wears the selected tint, and its panel sits on the card (a field on a tint would leave --fg-subtle short of AA)",
  );

  assert(radioLabels(panel) === '忽略，維持目前|這首歌改名為|改連到既有的歌|改連到新的歌', `the four choices, in order (got ${radioLabels(panel)})`);
  assert(radioNamed(panel, '忽略，維持目前').checked, 'ignore is the default');
  assert(textOf(panel).includes('這首歌共 1 場，會一起改'), 'the rename hint counts the performances the rename reaches');
  assert(textOf(panel).includes('Late Niqht Drive'), 'the submitted title is shown beside the current one');
  assert(buttonNamed(panel, '拆開配對') !== null, 'a pair can be split');
  assert(new Set([...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => radio.name)).size === 1, 'one radio group');

  // Rename: one more applied, one fewer skipped; the rename goes after the row's time change.
  await click(radioNamed(panel, '這首歌改名為'), 'the rename choice');
  assert(footerCounts(container) === '已勾選 7 項 · 未勾 1 項', `a rename is applied (got ${footerCounts(container)})`);
  const renamedTitle = inputNamed(panel, '改名：歌名');
  assert(renamedTitle.value === 'Late Niqht Drive' && !renamedTitle.disabled, 'it starts from the submitted title, editable');
  await typeInto(renamedTitle, 'Late Night Drive!');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 7 項'), '套用 7 項');
  deepStrictEqual(lastApply().operations[1], { op: 'renameSong', songId: 's1', title: 'Late Night Drive!' });

  // A new song: relinks the performance, with the typed title.
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(inputNamed(panel, '改名：歌名').disabled, 'the rename fields wait for their choice');
  await click(buttonNamed(container, '套用 7 項'), '套用 7 項');
  deepStrictEqual(lastApply().operations[1], {
    op: 'relinkToNewSong', performanceId: 'p1', title: 'Late Niqht Drive', originalArtist: 'Unknown', expectedSongStatus: null,
  });

  // Back to ignore: the typo is skipped again.
  await click(radioNamed(panel, '忽略，維持目前'), 'the ignore choice');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'ignore leaves the title as it is');

  // Collapsing takes the panel away; the choice stays in the draft.
  await click(radioNamed(panel, '這首歌改名為'), 'the rename choice');
  await click(expandOf(row), 'the collapse control');
  assert(panelOf(row) === null && expandOf(row).getAttribute('aria-expanded') === 'false', 'the row collapses');
  assert(footerCounts(container) === '已勾選 7 項 · 未勾 1 項', 'and the rename is still applied');
  const again = await expand(container, 'Late Night Drive');
  assert(radioNamed(again, '這首歌改名為').checked, 'reopened, the panel shows the choice');
  await unmount();
  console.log('✓ review page: expanding the title row offers the four choices, with the rename hint 這首歌共 1 場，會一起改');
}

async function aBlankArtistKeepsTheCuratedOne(mountPage: MountPage): Promise<void> {
  // The submission retitles Fly Me To The Moon and leaves its artist blank; the stream's artist is curated.
  const view = ichiiCorrectionView();
  view.proposed[4] = { ...need(view.proposed[4], 'the fifth proposed row'), title: 'Fly Me To The Moon (Live)', originalArtist: '' };
  view.match = matchCorrection(view.current, view.proposed);
  reset(loaded(view));
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Fly Me To The Moon');
  assert(
    valueOf(inputNamed(panel, '改名：原唱')) === 'Frank Sinatra' && valueOf(inputNamed(panel, '新的歌：原唱')) === 'Frank Sinatra',
    `both choices start from the stream's artist, not Unknown (got ${valueOf(inputNamed(panel, '改名：原唱'))})`,
  );
  applyReply = () => failure(400, { error: 'stop here' });
  await click(radioNamed(panel, '這首歌改名為'), 'the rename choice');
  await click(buttonNamed(container, '套用 7 項'), '套用 7 項');
  deepStrictEqual(lastApply().operations.filter((operation) => operation.op === 'renameSong'), [
    { op: 'renameSong', songId: 's6', title: 'Fly Me To The Moon (Live)' },
  ]);
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  await click(buttonNamed(container, '套用 7 項'), '套用 7 項');
  deepStrictEqual(lastApply().operations.find((operation) => operation.op === 'relinkToNewSong'), {
    op: 'relinkToNewSong',
    performanceId: 'p6',
    title: 'Fly Me To The Moon (Live)',
    originalArtist: 'Frank Sinatra',
  });
  await unmount();

  // A blank artist and nothing else names no artist, so it is no 歌名 change, and renaming as offered sends nothing.
  const blankOnly = ichiiCorrectionView();
  blankOnly.proposed[4] = { ...need(blankOnly.proposed[4], 'the fifth proposed row'), originalArtist: '' };
  blankOnly.match = matchCorrection(blankOnly.current, blankOnly.proposed);
  reset(loaded(blankOnly));
  const second = await mountPage();
  const chips = pillsOf(compactOf(rowNamed(second.container, 'Fly Me To The Moon')));
  assert(!chips.includes('歌名'), `a blank artist alone is no 歌名 change (got ${chips.join('|')})`);
  await click(radioNamed(await expand(second.container, 'Fly Me To The Moon'), '這首歌改名為'), 'the rename choice');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(second.container, '套用 6 項'), '套用 6 項');
  assert(!lastApply().operations.some((operation) => operation.op === 'renameSong'), 'no rename: the title is the same and the artist stays');
  await second.unmount();
  console.log("✓ review page: a blank submitted artist prefills 這首歌改名為 and 改連到新的歌 with the stream's artist, never Unknown");
}

async function rowsThatApplyNothingAreShaded(mountPage: MountPage): Promise<void> {
  // A row that applies nothing wears the neutral tone. Nothing is dimmed with opacity, so a shaded row's text and its
  // seek and expand controls keep their contrast.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const shade = 'bg-tone-neutral-bg';
  const ticked = need(rowsOf(container).find((row) => checkboxOf(row)?.checked === true), 'a ticked row');
  assert(!compactOf(ticked).classList.contains(shade), 'a row that applies is not shaded');
  await click(checkboxOf(ticked), "the row's tick");
  assert(compactOf(ticked).classList.contains(shade), 'unticked, it applies nothing and is shaded');
  await click(checkboxOf(ticked), "the row's tick");
  assert(!compactOf(ticked).classList.contains(shade), 'ticked again, it applies and is not');
  await click(checkboxOf(ticked), "the row's tick");
  const dimmed = rowsOf(container).filter((row) => /(?:^|\s)opacity-\d/.test(compactOf(row).className));
  assert(dimmed.length === 0, `no row is dimmed with opacity (got ${dimmed.map(titleOf).join('|')})`);
  await unmount();
  console.log('✓ review page: a row that applies nothing is shaded with the neutral tone, never dimmed');
}

async function linkingAnExistingSong(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Late Night Drive');

  await click(radioNamed(panel, '改連到既有的歌'), 'the existing song choice');
  assert(radioNamed(panel, '改連到既有的歌').checked, 'the choice is taken');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'nothing is applied until a song is picked');
  const search = need(panel.querySelector<HTMLInputElement>('input[type="search"]'), "the picker's search field");
  assert(search.getAttribute('placeholder') === '搜尋 ichii 的歌…', `the picker searches the VOD's streamer (got ${search.getAttribute('placeholder')})`);
  assert(searchCalls().length === 0, 'an empty search asks for nothing');

  // The row's own song, and songs the apply would refuse (neither approved nor pending), are left out. The stub
  // answers like the worker: only the status asked for.
  const matches = [song('s1', 'Late Night Drive', 'approved'), song('s9', 'Late Night Drive (Acoustic)', 'pending'), song('s10', 'Late Night Driver', 'approved'), song('s11', 'Late', 'rejected')];
  songSearchReply = (call) => {
    const data = matches.filter((match) => match.status === call.params.get('status'));
    return ok({ data, total: data.length, page: 1, pageSize: 20, totalPages: 1 });
  };
  await typeInto(search, 'Late');
  const asked = searchCalls().slice(-2);
  for (const call of asked) {
    assert(
      call.params.get('streamer') === 'ichii' && call.params.get('search') === 'Late' && call.params.getAll('streamer').length === 1,
      `the search is the VOD streamer's (got ${call.params.toString()})`,
    );
  }
  deepStrictEqual(asked.map((call) => call.params.get('status')), ['approved', 'pending'], 'it asks for the approved songs, then the pending ones');
  const options = [...panel.querySelectorAll('[role="option"]')];
  assert(options.length === 2, `two songs to pick from (got ${options.map((option) => textOf(option)).join(' | ')})`);
  assert(textOf(options[0]).includes('Late Night Driver') && pillsOf(need(options[0], 'the first option')).includes('Approved'), 'each with its status, approved first');
  assert(textOf(options[1]).includes('Late Night Drive (Acoustic)') && pillsOf(need(options[1], 'the second option')).includes('Pending'), 'a pending one too');
  assert(!textOf(panel).includes('這首歌目前待審'), 'no pending hint before a pick');

  // Picking a pending song: applied, disclosed.
  await click(options[1] as HTMLElement, 'the pending song');
  assert(footerCounts(container) === '已勾選 7 項 · 未勾 1 項', `the relink is applied (got ${footerCounts(container)})`);
  assert(textOf(panel).includes('這首歌目前待審，套用後會一併通過'), 'a pending song says it will be approved with the apply');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 7 項'), '套用 7 項');
  deepStrictEqual(lastApply().operations[1], {
    op: 'relinkToSong', performanceId: 'p1', songId: 's9', expectedSongStatus: 'pending',
  });

  // An approved one: no hint.
  await click(need([...panel.querySelectorAll('[role="option"]')][0] as HTMLElement | undefined, 'the approved song'), 'the approved song');
  assert(!textOf(panel).includes('這首歌目前待審'), 'an approved song needs no hint');
  await unmount();
  console.log("✓ review page: 改連到既有的歌 searches the streamer's songs, lists each with its status, leaves the row's own song out and discloses a pending pick");
}

async function aSearchOffersOnlyItsOwnMatches(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Late Night Drive');
  await click(radioNamed(panel, '改連到既有的歌'), 'the existing song choice');
  const search = need(panel.querySelector<HTMLInputElement>('input[type="search"]'), "the picker's search field");
  const options = () => [...panel.querySelectorAll('[role="option"]')].map((option) => textOf(option));
  const answer = (...songs: Song[]) => (call: Call): Reply => {
    const data = songs.filter((match) => match.status === call.params.get('status'));
    return ok({ data, total: data.length, page: 1, pageSize: 20, totalPages: 1 });
  };
  const nothingPicked = '已勾選 6 項 · 未勾 2 項';

  songSearchReply = answer(song('s10', 'Late Night Driver', 'approved'));
  await typeInto(search, 'Late');
  assert(options().length === 1, `the first search's match (got ${options().join(' | ')})`);
  await press(search, 'ArrowDown');
  assert(search.getAttribute('aria-activedescendant') !== null, 'the arrow makes it the active option');

  // The next search is on its way: the last one's matches are not its own, so none is offered, and Enter picks none.
  const gate = held();
  songSearchReply = () => gate.reply;
  await typeInto(search, 'Moon');
  assert(options().length === 0 && textOf(panel).includes('搜尋中…'), `nothing to pick while it loads (got ${options().join(' | ')})`);
  await press(search, 'Enter');
  assert(footerCounts(container) === nothingPicked, `Enter picks nothing (got ${footerCounts(container)})`);

  // It fails: the failure shows, which a match left on screen would hide, and still nothing is offered.
  await respond(gate, failure(500, { error: 'search is down' }));
  assert(options().length === 0 && textOf(panel).includes('搜尋失敗：search is down'), `the failure shows (got ${options().join(' | ')})`);
  await press(search, 'Enter');
  assert(footerCounts(container) === nothingPicked, `Enter still picks nothing (got ${footerCounts(container)})`);

  // The search after it answers: its own matches are offered.
  songSearchReply = answer(song('s12', 'Moon Halo', 'approved'));
  await typeInto(search, 'Moon H');
  assert(options().length === 1 && options()[0]?.includes('Moon Halo') === true, `the new search's match (got ${options().join(' | ')})`);
  await unmount();
  console.log('✓ review page: 改連到既有的歌 offers only the matches of the search in the field: none while it loads, none when it fails, which it says, so Enter cannot pick a stale one');
}

async function thePendingHintFollowsTheStream(mountPage: MountPage): Promise<void> {
  // The submitted title resolves to a pending song: a new-song relink of it lands on that song.
  const view = ichiiCorrectionView();
  const first = need(view.proposed[0], 'the first proposed row');
  first.existingSong = { id: 's9', status: 'pending' };
  reset(view);
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Late Night Drive');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(textOf(panel).includes('這首歌目前待審，套用後會一併通過'), 'the resolved song is pending: the apply approves it');
  await typeInto(inputNamed(panel, '新的歌：歌名'), 'Something else');
  assert(!textOf(panel).includes('這首歌目前待審'), 'another title is another song: the hint goes');
  await unmount();

  // On a stream that is not public the apply approves nothing, so it says nothing.
  const hidden = ichiiCorrectionView();
  hidden.stream.status = 'pending';
  need(hidden.proposed[0], 'the first proposed row').existingSong = { id: 's9', status: 'pending' };
  reset(hidden);
  const second = await mountPage();
  const hiddenPanel = await expand(second.container, 'Late Night Drive');
  await click(radioNamed(hiddenPanel, '改連到新的歌'), 'the new song choice');
  assert(!textOf(hiddenPanel).includes('這首歌目前待審'), 'no promise of an approval the apply does not make');
  await second.unmount();
  console.log("✓ review page: the pending hint follows the submitted song's status, and only on a public stream");
}

/**
 * A title-only correction of row 1, sent with no artist: the stream has Song Y by `streamArtist`, the submission Song
 * X. The catalog's one Song X is by `streamArtist` and has the status `song`. Its resolution as the route sends it:
 * the submitted identity (Song X / Unknown), and Song X with each artist the stream has.
 */
function retitledWithNoArtist(streamArtist: string, song: Status): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.current[0] = { ...need(view.current[0], 'the first current row'), title: 'Song Y', originalArtist: streamArtist };
  const liveArtists = [...new Set(view.current.map((current) => current.originalArtist.trim() || 'Unknown'))];
  const resolved = (originalArtist: string) => (originalArtist === streamArtist ? { id: 'sX', status: song } : null);
  view.proposed[0] = {
    ...need(view.proposed[0], 'the first proposed row'),
    title: 'Song X',
    originalArtist: '',
    timestamp: 882,
    endTimestamp: 1026,
    existingSong: resolved('Unknown'),
    existingSongsByLiveArtist: liveArtists.map((originalArtist) => ({ originalArtist, existingSong: resolved(originalArtist) })),
  };
  view.match = matchCorrection(view.current, view.proposed);
  return view;
}

async function thePendingHintReadsThePrefilledArtist(mountPage: MountPage): Promise<void> {
  // Finding #12. With no artist submitted, 改連到新的歌 offers the stream's: Song X / Artist Q, a pending song (with
  // an approved row on another public stream). Taken as offered, the apply approves it, so the hint says so.
  reset(retitledWithNoArtist('Artist Q', 'pending'));
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Song Y');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(valueOf(inputNamed(panel, '新的歌：歌名')) === 'Song X' && valueOf(inputNamed(panel, '新的歌：原唱')) === 'Artist Q', "offered with the stream's artist");
  assert(textOf(panel).includes(PENDING_HINT), 'the song the offer lands on is pending: the apply approves it');

  // Another artist the stream has reads that artist's song (none here); one it does not have is not resolved.
  await typeInto(inputNamed(panel, '新的歌：原唱'), '五月天');
  assert(!textOf(panel).includes(PENDING_HINT), "五月天's Song X is no song: nothing to approve");
  await typeInto(inputNamed(panel, '新的歌：原唱'), 'Artist Q ');
  assert(textOf(panel).includes(PENDING_HINT), 'an artist reads trimmed');
  await typeInto(inputNamed(panel, '新的歌：原唱'), 'Somebody');
  assert(!textOf(panel).includes(PENDING_HINT), 'an artist the stream does not have says nothing, as before');
  await typeInto(inputNamed(panel, '新的歌：原唱'), 'Artist Q');
  await typeInto(inputNamed(panel, '新的歌：歌名'), 'Song X (Live)');
  assert(!textOf(panel).includes(PENDING_HINT), 'nor does another title');
  await unmount();

  // The offer lands on an approved song: nothing to approve, no hint.
  reset(retitledWithNoArtist('Artist Q', 'approved'));
  const second = await mountPage();
  const approvedPanel = await expand(second.container, 'Song Y');
  await click(radioNamed(approvedPanel, '改連到新的歌'), 'the new song choice');
  assert(!textOf(approvedPanel).includes(PENDING_HINT), 'an approved song needs no hint');
  await second.unmount();
  console.log("✓ review page: with no artist submitted, the pending hint reads the song 改連到新的歌's offer (the stream's artist) resolves to");
}

async function thePendingHintReadsAnUnknownStreamArtist(mountPage: MountPage): Promise<void> {
  // Finding #12, its last case: the stream's artist is Unknown, so the offer is Song X / Unknown, the very identity
  // the blank submitted artist resolved to, and a pending song. Typed as offered, the artist is no longer the blank
  // one submitted, yet the apply lands on that song all the same: the hint says so.
  reset(retitledWithNoArtist('Unknown', 'pending'));
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Song Y');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(valueOf(inputNamed(panel, '新的歌：原唱')) === 'Unknown', "offered with the stream's artist, Unknown");
  assert(textOf(panel).includes(PENDING_HINT), 'the pending song it lands on is disclosed');
  await unmount();
  console.log('✓ review page: with no artist submitted and Unknown on the stream, the pending hint still shows for the offer');
}

/** `withAnAdd`, the add (月光) submitted by `originalArtist` and resolving to a pending song sung nowhere on the stream. */
function withAnAddOfAPendingSong(originalArtist: string): NovaVodCorrectionView {
  const view = withAnAdd();
  view.proposed[5] = { ...need(view.proposed[5], 'the added row'), originalArtist, existingSong: { id: 's99', status: 'pending' } };
  return view;
}

/**
 * Song Y by Artist Q is the stream's one row, so no row of it is by Unknown. The submission retitles it Song X with no
 * artist, which resolves to X, a pending song; Song X by Artist Q, the stream's artist, is no song.
 */
function retitledOnAStreamWithNoUnknownRow(): NovaVodCorrectionView {
  const view = correctionView({ base: null, current: [liveRow('p1', row('Song Y', 'Artist Q', 100, 200))], proposed: [row('Song X', '', 100, 200)] });
  view.proposed[0] = {
    ...need(view.proposed[0], 'the retitled row'),
    existingSong: { id: 'sX', status: 'pending' },
    existingSongsByLiveArtist: [{ originalArtist: 'Artist Q', existingSong: null }],
  };
  return view;
}

async function thePendingHintReadsABlankArtistAsUnknown(mountPage: MountPage): Promise<void> {
  // The 2026-11-16 review's #7. Resolution reads a blank artist as Unknown, and so does the apply, so '' and 'Unknown'
  // name one song. An add submitted with no artist lands on the pending song all the same with Unknown typed in, and one
  // submitted as Unknown with it cleared: the hint stays.
  for (const [submitted, typed] of [['', 'Unknown'], ['Unknown', '']] as const) {
    reset(withAnAddOfAPendingSong(submitted));
    const { container, unmount } = await mountPage();
    const panel = await expand(container, '月光');
    assert(textOf(panel).includes(PENDING_HINT), `submitted "${submitted}": the pending song the add lands on is disclosed`);
    await typeInto(inputNamed(panel, '原唱'), typed);
    assert(textOf(panel).includes(PENDING_HINT), `"${typed}" typed over "${submitted}" names the same song: the hint stays`);
    await typeInto(inputNamed(panel, '原唱'), '張惠妹');
    assert(!textOf(panel).includes(PENDING_HINT), 'another artist is another song: the hint goes');
    await unmount();
  }

  // 改連到新的歌 on a row submitted with no artist is offered under the stream's artist, Artist Q, whose Song X is no
  // song. Changed to Unknown, it names the song the blank artist resolved to, a pending one, though no row of the stream
  // is by Unknown.
  reset(retitledOnAStreamWithNoUnknownRow());
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Song Y');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(valueOf(inputNamed(panel, '新的歌：原唱')) === 'Artist Q' && !textOf(panel).includes(PENDING_HINT), "offered with the stream's artist: no song, no hint");
  await typeInto(inputNamed(panel, '新的歌：原唱'), 'Unknown');
  assert(textOf(panel).includes(PENDING_HINT), 'changed to Unknown, it lands on the pending song: the hint shows');
  await typeInto(inputNamed(panel, '新的歌：原唱'), '');
  assert(textOf(panel).includes(PENDING_HINT), 'and so it does left blank');
  await unmount();
  console.log('✓ review page: the pending hint reads a blank artist as Unknown, on an add and on 改連到新的歌, as resolution does');
}

async function aRelinkOfARowThatIsNotApprovedPromisesNoApproval(mountPage: MountPage): Promise<void> {
  // The 2026-11-16 review's #13, as ruled. A relink keeps its row's status: a performance that is not approved stays
  // off the site whatever its song, so the apply approves no song for it, and the page promises none. The row stays off
  // the site, and says so.
  for (const status of ['pending', 'extracted'] as const) {
    const view = withARowOffTheSite(status);
    need(view.proposed[1], 'the Song B line').existingSong = { id: 's21', status: 'pending' };
    reset(view);
    const { container, unmount } = await mountPage();
    const panel = await expand(container, 'Song B');
    await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
    assert(textOf(panel).includes(NOT_ON_SITE) && !textOf(panel).includes(PENDING_HINT), `${status}: onto the pending song its line resolves to, no approval is promised`);

    await click(radioNamed(panel, '改連到既有的歌'), 'the existing song choice');
    const pending = song('s21', 'Song B (Acoustic)', 'pending');
    songSearchReply = (call) => {
      const data = [pending].filter((match) => match.status === call.params.get('status'));
      return ok({ data, total: data.length, page: 1, pageSize: 20, totalPages: 1 });
    };
    await typeInto(need(panel.querySelector<HTMLInputElement>('input[type="search"]'), "the picker's search field"), 'Song B');
    const option = need([...panel.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => textOf(item).includes('Song B (Acoustic)')), 'the pending song');
    await click(option, 'the pending song');
    assert(textOf(panel).includes(NOT_ON_SITE) && !textOf(panel).includes(PENDING_HINT), `${status}: nor onto a pending song picked`);
    await unmount();
  }
  console.log('✓ review page: a relink of a performance that is not approved promises no approval of a pending song: the row stays off the site');
}

async function editingTimes(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Late Night Drive');
  const start = inputNamed(panel, '開始');
  const end = inputNamed(panel, '結束');
  assert(valueOf(start) === '14:41' && valueOf(end) === '17:04', `prefilled with the submitted times (got ${valueOf(start)}, ${valueOf(end)})`);
  applyReply = () => failure(400, { error: 'stop here' });
  const applyButton = () => need(buttonNamed(container, '套用 6 項'), 'the apply button');
  /** The compact row's start, old then new: what the draft holds. */
  const compactStart = () => seekLabels(compactOf(rowNamed(container, 'Late Night Drive'))).split('|').slice(0, 2).join('|');

  // Typing writes nothing; leaving the field commits a time that reads. Pressing 套用 leaves it first, as a press moves the focus.
  await focus(start);
  await typeInto(start, '14:40');
  assert(compactStart() === '目前：跳到 14:42|改為：跳到 14:41', `the draft is untouched while a time is typed (got ${compactStart()})`);
  await focus(applyButton());
  assert(compactStart() === '目前：跳到 14:42|改為：跳到 14:40' && valueOf(start) === '14:40', `leaving the field commits it (got ${compactStart()})`);
  await click(applyButton(), '套用 6 項');
  deepStrictEqual(lastApply().operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 880, endTimestamp: 1024 });

  // Enter commits too, and the field keeps the focus.
  await focus(start);
  await typeInto(start, '14:39');
  await press(start, 'Enter');
  assert(focused() === start && compactStart() === '目前：跳到 14:42|改為：跳到 14:39', `Enter commits the time and keeps the focus (got ${compactStart()})`);

  // A time that does not read is marked and 套用 waits: pressing it leaves the focus in the field and sends nothing.
  // Enter keeps it, to be fixed; Escape shows the time the row has.
  await typeInto(start, '14:3x');
  assert(start.getAttribute('aria-invalid') === 'true', 'an unreadable time is marked invalid');
  await press(start, 'Enter');
  assert(start.getAttribute('aria-invalid') === 'true' && valueOf(start) === '14:3x', 'Enter keeps an unreadable time, marked');
  assert(isUnavailable(applyButton()), '套用 waits while a time does not read');
  const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  await act(async () => {
    applyButton().dispatchEvent(mousedown);
  });
  assert(mousedown.defaultPrevented, 'pressing 套用 leaves the focus in the field, which would otherwise be left and restored first');
  const posts = applyCalls().length;
  await click(applyButton(), '套用 6 項');
  assert(applyCalls().length === posts, 'and sends nothing');
  await press(start, 'Escape');
  assert(valueOf(start) === '14:39' && start.getAttribute('aria-invalid') === null, `Escape shows the time the row has (got ${valueOf(start)})`);
  assert(isIdle(applyButton()), 'and 套用 is available again');

  // A field left unreadable shows the row's time again; a start cannot be empty.
  await typeInto(start, '');
  assert(start.getAttribute('aria-invalid') === 'true', 'a start cannot be empty');
  await blur(start);
  assert(valueOf(start) === '14:39' && start.getAttribute('aria-invalid') === null, `leaving it shows the time kept (got ${valueOf(start)})`);

  // An empty end reads, as none; but the row has an end, and a ticked change may not take it away (the export refuses
  // a row with no end): 套用 waits, and says why, and the emptied field is marked, until an end is typed again.
  await focus(end);
  await typeInto(end, '');
  assert(end.getAttribute('aria-invalid') === null, 'an empty end reads, as no end');
  await blur(end);
  assert(isUnavailable(applyButton()) && applyReason(applyButton()) === '還有 1 列需要結束時間', `a ticked row whose end is cleared holds 套用 (got "${applyReason(applyButton())}")`);
  assert(end.getAttribute('aria-invalid') === 'true' && textOf(panel).includes(NEEDS_END), 'and its emptied end field is marked');
  assert(pillsOf(compactOf(rowNamed(container, 'Late Night Drive'))).includes(NEEDS_END), 'as is its line');
  // Where the end goes to none, the line shows a dash, which a screen reader hears as the end it would have.
  const line = compactOf(rowNamed(container, 'Late Night Drive'));
  assert(
    seekLabels(line).split('|').slice(2).join('|') === '目前：跳到 17:06' && textOf(line).includes('改為：無'),
    `the line reads the end it has, then none (got ${seekLabels(line)} / ${textOf(line)})`,
  );
  const sent = applyCalls().length;
  await click(applyButton(), '套用 6 項');
  assert(applyCalls().length === sent, 'a press sends nothing');
  await focus(end);
  await typeInto(end, '1:00:00');
  await blur(end);
  assert(isIdle(applyButton()) && end.getAttribute('aria-invalid') === null, 'an end typed again lets the apply go');
  await click(applyButton(), '套用 6 項');
  deepStrictEqual(lastApply().operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 879, endTimestamp: 3600 });

  // A committed time is one the curator wants: an unticked row takes its tick back once the time is committed.
  const tick = need(checkboxOf(rowNamed(container, 'Late Night Drive')), "the row's tick");
  await click(tick, "the row's tick");
  assert(!tick.checked && footerCounts(container) === '已勾選 5 項 · 未勾 3 項', 'unticked, the time change is skipped');
  const panelTick = need(panel.querySelector<HTMLInputElement>('input[type="checkbox"]'), "the panel's 時間 tick");
  assert(!panelTick.checked, "the panel's 時間 tick is the same choice");
  await focus(start);
  await typeInto(start, '14:38');
  assert(!tick.checked, 'typing alone ticks nothing');
  await blur(start);
  assert(tick.checked && panelTick.checked && footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'a committed time ticks the row again');
  assert(compactStart() === '目前：跳到 14:42|改為：跳到 14:38', 'and the compact row shows it');

  // A field that leaves the page while it does not read holds nothing back: here its row collapses under it.
  await focus(start);
  await typeInto(start, '14:3x');
  assert(isUnavailable(applyButton()), '套用 waits');
  await click(expandOf(rowNamed(container, 'Late Night Drive')), 'the collapse control');
  assert(panelOf(rowNamed(container, 'Late Night Drive')) === null, 'the panel is gone');
  assert(isIdle(applyButton()), 'and so is the hold on 套用');
  await unmount();
  console.log('✓ review page: a time is committed when it is left or entered; one that does not read, or a ticked end cleared, holds 套用 back until it is fixed, and a committed one ticks the row');
}

/** Backspace ×3 from 1:29:28, then :3: the text passes through 1:29, which reads (as 89 s). */
const PREFIX_KEYSTROKES = ['1:29:2', '1:29:', '1:29', '1:29:', '1:29:3'];

async function aPrefixIsNeverCommitted(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const row = () => rowNamed(container, 'Moon River');
  const tick = () => need(checkboxOf(row()), "Moon River's tick");
  // Unticked first, so a time written while it is typed would show as a tick too.
  await click(tick(), "Moon River's tick");
  assert(!tick().checked && footerCounts(container) === '已勾選 5 項 · 未勾 3 項', 'Moon River unticked');
  const panel = await expand(container, 'Moon River');
  const start = inputNamed(panel, '開始');
  assert(valueOf(start) === '1:29:28', `the submitted start (got ${valueOf(start)})`);
  const untouched = (step: string) => {
    const labels = seekLabels(compactOf(row()));
    assert(labels.startsWith('目前：跳到 1:29:37|改為：跳到 1:29:28'), `the draft keeps 1:29:28 through ${step} (got ${labels})`);
    assert(!tick().checked && footerCounts(container) === '已勾選 5 項 · 未勾 3 項', `and the tick stays off through ${step}`);
  };

  // Keystroke by keystroke, then Escape.
  await focus(start);
  for (const text of PREFIX_KEYSTROKES) {
    await typeInto(start, text);
    untouched(`"${text}"`);
  }
  assert(start.getAttribute('aria-invalid') === 'true', '1:29:3 does not read');
  await press(start, 'Escape');
  assert(valueOf(start) === '1:29:28' && start.getAttribute('aria-invalid') === null, `Escape shows the time the row has (got ${valueOf(start)})`);
  untouched('Escape');

  // The same, then the field is left.
  for (const text of PREFIX_KEYSTROKES) {
    await typeInto(start, text);
    untouched(`"${text}"`);
  }
  await blur(start);
  assert(valueOf(start) === '1:29:28' && start.getAttribute('aria-invalid') === null, `leaving it shows the time the row has (got ${valueOf(start)})`);
  untouched('the blur');

  // Ticked again, the apply sends the time the row had all along.
  await click(tick(), "Moon River's tick");
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(
    lastApply().operations.find((operation) => operation.op === 'setTimes' && operation.performanceId === 'p7'),
    { op: 'setTimes', performanceId: 'p7', timestamp: 5368, endTimestamp: 5472 },
  );
  await unmount();
  console.log('✓ review page: a time being typed is never committed on the way: 1:29:28 → 1:29 → 1:29:3 and Escape (or a blur) leave the row as it was');
}

async function anAddsTimeIsCommittedOnlyWhenItIsLeft(mountPage: MountPage): Promise<void> {
  reset(loaded(withAnAdd()));
  const { container, unmount } = await mountPage();
  const tick = () => need(checkboxOf(rowNamed(container, '月光')), "the add's tick");
  const compactStart = () => seekLabels(compactOf(rowNamed(container, '月光'))).split('|')[0];
  await click(tick(), "the add's tick");
  assert(!tick().checked && footerCounts(container) === '已勾選 6 項 · 未勾 3 項', 'the add unticked');
  const panel = await expand(container, '月光');
  const start = inputNamed(panel, '開始');
  assert(valueOf(start) === '1:05:10', `the submitted start (got ${valueOf(start)})`);

  // 1:05 reads (as 65 s) on the way from 1:05:10 to 1:05:2: nothing of it reaches the add.
  await focus(start);
  for (const text of ['1:05:1', '1:05:', '1:05', '1:05:', '1:05:2']) {
    await typeInto(start, text);
    assert(compactStart() === '跳到 1:05:10' && !tick().checked, `the add keeps 1:05:10, unticked, through "${text}" (got ${compactStart()})`);
  }
  await press(start, 'Escape');
  assert(valueOf(start) === '1:05:10' && !tick().checked && footerCounts(container) === '已勾選 6 項 · 未勾 3 項', 'Escape leaves the add as it was');

  // A committed time ticks the add.
  await typeInto(start, '1:05:20');
  await press(start, 'Enter');
  assert(compactStart() === '跳到 1:05:20' && tick().checked, `a committed time is the add's, and ticks it (got ${compactStart()})`);
  assert(footerCounts(container) === '已勾選 7 項 · 未勾 2 項', 'the add is applied');
  await unmount();
  console.log("✓ review page: an add's time follows the same rule: committed when left or entered, and only then ticked");
}

/** The ichii correction with row 1's times left as the stream has them: a title-only pair, whose row has no tick. */
function withATitleOnlyFirstRow(): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.proposed[0] = { ...need(view.proposed[0], 'the first proposed row'), timestamp: 882, endTimestamp: 1026 };
  view.match = matchCorrection(view.current, view.proposed);
  return view;
}

async function aPressActsOnTheBoxItPressed(mountPage: MountPage): Promise<void> {
  // Finding #3. A typed time is committed when its field is left, and a committed time ticks its row. A mouse press
  // leaves the field before its click lands: an unticked box the curator presses is ticked by then, and the click's
  // toggle would untick it, the typed time left out of the apply. What the press acts on is the box as it was pressed.
  for (const pressed of ['box', 'label'] as const) {
    reset(loaded(withATitleOnlyFirstRow()));
    const { container, unmount } = await mountPage();
    assert(footerCounts(container) === '已勾選 5 項 · 未勾 2 項', `the title-only pair applies nothing (got ${footerCounts(container)})`);
    const panel = await expand(container, 'Late Night Drive');
    const box = need(panel.querySelector<HTMLInputElement>('input[type="checkbox"]'), "the panel's 時間 box");
    const text = need(box.closest('label')?.lastElementChild as HTMLElement | null | undefined, "the 時間 box's label");
    assert(!box.checked && textOf(text) === '時間', 'its 時間 box starts unticked');
    const start = inputNamed(panel, '開始');
    await focus(start);
    await typeInto(start, '14:45');
    await pressWhileTyping(start, pressed === 'box' ? box : text, `the 時間 ${pressed}`);
    assert(box.checked, `pressing the unticked ${pressed} ticks the box`);
    assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `and the typed time is applied (got ${footerCounts(container)})`);
    applyReply = () => failure(400, { error: 'stop here' });
    await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
    deepStrictEqual(lastApply().operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 885 });
    await unmount();
  }

  // A row's own tick, and pressed the other way: ticked as it was pressed, the press unticks it.
  reset(ichiiLoadedView());
  const timed = await mountPage();
  const tick = () => need(checkboxOf(rowNamed(timed.container, 'Moon River')), "Moon River's tick");
  await click(tick(), "Moon River's tick");
  const riverStart = inputNamed(await expand(timed.container, 'Moon River'), '開始');
  await focus(riverStart);
  await typeInto(riverStart, '1:29:20');
  await pressWhileTyping(riverStart, tick(), "Moon River's tick");
  assert(tick().checked && footerCounts(timed.container) === '已勾選 6 項 · 未勾 2 項', "pressing the row's unticked tick ticks it");
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(timed.container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(
    lastApply().operations.find((operation) => operation.op === 'setTimes' && operation.performanceId === 'p7'),
    { op: 'setTimes', performanceId: 'p7', timestamp: 5360, endTimestamp: 5472 },
  );
  await focus(riverStart);
  await typeInto(riverStart, '1:29:21');
  await pressWhileTyping(riverStart, tick(), "Moon River's tick");
  assert(!tick().checked && footerCounts(timed.container) === '已勾選 5 項 · 未勾 3 項', 'and pressing it ticked unticks it, the time kept out');
  await timed.unmount();

  // An add's tick: its committed time ticks it too.
  reset(loaded(withAnAdd()));
  const added = await mountPage();
  const addTick = () => need(checkboxOf(rowNamed(added.container, '月光')), "the add's tick");
  await click(addTick(), "the add's tick");
  const addStart = inputNamed(await expand(added.container, '月光'), '開始');
  await focus(addStart);
  await typeInto(addStart, '1:05:20');
  await pressWhileTyping(addStart, addTick(), "the add's tick");
  assert(addTick().checked && footerCounts(added.container) === '已勾選 7 項 · 未勾 2 項', "pressing the add's unticked tick ticks it");
  await added.unmount();

  // A press that never became a click (released elsewhere) leaves nothing behind: a later key toggles the box as it is.
  reset(loaded(withATitleOnlyFirstRow()));
  const keyed = await mountPage();
  const panel = await expand(keyed.container, 'Late Night Drive');
  const box = need(panel.querySelector<HTMLInputElement>('input[type="checkbox"]'), "the panel's 時間 box");
  await act(async () => {
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  const start = inputNamed(panel, '開始');
  await focus(start);
  await typeInto(start, '14:45');
  await blur(start);
  assert(box.checked, 'the committed time ticked the box');
  await focus(box);
  await press(box, ' ');
  await click(box, 'the 時間 box, from the keyboard');
  assert(!box.checked && footerCounts(keyed.container) === '已勾選 5 項 · 未勾 2 項', 'Space unticks the box it shows ticked');
  await keyed.unmount();
  console.log('✓ review page: a press of a 時間 box, its label, a row tick or an add tick while a time is typed acts on the box as it was pressed; keys toggle it as it is');
}

async function rePairingByHand(mountPage: MountPage): Promise<void> {
  // With no base the review opens with nothing ticked: 全選時間 gives back the six time edits it opened with before the
  // guard. (A loaded review would not do: with a base, the row split off below is no suggested delete, as its submitted
  // row stands for it, and the counts read 未勾 1 項.)
  reset();
  const { container, unmount } = await mountPage();
  await click(buttonNamed(container, '全選時間'), '全選時間');
  const panel = await expand(container, 'Late Night Drive');
  await click(buttonNamed(panel, '拆開配對'), '拆開配對');

  // The pair is now an unticked delete of the current row and a ticked add of the submitted one.
  const rows = rowsOf(container);
  assert(rows.length === 8, `8 rows (got ${rows.length})`);
  assert(rows.map(titleOf).slice(0, 2).join('|') === 'Late Niqht Drive|Late Night Drive', `the add at 14:41, then the delete at 14:42 (got ${rows.map(titleOf).join('|')})`);
  const add = rowNamed(container, 'Late Niqht Drive');
  assert(pillsOf(compactOf(add)).join('|') === '新增' && checkboxOf(add)?.checked === true, 'the submitted row is a ticked add');
  assert(textOf(compactOf(add)).startsWith('+'), 'numbered + as the mockup does');
  assert(seekLabels(compactOf(add)) === '跳到 14:41|跳到 17:04', 'with its own times');
  const removed = rowNamed(container, 'Late Night Drive');
  assert(pillsOf(compactOf(removed)).join('|') === '刪除' && checkboxOf(removed)?.checked === false, 'the current row an unticked delete');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `five time changes and an add; two deletes unticked (got ${footerCounts(container)})`);

  // The add opens, offering to pair it again, with the unpaired current rows.
  const addPanel = need(panelOf(add), 'the add panel, opened by the split');
  const pairTo = need(addPanel.querySelector<HTMLSelectElement>('select[aria-label="配對到…"]'), 'the 配對到… picker');
  assert(
    [...pairTo.options].map((option) => textOf(option)).join('|') === '配對到…|#1 Late Night Drive（14:42）|#3 A Tender Moon Tempo（31:41）',
    `over the unpaired current rows (got ${[...pairTo.options].map((option) => textOf(option)).join('|')})`,
  );
  assert(inputNamed(addPanel, '歌名').value === 'Late Niqht Drive', "the add's title is editable");

  await selectOption(pairTo, '0');
  const again = rowsOf(container);
  assert(again.length === 7 && again.map(titleOf)[0] === 'Late Night Drive', 'paired again: seven rows, the pair back in place');
  assert(pillsOf(compactOf(rowNamed(container, 'Late Night Drive'))).join('|') === '時間|歌名', 'with its chips');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'and the counts it started with');
  await unmount();
  console.log('✓ review page: 拆開配對 splits a pair into an add and a delete, and 配對到… pairs them again');
}

/** The ichii correction with one song added, between Fly Me To The Moon and Moon River (the rows stay in time order). */
function withAnAdd(): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.proposed.splice(5, 0, {
    id: 'v7', title: '月光', originalArtist: '張惠妹', timestamp: 3910, endTimestamp: 4142, endFilled: false, nextSubmittedId: 'v6', existingSong: null,
  });
  view.match = matchCorrection(view.current, view.proposed);
  assert(view.match.unpairedProposed.join() === '5', 'the fixture: the new row pairs with nothing');
  return view;
}

async function aDeleteAndAnAdd(mountPage: MountPage): Promise<void> {
  reset(loaded(withAnAdd()));
  const { container, unmount } = await mountPage();
  const add = rowNamed(container, '月光');
  assert(pillsOf(compactOf(add)).join('|') === '新增' && checkboxOf(add)?.checked === true, 'an add starts ticked');
  assert(footerCounts(container) === '已勾選 7 項 · 未勾 2 項', 'and counts as applied');

  const deletePanel = await expand(container, 'A Tender Moon Tempo');
  assert(textOf(deletePanel).includes('粉絲的收藏會失效'), "a delete warns that fans' saved items go missing");
  await click(checkboxOf(rowNamed(container, 'A Tender Moon Tempo')), 'the delete tick');
  assert(footerCounts(container) === '已勾選 8 項 · 未勾 1 項', 'a ticked delete is applied');

  const addPanel = await expand(container, '月光');
  await typeInto(inputNamed(addPanel, '原唱'), '  ');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 8 項'), '套用 8 項');
  const operations = lastApply().operations;
  deepStrictEqual(operations.slice(-2), [
    { op: 'addPerformance', title: '月光', originalArtist: 'Unknown', timestamp: 3910, endTimestamp: 4142 },
    { op: 'deletePerformance', performanceId: 'p3' },
  ]);
  await unmount();
  console.log("✓ review page: an add starts ticked and is editable, a delete warns about fans' saved items and is applied once ticked");
}

/**
 * The stream has Lemon by Kenshi Yonezu and Gurenge by LiSA, which the contributor kept, and the contributor added Lemon
 * after them with no artist. As the route resolves that line, its title by Unknown is no song, and with each artist the
 * stream has it is `candidates` (one entry per artist: `existingSongsByLiveArtist`). The stream's Lemon is a row of the
 * song `s1`, whose status is `lemon`: a pending one is off the site, so the list the contributor saw lacks it.
 */
function withALemonAddedWithNoArtist(lemon: Status, candidates: NonNullable<CorrectionProposedRow['existingSongsByLiveArtist']>): NovaVodCorrectionView {
  const kept = row('Lemon', 'Kenshi Yonezu', 100, 200);
  const gurenge = row('Gurenge', 'LiSA', 300, 400);
  const view = correctionView({
    base: lemon === 'approved' ? [baseRow('p1', kept), baseRow('p2', gurenge)] : [baseRow('p2', gurenge)],
    current: [liveRow('p1', kept, 'approved', lemon), liveRow('p2', gurenge)],
    proposed: [kept, gurenge, row('Lemon', '', 500, 600)],
  });
  need(view.proposed[2], 'the Lemon with no artist').existingSongsByLiveArtist = candidates;
  return loaded(view);
}

async function anAddWithNoArtistShowsTheLiveArtistItBorrows(mountPage: MountPage): Promise<void> {
  // r3 #4. Sent with no artist, an add is Lemon by Unknown, and the apply makes that song beside the stream's Lemon, an
  // approved twin. Of the stream's artists exactly one has a Lemon, so the add opens with that artist in its field,
  // ticked, and the apply sends it: the guard has nothing to hold back, as the add names a song.
  const kenshi = (status: Status) => ({ originalArtist: 'Kenshi Yonezu', existingSong: { id: 's1', status } });
  const lisa = (song: { id: string; status: Status } | null) => ({ originalArtist: 'LiSA', existingSong: song });
  reset(withALemonAddedWithNoArtist('approved', [kenshi('approved'), lisa(null)]));
  const { container, unmount } = await mountPage();
  assert(marksOf(container, 'Lemon') === '新增' && checkboxOf(rowNamed(container, 'Lemon'))?.checked === true, `it opens ticked and unmarked (got ${marksOf(container, 'Lemon')})`);
  assert(footerCounts(container) === '已勾選 1 項 · 未勾 0 項', `and counts as applied (got ${footerCounts(container)})`);
  const panel = await expand(container, 'Lemon');
  assert(valueOf(inputNamed(panel, '原唱')) === 'Kenshi Yonezu', `its artist field shows the borrowed artist (got "${valueOf(inputNamed(panel, '原唱'))}")`);
  assert(!textOf(panel).includes('沒有原唱') && !textOf(panel).includes(PENDING_HINT), 'it names a song, and the song is approved: nothing to say');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 1 項'), '套用 1 項');
  deepStrictEqual(lastApply().operations, [{ op: 'addPerformance', title: 'Lemon', originalArtist: 'Kenshi Yonezu', timestamp: 500, endTimestamp: 600 }]);

  // A default, not a lock: with the field cleared, the add is sent as Unknown, as any add with no artist.
  await typeInto(inputNamed(panel, '原唱'), '');
  await click(buttonNamed(container, '套用 1 項'), '套用 1 項');
  deepStrictEqual(lastApply().operations, [{ op: 'addPerformance', title: 'Lemon', originalArtist: 'Unknown', timestamp: 500, endTimestamp: 600 }]);
  await unmount();

  // The song it lands on is the borrowed artist's, whatever its status: a pending one is approved with the apply, and the
  // panel says so, until another artist is typed.
  reset(withALemonAddedWithNoArtist('pending', [kenshi('pending'), lisa(null)]));
  const pending = await mountPage();
  const pendingPanel = await expand(pending.container, 'Lemon');
  assert(valueOf(inputNamed(pendingPanel, '原唱')) === 'Kenshi Yonezu' && textOf(pendingPanel).includes(PENDING_HINT), "the borrowed artist's Lemon is pending: the hint says the apply approves it");
  await typeInto(inputNamed(pendingPanel, '原唱'), 'LiSA');
  assert(!textOf(pendingPanel).includes(PENDING_HINT), "LiSA has no Lemon, so it is another song, which only the apply resolves: the hint goes");
  await pending.unmount();

  // Two artists with a Lemon: there is no telling which was meant, so the field stays empty and the guard holds the add
  // back for naming no song.
  reset(withALemonAddedWithNoArtist('approved', [kenshi('approved'), lisa({ id: 's2', status: 'approved' })]));
  const two = await mountPage();
  assert(marksOf(two.container, 'Lemon') === '新增|沒有原唱' && checkboxOf(rowNamed(two.container, 'Lemon'))?.checked === false, `it stays blank, held, unticked (got ${marksOf(two.container, 'Lemon')})`);
  assert(valueOf(inputNamed(await expand(two.container, 'Lemon'), '原唱')) === '', 'its artist field is empty');
  await two.unmount();
  console.log("✓ review page: an add with no artist opens with the one live artist that has a song of its title, ticked and sent with it; with two such artists it stays blank and the guard holds it");
}

const SIZE_FAMILIES = { width: /^w-/, 'padding-x': /^px-/, 'padding-y': /^py-/ } as const;

/**
 * The size `element`'s own classes give it in one family (`w-…`, `px-…`, `py-…`): an `!important` class if it has one,
 * else its one plain class, else null. Two plain classes fail: the kit gives every field `w-full px-3 py-2` (the Select
 * its wrapper `w-full`), and the stylesheet emits those after what a page adds (`.w-full` after `.w-[5.5rem]`, `.w-40`
 * and `.w-72`, `.px-3` after `.px-2`), so whatever the order of the class list, the page's value loses to the kit's.
 */
function sizeOf(element: Element, family: keyof typeof SIZE_FAMILIES, what: string): string | null {
  const classes = element.getAttribute('class')?.split(/\s+/) ?? [];
  const plain = classes.filter((name) => SIZE_FAMILIES[family].test(name));
  const important = classes.filter((name) => name.startsWith('!') && SIZE_FAMILIES[family].test(name.slice(1)));
  assert(plain.length <= 1 || important.length > 0, `${what}: its ${family} is set twice, and the kit's wins (${plain.join(' ')})`);
  return important[0]?.slice(1) ?? plain[0] ?? null;
}

/** The width that sizes `element`: its own, or that of the nearest box around it, past every `w-full`. */
function widthOf(element: Element, what: string): string | null {
  for (let box: Element | null = element; box; box = box.parentElement) {
    const width = sizeOf(box, 'width', what);
    if (width !== null && width !== 'w-full') return width;
  }
  return null;
}

async function theFieldsKeepTheirSize(mountPage: MountPage): Promise<void> {
  // The panels size their fields: a time 5.5rem wide, a title or an artist 10rem and the 配對到… picker 18rem, the time
  // and text fields with the compact padding. A second plain width or padding beside the kit's loses (see sizeOf): in
  // real Chromium the time fields came out about 176px wide, and their 開始 and 結束 labels wrapped a character a line.
  reset(withAnAdd());
  const { container, unmount } = await mountPage();
  const panels = [await expand(container, 'Late Night Drive'), await expand(container, '月光')];
  const widths: Record<string, string> = {
    開始: 'w-[5.5rem]', 結束: 'w-[5.5rem]', 歌名: 'w-40', 原唱: 'w-40',
    '改名：歌名': 'w-40', '改名：原唱': 'w-40', '新的歌：歌名': 'w-40', '新的歌：原唱': 'w-40',
  };
  const fields = panels.flatMap((panel) => [...panel.querySelectorAll<HTMLInputElement>('input')].filter((input) => input.type === 'text'));
  assert(fields.map((input) => input.getAttribute('aria-label')).join('|') === '開始|結束|改名：歌名|改名：原唱|新的歌：歌名|新的歌：原唱|開始|結束|歌名|原唱',
    `every time and text field of both panels (got ${fields.map((input) => input.getAttribute('aria-label')).join('|')})`);
  for (const input of fields) {
    const label = input.getAttribute('aria-label') ?? '';
    assert(widthOf(input, label) === widths[label], `${label} is ${widths[label]} wide (got ${widthOf(input, label)})`);
    const padding = [sizeOf(input, 'padding-x', label), sizeOf(input, 'padding-y', label)].join(' ');
    assert(padding === 'px-2 py-1', `${label} has the compact padding (got ${padding})`);
  }
  const picker = need(panels[1]?.querySelector('select[aria-label="配對到…"]'), 'the 配對到… picker');
  assert(widthOf(picker, '配對到…') === 'w-72', `the picker is 18rem wide (got ${widthOf(picker, '配對到…')})`);
  await unmount();
  console.log("✓ review page: the panels' time fields, text fields and picker keep the width and padding they are given, beside the kit's own");
}

/** The ichii correction with one song added that the contributor gave no end (the last line pasted, say). */
function withAnAddWithoutAnEnd(): NovaVodCorrectionView {
  const view = withAnAdd();
  view.proposed[5] = { ...need(view.proposed[5], 'the added row'), endTimestamp: null };
  view.match = matchCorrection(view.current, view.proposed);
  assert(view.match.unpairedProposed.join() === '5', 'the fixture: the new row still pairs with nothing');
  return view;
}

/** What 套用 says it waits for: the text its `aria-describedby` points at. */
function applyReason(apply: HTMLButtonElement): string {
  const id = apply.getAttribute('aria-describedby');
  return id === null ? '' : textOf(document.getElementById(id));
}

async function anEndTheApplyNeedsHoldsIt(mountPage: MountPage): Promise<void> {
  // Finding #1. On an approved stream (the ichii one) an add is born approved, and a row with no end on the site
  // stops the export, so the apply refuses an add without one. Ticked, it holds 套用, which says why; the row says so
  // on its line and, open, at its empty end field. An end typed in, and committed (pressing 套用 leaves the field
  // first), lets the apply go.
  reset(loaded(withAnAddWithoutAnEnd()));
  const { container, unmount } = await mountPage();
  const applyButton = () => need(buttonNamed(container, '套用 7 項'), 'the apply button');
  assert(isUnavailable(applyButton()), '套用 waits while a ticked add has no end');
  assert(applyReason(applyButton()) === '還有 1 列需要結束時間', `and says why (got "${applyReason(applyButton())}")`);
  const add = () => rowNamed(container, '月光');
  assert(pillsOf(compactOf(add())).join('|') === `新增|${NEEDS_END}`, `the closed row says what it needs (got ${pillsOf(compactOf(add())).join('|')})`);
  await click(applyButton(), '套用 7 項');
  assert(applyCalls().length === 0, 'a press of 套用 sends nothing');

  // Unticked, the add needs nothing.
  await click(checkboxOf(add()), "the add's tick");
  const fewer = need(buttonNamed(container, '套用 6 項'), 'the apply button');
  assert(isIdle(fewer) && applyReason(fewer) === '' && !textOf(container).includes(NEEDS_END), 'an unticked add holds nothing back');
  await click(checkboxOf(add()), "the add's tick");
  assert(isUnavailable(applyButton()), 'ticked again, it holds 套用 again');

  const panel = await expand(container, '月光');
  const end = inputNamed(panel, '結束');
  const marked = () => end.getAttribute('aria-invalid') === 'true' && textOf(document.getElementById(end.getAttribute('aria-describedby') ?? '')) === NEEDS_END;
  assert(valueOf(end) === '' && marked(), 'its empty end field is marked, with what it needs');
  await focus(end);
  await typeInto(end, '1:09:02');
  applyReply = () => failure(400, { error: 'stop here' });
  await focus(applyButton());
  assert(isIdle(applyButton()) && applyReason(applyButton()) === '', 'leaving the field commits the end, and 套用 can apply');
  assert(!marked() && !textOf(container).includes(NEEDS_END), 'nothing asks for an end any more');
  await click(applyButton(), '套用 7 項');
  deepStrictEqual(lastApply().operations.find((operation) => operation.op === 'addPerformance'), {
    op: 'addPerformance', title: '月光', originalArtist: '張惠妹', timestamp: 3910, endTimestamp: 4142,
  });
  await unmount();
  console.log('✓ review page: on an approved stream a ticked add with no end holds 套用 (還有 1 列需要結束時間), marks its row and its end field, until the end is typed');
}

async function aPipelineStreamsAddNeedsNoEnd(mountPage: MountPage): Promise<void> {
  // Finding #1, as hydai narrowed it (3B). On a stream still in the pipeline the apply creates an add pending, like an
  // imported row, and it is stamped later. So the last line of a start-only paste, which never has an end, holds
  // nothing back: no mark on the row or at its end field, 套用 is available, and the add goes out with no end.
  const view = withAnAddWithoutAnEnd();
  view.stream.status = 'pending';
  reset(loaded(view));
  const { container, unmount } = await mountPage();
  const applyButton = () => need(buttonNamed(container, '套用 7 項'), 'the apply button');
  assert(isIdle(applyButton()) && applyReason(applyButton()) === '', `套用 is not held (got "${applyReason(applyButton())}")`);
  const add = rowNamed(container, '月光');
  assert(checkboxOf(add)?.checked === true, 'the add is ticked');
  assert(pillsOf(compactOf(add)).join('|') === '新增', `the closed row says only that it is new (got ${pillsOf(compactOf(add)).join('|')})`);
  const panel = await expand(container, '月光');
  const end = inputNamed(panel, '結束');
  assert(valueOf(end) === '' && end.getAttribute('aria-invalid') === null && end.getAttribute('aria-describedby') === null, 'its empty end field is not marked');
  assert(!textOf(container).includes(NEEDS_END), 'nothing on the page asks for an end');

  applyReply = () => failure(400, { error: 'stop here' });
  await click(applyButton(), '套用 7 項');
  deepStrictEqual(lastApply().operations.find((operation) => operation.op === 'addPerformance'), {
    op: 'addPerformance', title: '月光', originalArtist: '張惠妹', timestamp: 3910, endTimestamp: null,
  });
  await unmount();
  console.log('✓ review page: on a stream that is not approved a ticked add with no end holds nothing back, and 套用 sends it with no end');
}

async function unchangedPairsCollapse(mountPage: MountPage): Promise<void> {
  // The submission keeps 私奔到月球 as it is but for whitespace round its title, and Moon Halo as it is but for a blank
  // artist where the stream has Unknown: neither differs as typed, so both collapse.
  const view = ichiiCorrectionView();
  const second = need(view.proposed[1], 'the second proposed row');
  view.proposed[1] = { ...second, title: ` ${second.title} `, endTimestamp: 1621 };
  view.proposed[2] = { ...need(view.proposed[2], 'the third proposed row'), originalArtist: '', timestamp: 2248, endTimestamp: 2448 };
  view.match = matchCorrection(view.current, view.proposed);
  assert(view.match.pairs.length === 6, 'the fixture: still six pairs');
  reset(loaded(view));
  const { container, unmount } = await mountPage();
  const titles = rowsOf(container).map(titleOf);
  assert(titles.length === 5 && !titles.includes('私奔到月球') && !titles.includes('Moon Halo'), `the unchanged pairs leave the rows (got ${titles.join('|')})`);
  const toggle = need(buttonNamed(container, '未變更 2 首'), 'the 未變更 line');
  assert(toggle.getAttribute('aria-expanded') === 'false', 'collapsed');
  assert(footerCounts(container) === '已勾選 4 項 · 未勾 2 項', `and counts for nothing (got ${footerCounts(container)})`);
  await click(toggle, '未變更 2 首');
  assert(toggle.getAttribute('aria-expanded') === 'true', 'it opens');
  const unchanged = need(container.querySelector('ol[aria-label="未變更"]'), 'the unchanged rows');
  assert(
    textOf(unchanged).includes('私奔到月球') && textOf(unchanged).includes('Moon Halo') && seekLabels(unchanged) === '跳到 23:14|跳到 27:01|跳到 37:28|跳到 40:48',
    `showing the rows and their times (got ${seekLabels(unchanged)})`,
  );
  await unmount();
  console.log('✓ review page: unchanged pairs (whitespace round a title, a blank artist for Unknown) collapse into 未變更 2 首');
}

/** A row's chips and marks, in the order its line shows them. */
function marksOf(container: HTMLElement, title: string): string {
  return pillsOf(compactOf(rowNamed(container, title))).join('|');
}

async function rowsChangedSinceTheSubmissionAreMarked(mountPage: MountPage): Promise<void> {
  // Finding #2. The contributor compared against Song A to D. Since then another correction moved Song A, Song C was
  // edited and Song D deleted. The submission moved Song B, left Song C out and kept Song D: each row that is not as
  // it was when it was submitted says so, and none of them is ticked.
  const a = row('Song A', 'Artist', 100, 200);
  const b = row('Song B', 'Artist', 300, 400);
  const c = row('Song C', 'Artist', 500, 600);
  const d = row('Song D', 'Artist', 700, 800);
  reset(loaded(correctionView({
    base: [baseRow('p1', a), baseRow('p2', b), baseRow('p3', c), baseRow('p4', d)],
    current: [liveRow('p1', row('Song A', 'Artist', 130, 200)), liveRow('p2', b), liveRow('p3', row('Song C', 'Artist', 510, 600))],
    proposed: [a, row('Song B', 'Artist', 310, 400), d],
  })));
  const { container, unmount } = await mountPage();
  assert(marksOf(container, 'Song A') === '投稿後已變更' && checkboxOf(rowNamed(container, 'Song A')) === null, `the pair it left as it was, moved since (got ${marksOf(container, 'Song A')})`);
  assert(marksOf(container, 'Song B') === '時間' && checkboxOf(rowNamed(container, 'Song B'))?.checked === true, `the row it moved, as it was (got ${marksOf(container, 'Song B')})`);
  assert(marksOf(container, 'Song C') === '刪除|投稿後已變更' && checkboxOf(rowNamed(container, 'Song C'))?.checked === false, `the row it left out, edited since (got ${marksOf(container, 'Song C')})`);
  assert(marksOf(container, 'Song D') === '新增|投稿後已變更' && checkboxOf(rowNamed(container, 'Song D'))?.checked === false, `the row it kept, deleted since (got ${marksOf(container, 'Song D')})`);
  assertNoRawColour(rowList(container).innerHTML, 'the marked rows');
  await unmount();
  console.log('✓ review page: a pair, a delete and an add whose row changed after the submission are marked 投稿後已變更');
}

async function rowsTheContributorCouldNotSeeAreMarked(mountPage: MountPage): Promise<void> {
  // Finding #5. Song B is on the stream but not on the site (its song is pending), so the list the contributor
  // compared against lacked it.
  const a = row('Song A', 'Artist', 100, 200);
  const hidden = liveRow('p2', row('Song B', 'Artist', 302, 398), 'approved', 'pending');
  const base = [baseRow('p1', a)];
  const view = (proposed: RowFields[]) => loaded(correctionView({ base, current: [liveRow('p1', a), hidden], proposed }));

  // Added back at other times, it pairs with the hidden row: marked, ticked as suggested, and its panel says the apply
  // will not put it on the site.
  reset(view([a, row('Song B', 'Artist', 300, 400)]));
  const paired = await mountPage();
  assert(marksOf(paired.container, 'Song B') === '時間|投稿時未顯示|未公開', `the pair says both (got ${marksOf(paired.container, 'Song B')})`);
  assert(!textOf(paired.container).includes(NOTHING_SEEN), 'a list that showed rows is never said to have shown none');
  assert(checkboxOf(rowNamed(paired.container, 'Song B'))?.checked === true, 'and keeps its tick');
  const panel = await expand(paired.container, 'Song B');
  assert(textOf(panel).includes('這場演出目前未公開，套用不會讓它公開'), 'its panel says the apply will not publish it');
  await paired.unmount();

  // Left out, it is a delete nobody suggested: marked, unticked, and not counted as skipped.
  reset(view([row('Song A', 'Artist', 101, 200)]));
  const left = await mountPage();
  assert(marksOf(left.container, 'Song B') === '刪除|投稿時未顯示|未公開', `the delete says both (got ${marksOf(left.container, 'Song B')})`);
  assert(footerCounts(left.container) === '已勾選 1 項 · 未勾 0 項', `and is no skipped suggestion (got ${footerCounts(left.container)})`);
  await left.unmount();

  // Added at its exact times, the pair has nothing to apply and joins 未變更, where its line says the same.
  reset(view([a, row('Song B', 'Artist', 302, 398)]));
  const same = await mountPage();
  await click(buttonNamed(same.container, '未變更 2 首'), '未變更 2 首');
  const unchanged = need(same.container.querySelector('ol[aria-label="未變更"]'), 'the unchanged rows');
  const line = need([...unchanged.children].find((item) => textOf(item.querySelector('b')) === 'Song B'), 'Song B among them');
  assert(pillsOf(line).join('|') === '投稿時未顯示|未公開', `the unchanged line says both (got ${pillsOf(line).join('|')})`);
  await same.unmount();

  // With no base, a row that is not on the site says so too.
  const plain = ichiiCorrectionView();
  plain.current[2] = { ...need(plain.current[2], 'the third current row'), status: 'pending', onSite: false };
  reset(plain);
  const hiddenDelete = await mountPage();
  assert(marksOf(hiddenDelete.container, 'A Tender Moon Tempo') === '刪除|未公開', `a delete not on the site (got ${marksOf(hiddenDelete.container, 'A Tender Moon Tempo')})`);
  await hiddenDelete.unmount();
  console.log('✓ review page: a row the contributor never saw is marked 投稿時未顯示, one not on the site 未公開 (its pair says the apply will not publish it), in 未變更 too');
}

const REPEAT_HINT_SONG_A = '和「Song A」1:40 是同一首、時間重疊，預設不套用';
const REPEAT_HINT_SONG_B = '和「Song B」5:00 是同一首、時間重疊，預設不套用';

async function aRepeatIsMarkedAndNamesTheRowItRepeats(mountPage: MountPage): Promise<void> {
  // Finding #3. The contributor loaded Song A and Song B and pasted their own list under it, Song B 10 s late. The
  // loaded copies pair with the live rows and agree with them, so they fold into 未變更; the own copies are adds that
  // repeat a row the stream keeps: marked 重複, unticked, and each says which row it repeats.
  const a = row('Song A', 'Artist', 100, 200);
  const b = row('Song B', 'Artist', 300, 400);
  reset(correctionView({
    base: [baseRow('p1', a), baseRow('p2', b)],
    current: [liveRow('p1', a), liveRow('p2', b)],
    proposed: [a, a, b, row('Song B', 'Artist', 310, 400)],
  }));
  const { container, unmount } = await mountPage();
  assert(rowsOf(container).map(titleOf).join('|') === 'Song A|Song B', `the repeats are the rows to review (got ${rowsOf(container).map(titleOf).join('|')})`);
  assert(buttonNamed(container, '未變更 2 首') !== null, 'and the loaded copies are folded under 未變更');
  for (const title of ['Song A', 'Song B']) {
    assert(marksOf(container, title) === '新增|重複', `${title} is an add marked 重複 (got ${marksOf(container, title)})`);
    assert(checkboxOf(rowNamed(container, title))?.checked === false, `${title} starts unticked`);
  }
  assert(footerCounts(container) === '已勾選 0 項 · 未勾 2 項', `so the apply has nothing to send (got ${footerCounts(container)})`);
  assert(need(buttonNamed(container, '套用 0 項'), 'the apply button').disabled, '套用 is disabled');
  assertNoRawColour(rowList(container).innerHTML, 'the repeated rows');

  // The panel says which row each one repeats, and when it starts.
  assert(textOf(await expand(container, 'Song A')).includes(REPEAT_HINT_SONG_A), 'Song A names the row it repeats');
  assert(textOf(await expand(container, 'Song B')).includes(REPEAT_HINT_SONG_B), 'Song B names the row it repeats');

  // A default only: ticked, the own copy is added like any other add, and still says what it repeats.
  await click(checkboxOf(rowNamed(container, 'Song B')), "Song B's tick");
  assert(footerCounts(container) === '已勾選 1 項 · 未勾 1 項', `ticked, it counts (got ${footerCounts(container)})`);
  assert(marksOf(container, 'Song B') === '新增|重複', 'and keeps its mark');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 1 項'), '套用 1 項');
  deepStrictEqual(lastApply().operations, [{ op: 'addPerformance', title: 'Song B', originalArtist: 'Artist', timestamp: 310, endTimestamp: 400 }]);
  deepStrictEqual(lastApply().skipped, { time: 0, title: 0, add: 1, delete: 0 });
  await unmount();

  // The same song sung again later, which nothing overlaps, is an add like any other: ticked, and it says nothing of repeating.
  reset(loaded(correctionView({
    base: [baseRow('p1', a), baseRow('p2', b)],
    current: [liveRow('p1', a), liveRow('p2', b)],
    proposed: [a, b, row('Song A', 'Artist', 5000, 5100)],
  })));
  const encore = await mountPage();
  assert(marksOf(encore.container, 'Song A') === '新增', `an encore is only an add (got ${marksOf(encore.container, 'Song A')})`);
  assert(checkboxOf(rowNamed(encore.container, 'Song A'))?.checked === true, 'ticked');
  assert(!textOf(await expand(encore.container, 'Song A')).includes('是同一首'), 'and its panel names no row');
  await encore.unmount();
  console.log('✓ review page: an add that repeats a row the stream keeps is marked 重複, starts unticked and names the row; an encore is no repeat');
}

/**
 * Song B is on the stream but off the site: a row whose song is pending, and whose own status is `performance`. The
 * contributor added Song B back at other times, so it pairs with that row.
 */
function withARowOffTheSite(performance: Status): NovaVodCorrectionView {
  const a = row('Song A', 'Artist', 100, 200);
  return correctionView({
    base: [baseRow('p1', a)],
    current: [liveRow('p1', a), liveRow('p2', row('Song B', 'Artist', 302, 398), performance, 'pending')],
    proposed: [a, row('Song B', 'Artist', 300, 400)],
  });
}

async function theNotOnSiteHintFollowsTheChoice(mountPage: MountPage): Promise<void> {
  // An apply never changes a performance's status, but a relink gives it another song. On a public stream that song
  // is approved, or approved along with the apply, so a relinked approved row goes on the site. The hint that the row
  // stays off the site holds while the title keeps its song, and on every choice for a row that cannot go on.
  reset(withARowOffTheSite('approved'));
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Song B');
  assert(textOf(panel).includes(NOT_ON_SITE), 'ignored, the row keeps its pending song: it stays off the site');
  await click(radioNamed(panel, '這首歌改名為'), 'the rename choice');
  assert(textOf(panel).includes(NOT_ON_SITE), 'renamed, its song keeps its status: it stays off the site');
  await click(radioNamed(panel, '改連到既有的歌'), 'the existing song choice');
  assert(textOf(panel).includes(NOT_ON_SITE), 'no song picked yet, nothing is relinked: it stays off the site');
  const matches = [song('s20', 'Song B (Live)', 'approved'), song('s21', 'Song B (Acoustic)', 'pending')];
  songSearchReply = (call) => {
    const data = matches.filter((match) => match.status === call.params.get('status'));
    return ok({ data, total: data.length, page: 1, pageSize: 20, totalPages: 1 });
  };
  await typeInto(need(panel.querySelector<HTMLInputElement>('input[type="search"]'), "the picker's search field"), 'Song B');
  const option = (title: string) =>
    need([...panel.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => textOf(item).includes(title)), `the option ${title}`);
  await click(option('Song B (Live)'), 'the approved song');
  assert(!textOf(panel).includes(NOT_ON_SITE), 'relinked onto an approved song, the row goes on the site: no such hint');
  await click(option('Song B (Acoustic)'), 'the pending song');
  assert(!textOf(panel).includes(NOT_ON_SITE) && textOf(panel).includes(PENDING_HINT), 'onto a pending song the apply approves: that hint, not this one');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(!textOf(panel).includes(NOT_ON_SITE), 'onto a new song: no such hint');
  await unmount();

  // A row whose own performance is not approved stays off the site, relinked or not.
  reset(withARowOffTheSite('pending'));
  const pendingRow = await mountPage();
  const pendingPanel = await expand(pendingRow.container, 'Song B');
  await click(radioNamed(pendingPanel, '改連到新的歌'), 'the new song choice');
  assert(textOf(pendingPanel).includes(NOT_ON_SITE), 'a pending performance stays off the site');
  await pendingRow.unmount();

  // On a stream that is not public, an apply that would put a row on the site is refused: a relink leaves it off too.
  const pipeline = withARowOffTheSite('approved');
  pipeline.stream.status = 'pending';
  reset(pipeline);
  const notPublic = await mountPage();
  const notPublicPanel = await expand(notPublic.container, 'Song B');
  await click(radioNamed(notPublicPanel, '改連到新的歌'), 'the new song choice');
  assert(textOf(notPublicPanel).includes(NOT_ON_SITE), 'a relink on a stream that is not public publishes nothing');
  await notPublic.unmount();
  console.log('✓ review page: 這場演出目前未公開，套用不會讓它公開 shows while the apply leaves the row off the site: its song kept, its performance not approved, or its stream not public');
}

/**
 * p9 is a row of pending Song Q at 15:00, with an end, so it is off the site and waits for nothing. `performance` is its
 * own status. The contributor moved Song A and p9 a little, so both pairs are listed with a panel, and added another
 * performance of Song Q at 11:40–13:20, which resolves to that pending song (`s9`).
 */
function withAHiddenRowAndAnAddOfItsSong(performance: Status = 'approved'): NovaVodCorrectionView {
  const a = row('Song A', 'Artist', 100, 200);
  const q = row('Song Q', 'Artist', 900, 1000);
  const view = correctionView({
    base: [baseRow('p1', a)],
    current: [liveRow('p1', a), liveRow('p9', q, performance, 'pending')],
    proposed: [row('Song A', 'Artist', 105, 200), row('Song Q', 'Artist', 700, 800), row('Song Q', 'Artist', 902, 1000)],
  });
  for (const proposed of view.proposed) {
    if (proposed.title === 'Song Q') proposed.existingSong = { id: 's9', status: 'pending' };
  }
  return loaded(view);
}

async function theOffSiteHintGivesWayToAPromotionFromAnotherRow(mountPage: MountPage): Promise<void> {
  // r3 #12. p9's panel says the apply will not publish it: its performance is approved, its song pending, and its own
  // choice keeps the song. The apply approves a pending song that any ticked add or title choice of the draft lands on,
  // which puts every approved row of it on the site, so the hint holds only while nothing in the draft does: it was said
  // beside the add that publishes the row.
  reset(withAHiddenRowAndAnAddOfItsSong());
  const { container, unmount } = await mountPage();
  const [add, p9] = rowsOf(container).filter((row) => titleOf(row) === 'Song Q');
  const addRow = need(add, 'the add of Song Q');
  const p9Row = need(p9, "p9's row");
  await click(expandOf(p9Row), "the expand control of p9's row");
  const p9Panel = need(panelOf(p9Row), "p9's panel");

  // S1. The add of Song Q is ticked and lands on Song Q, a pending song: the apply approves it, and p9 goes on the site.
  assert(checkboxOf(addRow)?.checked === true, 'the add of Song Q opens ticked');
  assert(!textOf(p9Panel).includes(NOT_ON_SITE), 'S1: the apply approves Song Q with the add, which publishes p9: its panel does not say it stays off');
  // Unticked, the add lands nowhere, and p9 stays off the site.
  await click(checkboxOf(addRow), "the add's tick");
  assert(textOf(p9Panel).includes(NOT_ON_SITE), 'the add unticked, nothing approves Song Q: p9 stays off the site, and says so');

  // S2. Song A's row relinked to Song Q lands on it too.
  const aPanel = await expand(container, 'Song A');
  await click(radioNamed(aPanel, '改連到既有的歌'), 'the existing song choice');
  songSearchReply = (call) => {
    const data = [song('s9', 'Song Q', 'pending')].filter((match) => match.status === call.params.get('status'));
    return ok({ data, total: data.length, page: 1, pageSize: 20, totalPages: 1 });
  };
  await typeInto(need(aPanel.querySelector<HTMLInputElement>('input[type="search"]'), "the picker's search field"), 'Song Q');
  const pick = need([...aPanel.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => textOf(item).includes('Song Q')), 'the pending Song Q');
  await click(pick, 'the pending song');
  assert(textOf(aPanel).includes(PENDING_HINT), "Song A's row lands on Song Q, which the apply approves");
  assert(!textOf(p9Panel).includes(NOT_ON_SITE), "S2: that relink publishes p9 too: its panel does not say it stays off");
  await click(radioNamed(aPanel, '忽略，維持目前'), 'the ignore choice');
  assert(textOf(p9Panel).includes(NOT_ON_SITE), "Song A's row kept on its own song, nothing approves Song Q: p9 stays off the site again");
  await unmount();

  // The apply publishes a row only if it is approved itself, on a stream that is public, so a promotion that cannot
  // reach p9 leaves the hint where it was, with the add ticked.
  const notApproved = withAHiddenRowAndAnAddOfItsSong('pending');
  const notPublic = withAHiddenRowAndAnAddOfItsSong();
  notPublic.stream.status = 'pending';
  for (const [what, view] of [['p9 is not approved itself', notApproved], ['the stream is not public', notPublic]] as const) {
    reset(view);
    const other = await mountPage();
    const [, hiddenRow] = rowsOf(other.container).filter((row) => titleOf(row) === 'Song Q');
    await click(expandOf(need(hiddenRow, "p9's row")), "the expand control of p9's row");
    assert(textOf(need(panelOf(need(hiddenRow, "p9's row")), "p9's panel")).includes(NOT_ON_SITE), `${what}: the apply publishes nothing, so p9 stays off the site`);
    await other.unmount();
  }

  // The rule itself, asked of p9's pair against the pending songs the apply approves: it is the row's own status and the
  // stream's that decide, so a stream that is not public leaves the hint whatever it is asked against.
  const stays = (view: NovaVodCorrectionView, promoted: ReadonlySet<string>): boolean => {
    const draft = initialDraft(view);
    const pair = reviewRows(view, draft, draftFlags(draft, view)).rows.find((entry): entry is PairRow => entry.kind === 'pair' && entry.current.performanceId === 'p9');
    return staysOffSite(view, need(pair, "p9's pair"), promoted);
  };
  const songQ = new Set(['s9']);
  const publicStream = withAHiddenRowAndAnAddOfItsSong();
  assert(stays(publicStream, new Set()), 'an approved row of a pending song stays off while nothing approves the song');
  assert(!stays(publicStream, songQ), 'and goes on the site once the apply approves it');
  assert(stays(publicStream, new Set(['s1'])), 'another song approved is none of its business');
  assert(stays(withAHiddenRowAndAnAddOfItsSong('pending'), songQ), 'a row that is not approved itself stays off');
  assert(stays(notPublic, songQ), 'and so does any row of a stream that is not public');
  console.log('✓ review page: the not-on-the-site hint of a hidden row goes while a ticked add or a relink of another row lands on its pending song, and stays where the apply cannot publish the row');
}

/**
 * Song B is an approved row of a pending song, off the site, and neither the stream nor the submission gives it an
 * end: the contributor moved its start by two seconds on a line with no end.
 */
function withAnEndlessRowOffTheSite(): NovaVodCorrectionView {
  const a = row('Song A', 'Artist', 100, 200);
  return correctionView({
    base: [baseRow('p1', a)],
    current: [liveRow('p1', a), liveRow('p2', row('Song B', 'Artist', 302, null), 'approved', 'pending')],
    proposed: [a, row('Song B', 'Artist', 300, null)],
  });
}

async function aRelinkThatPublishesARowNeedsItsEnd(mountPage: MountPage): Promise<void> {
  // Codex P1 on PR #236. On a public stream a relink gives Song B's approved row a song that is approved, or approved
  // along with the apply: it goes on the site, where a row with no end stops the export. 改連到新的歌 then holds 套用,
  // which says why, and the row says so on its line and at its empty end field, until an end is typed.
  reset(loaded(withAnEndlessRowOffTheSite()));
  const { container, unmount } = await mountPage();
  assert(isIdle(need(buttonNamed(container, '套用 1 項'), 'the apply button')), 'the time change alone holds nothing back');
  const panel = await expand(container, 'Song B');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  const applyButton = () => need(buttonNamed(container, '套用 2 項'), 'the apply button');
  assert(isUnavailable(applyButton()) && applyReason(applyButton()) === '還有 1 列需要結束時間', `套用 waits, and says why (got "${applyReason(applyButton())}")`);
  assert(marksOf(container, 'Song B') === `時間|${NEEDS_END}|投稿時未顯示|未公開`, `the row says what it needs (got ${marksOf(container, 'Song B')})`);
  const end = inputNamed(panel, '結束');
  const marked = () => end.getAttribute('aria-invalid') === 'true' && textOf(document.getElementById(end.getAttribute('aria-describedby') ?? '')) === NEEDS_END;
  assert(valueOf(end) === '' && marked(), 'its empty end field is marked, with what it needs');
  await click(applyButton(), '套用 2 項');
  assert(applyCalls().length === 0, 'a press of 套用 sends nothing');

  // Kept on its song, the row stays off the site and needs no end.
  await click(radioNamed(panel, '忽略，維持目前'), 'the ignore choice');
  assert(isIdle(need(buttonNamed(container, '套用 1 項'), 'the apply button')) && !textOf(container).includes(NEEDS_END), 'ignored, nothing waits for an end');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  assert(isUnavailable(applyButton()), 'relinked again, 套用 waits again');

  await focus(end);
  await typeInto(end, '6:00');
  applyReply = () => failure(400, { error: 'stop here' });
  await focus(applyButton());
  assert(isIdle(applyButton()) && applyReason(applyButton()) === '', 'leaving the field commits the end, and 套用 can apply');
  assert(!marked() && !textOf(container).includes(NEEDS_END), 'nothing asks for an end any more');
  await click(applyButton(), '套用 2 項');
  deepStrictEqual(lastApply().operations, [
    { op: 'setTimes', performanceId: 'p2', timestamp: 300, endTimestamp: 360 },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song B', originalArtist: 'Artist', expectedSongStatus: null },
  ]);
  await unmount();
  console.log('✓ review page: on a public stream 改連到新的歌 of an approved row off the site with no end holds 套用 (還有 1 列需要結束時間) and marks the row and its end field, until the end is typed');
}

/** `withAnEndlessRowOffTheSite`, but the contributor gave Song B an end, 7:00: its pair proposes it. */
function withAnEndlessRowGivenAnEnd(): NovaVodCorrectionView {
  const a = row('Song A', 'Artist', 100, 200);
  return correctionView({
    base: [baseRow('p1', a)],
    current: [liveRow('p1', a), liveRow('p2', row('Song B', 'Artist', 302, null), 'approved', 'pending')],
    proposed: [a, row('Song B', 'Artist', 300, 420)],
  });
}

async function anEndThatIsShownButNotSentIsMarked(mountPage: MountPage): Promise<void> {
  // Task 11 M1. 改連到新的歌 puts Song B's row on the site, so it needs an end once the apply is done: with 時間
  // unticked that is the row's own, none. Its 結束 field still shows the end the contributor gave (7:00), which is not
  // sent, and typing that end again commits nothing. So the field is marked, and says that ticking 時間 sends it.
  reset(loaded(withAnEndlessRowGivenAnEnd()));
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Song B');
  await click(radioNamed(panel, '改連到新的歌'), 'the new song choice');
  const both = () => need(buttonNamed(container, '套用 2 項'), 'the apply button');
  assert(isIdle(both()), 'ticked, the end the contributor gave goes with the relink, and nothing waits');
  const box = need(panel.querySelector<HTMLInputElement>('input[type="checkbox"]'), "the panel's 時間 box");
  await click(box, "the panel's 時間 box");
  const relinkOnly = () => need(buttonNamed(container, '套用 1 項'), 'the apply button');
  assert(
    isUnavailable(relinkOnly()) && applyReason(relinkOnly()) === '還有 1 列需要結束時間',
    `unticked, 套用 waits for an end (got "${applyReason(relinkOnly())}")`,
  );
  const end = inputNamed(panel, '結束');
  const hint = () => textOf(document.getElementById(end.getAttribute('aria-describedby') ?? ''));
  assert(valueOf(end) === '7:00', `the field still shows the end the contributor gave (got ${valueOf(end)})`);
  assert(end.getAttribute('aria-invalid') === 'true' && hint() === UNSENT_END, `it is marked, and says what sends it (got "${hint()}")`);

  // The same end typed again commits nothing: only 時間 sends it.
  await focus(end);
  await typeInto(end, '7:00');
  await blur(end);
  assert(isUnavailable(relinkOnly()), 'retyped, it is still not sent, and 套用 still waits');
  assert(end.getAttribute('aria-invalid') === 'true' && hint() === UNSENT_END, 'and the field still says what sends it');

  await click(box, "the panel's 時間 box");
  assert(isIdle(both()) && applyReason(both()) === '', 'ticking 時間 lets the apply go');
  assert(end.getAttribute('aria-invalid') === null && end.getAttribute('aria-describedby') === null, 'and the field is not marked');
  assert(!textOf(container).includes(NEEDS_END) && !textOf(container).includes(UNSENT_END), 'nothing asks for an end any more');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(both(), '套用 2 項');
  deepStrictEqual(lastApply().operations, [
    { op: 'setTimes', performanceId: 'p2', timestamp: 300, endTimestamp: 420 },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song B', originalArtist: 'Artist', expectedSongStatus: null },
  ]);
  await unmount();
  console.log('✓ review page: a relinked row whose end field shows an end that is not sent (時間 unticked) marks the field and says that ticking 時間 sends it; ticking 時間 lets the apply go');
}

/**
 * The 2026-11-16 review's #12 on a public stream: p9 is an approved row of pending Song Q at 15:00 with no end, off the
 * site. The submission keeps Song A, adds another performance of Song Q at 11:40–13:20, which resolves to that song,
 * and gives p9's line, its last, the start `lineStart` (15:05 unless given) and no end.
 */
function withAnEndlessRowOfAPendingSong(lineStart = 905): NovaVodCorrectionView {
  const a = row('Song A', 'Artist', 100, 200);
  const view = correctionView({
    base: null,
    current: [liveRow('p1', a), liveRow('p9', row('Song Q', 'Artist', 900, null), 'approved', 'pending')],
    proposed: [a, row('Song Q', 'Artist', 700, 800), row('Song Q', 'Artist', lineStart, null)],
  });
  for (const proposed of view.proposed) {
    if (proposed.title === 'Song Q') proposed.existingSong = { id: 's9', status: 'pending' };
  }
  return view;
}

async function aPromotionHoldsTheApplyForAnEndlessRowHere(mountPage: MountPage): Promise<void> {
  // The apply approves the pending song the add lands on, which puts p9 on the site with no end: the worker refuses that
  // (409 would_publish_endless). So 套用 waits, and says why, and p9's row says so on its line and at its empty end
  // field, until an end is typed.
  reset(loaded(withAnEndlessRowOfAPendingSong()));
  const { container, unmount } = await mountPage();
  const applyButton = () => need(buttonNamed(container, '套用 2 項'), 'the apply button');
  assert(isUnavailable(applyButton()) && applyReason(applyButton()) === '還有 1 列需要結束時間', `套用 waits, and says why (got "${applyReason(applyButton())}")`);
  const [add, p9] = rowsOf(container).filter((row) => titleOf(row) === 'Song Q');
  const addRow = need(add, 'the add of Song Q');
  const p9Row = need(p9, "p9's row");
  assert(pillsOf(compactOf(addRow)).join('|') === '新增', `the add has its own end, and needs none (got ${pillsOf(compactOf(addRow)).join('|')})`);
  assert(pillsOf(compactOf(p9Row)).join('|') === `時間|${NEEDS_END}|未公開`, `p9's row says what it needs (got ${pillsOf(compactOf(p9Row)).join('|')})`);

  await click(expandOf(p9Row), "the expand control of p9's row");
  const panel = need(panelOf(p9Row), "p9's panel");
  const end = inputNamed(panel, '結束');
  const marked = () => end.getAttribute('aria-invalid') === 'true' && textOf(document.getElementById(end.getAttribute('aria-describedby') ?? '')) === NEEDS_END;
  assert(valueOf(end) === '' && marked(), 'its empty end field is marked, with what it needs');
  await focus(end);
  await typeInto(end, '18:20');
  applyReply = () => failure(400, { error: 'stop here' });
  await focus(applyButton());
  assert(isIdle(applyButton()) && applyReason(applyButton()) === '', 'leaving the field commits the end, and 套用 can apply');
  assert(!marked() && !textOf(container).includes(NEEDS_END), 'nothing asks for an end any more');
  await click(applyButton(), '套用 2 項');
  deepStrictEqual(lastApply().operations, [
    { op: 'setTimes', performanceId: 'p9', timestamp: 905, endTimestamp: 1100 },
    { op: 'addPerformance', title: 'Song Q', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 },
  ]);
  await unmount();
  console.log('✓ review page: an add onto a pending song whose approved row here has no end holds 套用 (還有 1 列需要結束時間) and marks that row and its end field, until the end is typed');
}

async function aHeldRowIsNeverFoldedAway(mountPage: MountPage): Promise<void> {
  // p9's line is p9 exactly (15:00, no end), so the two rows of its pair agree, which would fold it into 未變更, where a
  // row has no panel. Held, it needs an end only its panel can give: it stays listed, its end field reachable. Given
  // that end, its time change applies, so it stays listed while the curator works on it.
  reset(loaded(withAnEndlessRowOfAPendingSong(900)));
  const { container, unmount } = await mountPage();
  const held = need(buttonNamed(container, '套用 1 項'), 'the apply button');
  assert(isUnavailable(held) && applyReason(held) === '還有 1 列需要結束時間', `套用 waits, and says why (got "${applyReason(held)}")`);
  assert(textOf(container).includes('未變更 1 首'), 'Song A alone folds into 未變更');
  const p9Row = need(rowsOf(container).filter((row) => titleOf(row) === 'Song Q')[1], "p9's row, listed after the add");
  assert(pillsOf(compactOf(p9Row)).join('|') === `${NEEDS_END}|未公開`, `it suggests nothing, and says what it needs (got ${pillsOf(compactOf(p9Row)).join('|')})`);

  await click(expandOf(p9Row), "the expand control of p9's row");
  const panel = need(panelOf(p9Row), "p9's panel");
  const end = inputNamed(panel, '結束');
  assert(valueOf(end) === '' && end.getAttribute('aria-invalid') === 'true', 'its empty end field is reachable, and marked');
  await focus(end);
  await typeInto(end, '18:20');
  applyReply = () => failure(400, { error: 'stop here' });
  await focus(held);
  assert(rowsOf(container).includes(p9Row) && panelOf(p9Row) !== null, 'given an end, it stays listed with its panel open');
  const both = need(buttonNamed(container, '套用 2 項'), 'the apply button');
  assert(isIdle(both) && applyReason(both) === '', '套用 can apply');
  await click(both, '套用 2 項');
  deepStrictEqual(lastApply().operations, [
    { op: 'setTimes', performanceId: 'p9', endTimestamp: 1100 },
    { op: 'addPerformance', title: 'Song Q', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 },
  ]);
  await unmount();
  console.log('✓ review page: a held pair whose two rows agree is listed, not folded into 未變更, so its end can be typed; given one, it stays listed');
}

/** #12 as it was found: the add of Song Q at 11:40–13:20 is the submission's one Song Q line, and pairs with p9 by title. */
function withTheAddAsTheOnlyLineOfSongQ(): NovaVodCorrectionView {
  const a = row('Song A', 'Artist', 100, 200);
  const view = correctionView({
    base: null,
    current: [liveRow('p1', a), liveRow('p9', row('Song Q', 'Artist', 900, null), 'approved', 'pending')],
    proposed: [a, row('Song Q', 'Artist', 700, 800)],
  });
  need(view.proposed[1], 'the Song Q line').existingSong = { id: 's9', status: 'pending' };
  return view;
}

async function aHeldDeleteSaysHowToReleaseIt(mountPage: MountPage): Promise<void> {
  // Split from the line it pairs with, p9 is an unticked delete beside the add of Song Q, whose promotion would publish
  // p9 with no end. A delete has no end field, so its panel says how to release the hold; ticked, the delete releases
  // it, and the hint goes.
  reset(withTheAddAsTheOnlyLineOfSongQ());
  const { container, unmount } = await mountPage();
  await click(need(buttonNamed(await expand(container, 'Song Q'), '拆開配對'), 'the split button'), '拆開配對');
  const removal = need(rowsOf(container).find((row) => pillsOf(compactOf(row)).includes('刪除')), "p9's delete");
  assert(pillsOf(compactOf(removal)).join('|') === `刪除|${NEEDS_END}|未公開`, `the delete says what it needs (got ${pillsOf(compactOf(removal)).join('|')})`);
  const held = need(buttonNamed(container, '套用 1 項'), 'the apply button');
  assert(isUnavailable(held) && applyReason(held) === '還有 1 列需要結束時間', `套用 waits, and says why (got "${applyReason(held)}")`);

  await click(expandOf(removal), "the expand control of p9's delete");
  const panel = need(panelOf(removal), "the delete's panel");
  assert(textOf(panel).includes(HELD_DELETE), 'its panel says how to release the hold');
  await click(need(checkboxOf(removal), "the delete's tick"), "the delete's tick");
  assert(!textOf(panel).includes(HELD_DELETE), 'ticked, the delete releases it: the hint goes');
  assert(textOf(panel).includes('粉絲的收藏會失效'), 'and the warning of a delete stays');
  const both = need(buttonNamed(container, '套用 2 項'), 'the apply button');
  assert(isIdle(both) && applyReason(both) === '', '套用 can apply');
  await unmount();
  console.log('✓ review page: a held delete says how to release the hold (tick the delete, or untick what approves the song), until it is ticked');
}

async function aStreamThatShowedNothingSaysSoOnce(mountPage: MountPage): Promise<void> {
  // A correction of a stream with no song on the site yet (its base is []): the contributor saw none of its rows. The
  // page says so once, above the rows, rather than marking every row 投稿時未顯示; every other mark stays.
  const b = row('Song B', 'Artist', 300, 400);
  reset(correctionView({
    base: [],
    current: [liveRow('p1', row('Song A', 'Artist', 100, 200)), liveRow('p2', b, 'approved', 'pending'), liveRow('p3', row('Song C', 'Artist', 500, 600))],
    proposed: [row('Song A', 'Artist', 101, 200), b],
  }));
  const { container, unmount } = await mountPage();
  assert(textOf(container).split(NOTHING_SEEN).length === 2, 'the page says once that the contributor saw no row');
  const said = need([...container.querySelectorAll<HTMLElement>('div')].reverse().find((box) => textOf(box) === NOTHING_SEEN), 'the line');
  assert(Boolean(said.compareDocumentPosition(rowList(container)) & Node.DOCUMENT_POSITION_FOLLOWING), 'above the rows');
  assert(marksOf(container, 'Song A') === '時間', `a pair marks nothing of it (got ${marksOf(container, 'Song A')})`);
  assert(marksOf(container, 'Song C') === '刪除', `nor does a delete (got ${marksOf(container, 'Song C')})`);
  await click(buttonNamed(container, '未變更 1 首'), '未變更 1 首');
  const unchanged = need(container.querySelector('ol[aria-label="未變更"]'), 'the unchanged rows');
  assert(pillsOf(unchanged).join('|') === '未公開', `nor an unchanged row, which keeps its other marks (got ${pillsOf(unchanged).join('|')})`);
  await unmount();

  // A stream with no row yet (the usual pipeline stream) has no row the contributor did not see: every row is one
  // they add, so the line would be untrue, and is not said.
  const empty = correctionView({ base: [], current: [], proposed: [row('Song A', 'Artist', 100, 200), row('Song B', 'Artist', 300, 400)] });
  empty.stream.status = 'pending';
  reset(empty);
  const adds = await mountPage();
  assert(rowsOf(adds.container).map(titleOf).join('|') === 'Song A|Song B', `the two adds are listed (got ${rowsOf(adds.container).map(titleOf).join('|')})`);
  assert(!textOf(adds.container).includes(NOTHING_SEEN), 'a stream with no row says nothing of rows the contributor did not see');
  await adds.unmount();

  // With no base there is nothing to say.
  reset();
  const plain = await mountPage();
  assert(!textOf(plain.container).includes(NOTHING_SEEN), 'a review with no base says nothing of what the contributor saw');
  await plain.unmount();
  console.log('✓ review page: a stream that showed no song when the correction was sent says so once, above the rows, not on every row, and not at all while it has no row');
}

// --- The guard: what a review opens with unticked, why, and 全選 ---

const BASE_MISSING = '這份投稿沒有記錄投稿者當時看到的歌單，所有變更都預設不勾，請逐項確認。';
const BASE_UNVERIFIED = '投稿者沒有在送出的地方載入目前歌單，無法確認他看到的是哪一版，所有變更都預設不勾，請逐項確認。';
const PASTED_LIST = '這份投稿看起來貼了兩份歌單，新增的歌都預設不勾。';
/** How every hint of a row the guard held back ends. */
const HELD_BACK = '預設不勾。';

/** The review of `proposed` (in the order submitted) against live rows `p1`, `p2`, … of `current`, loaded (`loaded`). */
function loadedReview(current: readonly RowFields[], proposed: readonly RowFields[]): NovaVodCorrectionView {
  return loaded(correctionView({ base: null, current: current.map((fields, index) => liveRow(`p${index + 1}`, fields)), proposed }));
}

const ALPHA = row('Alpha', 'Artist A', 100, 340);
const BRAVO = row('Bravo', 'Artist B', 400, 640);
const CHARLIE = row('Charlie', 'Artist C', 700, 940);
const DELTA = row('Delta', 'Artist D', 1000, 1240);

/** Bravo typed 15 minutes later than the stream has it, Alpha and Charlie as they are, and Delta left out. */
function withBravoMovedFar(): NovaVodCorrectionView {
  return loadedReview([ALPHA, BRAVO, CHARLIE, DELTA], [ALPHA, row('Bravo', 'Artist B', 1300, 1540), CHARLIE]);
}

/**
 * Song 1 to Song 4 as loaded, Song 4 moved 10 s, and under them the contributor's own copy of the list, spelled another
 * way, each line 40 s before its song: four adds, each near the start of a row of the stream.
 */
function withAPastedList(): NovaVodCorrectionView {
  const songs = [row('Song 1', 'Artist 1', 100, 340), row('Song 2', 'Artist 2', 400, 640), row('Song 3', 'Artist 3', 700, 940), row('Song 4', 'Artist 4', 1000, 1240)];
  return loadedReview(songs, [
    ...songs.slice(0, 3),
    row('Song 4', 'Artist 4', 1010, 1250),
    row('Song 1 (copy)', 'Artist 1', 60, 360),
    row('Song 2 (copy)', 'Artist 2', 360, 660),
    row('Song 3 (copy)', 'Artist 3', 660, 960),
    row('Song 4 (copy)', 'Artist 4', 960, null),
  ]);
}

/** The line above the rows that says `text`, which must be there. */
function noteAboveTheRows(container: HTMLElement, text: string): void {
  assert(textOf(container).split(text).length === 2, `the page says it once: ${text}`);
  const said = need([...container.querySelectorAll<HTMLElement>('div')].reverse().find((box) => textOf(box) === text), `the line ${text}`);
  assert(Boolean(said.compareDocumentPosition(rowList(container)) & Node.DOCUMENT_POSITION_FOLLOWING), `above the rows: ${text}`);
}

async function aBaseNullReviewTicksNothing(mountPage: MountPage): Promise<void> {
  // Review Focus 5. A correction Nova stored before it kept a base (base null, base_verified 0), as every one pending at
  // the deploy is: the review cannot tell what the contributor saw, so nothing opens ticked, and the page says so once,
  // above the rows. No row is marked for it, and no panel says it again.
  reset(ichiiCorrectionView());
  const { container, unmount } = await mountPage();
  noteAboveTheRows(container, BASE_MISSING);
  assert(!rowsOf(container).some((row) => checkboxOf(row)?.checked === true), 'no row opens ticked');
  assert(footerCounts(container) === '已勾選 0 項 · 未勾 8 項', `the six time changes, the typo and the delete are left (got ${footerCounts(container)})`);
  assert(need(buttonNamed(container, '套用 0 項'), 'the apply button').disabled, 'so 套用 0 項 has nothing to send');
  assert(marksOf(container, 'Late Night Drive') === '時間|歌名' && marksOf(container, 'Moon River') === '時間', 'a row says only what it suggests');
  assert(!textOf(await expand(container, 'Moon River')).includes(HELD_BACK), 'and its panel nothing of the base');
  await unmount();
  console.log('✓ review page: a review with no base opens with nothing ticked (套用 0 項) and says so once, above the rows');
}

async function anUnverifiedReviewSaysSo(mountPage: MountPage): Promise<void> {
  // Nova recorded the list as it stood when the correction was sent, but no revision showed it is the one the
  // contributor saw (they did not load it where they sent it from): nothing opens ticked either, and the page says why.
  const view = ichiiLoadedView();
  view.baseVerified = false;
  reset(view);
  const { container, unmount } = await mountPage();
  noteAboveTheRows(container, BASE_UNVERIFIED);
  assert(!textOf(container).includes(BASE_MISSING), 'a base was recorded: the page does not say there is none');
  assert(!rowsOf(container).some((row) => checkboxOf(row)?.checked === true), 'no row opens ticked');
  assert(footerCounts(container) === '已勾選 0 項 · 未勾 8 項', `everything is left (got ${footerCounts(container)})`);
  await unmount();

  // Confirmed, the same review opens with its six time edits, and says nothing of its base.
  reset(ichiiLoadedView());
  const confirmed = await mountPage();
  assert(buttonNamed(confirmed.container, '套用 6 項') !== null, 'confirmed: the six time edits open ticked');
  assert(![BASE_MISSING, BASE_UNVERIFIED, PASTED_LIST].some((text) => textOf(confirmed.container).includes(text)), 'and no banner');
  await confirmed.unmount();
  console.log('✓ review page: a review whose base no revision confirmed opens with nothing ticked and says why; confirmed, it opens with its defaults');
}

async function aPastedListSaysSoAndHoldsTheAdds(mountPage: MountPage): Promise<void> {
  // Four adds, each starting near a row of the stream: the loaded list pasted again under itself, read as a second
  // list. The page says so once, above the rows, and every add opens unticked, marked; Song 4's move keeps its tick.
  reset(withAPastedList());
  const { container, unmount } = await mountPage();
  noteAboveTheRows(container, PASTED_LIST);
  const adds = rowsOf(container).filter((row) => pillsOf(compactOf(row)).includes('新增'));
  assert(adds.map(titleOf).join('|') === 'Song 1 (copy)|Song 2 (copy)|Song 3 (copy)|Song 4 (copy)', `the copies are the adds (got ${adds.map(titleOf).join('|')})`);
  for (const add of adds) {
    assert(checkboxOf(add)?.checked === false, `${titleOf(add)} opens unticked`);
    assert(pillsOf(compactOf(add)).join('|') === '新增|可能重複貼上', `${titleOf(add)} is marked (got ${pillsOf(compactOf(add)).join('|')})`);
  }
  assert(checkboxOf(rowNamed(container, 'Song 4'))?.checked === true, "Song 4's move is no add, and keeps its tick");
  assert(footerCounts(container) === '已勾選 1 項 · 未勾 4 項', `the move applied, the four adds left (got ${footerCounts(container)})`);
  assertNoRawColour(rowList(container).innerHTML, 'the held rows');
  await unmount();
  console.log('✓ review page: a list that looks pasted twice says so once and opens every add unticked, marked 可能重複貼上');
}

async function aHeldRowShowsItsMarkAndHint(mountPage: MountPage): Promise<void> {
  // Each row the guard held back opens unticked, marked on its line with why, and its panel says it in words.
  const cases: ReadonlyArray<{ what: string; view: NovaVodCorrectionView; title: string; marks: string; hint: string }> = [
    {
      what: 'a far move',
      view: withBravoMovedFar(),
      title: 'Bravo',
      marks: '時間|移動太遠',
      hint: '開始時間的移動跟附近的歌差了 15:00，超過這首歌的長度，預設不勾。',
    },
    {
      what: 'a length change',
      view: loadedReview(
        [ALPHA, row('Bravo', 'Artist B', 1100, 1340), row('Charlie', 'Artist C', 2100, 2340)],
        [ALPHA, row('Bravo', 'Artist B', 1100, 1200), row('Charlie', 'Artist C', 2100, 2340)],
      ),
      title: 'Bravo',
      marks: '時間|長度改變',
      hint: '套用後長度會變成原本的 0.42 倍，預設不勾。',
    },
    {
      what: 'a new overlap',
      view: loadedReview([ALPHA, BRAVO, CHARLIE], [ALPHA, row('Bravo', 'Artist B', 400, 760), CHARLIE]),
      title: 'Bravo',
      marks: '時間|會重疊',
      hint: '套用後會跟「Charlie」重疊，預設不勾。',
    },
    {
      what: 'an add that names no song',
      view: loadedReview([ALPHA], [ALPHA, row('November', '', 500, 700)]),
      title: 'November',
      marks: '新增|沒有原唱',
      hint: '沒有原唱，套用會建立新歌「November / Unknown」，預設不勾。',
    },
    {
      what: 'a short add',
      view: loadedReview([ALPHA], [ALPHA, row('November', 'Artist N', 500, 503)]),
      title: 'November',
      marks: '新增|太短',
      hint: '只有 3 秒，預設不勾。',
    },
    {
      what: 'two adds of one title that touch',
      view: loadedReview([ALPHA], [ALPHA, row('November', 'Artist N', 500, 530), row('November', 'Artist N', 530, 600)]),
      title: 'November',
      marks: '新增|重複',
      hint: '跟另一筆同名的新增接在一起，可能是重複，預設不勾。',
    },
    {
      what: 'a pasted list',
      view: withAPastedList(),
      title: 'Song 1 (copy)',
      marks: '新增|可能重複貼上',
      hint: '這份投稿看起來貼了兩份歌單，預設不勾。',
    },
  ];
  for (const { what, view, title, marks, hint } of cases) {
    reset(view);
    const { container, unmount } = await mountPage();
    assert(marksOf(container, title) === marks, `${what}: the row says why it opens unticked (got ${marksOf(container, title)})`);
    assert(checkboxOf(rowNamed(container, title))?.checked === false, `${what}: and it is not ticked`);
    const panel = await expand(container, title);
    assert(textOf(panel).includes(hint), `${what}: its panel says it in words (got ${textOf(panel)})`);
    assertNoRawColour(rowList(container).innerHTML, `${what}: the held row`);
    await unmount();
  }
  console.log('✓ review page: a row the guard held back opens unticked, marked 移動太遠, 長度改變, 會重疊, 沒有原唱, 太短, 重複 or 可能重複貼上, and its panel says why');
}

const PARTIAL_LIST = '這份投稿只列了目前歌單的一部分，時間變更都預設不勾。';

async function aPartialListAndAnotherSongAreMarked(mountPage: MountPage): Promise<void> {
  // A loaded list cut down to one line, Lemon again right after the stream's own Lemon: a partial list. The page says
  // so once, above the rows, and Lemon's move opens unticked, marked, its panel saying why; the default applies nothing.
  reset(loadedReview(
    [row('Alpha', 'X', 100, 340), row('Lemon', '米津玄師', 600, 840), row('Bravo', 'Y', 1200, 1440), row('Charlie', 'Z', 1800, 2040)],
    [row('Lemon', '米津玄師', 840, 1080)],
  ));
  const partial = await mountPage();
  noteAboveTheRows(partial.container, PARTIAL_LIST);
  assert(marksOf(partial.container, 'Lemon') === '時間|只列部分', `the move is marked (got ${marksOf(partial.container, 'Lemon')})`);
  assert(checkboxOf(rowNamed(partial.container, 'Lemon'))?.checked === false, 'and opens unticked');
  const lemon = await expand(partial.container, 'Lemon');
  assert(textOf(lemon).includes('這份投稿只列了部分歌曲，無法確定這一行是修正還是另一首歌，預設不勾。'), `its panel says why (got ${textOf(lemon)})`);
  assert(footerCounts(partial.container) === '已勾選 0 項 · 未勾 4 項', `the default applies nothing (got ${footerCounts(partial.container)})`);
  assertNoRawColour(rowList(partial.container).innerHTML, 'the partial list');
  await partial.unmount();

  // A loaded list with Charlie's line replaced by another song, start only, 3:50 before Charlie: paired with Charlie by
  // time, its move opens unticked, marked as another song, and no banner shows, as every row is listed.
  const six = [ALPHA, BRAVO, row('Charlie', 'Artist C', 1000, 1240), row('Delta', 'Artist D', 1300, 1540), row('Echo', 'Artist E', 1900, 2140), row('Foxtrot', 'Artist F', 2200, 2440)];
  reset(loadedReview(six, six.map((song) => (song.title === 'Charlie' ? row('Missed One', 'm1', 770, 1300) : song))));
  const other = await mountPage();
  assert(![BASE_MISSING, BASE_UNVERIFIED, PASTED_LIST, PARTIAL_LIST].some((text) => textOf(other.container).includes(text)), 'no banner');
  assert(marksOf(other.container, 'Charlie') === '時間|歌名|歌名不同', `the move is marked (got ${marksOf(other.container, 'Charlie')})`);
  assert(checkboxOf(rowNamed(other.container, 'Charlie'))?.checked === false, 'and opens unticked');
  const charlie = await expand(other.container, 'Charlie');
  assert(textOf(charlie).includes('投稿的歌名跟這場演出不同，開始時間又差了 3:50，可能是另一首歌，預設不勾。'), `its panel says why (got ${textOf(charlie)})`);
  assertNoRawColour(rowList(other.container).innerHTML, 'another song');
  await other.unmount();
  console.log('✓ review page: a partial list says so once and opens its moves unticked, marked 只列部分; a row likely another song is marked 歌名不同; each panel says why');
}

async function anUnverifiedReviewShowsTheRowMarks(mountPage: MountPage): Promise<void> {
  // A review whose base no revision confirmed opens with nothing ticked, yet a row the other checks would hold says
  // why, as on a confirmed review: Bravo's far move, or Bravo's typed end running into Charlie. 全選時間 ticks Bravo
  // again, and its mark stays, for the curator to read before applying.
  const cases: ReadonlyArray<{ what: string; view: NovaVodCorrectionView; mark: string }> = [
    { what: 'a far move', view: withBravoMovedFar(), mark: '移動太遠' },
    { what: 'a new overlap', view: loadedReview([ALPHA, BRAVO, CHARLIE], [ALPHA, row('Bravo', 'Artist B', 400, 760), CHARLIE]), mark: '會重疊' },
  ];
  for (const { what, view, mark } of cases) {
    view.baseVerified = false;
    reset(view);
    const { container, unmount } = await mountPage();
    noteAboveTheRows(container, BASE_UNVERIFIED);
    assert(marksOf(container, 'Bravo') === `時間|${mark}`, `${what}: the row says why it would be held (got ${marksOf(container, 'Bravo')})`);
    assert(checkboxOf(rowNamed(container, 'Bravo'))?.checked === false, `${what}: and it opens unticked`);
    assert(textOf(await expand(container, 'Bravo')).includes(HELD_BACK), `${what}: its panel says why`);
    await click(buttonNamed(container, '全選時間'), '全選時間');
    assert(checkboxOf(rowNamed(container, 'Bravo'))?.checked === true, `${what}: 全選時間 ticks it`);
    assert(marksOf(container, 'Bravo') === `時間|${mark}`, `${what}: and the mark stays (got ${marksOf(container, 'Bravo')})`);
    await unmount();
  }
  console.log('✓ review page: a review with no confirmed base still marks the rows the other checks hold (移動太遠, 會重疊), before 全選時間 and after');
}

async function theNoArtistMarkGoesOnceAnArtistIsTyped(mountPage: MountPage): Promise<void> {
  // November was added with no artist, and no song is found for it: held, marked 沒有原唱, its panel saying the apply
  // would make 'November / Unknown'. Once the curator types an artist that is no longer so, and the mark and the hint
  // go (the edit ticks the add). With the field blank again, both are back.
  reset(loadedReview([ALPHA], [ALPHA, row('November', '', 500, 700)]));
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'November');
  const hint = '沒有原唱，套用會建立新歌「November / Unknown」，預設不勾。';
  assert(marksOf(container, 'November') === '新增|沒有原唱' && textOf(panel).includes(hint), 'the fixture: held for naming no song');
  await typeInto(inputNamed(panel, '原唱'), 'Artist N');
  assert(marksOf(container, 'November') === '新增', `an artist typed: the mark goes (got ${marksOf(container, 'November')})`);
  assert(!textOf(panel).includes(hint), 'and so does the hint');
  assert(checkboxOf(rowNamed(container, 'November'))?.checked === true, 'the edit ticks the add');
  await typeInto(inputNamed(panel, '原唱'), '  ');
  assert(marksOf(container, 'November') === '新增|沒有原唱' && textOf(panel).includes(hint), `only spaces: blank again, and both are back (got ${marksOf(container, 'November')})`);
  await unmount();
  console.log('✓ review page: an add held for naming no song loses its 沒有原唱 mark and hint once an artist is typed, and gets them back once it is blank');
}

/** The six time edits of the ichii correction, as the apply sends them. */
const ICHII_TIME_EDITS = [
  { op: 'setTimes', performanceId: 'p1', timestamp: 881, endTimestamp: 1024 },
  { op: 'setTimes', performanceId: 'p2', endTimestamp: 1617 },
  { op: 'setTimes', performanceId: 'p4', timestamp: 2247, endTimestamp: 2445 },
  { op: 'setTimes', performanceId: 'p5', endTimestamp: 2945 },
  { op: 'setTimes', performanceId: 'p6', timestamp: 3512, endTimestamp: 3658 },
  { op: 'setTimes', performanceId: 'p7', timestamp: 5368, endTimestamp: 5472 },
];

async function selectAllTicksWhatTheGuardHeld(mountPage: MountPage): Promise<void> {
  // 全選時間 ticks back the time edits the guard held: on a review with no base, the six it would have opened with. The
  // delete is not its to tick, and the banner still says what the review opened with.
  reset(ichiiCorrectionView());
  const { container, unmount } = await mountPage();
  assert(footerCounts(container) === '已勾選 0 項 · 未勾 8 項', 'the fixture: nothing ticked');
  await click(buttonNamed(container, '全選時間'), '全選時間');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `the six time edits are ticked (got ${footerCounts(container)})`);
  assert(rowsOf(container).filter((row) => checkboxOf(row)?.checked === true).length === 6, 'six rows ticked');
  assert(checkboxOf(rowNamed(container, 'A Tender Moon Tempo'))?.checked === false, 'the delete stays unticked');
  assert(textOf(container).includes(BASE_MISSING), 'the banner stays');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(lastApply().operations, ICHII_TIME_EDITS);
  await unmount();

  // 全選新增 ticks back the adds of a list that looks pasted twice, marks and all.
  reset(withAPastedList());
  const pasted = await mountPage();
  await click(buttonNamed(pasted.container, '全選新增'), '全選新增');
  const adds = rowsOf(pasted.container).filter((row) => pillsOf(compactOf(row)).includes('新增'));
  assert(adds.length === 4 && adds.every((row) => checkboxOf(row)?.checked === true), 'every add is ticked');
  assert(footerCounts(pasted.container) === '已勾選 5 項 · 未勾 0 項', `and applied (got ${footerCounts(pasted.container)})`);
  assert(pillsOf(compactOf(rowNamed(pasted.container, 'Song 1 (copy)'))).includes('可能重複貼上'), 'still marked with why it opened unticked');
  await pasted.unmount();
  console.log('✓ review page: 全選時間 ticks the time edits the guard held (套用 6 項), and 全選新增 its adds');
}

async function selectAllRestoresDefaultsAfterHandUnticks(mountPage: MountPage): Promise<void> {
  // Review Focus 3. 全選 ticks every row of its kind that its default, before the guard, ticks, those the curator
  // unticked included. It only ticks: any other row keeps the tick it has.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  await click(checkboxOf(rowNamed(container, 'Late Night Drive')), "Late Night Drive's tick");
  await click(checkboxOf(rowNamed(container, 'Moon River')), "Moon River's tick");
  assert(footerCounts(container) === '已勾選 4 項 · 未勾 4 項', `two unticked by hand (got ${footerCounts(container)})`);
  await click(buttonNamed(container, '全選時間'), '全選時間');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `both ticked again (got ${footerCounts(container)})`);
  assert(['Late Night Drive', 'Moon River'].every((title) => checkboxOf(rowNamed(container, title))?.checked === true), 'each one');
  await unmount();

  // The adds alike, and each button keeps to its kind.
  reset(loaded(withAnAdd()));
  const added = await mountPage();
  await click(checkboxOf(rowNamed(added.container, '月光')), "the add's tick");
  await click(checkboxOf(rowNamed(added.container, 'Moon River')), "Moon River's tick");
  assert(footerCounts(added.container) === '已勾選 5 項 · 未勾 4 項', `the add and a time unticked (got ${footerCounts(added.container)})`);
  await click(buttonNamed(added.container, '全選新增'), '全選新增');
  assert(checkboxOf(rowNamed(added.container, '月光'))?.checked === true, '全選新增 ticks the add again');
  assert(checkboxOf(rowNamed(added.container, 'Moon River'))?.checked === false, 'and leaves the time alone');
  await click(buttonNamed(added.container, '全選時間'), '全選時間');
  assert(footerCounts(added.container) === '已勾選 7 項 · 未勾 2 項', `全選時間 ticks the time (got ${footerCounts(added.container)})`);
  await added.unmount();
  console.log('✓ review page: 全選時間 and 全選新增 tick back what the curator unticked, each only its own kind');
}

async function selectAllNeverUnticksACuratorsTick(mountPage: MountPage): Promise<void> {
  // 全選 only ticks. Late Night Drive's pair suggests no time change, so it opens unticked; a start typed in its panel
  // ticks it. 全選時間 has nothing to tick for that, and once Moon River is unticked it ticks Moon River again and leaves
  // Late Night Drive as the curator made it: the typed start is still sent.
  reset(loaded(withATitleOnlyFirstRow()));
  const { container, unmount } = await mountPage();
  const selectAll = () => need(buttonNamed(container, '全選時間'), '全選時間');
  const panel = await expand(container, 'Late Night Drive');
  const box = need(panel.querySelector<HTMLInputElement>('input[type="checkbox"]'), "the panel's 時間 box");
  const start = inputNamed(panel, '開始');
  await focus(start);
  await typeInto(start, '14:45');
  await blur(start);
  assert(box.checked && footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `the typed start ticks the pair (got ${footerCounts(container)})`);
  assert(isUnavailable(selectAll()), 'a tick the curator gave a row that opens unticked leaves 全選時間 nothing to do');
  await click(checkboxOf(rowNamed(container, 'Moon River')), "Moon River's tick");
  await click(selectAll(), '全選時間');
  assert(checkboxOf(rowNamed(container, 'Moon River'))?.checked === true, '全選時間 ticks Moon River again');
  assert(box.checked && footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `and keeps the curator's tick (got ${footerCounts(container)})`);
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(lastApply().operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 885 });
  await unmount();
  console.log("✓ review page: 全選時間 never unticks a curator's tick on a row that opens unticked: a typed start is still sent");
}

async function theSelectAllButtonsAreDisabledWhenNothingChanges(mountPage: MountPage): Promise<void> {
  // A button that would change nothing is unavailable: it keeps the focus the press that got there left on it.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  const times = () => need(buttonNamed(container, '全選時間'), '全選時間');
  const adds = () => need(buttonNamed(container, '全選新增'), '全選新增');
  assert(isUnavailable(times()) && isUnavailable(adds()), 'every row as it opens: neither would change anything');
  await click(times(), 'the unavailable 全選時間');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'a press of it does nothing');
  await click(checkboxOf(rowNamed(container, 'Moon River')), "Moon River's tick");
  assert(isIdle(times()) && isUnavailable(adds()), 'a time unticked: 全選時間 would tick it, and 全選新增 has no add to tick');
  await focus(times());
  await click(times(), '全選時間');
  assert(isUnavailable(times()) && focused() === times(), 'pressed, it has nothing left to do, and keeps the focus');
  await unmount();

  reset(loaded(withAnAdd()));
  const added = await mountPage();
  const addsHere = () => need(buttonNamed(added.container, '全選新增'), '全選新增');
  assert(isUnavailable(addsHere()), 'an add ticked as it opens: 全選新增 would change nothing');
  await click(checkboxOf(rowNamed(added.container, '月光')), "the add's tick");
  assert(isIdle(addsHere()), 'unticked, it would tick it');
  await click(addsHere(), '全選新增');
  assert(isUnavailable(addsHere()), 'and once it has, nothing is left to do');
  await added.unmount();
  console.log('✓ review page: 全選時間 and 全選新增 are unavailable while they would change nothing, and keep the focus once they have');
}

async function aHandRePairDropsTheGuardMark(mountPage: MountPage): Promise<void> {
  // Review Focus 2. The guard's reasons belong to the pairs and adds the review opened with (R3-7). Bravo's pair, held
  // for its far move, split by hand makes an add and a delete the guard never saw: neither is marked, and the add
  // starts as any add does, ticked. Paired with Delta's row instead, the pair is new too: no row is marked 移動太遠.
  reset(withBravoMovedFar());
  const { container, unmount } = await mountPage();
  const farMarked = () => rowsOf(container).filter((row) => pillsOf(compactOf(row)).includes('移動太遠')).map(titleOf);
  assert(farMarked().join('|') === 'Bravo' && checkboxOf(rowNamed(container, 'Bravo'))?.checked === false, 'the fixture: Bravo is held for its move');
  await click(need(buttonNamed(await expand(container, 'Bravo'), '拆開配對'), 'the split button'), '拆開配對');
  const bravos = rowsOf(container).filter((row) => titleOf(row) === 'Bravo');
  assert(bravos.map((row) => pillsOf(compactOf(row)).join('|')).join(' / ') === '刪除 / 新增', `split: a delete and an add, marked with nothing more (got ${bravos.map((row) => pillsOf(compactOf(row)).join('|')).join(' / ')})`);
  const add = need(bravos[1], "Bravo's add");
  assert(checkboxOf(add)?.checked === true, 'the add starts ticked');

  const pairTo = need(need(panelOf(add), 'the add panel, opened by the split').querySelector<HTMLSelectElement>('select[aria-label="配對到…"]'), 'the 配對到… picker');
  const delta = need([...pairTo.options].find((option) => textOf(option).includes('Delta')), "Delta's row in the picker");
  await selectOption(pairTo, delta.value);
  assert(marksOf(container, 'Delta') === '時間|歌名', `paired with Delta's row: a new pair, marked with nothing more (got ${marksOf(container, 'Delta')})`);
  assert(farMarked().length === 0, 'and no row is marked 移動太遠');
  await unmount();
  console.log('✓ review page: a pair the guard held, re-paired by hand, loses its mark, and no other row takes it');
}

async function aReloadRecomputesTheGuard(mountPage: MountPage): Promise<void> {
  // Review Focus 4. A reload brings a new view and the guard runs again on it: what the curator changed goes with the
  // old one, and the banner, the marks and the held ticks are back.
  const reloadAfterStale = async (container: HTMLElement, apply: string, next: NovaVodCorrectionView) => {
    applyReply = () => failure(409, { error: 'stale' });
    await click(buttonNamed(container, apply), apply);
    const fresh = held();
    correctionReply = () => fresh.reply;
    await click(need(buttonNamed(need(alertWith(container, '這場歌單在你審核時被改過'), 'the stale banner'), '重新載入'), 'its reload'), '重新載入');
    next.fingerprint = 'e'.repeat(64);
    await respond(fresh, ok(next));
  };

  // No base: 全選時間 is the curator's, and goes with the old view.
  reset(ichiiCorrectionView());
  const { container, unmount } = await mountPage();
  await click(buttonNamed(container, '全選時間'), '全選時間');
  await reloadAfterStale(container, '套用 6 項', ichiiCorrectionView());
  noteAboveTheRows(container, BASE_MISSING);
  assert(footerCounts(container) === '已勾選 0 項 · 未勾 8 項' && buttonNamed(container, '套用 0 項') !== null, `nothing is ticked again (got ${footerCounts(container)})`);
  await unmount();

  // A held pair split by hand, and meanwhile another correction added Echo before Alpha, which moves every row of the
  // stream down one place. Reloaded, the pair is back, held and marked: the guard ran on the new view, where the pair
  // has a place of its own, which the first view's reasons know nothing of.
  reset(withBravoMovedFar());
  const second = await mountPage();
  await click(need(buttonNamed(await expand(second.container, 'Bravo'), '拆開配對'), 'the split button'), '拆開配對');
  assert(!rowsOf(second.container).some((row) => pillsOf(compactOf(row)).includes('移動太遠')), 'the fixture: split, nothing is marked');
  const withEcho = loaded(correctionView({
    base: [ALPHA, BRAVO, CHARLIE, DELTA].map((fields, index) => baseRow(`p${index + 1}`, fields)),
    current: [liveRow('pE', row('Echo', 'Artist E', 20, 80)), ...[ALPHA, BRAVO, CHARLIE, DELTA].map((fields, index) => liveRow(`p${index + 1}`, fields))],
    proposed: [ALPHA, row('Bravo', 'Artist B', 1300, 1540), CHARLIE],
  }));
  await reloadAfterStale(second.container, '套用 1 項', withEcho);
  assert(rowsOf(second.container).filter((row) => titleOf(row) === 'Bravo').length === 1, 'one Bravo row again: the pair');
  assert(marksOf(second.container, 'Bravo') === '時間|移動太遠', `held and marked again (got ${marksOf(second.container, 'Bravo')})`);
  assert(checkboxOf(rowNamed(second.container, 'Bravo'))?.checked === false, 'and unticked');
  await second.unmount();
  console.log('✓ review page: a reload runs the guard again on the new view: its banner, marks and held ticks are back');
}

async function aCaseOnlyFixIsReachable(mountPage: MountPage): Promise<void> {
  // The stream has "night dancer"; the submission fixes only the case, with the stream's own times. Matching folds
  // the two titles together, so the pair suggests nothing (no chip), yet the fix must be there to take.
  const view = ichiiCorrectionView();
  view.current[3] = { ...need(view.current[3], 'the fourth current row'), title: 'night dancer', originalArtist: 'imase' };
  view.proposed[2] = {
    ...need(view.proposed[2], 'the third proposed row'),
    title: 'NIGHT DANCER',
    originalArtist: 'imase',
    timestamp: 2248,
    endTimestamp: 2448,
  };
  view.match = matchCorrection(view.current, view.proposed);
  reset(loaded(view));
  const { container, unmount } = await mountPage();
  assert(!textOf(container).includes('未變更'), 'the pair is not set apart as unchanged');
  const row = rowNamed(container, 'night dancer');
  assert(pillsOf(compactOf(row)).length === 0 && checkboxOf(row) === null, 'a row of its own, with no chip and no tick');
  assert(footerCounts(container) === '已勾選 5 項 · 未勾 2 項', `it counts for nothing until taken (got ${footerCounts(container)})`);
  const panel = await expand(container, 'night dancer');
  assert(radioNamed(panel, '忽略，維持目前').checked, 'ignore is the default');
  await click(radioNamed(panel, '這首歌改名為'), 'the rename choice');
  assert(valueOf(inputNamed(panel, '改名：歌名')) === 'NIGHT DANCER', 'the rename starts from the submitted title');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', `the rename is applied (got ${footerCounts(container)})`);
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(lastApply().operations.filter((operation) => operation.op === 'renameSong'), [
    { op: 'renameSong', songId: 's4', title: 'NIGHT DANCER' },
  ]);
  await unmount();
  console.log('✓ review page: a fix of only the case is a row of its own, and 這首歌改名為 sends renameSong {s4, NIGHT DANCER}');
}

async function startOnlyRowsProposeNoEnds(mountPage: MountPage): Promise<void> {
  // Pasted as start times only, to fix one title: every submitted end is the parser's. No row wears 時間 or has a tick,
  // and each end stays the stream's. The rows stay listed (their ends differ as they stand), so an end can be typed.
  reset(startOnlyCorrectionView());
  const { container, unmount } = await mountPage();
  const rows = rowsOf(container);
  assert(rows.length === 5 && !textOf(container).includes('未變更'), `every pair stays listed (got ${rows.map(titleOf).join('|')})`);
  const chips = rows.flatMap((row) => pillsOf(compactOf(row)));
  assert(chips.join('|') === '歌名', `only the title fix wears a chip, no 時間 (got ${chips.join(',')})`);
  assert(rows.every((row) => checkboxOf(row) === null), 'no time change to tick');
  assert(footerCounts(container) === '已勾選 0 項 · 未勾 1 項', `nothing applied, the title fix skipped (got ${footerCounts(container)})`);
  assert(need(buttonNamed(container, '套用 0 項'), 'the apply button').disabled, 'so 套用 waits');
  const first = seekLabels(compactOf(rowNamed(container, 'Song A')));
  assert(first === '跳到 1:40|跳到 5:40', `the row shows the stream's end, not the next start (got ${first})`);
  const panel = await expand(container, 'Song A');
  assert(valueOf(inputNamed(panel, '結束')) === '5:40', `the end field starts as the stream's end (got ${valueOf(inputNamed(panel, '結束'))})`);
  await unmount();
  console.log("✓ review page: start-only rows propose no ends: no 時間 chip, no tick, 已勾選 0 項, each end the stream's");
}

async function aMovedStartKeepsTheDerivedEndOut(mountPage: MountPage): Promise<void> {
  // Song B and Song E start later; the parser gave the rows before them the new starts as their ends, and Song E none.
  const view = startOnlyCorrectionView();
  const moved: Record<number, { timestamp?: number; endTimestamp?: number }> = {
    0: { endTimestamp: 405 },
    1: { timestamp: 405 },
    3: { endTimestamp: 1310 },
    4: { timestamp: 1310 },
  };
  view.proposed = view.proposed.map((row, index) => ({ ...row, ...moved[index] }));
  view.match = matchCorrection(view.current, view.proposed);
  reset(loaded(view));
  const { container, unmount } = await mountPage();
  const timed = rowsOf(container).filter((row) => pillsOf(compactOf(row)).includes('時間'));
  assert(timed.map(titleOf).join('|') === 'Song B|Song E', `only the moved starts wear 時間 (got ${timed.map(titleOf).join('|')})`);
  assert(timed.every((row) => checkboxOf(row)?.checked === true), 'ticked');
  assert(footerCounts(container) === '已勾選 2 項 · 未勾 1 項', `two time changes (got ${footerCounts(container)})`);
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 2 項'), '套用 2 項');
  deepStrictEqual(lastApply().operations, [
    { op: 'setTimes', performanceId: 'p2', timestamp: 405 },
    { op: 'setTimes', performanceId: 'p5', timestamp: 1310 },
  ]);
  await unmount();
  console.log('✓ review page: a moved start with a derived end sends the start alone');
}

async function bannersOfTheStream(mountPage: MountPage): Promise<void> {
  const view = ichiiCorrectionView();
  view.stream.status = 'pending';
  view.otherPendingCount = 2;
  view.submission = { ...view.submission, kind: 'new', submitter_note: 'Fixed the times', stream_title: 'Mid-autumn', stream_date: '2026-09-26' };
  reset(view);
  const { container, unmount } = await mountPage();
  const text = textOf(container);
  assert(text.includes('這場 stream 目前不是公開狀態（pending）'), 'a stream that is not public says so, with its status');
  assert(text.includes('這場還有 2 份待審修正'), 'other pending corrections of the stream are counted');
  assert(text.includes('Fixed the times'), 'the submitter note is shown');
  assert(text.includes('Mid-autumn') && text.includes('2026-09-26'), 'and the submitted title and date beside the current ones');
  assert(text.includes('【中秋歌回🎤】玉兔搗藥，也在月亮上唱唱歌') && text.includes('2026-09-25'), 'the current title and date');
  const header = need(container.querySelector('header'), 'the header');
  assert(pillsOf(header).includes('對應既有 stream') && !pillsOf(header).includes('修正'), 'a first submission of a video that has a stream says so');
  await unmount();
  console.log('✓ review page: the left column shows the non-public stream and the other pending corrections, the submitter note and both titles');
}

async function wouldPublishHidden(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () =>
    failure(409, {
      error: 'would_publish_hidden',
      performances: [
        { performanceId: 'x1', streamId: 'other-1', songId: 's9' },
        { performanceId: 'x2', streamId: 'other-2', songId: 's9' },
      ],
    });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const toast = need(toastsOf(container)[0], 'the toast');
  assert(toast.danger && `${toast.message} ${toast.detail}`.includes('2 場'), `an error toast naming the 2 performances (got "${toast.message}" / "${toast.detail}")`);
  assert(whereOf(container) === '/nova/vods/vod-1/review' && alertWith(container, '重新載入') === null, 'the page stays, with no stale banner');
  await unmount();
  console.log('✓ review page: would_publish_hidden is an error toast naming the performance count');
}

async function wouldUnpublish(mountPage: MountPage): Promise<void> {
  // Finding #6. On a stream that is not public, a relink onto a song that is not approved takes on-site rows off it.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () => failure(409, { error: 'would_unpublish', performanceIds: ['p1', 'p4'] });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(toastsOf(container).map(({ message, detail, danger }) => ({ message, detail, danger })), [
    { message: '套用會讓 2 場演出從網站上消失', detail: '這些演出的 stream 還沒公開，改連到待審的歌會讓它們下架。請改連到已通過的歌。', danger: true },
  ]);
  assert(whereOf(container) === '/nova/vods/vod-1/review' && alertWith(container, '重新載入') === null, 'the page stays, with no stale banner');
  assert(isIdle(need(buttonNamed(container, '套用 6 項'), 'the apply')), 'and the apply is available again');
  await unmount();
  console.log('✓ review page: would_unpublish toasts 套用會讓 2 場演出從網站上消失, with what to do instead');
}

async function wouldPublishEndless(mountPage: MountPage): Promise<void> {
  // Codex P1 on PR #236. A pending song the apply would approve has approved rows with no end on public streams.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () =>
    failure(409, {
      error: 'would_publish_endless',
      performances: [
        { performanceId: 'x1', streamId: 'other-1', songId: 's9' },
        { performanceId: 'x2', streamId: 'other-2', songId: 's9' },
      ],
    });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  deepStrictEqual(toastsOf(container).map(({ message, detail, danger }) => ({ message, detail, danger })), [
    {
      message: '無法套用修正：會讓 2 場沒有結束時間的演出公開',
      detail: '這些演出已核准但沒有結束時間，套用會讓它們出現在網站上，VOD 匯出會因此停擺。請先替它們補上結束時間。',
      danger: true,
    },
  ]);
  assert(whereOf(container) === '/nova/vods/vod-1/review' && alertWith(container, '重新載入') === null, 'the page stays, with no stale banner');
  assert(isIdle(need(buttonNamed(container, '套用 6 項'), 'the apply')), 'and the apply is available again');
  await unmount();
  console.log('✓ review page: would_publish_endless toasts 會讓 2 場沒有結束時間的演出公開, with what to do first');
}

async function aFailureThatReachedTheCatalog(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const view = ichiiCorrectionView();
  const { container, unmount } = await mountPage();
  await typeInto(noteBox(container), '  請確認時間  ');
  applyReply = () => failure(502, { error: 'Catalog updated but the submission could not be marked reviewed', appliedToCatalog: true });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const sent = lastApply();
  assert(sent.reviewerNote === '  請確認時間  ', 'the note goes with the apply as typed');

  const banner = need(alertWith(container, '直接通過（不套用）'), 'the recovery message');
  assert(textOf(banner).includes('已套用'), `it says the catalog has the changes (got ${textOf(banner)})`);
  assert(isUnavailable(need(buttonNamed(container, '套用 6 項'), 'the apply')), 'the apply is not offered again');
  assert(isUnavailable(need(buttonNamed(container, '退回'), 'the reject')), 'nor is a rejection of what was applied');

  // The recovery marks the submission approved without applying again. It asks first, in words that say the changes
  // are in: only the mark is left, and the contributor is told. It sends the note the apply would have written, which
  // the worker writes only if it finds no record of the apply.
  statusReply = (call) => ok({ ...view.submission, status: 'approved', reviewer_note: (call.body as { reviewer_note: string }).reviewer_note } satisfies NovaVodSubmission);
  await click(need(buttonNamed(banner, '直接通過（不套用）'), 'the recovery action'), '直接通過（不套用）');
  const dialog = need(confirmDialog(container), 'the confirm');
  assert(textOf(dialog).includes('把這份投稿標記為已通過？'), `it asks first (got ${textOf(dialog)})`);
  assert(textOf(dialog).includes('變更已經寫入歌單。這一步只會把投稿標記為已通過並通知投稿者，不會再套用一次。'), 'saying the changes are in already');
  assert(!textOf(dialog).includes('不套用任何變更'), 'never that nothing is applied');
  await click(buttonNamed(dialog, '標記為已通過'), "the confirm's 標記為已通過");
  assert(statusCalls().length === 1, 'one status change');
  const patch = need(statusCalls()[0], 'the status request');
  assert(patch.path === '/api/nova/vods/vod-1/status', 'of the VOD');
  deepStrictEqual(patch.body, {
    status: 'approved',
    without_applying: true,
    expected_status: 'pending',
    reviewer_note: ['請確認時間', summarizeCorrection(sent.operations, sent.skipped)].join('\n'),
  });
  deepStrictEqual(toastsOf(container).map(({ message }) => message), ['已通過（變更先前已套用）']);
  assert(whereOf(container) === '/nova/vods', 'then back to the list');
  await unmount();

  // A 502 that does not say the catalog was written is a plain failure: nothing is offered in its place.
  reset(ichiiLoadedView());
  const second = await mountPage();
  applyReply = () => failure(502, { error: 'Bad gateway' });
  await click(buttonNamed(second.container, '套用 6 項'), '套用 6 項');
  assert(alertWith(second.container, '直接通過（不套用）') === null, 'no recovery without appliedToCatalog');
  assert(toastsOf(second.container).some((item) => item.danger && item.detail === 'Bad gateway'), 'an error toast instead');
  assert(isIdle(need(buttonNamed(second.container, '套用 6 項'), 'the apply')), 'and the apply stays available');
  await second.unmount();
  console.log('✓ review page: a 502 that reached the catalog offers 直接通過（不套用）, which asks to mark it approved (變更已經寫入歌單), sends the note the apply would have written and toasts 已通過（變更先前已套用）');
}

async function aRecoveryWhoseStreamIsGone(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () => failure(502, { error: 'Catalog updated but the submission could not be marked reviewed', appliedToCatalog: true });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const banner = need(alertWith(container, '直接通過（不套用）'), 'the recovery message');

  // The stream went away meanwhile: the approval that applies nothing is refused (404 no_target_stream), in words.
  statusReply = () => failure(404, { error: 'no_target_stream' });
  await click(need(buttonNamed(banner, '直接通過（不套用）'), 'the recovery action'), '直接通過（不套用）');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), '標記為已通過'), "the confirm's 標記為已通過");
  assert(statusCalls().length === 1, 'one status change');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `one toast (got ${toasts.length})`);
  const toast = need(toasts[0], 'the toast');
  assert(
    toast.danger && toast.message === '這支影片目前沒有對應的 stream，請回到列表重新審核' && toast.detail === '',
    `an error toast that says the video has no stream now (got "${toast.message}" / "${toast.detail}")`,
  );
  assert(!textOf(container).includes('no_target_stream'), "the worker's code is not shown");
  assert(whereOf(container) === '/nova/vods/vod-1/review', 'and the page stays');
  await unmount();
  console.log('✓ review page: a recovery refused because the stream is gone says 這支影片目前沒有對應的 stream，請回到列表重新審核');
}

/** The ichii correction, opened after an apply of it reached the catalog while the submission was not marked reviewed. */
function withAnOpenApply(): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.openApply = { summary: '套用 2 項（時間 2）' };
  return view;
}

/** Whether the page shows the recovery: its message, and 套用 and 退回 held beside it. */
function showsTheRecovery(container: HTMLElement): boolean {
  const banner = alertWith(container, '直接通過（不套用）');
  return (
    banner !== null &&
    textOf(banner).includes('歌單已套用變更') &&
    isUnavailable(need(buttonNamed(container, '套用 6 項'), 'the apply')) &&
    isUnavailable(need(buttonNamed(container, '退回'), 'the reject'))
  );
}

/** Confirms the recovery's 直接通過（不套用）, answered as approved; resolves with the body it sent. */
async function recoverFrom(container: HTMLElement, submission: NovaVodSubmission): Promise<unknown> {
  statusReply = () => ok({ ...submission, status: 'approved' } satisfies NovaVodSubmission);
  await click(need(buttonNamed(need(alertWith(container, '直接通過（不套用）'), 'the recovery message'), '直接通過（不套用）'), 'the recovery action'), '直接通過（不套用）');
  const dialog = need(confirmDialog(container), 'the confirm');
  assert(textOf(dialog).includes('把這份投稿標記為已通過？') && textOf(dialog).includes('變更已經寫入歌單'), `it asks as the recovery of a 502 does (got ${textOf(dialog)})`);
  await click(buttonNamed(dialog, '標記為已通過'), "the confirm's 標記為已通過");
  return need(statusCalls().at(-1), 'the status request').body;
}

async function aReopenedReviewOffersOnlyTheRecovery(mountPage: MountPage): Promise<void> {
  // An apply of this submission reached the catalog and the submission was not marked reviewed (502). A review opened
  // after it, a reload, a reopen from the list or another curator's, carries that apply (openApply) and opens on the
  // recovery: 套用 and 退回 are held, so nothing re-offers the items that apply left out, and 直接通過（不套用） is offered.
  const view = loaded(withAnOpenApply());
  reset(view);
  const { container, unmount } = await mountPage();
  assert(showsTheRecovery(container), 'the page opens on the recovery, 套用 and 退回 held');
  await click(need(buttonNamed(container, '套用 6 項'), 'the apply'), 'the held 套用');
  await click(need(buttonNamed(container, '退回'), 'the reject'), 'the held 退回');
  assert(applyCalls().length === 0 && statusCalls().length === 0, 'a press on either sends nothing');

  // Its approval sends no note of this page's: the worker writes the one it recorded with that apply.
  await typeInto(noteBox(container), 'Looks right');
  deepStrictEqual(await recoverFrom(container, view.submission), { status: 'approved', without_applying: true, expected_status: 'pending' });
  deepStrictEqual(toastsOf(container).map(({ message }) => message), ['已通過（變更先前已套用）']);
  assert(whereOf(container) === '/nova/vods', 'then back to the list');
  await unmount();
  console.log('✓ review page: a review that opens on an apply which reached the catalog holds 套用 and 退回 and offers only 直接通過（不套用）, which sends no note of its own');
}

async function aViewWithoutOpenApplyOpensTheReview(mountPage: MountPage): Promise<void> {
  // A view that carries no openApply at all (a worker that predates it) has no open apply: the page opens on the
  // review, 套用 and 退回 free, and offers no recovery.
  const view = ichiiCorrectionView();
  delete (view as Partial<NovaVodCorrectionView>).openApply;
  reset(loaded(view));
  const { container, unmount } = await mountPage();
  assert(alertWith(container, '直接通過（不套用）') === null, 'no recovery is offered');
  assert(isIdle(need(buttonNamed(container, '套用 6 項'), 'the apply')) && isIdle(need(buttonNamed(container, '退回'), 'the reject')), '套用 and 退回 are free');
  await unmount();
  console.log('✓ review page: a view without openApply opens on the review, not the recovery');
}

async function anApplyAnswering409AlreadyAppliedTurnsToRecovery(mountPage: MountPage): Promise<void> {
  // The page was loaded before another apply of this submission (another tab, another curator) reached the catalog and
  // failed to mark it reviewed. Its own apply is refused, 409 already_applied: the page turns to the recovery, as after
  // its own 502, with no error toast. Its approval sends no note of this draft: the apply that landed is another one.
  reset(ichiiLoadedView());
  const view = ichiiCorrectionView();
  const { container, unmount } = await mountPage();
  await typeInto(noteBox(container), 'Times checked');
  applyReply = () => failure(409, { error: 'already_applied', appliedToCatalog: true });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  assert(applyCalls().length === 1, 'one apply was sent');
  assert(showsTheRecovery(container), 'the page turns to the recovery, 套用 and 退回 held');
  assert(toastsOf(container).length === 0, 'with no error toast: the message says it');
  assert(!textOf(container).includes('already_applied'), "the worker's code is not shown");
  deepStrictEqual(await recoverFrom(container, view.submission), { status: 'approved', without_applying: true, expected_status: 'pending' });
  deepStrictEqual(toastsOf(container).map(({ message }) => message), ['已通過（變更先前已套用）']);
  assert(whereOf(container) === '/nova/vods', 'then back to the list');
  await unmount();
  console.log('✓ review page: an apply refused as already_applied turns to the recovery, whose approval sends no note of this draft');
}

async function aRejectAnswering409AlreadyAppliedTurnsToRecovery(mountPage: MountPage): Promise<void> {
  // The same for a rejection: one refused as already_applied posts nothing, and the page turns to the recovery. The
  // reason typed for the rejection is not sent with the approval.
  reset(ichiiLoadedView());
  const view = ichiiCorrectionView();
  const { container, unmount } = await mountPage();
  await typeInto(noteBox(container), 'Wrong times');
  statusReply = () => failure(409, { error: 'already_applied', appliedToCatalog: true });
  await click(buttonNamed(container, '退回'), '退回');
  deepStrictEqual(need(statusCalls()[0], 'the rejection').body, { status: 'rejected', reviewer_note: 'Wrong times', expected_status: 'pending' });
  assert(showsTheRecovery(container), 'the page turns to the recovery, 套用 and 退回 held');
  assert(toastsOf(container).length === 0, 'with no error toast');
  assert(whereOf(container) === '/nova/vods/vod-1/review', 'and the page stays');
  deepStrictEqual(await recoverFrom(container, view.submission), { status: 'approved', without_applying: true, expected_status: 'pending' });
  assert(whereOf(container) === '/nova/vods', 'the approval goes back to the list');
  await unmount();
  console.log('✓ review page: a rejection refused as already_applied turns to the recovery, whose approval sends no note');
}

async function anApplyAnswering404NoTargetStreamToastsAndReloads(mountPage: MountPage): Promise<void> {
  // The stream went away after the page loaded: the apply is refused, 404 no_target_stream. The curator reads why in
  // words, not the worker's code, and the review is asked for again, which says the same.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () => failure(404, { error: 'no_target_stream' });
  correctionReply = () => failure(404, { error: 'no_target_stream' });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const toasts = toastsOf(container);
  assert(toasts.length === 1, `one toast (got ${toasts.length})`);
  const toast = need(toasts[0], 'the toast');
  assert(
    toast.danger && toast.message === '這支影片目前沒有對應的 stream，請回到列表重新審核' && toast.detail === '',
    `an error toast that says the video has no stream now (got "${toast.message}" / "${toast.detail}")`,
  );
  assert(!textOf(container).includes('no_target_stream'), "the worker's code is not shown");
  assert(correctionCalls().length === 2, `the review is asked for again (got ${correctionCalls().length})`);
  assert(alertWith(container, '這支影片目前沒有對應的 stream，請回到列表重新審核') !== null, 'and its failure says the same');
  assert(whereOf(container) === '/nova/vods/vod-1/review', 'the page stays');
  await unmount();
  console.log('✓ review page: an apply refused as no_target_stream toasts 這支影片目前沒有對應的 stream，請回到列表重新審核 and loads the review again');
}

async function aReloadThatFailsLeavesNoStaleReview(mountPage: MountPage): Promise<void> {
  // The apply is refused, 404 no_target_stream, and the review asked for again fails the same way. The review the page
  // still holds is stale: it is not shown, so 套用 cannot send the same 404 again. The failure and its Retry are.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () => failure(404, { error: 'no_target_stream' });
  correctionReply = () => failure(404, { error: 'no_target_stream' });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const alert = need(alertWith(container, '這支影片目前沒有對應的 stream，請回到列表重新審核'), 'the failed reload');
  assert(
    container.querySelector('ol[aria-label="逐首對照"]') === null && buttonNamed(container, '套用 6 項') === null && buttonNamed(container, '退回') === null,
    'no stale review to act on',
  );
  // Once the review loads again, it is offered again.
  correctionReply = () => ok(ichiiLoadedView());
  await click(buttonNamed(alert, 'Retry'), 'Retry');
  assert(rowsOf(container).length === 7 && buttonNamed(container, '套用 6 項') !== null, 'Retry brings the review back');
  assert(applyCalls().length === 1, 'and the refused apply was sent once');
  await unmount();
  console.log('✓ review page: a reload that fails after a no_target_stream apply shows the failure, not the stale review');
}

async function rejecting(mountPage: MountPage): Promise<void> {
  reset(ichiiLoadedView());
  const view = ichiiCorrectionView();
  const { container, unmount } = await mountPage();
  await typeInto(noteBox(container), 'Times are fine as they are');
  const answer = held();
  statusReply = () => answer.reply;
  const reject = need(buttonNamed(container, '退回'), 'the reject button');
  await focus(reject);
  await click(reject, '退回');
  assert(statusCalls().length === 1 && applyCalls().length === 0, 'a rejection is a status change, not an apply');
  deepStrictEqual(
    need(statusCalls()[0], 'the status request').body,
    { status: 'rejected', reviewer_note: 'Times are fine as they are', expected_status: 'pending' },
    'with the note, and the status the page shows',
  );
  assert(isBusy(reject) && isUnavailable(need(buttonNamed(container, '套用 6 項'), 'the apply')), 'busy while out, the apply unavailable');
  await respond(answer, ok({ ...view.submission, status: 'rejected', reviewer_note: 'Times are fine as they are' }));
  const toast = need(toastsOf(container)[0], 'the toast');
  assert(!toast.danger && toast.message === '修正已退回', `a success toast (got ${toast.message})`);
  assert(whereOf(container) === '/nova/vods', 'then back to the list');

  // A refused rejection says why and stays.
  await unmount();
  reset();
  const second = await mountPage();
  statusReply = () => failure(500, { error: 'Review store is down' });
  await click(buttonNamed(second.container, '退回'), '退回');
  assert(
    toastsOf(second.container).some((item) => item.danger && item.message === '無法退回修正' && item.detail === 'Review store is down'),
    "a refused rejection is an error toast with the worker's message",
  );
  assert(whereOf(second.container) === '/nova/vods/vod-1/review', 'and the page stays');
  await second.unmount();
  console.log('✓ review page: 退回 rejects with the reviewer note, toasts and goes back to the list');
}

/** The ichii correction, reviewed already. */
function reviewedView(status: 'approved' | 'rejected'): NovaVodCorrectionView {
  const view = ichiiCorrectionView();
  view.submission = { ...view.submission, status, reviewed_at: '2026-11-14 10:00:00' };
  return view;
}

/** Nothing on the page could send anything: no rows to tick, no note, no 套用 and no 退回. */
function offersNothing(container: HTMLElement): boolean {
  return (
    container.querySelector('ol[aria-label="逐首對照"]') === null &&
    container.querySelector('input, textarea, select') === null &&
    buttonNamed(container, '退回') === null &&
    ![...container.querySelectorAll('button')].some((button) => textOf(button).startsWith('套用'))
  );
}

async function aReviewedSubmissionIsReadOnly(mountPage: MountPage): Promise<void> {
  // Back after an apply, a bookmark, a second tab: the submission is no longer pending, so nothing here may be sent.
  for (const [status, label] of [['approved', '已通過'], ['rejected', '已退回']] as const) {
    reset(reviewedView(status));
    const { container, unmount } = await mountPage();
    assert(
      textOf(container).includes(`這份投稿已審核過了（${label}），不能再套用或退回。`),
      `the ${status} submission says it was reviewed (got ${textOf(container)})`,
    );
    assert(offersNothing(container), `and the ${status} one offers nothing to send`);
    assert(need(linkNamed(container, '回到列表'), 'the way back').getAttribute('href') === '/nova/vods', 'it offers the way back to the list');
    assert(correctionCalls().length === 1 && applyCalls().length === 0 && statusCalls().length === 0, 'and asks for nothing more');
    await unmount();
  }
  console.log('✓ review page: a submission reviewed already reads 這份投稿已審核過了（已通過|已退回），不能再套用或退回。 with no 套用, no 退回 and a way back');
}

async function aSubmissionReviewedElsewhere(mountPage: MountPage): Promise<void> {
  // The submission was reviewed after this page loaded it (another tab, or the list). An apply is refused with 409
  // not_pending. A rejection carries the pending the page shows, and is refused with 409 status_changed. An apply whose
  // changes reached the catalog while another review landed answers 409 status_changed with appliedToCatalog, and the
  // toast says the changes are in. Each says so and asks for the review again, which reads as reviewed.
  const cases: ReadonlyArray<{ action: string; status: 'approved' | 'rejected'; label: string; refusal: Reply; detail: string }> = [
    { action: '套用 6 項', status: 'approved', label: '已通過', refusal: failure(409, { error: 'not_pending' }), detail: '' },
    { action: '退回', status: 'rejected', label: '已退回', refusal: failure(409, { error: 'status_changed', status: 'rejected' }), detail: '' },
    {
      action: '套用 6 項',
      status: 'rejected',
      label: '已退回',
      refusal: failure(409, { error: 'status_changed', status: 'rejected', appliedToCatalog: true }),
      detail: '變更已寫入歌單，但這份投稿在套用期間被另一位審核者處理了，它的狀態沒有被覆寫。',
    },
  ];
  for (const { action, status, label, refusal, detail: expectedDetail } of cases) {
    reset(ichiiLoadedView());
    const { container, unmount } = await mountPage();
    correctionReply = () => ok(reviewedView(status));
    applyReply = () => refusal;
    statusReply = () => refusal;
    await click(buttonNamed(container, action), action);
    deepStrictEqual(toastsOf(container).map(({ message, detail, danger }) => ({ message, detail, danger })), [
      { message: '這份投稿已審核過了', detail: expectedDetail, danger: true },
    ], `a ${action} answered ${JSON.stringify(refusal.body)} says the submission was reviewed`);
    assert(correctionCalls().length === 2, `${action}: the review is asked for again (got ${correctionCalls().length})`);
    assert(textOf(container).includes(`這份投稿已審核過了（${label}），不能再套用或退回。`), `${action}: the page then reads as reviewed`);
    assert(offersNothing(container), `${action}: and offers nothing to send`);
    assert(whereOf(container) === '/nova/vods/vod-1/review', `${action}: the page stays`);
    await unmount();
  }
  console.log('✓ review page: an apply refused as not_pending, a rejection refused as status_changed and an apply that met another review toast 這份投稿已審核過了 and load the review again, read-only');
}

async function aRecoveryOfASubmissionReviewedElsewhere(mountPage: MountPage): Promise<void> {
  // The apply reached the catalog and answered 502; the submission was then reviewed elsewhere. The recovery carries
  // the pending the page shows and is refused with 409 status_changed: the page says so and asks for the review again.
  reset(ichiiLoadedView());
  const { container, unmount } = await mountPage();
  applyReply = () => failure(502, { error: 'Catalog updated but the submission could not be marked reviewed', appliedToCatalog: true });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const banner = need(alertWith(container, '直接通過（不套用）'), 'the recovery message');
  correctionReply = () => ok(reviewedView('rejected'));
  statusReply = () => failure(409, { error: 'status_changed', status: 'rejected' });
  await click(need(buttonNamed(banner, '直接通過（不套用）'), 'the recovery action'), '直接通過（不套用）');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), '標記為已通過'), "the confirm's 標記為已通過");
  assert(statusCalls().length === 1, 'one status change');
  deepStrictEqual(toastsOf(container).map(({ message, detail, danger }) => ({ message, detail, danger })), [
    { message: '這份投稿已審核過了', detail: '', danger: true },
  ], 'the refused recovery says the submission was reviewed');
  assert(correctionCalls().length === 2, `the review is asked for again (got ${correctionCalls().length})`);
  assert(textOf(container).includes('這份投稿已審核過了（已退回），不能再套用或退回。'), 'the page then reads as reviewed');
  assert(alertWith(container, '直接通過（不套用）') === null && offersNothing(container), 'with no recovery left, and nothing to send');
  assert(whereOf(container) === '/nova/vods/vod-1/review', 'the page stays');
  await unmount();
  console.log('✓ review page: a recovery refused as status_changed toasts 這份投稿已審核過了 and loads the review again, read-only');
}

async function seeking(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  // The IFrame API arrives: the player is made and ready.
  await act(async () => {
    window.onYouTubeIframeAPIReady?.();
  });
  await settle();
  seeks.length = 0;
  await click(buttonNamed(compactOf(rowNamed(container, 'Late Night Drive')), '改為：跳到 14:41'), '改為：跳到 14:41');
  await click(buttonNamed(compactOf(rowNamed(container, 'Moon River')), '目前：跳到 1:29:37'), '目前：跳到 1:29:37');
  // The times an open panel shows beside its fields too: the stream's, struck, named as the current one.
  const panel = await expand(container, 'Fly Me To The Moon');
  await click(buttonNamed(panel, '目前：跳到 1:01:03'), "the panel's current end");
  deepStrictEqual(seeks, [881, 5377, 3663]);
  await unmount();
  console.log('✓ review page: every time is a seek of the player, in a row and in its panel');
}

async function aLoadThatFails(mountPage: MountPage): Promise<void> {
  reset();
  correctionReply = () => failure(404, { error: 'no_target_stream' });
  const { container, unmount } = await mountPage();
  // The video has no stream now: the failure says so in words, not with the worker's code.
  const alert = need(alertWith(container, '這支影片目前沒有對應的 stream，請回到列表重新審核'), 'the load failure, in words');
  assert(!textOf(container).includes('no_target_stream'), "the worker's code is not shown");
  assert(container.querySelector('ol[aria-label="逐首對照"]') === null && buttonNamed(container, '退回') === null, 'no workspace to act on');
  correctionReply = () => ok(ichiiCorrectionView());
  await click(buttonNamed(alert, 'Retry'), 'Retry');
  assert(correctionCalls().length === 2 && rowsOf(container).length === 7, 'Retry loads the review');
  assert(alertWith(container, '這支影片目前沒有對應的 stream') === null, 'and the failure goes');

  // Any other failure reads as the worker's message.
  await unmount();
  reset();
  correctionReply = () => failure(500, { error: 'Review store is down' });
  const second = await mountPage();
  assert(alertWith(second.container, 'Review store is down') !== null, 'another failure shows its own message');
  await second.unmount();
  console.log('✓ review page: a review that will not load says why (no_target_stream in words) and offers a Retry');
}

async function aContributorIsTurnedAway(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);
  assert(textOf(container).includes('Curator access is required.'), 'a contributor meets the guard');
  assert(calls.length === 0, 'and the page asks for nothing');
  await unmount();
  console.log('✓ review page: a contributor gets the guard and no request');
}

/**
 * The rows are laid out from one reading of the view: the base is read once, and the titles the end reading's keys are
 * worked out of as often for 40 pairs as for 10. The page lays its rows out again on every render (each committed edit,
 * each expand or collapse), so a reading for every row is a pause that grows with the square of the list.
 */
function reviewRowsReadTheViewOnce(): void {
  const readsFor = (pairs: number): ReadCounts => {
    const { view, reads, reset: resetReads } = countedReadsView({ pairs, gone: 0 });
    const draft = initialDraft(view);
    const flags = draftFlags(draft, view);
    resetReads();
    const { rows, unchanged } = reviewRows(view, draft, flags);
    assert(rows.length === pairs && unchanged.length === 0, `${pairs} moved pairs are ${pairs} rows to review`);
    return reads();
  };
  const small = readsFor(10);
  assert(small.base === 1, `the rows read the view's base once (got ${small.base})`);
  // The counters must see what they count, or the equality below could hold over counts of nothing.
  assert(small.baseTitle > 0 && small.liveTitle > 0, 'the rows read the base and live titles, or the counts below prove nothing');
  deepStrictEqual(readsFor(40), small, 'the same reads for 40 pairs as for 10');
  console.log('✓ review page: the rows are laid out from one reading of the view, however many pairs there are');
}

async function main(): Promise<void> {
  installDom('http://localhost/nova/vods/vod-1/review');
  installFetchStub();
  installYouTubeStub();

  const { default: NovaVodReview } = await import('../src/pages/NovaVodReview');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES } = await import('../src/lib/routes');

  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/nova/vods/:id/review'), 'the review route');
  assert(route.curatorOnly === true && route.label === undefined, 'the review route is curator-only and not in the sidebar');
  // It sits under the Nova VODs entry: that entry is current there, and names the page in the mobile top bar.
  const { currentNavLabel, matchAdminRoute } = await import('../src/lib/navigation');
  assert(matchAdminRoute('/nova/vods/vod-1/review') === route, 'a review URL matches the review route');
  assert(currentNavLabel('/nova/vods/vod-1/review') === 'Nova VODs', `the sidebar marks Nova VODs current on it (got ${currentNavLabel('/nova/vods/vod-1/review')})`);
  console.log('✓ review page: its route is curator-only, has no sidebar entry of its own and sits under Nova VODs');

  // In a router, as App.tsx mounts it, with the list it goes back to; the toasts outlive the page.
  const mountPage: MountPage = (user = curator) =>
    mount(
      <MemoryRouter initialEntries={['/nova/vods/vod-1/review']}>
        <ToastProvider timers={NO_TIMERS}>
          <ConfirmProvider>
            <Routes>
              <Route path="/nova/vods/:id/review" element={<NovaVodReview user={user} />} />
              <Route path="/nova/vods" element={<p>The Nova VODs list</p>} />
            </Routes>
            <Location />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

  reviewRowsReadTheViewOnce();
  await rendersThePairs(mountPage);
  await rowsThatApplyNothingAreShaded(mountPage);
  await rowsChangedSinceTheSubmissionAreMarked(mountPage);
  await rowsTheContributorCouldNotSeeAreMarked(mountPage);
  await aRepeatIsMarkedAndNamesTheRowItRepeats(mountPage);
  await theNotOnSiteHintFollowsTheChoice(mountPage);
  await anAddWithNoArtistShowsTheLiveArtistItBorrows(mountPage);
  await theOffSiteHintGivesWayToAPromotionFromAnotherRow(mountPage);
  await aRelinkThatPublishesARowNeedsItsEnd(mountPage);
  await anEndThatIsShownButNotSentIsMarked(mountPage);
  await aPromotionHoldsTheApplyForAnEndlessRowHere(mountPage);
  await aHeldRowIsNeverFoldedAway(mountPage);
  await aHeldDeleteSaysHowToReleaseIt(mountPage);
  await aStreamThatShowedNothingSaysSoOnce(mountPage);
  await aBaseNullReviewTicksNothing(mountPage);
  await anUnverifiedReviewSaysSo(mountPage);
  await aPastedListSaysSoAndHoldsTheAdds(mountPage);
  await aHeldRowShowsItsMarkAndHint(mountPage);
  await aPartialListAndAnotherSongAreMarked(mountPage);
  await anUnverifiedReviewShowsTheRowMarks(mountPage);
  await theNoArtistMarkGoesOnceAnArtistIsTyped(mountPage);
  await selectAllTicksWhatTheGuardHeld(mountPage);
  await selectAllRestoresDefaultsAfterHandUnticks(mountPage);
  await selectAllNeverUnticksACuratorsTick(mountPage);
  await theSelectAllButtonsAreDisabledWhenNothingChanges(mountPage);
  await aHandRePairDropsTheGuardMark(mountPage);
  await aReloadRecomputesTheGuard(mountPage);
  await applySendsTheOperations(mountPage);
  await staleShowsAReloadBanner(mountPage);
  await invalidOperationsShowsTheServersDetail(mountPage);
  await expandingTheTitleRowOffersTheFourChoices(mountPage);
  await aBlankArtistKeepsTheCuratedOne(mountPage);
  await linkingAnExistingSong(mountPage);
  await aSearchOffersOnlyItsOwnMatches(mountPage);
  await thePendingHintFollowsTheStream(mountPage);
  await thePendingHintReadsThePrefilledArtist(mountPage);
  await thePendingHintReadsAnUnknownStreamArtist(mountPage);
  await thePendingHintReadsABlankArtistAsUnknown(mountPage);
  await aRelinkOfARowThatIsNotApprovedPromisesNoApproval(mountPage);
  await editingTimes(mountPage);
  await aPrefixIsNeverCommitted(mountPage);
  await anAddsTimeIsCommittedOnlyWhenItIsLeft(mountPage);
  await aPressActsOnTheBoxItPressed(mountPage);
  await rePairingByHand(mountPage);
  await aDeleteAndAnAdd(mountPage);
  await theFieldsKeepTheirSize(mountPage);
  await anEndTheApplyNeedsHoldsIt(mountPage);
  await aPipelineStreamsAddNeedsNoEnd(mountPage);
  await unchangedPairsCollapse(mountPage);
  await aCaseOnlyFixIsReachable(mountPage);
  await startOnlyRowsProposeNoEnds(mountPage);
  await aMovedStartKeepsTheDerivedEndOut(mountPage);
  await bannersOfTheStream(mountPage);
  await wouldPublishHidden(mountPage);
  await wouldUnpublish(mountPage);
  await wouldPublishEndless(mountPage);
  await aFailureThatReachedTheCatalog(mountPage);
  await aRecoveryWhoseStreamIsGone(mountPage);
  await aReopenedReviewOffersOnlyTheRecovery(mountPage);
  await aViewWithoutOpenApplyOpensTheReview(mountPage);
  await anApplyAnswering409AlreadyAppliedTurnsToRecovery(mountPage);
  await aRejectAnswering409AlreadyAppliedTurnsToRecovery(mountPage);
  await anApplyAnswering404NoTargetStreamToastsAndReloads(mountPage);
  await aReloadThatFailsLeavesNoStaleReview(mountPage);
  await rejecting(mountPage);
  await aReviewedSubmissionIsReadOnly(mountPage);
  await aSubmissionReviewedElsewhere(mountPage);
  await aRecoveryOfASubmissionReviewedElsewhere(mountPage);
  await seeking(mountPage);
  await aLoadThatFails(mountPage);
  await aContributorIsTurnedAway(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  for (const file of [
    '../src/pages/NovaVodReview.tsx',
    '../src/components/vod-correction/CorrectionRows.tsx',
    '../src/components/vod-correction/CorrectionPanel.tsx',
    '../src/components/vod-correction/ReviewFooter.tsx',
    '../src/components/vod-correction/SeekButton.tsx',
    '../src/components/vod-correction/SongSearchPicker.tsx',
    '../src/components/vod-correction/review-rows.ts',
  ]) {
    assertNoRawColour(readFileSync(new URL(file, import.meta.url), 'utf8'), file);
  }
  console.log('✓ review page: no raw palette class and no arbitrary hex, in the markup or the source');
}

await main();
