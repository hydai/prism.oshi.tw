/**
 * The review page of a Nova VOD correction (spec §6.6), mounted live at /nova/vods/vod-1/review the way App.tsx
 * mounts every page (a ToastProvider and a ConfirmProvider around it, in a router) against a stubbed fetch. The
 * data is the ichii correction (tests/fixtures/vod-correction.ts): seven rows on the stream and six submitted, six
 * pairs whose times moved, one typo in a title (Late Niqht Drive) and one row the submission leaves out (A Tender
 * Moon Tempo), so the page opens with six time changes ticked, the typo ignored and the delete unticked.
 *
 * What the curator sees (the compact rows in time order, their chips and the footer's counts; the stream's facts and
 * banners), what each control does to the draft (a tick, a time typed, a title choice, a song picked, re-pairing),
 * what an apply sends and what each answer does (success, stale, invalid operations, would_publish_hidden, a 502 that
 * reached the catalog and its recovery), a rejection, a seek, a failed load and the guard a contributor meets.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, NovaVodSubmission, Song, Status } from '../../shared/types';
import { matchCorrection, summarizeCorrection } from '../../shared/vod-correction';
import type { CorrectionApplyBody, CorrectionApplyResult, NovaVodCorrectionView } from '../../shared/vod-correction';
import { ichiiCorrectionView, startOnlyCorrectionView } from './fixtures/vod-correction';
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

function seekLabels(root: ParentNode): string {
  return [...root.querySelectorAll('button[aria-label^="跳到 "]')].map((button) => button.getAttribute('aria-label')).join('|');
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

  await respond(first, ok(ichiiCorrectionView()));
  assert(container.querySelector('[role="status"]') === null, 'the answer ends the loading state');
  assert(pillsOf(header).includes('修正'), 'the header says the VOD is a correction');
  assert(textOf(header).includes('ichii') && textOf(header).includes('vod-1'), 'and whose it is, and which submission');

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
  assert(seekLabels(compactOf(typo)) === '跳到 14:42|跳到 14:41|跳到 17:06|跳到 17:04', `start and end, old then new (got ${seekLabels(compactOf(typo))})`);
  const late = rowNamed(container, 'Moon River');
  assert(seekLabels(compactOf(late)) === '跳到 1:29:37|跳到 1:29:28|跳到 1:32:25|跳到 1:31:12', 'past the hour the times grow an hours field');
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
  reset();
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
  reset();
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
  const next = ichiiCorrectionView();
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
  reset();
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
  reset();
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
  deepStrictEqual(lastApply().operations[1], { op: 'relinkToNewSong', performanceId: 'p1', title: 'Late Niqht Drive', originalArtist: 'Unknown' });

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
  reset(view);
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

  // A blank artist and nothing else: renaming as offered changes nothing, so nothing is sent for it.
  const blankOnly = ichiiCorrectionView();
  blankOnly.proposed[4] = { ...need(blankOnly.proposed[4], 'the fifth proposed row'), originalArtist: '' };
  blankOnly.match = matchCorrection(blankOnly.current, blankOnly.proposed);
  reset(blankOnly);
  const second = await mountPage();
  await click(radioNamed(await expand(second.container, 'Fly Me To The Moon'), '這首歌改名為'), 'the rename choice');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(second.container, '套用 6 項'), '套用 6 項');
  assert(!lastApply().operations.some((operation) => operation.op === 'renameSong'), 'no rename: the title is the same and the artist stays');
  await second.unmount();
  console.log("✓ review page: a blank submitted artist prefills 這首歌改名為 and 改連到新的歌 with the stream's artist, never Unknown");
}

async function linkingAnExistingSong(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const panel = await expand(container, 'Late Night Drive');

  await click(radioNamed(panel, '改連到既有的歌'), 'the existing song choice');
  assert(radioNamed(panel, '改連到既有的歌').checked, 'the choice is taken');
  assert(footerCounts(container) === '已勾選 6 項 · 未勾 2 項', 'nothing is applied until a song is picked');
  const search = need(panel.querySelector<HTMLInputElement>('input[type="search"]'), "the picker's search field");
  assert(search.getAttribute('placeholder') === '搜尋 ichii 的歌…', `the picker searches the VOD's streamer (got ${search.getAttribute('placeholder')})`);
  assert(searchCalls().length === 0, 'an empty search asks for nothing');

  // The row's own song, and songs the apply would refuse (neither approved nor pending), are left out.
  songSearchReply = () =>
    ok({
      data: [song('s1', 'Late Night Drive', 'approved'), song('s9', 'Late Night Drive (Acoustic)', 'pending'), song('s10', 'Late Night Driver', 'approved'), song('s11', 'Late', 'rejected')],
      total: 4,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  await typeInto(search, 'Late');
  const asked = need(searchCalls().at(-1), 'the search request');
  assert(
    asked.params.get('streamer') === 'ichii' && asked.params.get('search') === 'Late' && asked.params.getAll('streamer').length === 1,
    `the search is the VOD streamer's (got ${asked.params.toString()})`,
  );
  const options = [...panel.querySelectorAll('[role="option"]')];
  assert(options.length === 2, `two songs to pick from (got ${options.map((option) => textOf(option)).join(' | ')})`);
  assert(textOf(options[0]).includes('Late Night Drive (Acoustic)') && pillsOf(need(options[0], 'the first option')).includes('Pending'), 'each with its status');
  assert(pillsOf(need(options[1], 'the second option')).includes('Approved'), 'an approved one too');
  assert(!textOf(panel).includes('這首歌目前待審'), 'no pending hint before a pick');

  // Picking a pending song: applied, disclosed.
  await click(options[0] as HTMLElement, 'the pending song');
  assert(footerCounts(container) === '已勾選 7 項 · 未勾 1 項', `the relink is applied (got ${footerCounts(container)})`);
  assert(textOf(panel).includes('這首歌目前待審，套用後會一併通過'), 'a pending song says it will be approved with the apply');
  applyReply = () => failure(400, { error: 'stop here' });
  await click(buttonNamed(container, '套用 7 項'), '套用 7 項');
  deepStrictEqual(lastApply().operations[1], { op: 'relinkToSong', performanceId: 'p1', songId: 's9' });

  // An approved one: no hint.
  await click(need([...panel.querySelectorAll('[role="option"]')][1] as HTMLElement | undefined, 'the approved song'), 'the approved song');
  assert(!textOf(panel).includes('這首歌目前待審'), 'an approved song needs no hint');
  await unmount();
  console.log("✓ review page: 改連到既有的歌 searches the streamer's songs, lists each with its status, leaves the row's own song out and discloses a pending pick");
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

async function editingTimes(mountPage: MountPage): Promise<void> {
  reset();
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
  assert(compactStart() === '跳到 14:42|跳到 14:41', `the draft is untouched while a time is typed (got ${compactStart()})`);
  await focus(applyButton());
  assert(compactStart() === '跳到 14:42|跳到 14:40' && valueOf(start) === '14:40', `leaving the field commits it (got ${compactStart()})`);
  await click(applyButton(), '套用 6 項');
  deepStrictEqual(lastApply().operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 880, endTimestamp: 1024 });

  // Enter commits too, and the field keeps the focus.
  await focus(start);
  await typeInto(start, '14:39');
  await press(start, 'Enter');
  assert(focused() === start && compactStart() === '跳到 14:42|跳到 14:39', `Enter commits the time and keeps the focus (got ${compactStart()})`);

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

  // An end may be cleared: the row then has none.
  await focus(end);
  await typeInto(end, '');
  assert(end.getAttribute('aria-invalid') === null, 'an empty end is no end');
  await blur(end);
  await click(applyButton(), '套用 6 項');
  deepStrictEqual(lastApply().operations[0], { op: 'setTimes', performanceId: 'p1', timestamp: 879, endTimestamp: null });
  await focus(end);
  await typeInto(end, '1:00:00');
  await blur(end);
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
  assert(compactStart() === '跳到 14:42|跳到 14:38', 'and the compact row shows it');

  // A field that leaves the page while it does not read holds nothing back: here its row collapses under it.
  await focus(start);
  await typeInto(start, '14:3x');
  assert(isUnavailable(applyButton()), '套用 waits');
  await click(expandOf(rowNamed(container, 'Late Night Drive')), 'the collapse control');
  assert(panelOf(rowNamed(container, 'Late Night Drive')) === null, 'the panel is gone');
  assert(isIdle(applyButton()), 'and so is the hold on 套用');
  await unmount();
  console.log('✓ review page: a time is committed when it is left or entered; one that does not read holds 套用 back until it is fixed or dropped, and a committed one ticks the row');
}

/** Backspace ×3 from 1:29:28, then :3: the text passes through 1:29, which reads (as 89 s). */
const PREFIX_KEYSTROKES = ['1:29:2', '1:29:', '1:29', '1:29:', '1:29:3'];

async function aPrefixIsNeverCommitted(mountPage: MountPage): Promise<void> {
  reset();
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
    assert(labels.startsWith('跳到 1:29:37|跳到 1:29:28'), `the draft keeps 1:29:28 through ${step} (got ${labels})`);
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
  reset(withAnAdd());
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

async function rePairingByHand(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
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
  view.proposed.splice(5, 0, { id: 'v7', title: '月光', originalArtist: '張惠妹', timestamp: 3910, endTimestamp: 4142, existingSong: null });
  view.match = matchCorrection(view.current, view.proposed);
  assert(view.match.unpairedProposed.join() === '5', 'the fixture: the new row pairs with nothing');
  return view;
}

async function aDeleteAndAnAdd(mountPage: MountPage): Promise<void> {
  reset(withAnAdd());
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

async function unchangedPairsCollapse(mountPage: MountPage): Promise<void> {
  // The submission keeps 私奔到月球 as it is but for whitespace round its title, and Moon Halo as it is but for a blank
  // artist where the stream has Unknown: neither differs as typed, so both collapse.
  const view = ichiiCorrectionView();
  const second = need(view.proposed[1], 'the second proposed row');
  view.proposed[1] = { ...second, title: ` ${second.title} `, endTimestamp: 1621 };
  view.proposed[2] = { ...need(view.proposed[2], 'the third proposed row'), originalArtist: '', timestamp: 2248, endTimestamp: 2448 };
  view.match = matchCorrection(view.current, view.proposed);
  assert(view.match.pairs.length === 6, 'the fixture: still six pairs');
  reset(view);
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
  reset(view);
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
  reset(view);
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
  reset();
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

async function aFailureThatReachedTheCatalog(mountPage: MountPage): Promise<void> {
  reset();
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

  // The recovery approves without applying, with the note the apply would have written.
  statusReply = (call) => ok({ ...view.submission, status: 'approved', reviewer_note: (call.body as { reviewer_note: string }).reviewer_note } satisfies NovaVodSubmission);
  await click(need(buttonNamed(banner, '直接通過（不套用）'), 'the recovery action'), '直接通過（不套用）');
  const dialog = need(confirmDialog(container), 'the confirm');
  assert(textOf(dialog).includes('直接通過，不套用任何變更？'), 'it asks first');
  await click(buttonNamed(dialog, '直接通過'), "the confirm's 直接通過");
  assert(statusCalls().length === 1, 'one status change');
  const patch = need(statusCalls()[0], 'the status request');
  assert(patch.path === '/api/nova/vods/vod-1/status', 'of the VOD');
  deepStrictEqual(patch.body, {
    status: 'approved',
    without_applying: true,
    reviewer_note: ['請確認時間', summarizeCorrection(sent.operations, sent.skipped)].join('\n'),
  });
  deepStrictEqual(toastsOf(container).map(({ message }) => message), ['已通過（未套用變更）']);
  assert(whereOf(container) === '/nova/vods', 'then back to the list');
  await unmount();

  // A 502 that does not say the catalog was written is a plain failure: nothing is offered in its place.
  reset();
  const second = await mountPage();
  applyReply = () => failure(502, { error: 'Bad gateway' });
  await click(buttonNamed(second.container, '套用 6 項'), '套用 6 項');
  assert(alertWith(second.container, '直接通過（不套用）') === null, 'no recovery without appliedToCatalog');
  assert(toastsOf(second.container).some((item) => item.danger && item.detail === 'Bad gateway'), 'an error toast instead');
  assert(isIdle(need(buttonNamed(second.container, '套用 6 項'), 'the apply')), 'and the apply stays available');
  await second.unmount();
  console.log('✓ review page: a 502 that reached the catalog offers 直接通過（不套用）, which sends the note the apply would have written');
}

async function aRecoveryWhoseStreamIsGone(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  applyReply = () => failure(502, { error: 'Catalog updated but the submission could not be marked reviewed', appliedToCatalog: true });
  await click(buttonNamed(container, '套用 6 項'), '套用 6 項');
  const banner = need(alertWith(container, '直接通過（不套用）'), 'the recovery message');

  // The stream went away meanwhile: the approval that applies nothing is refused (404 no_target_stream), in words.
  statusReply = () => failure(404, { error: 'no_target_stream' });
  await click(need(buttonNamed(banner, '直接通過（不套用）'), 'the recovery action'), '直接通過（不套用）');
  await click(buttonNamed(need(confirmDialog(container), 'the confirm'), '直接通過'), "the confirm's 直接通過");
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

async function rejecting(mountPage: MountPage): Promise<void> {
  reset();
  const view = ichiiCorrectionView();
  const { container, unmount } = await mountPage();
  await typeInto(noteBox(container), 'Times are fine as they are');
  const answer = held();
  statusReply = () => answer.reply;
  const reject = need(buttonNamed(container, '退回'), 'the reject button');
  await focus(reject);
  await click(reject, '退回');
  assert(statusCalls().length === 1 && applyCalls().length === 0, 'a rejection is a status change, not an apply');
  deepStrictEqual(need(statusCalls()[0], 'the status request').body, { status: 'rejected', reviewer_note: 'Times are fine as they are' });
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
  // The submission was reviewed after this page loaded it (another tab, or the list): the apply and the rejection
  // are refused with 409 not_pending. The page says so and asks for the review again, which reads as reviewed.
  const cases = [
    { action: '套用 6 項', status: 'approved', label: '已通過' },
    { action: '退回', status: 'rejected', label: '已退回' },
  ] as const;
  for (const { action, status, label } of cases) {
    reset();
    const { container, unmount } = await mountPage();
    correctionReply = () => ok(reviewedView(status));
    applyReply = () => failure(409, { error: 'not_pending' });
    statusReply = () => failure(409, { error: 'not_pending' });
    await click(buttonNamed(container, action), action);
    deepStrictEqual(toastsOf(container).map(({ message, detail, danger }) => ({ message, detail, danger })), [
      { message: '這份投稿已審核過了', detail: '', danger: true },
    ], `a refused ${action} says the submission was reviewed`);
    assert(correctionCalls().length === 2, `${action}: the review is asked for again (got ${correctionCalls().length})`);
    assert(textOf(container).includes(`這份投稿已審核過了（${label}），不能再套用或退回。`), `${action}: the page then reads as reviewed`);
    assert(offersNothing(container), `${action}: and offers nothing to send`);
    assert(whereOf(container) === '/nova/vods/vod-1/review', `${action}: the page stays`);
    await unmount();
  }
  console.log('✓ review page: an apply or a rejection refused as not_pending toasts 這份投稿已審核過了 and loads the review again, read-only');
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
  await click(buttonNamed(compactOf(rowNamed(container, 'Late Night Drive')), '跳到 14:41'), '跳到 14:41');
  await click(buttonNamed(compactOf(rowNamed(container, 'Moon River')), '跳到 1:29:37'), '跳到 1:29:37');
  // The times an open panel shows beside its fields too.
  const panel = await expand(container, 'Fly Me To The Moon');
  await click(buttonNamed(panel, '跳到 1:01:03'), "the panel's current end");
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

  await rendersThePairs(mountPage);
  await applySendsTheOperations(mountPage);
  await staleShowsAReloadBanner(mountPage);
  await invalidOperationsShowsTheServersDetail(mountPage);
  await expandingTheTitleRowOffersTheFourChoices(mountPage);
  await aBlankArtistKeepsTheCuratedOne(mountPage);
  await linkingAnExistingSong(mountPage);
  await thePendingHintFollowsTheStream(mountPage);
  await editingTimes(mountPage);
  await aPrefixIsNeverCommitted(mountPage);
  await anAddsTimeIsCommittedOnlyWhenItIsLeft(mountPage);
  await rePairingByHand(mountPage);
  await aDeleteAndAnAdd(mountPage);
  await unchangedPairsCollapse(mountPage);
  await aCaseOnlyFixIsReachable(mountPage);
  await startOnlyRowsProposeNoEnds(mountPage);
  await aMovedStartKeepsTheDerivedEndOut(mountPage);
  await bannersOfTheStream(mountPage);
  await wouldPublishHidden(mountPage);
  await aFailureThatReachedTheCatalog(mountPage);
  await aRecoveryWhoseStreamIsGone(mountPage);
  await rejecting(mountPage);
  await aReviewedSubmissionIsReadOnly(mountPage);
  await aSubmissionReviewedElsewhere(mountPage);
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
