/**
 * Song Detail on the studio kit (spec §8.9), mounted live the way App.tsx mounts every page
 * (ToastProvider > router) against a stubbed fetch: the record header with its Songs crumb, the
 * metadata card with its inline edit (trimmed values, inline errors, a save failure that stays in the
 * card), Approve and Reject for a curator, the performance posters that load one video at a time, the
 * load failure with its Retry, and a song the worker does not know.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { AuthUser, Performance, Song, Status } from '../../shared/types';
import YouTubeEmbed from '../src/components/YouTubeEmbed';
import { buttonClasses } from '../src/components/ui/button-classes';
import { youtubeThumbnailUrl } from '../src/lib/youtube';
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

function performance(
  fields: Pick<Performance, 'id' | 'streamTitle' | 'videoId'> & Partial<Performance>,
): Performance {
  return {
    songId: 's-1',
    streamId: `stream-${fields.id}`,
    date: '2026-03-01',
    timestamp: 0,
    endTimestamp: null,
    note: '',
    status: 'approved',
    submittedBy: 'fan@example.com',
    createdAt: '2026-03-02 09:00:00',
    ...fields,
  };
}

const FIRST = performance({
  id: 'perf-1',
  streamTitle: 'First Stream',
  videoId: 'vid-one',
  date: '2026-03-01',
  timestamp: 75,
  endTimestamp: 310,
  note: 'Encore',
  status: 'approved',
});
const SECOND = performance({
  id: 'perf-2',
  streamTitle: 'Second Stream',
  videoId: 'vid-two',
  date: '2025-12-06',
  timestamp: 3900,
  endTimestamp: null,
  note: '',
  status: 'pending',
});

// Stored times are UTC ("YYYY-MM-DD HH:MM:SS"), as D1 writes them: Created is from another year,
// Updated from this one.
const SONG: Song = {
  id: 's-1',
  workId: null,
  title: 'Lemon',
  originalArtist: 'Kenshi Yonezu',
  tags: [],
  status: 'pending',
  submittedBy: 'fan@example.com',
  reviewedBy: null,
  createdAt: '2020-03-04 12:00:00',
  updatedAt: `${THIS_YEAR}-01-15 12:00:00`,
  performances: [FIRST, SECOND],
};

const OTHER_SONG: Song = {
  ...SONG,
  id: 's-2',
  title: 'Second Song',
  originalArtist: 'Another Artist',
  performances: [performance({ id: 'perf-3', songId: 's-2', streamTitle: 'Third Stream', videoId: 'vid-three' })],
};

const SAVED_AT = `${THIS_YEAR}-02-01 08:30:00`;

function withStatus(base: Song, status: Status): Song {
  return { ...base, status };
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

/** What happy-dom asked YouTube for on behalf of an iframe: it fetches an iframe's src itself. */
const frameRequests: string[] = [];

/** The song the worker holds; a scenario swaps it (another status, another performance list). */
let serverSong: Song = SONG;

const defaultGetReply = (_call: Call, id: string): Reply => (id === serverSong.id ? ok(serverSong) : failure(404, 'Song not found'));

/** What the worker answers a save: the whole song, with the fields it was sent. */
const defaultPutReply = (call: Call, id: string): Reply => {
  if (id !== serverSong.id) return failure(404, 'Song not found');
  const sent = call.body as { title: string; originalArtist: string };
  return ok({ ...serverSong, title: sent.title, originalArtist: sent.originalArtist, updatedAt: SAVED_AT });
};

/** What the worker answers a status change: the whole song, in the status that was asked for. */
const defaultPatchReply = (call: Call, id: string): Reply => {
  if (id !== serverSong.id) return failure(404, 'Song not found');
  const { status } = call.body as { status: Status };
  return ok({ ...serverSong, status, reviewedBy: 'curator@example.com', updatedAt: SAVED_AT });
};

/** What each endpoint answers next; a scenario swaps them. A promise holds the answer until released. */
let getReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultGetReply;
let putReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultPutReply;
let patchReply: (call: Call, id: string) => Reply | Promise<Reply> = defaultPatchReply;

function reset(): void {
  calls.length = 0;
  frameRequests.length = 0;
  serverSong = SONG;
  getReply = defaultGetReply;
  putReply = defaultPutReply;
  patchReply = defaultPatchReply;
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
      if (method === 'GET' && songId !== undefined) reply = getReply(call, decodeURIComponent(songId));
      else if (method === 'PUT' && songId !== undefined) reply = putReply(call, decodeURIComponent(songId));
      else if (method === 'PATCH' && statusId !== undefined) reply = patchReply(call, decodeURIComponent(statusId));
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

function getCalls(): Call[] {
  return calls.filter((call) => call.method === 'GET');
}

function putCalls(): Call[] {
  return calls.filter((call) => call.method === 'PUT');
}

function patchCalls(): Call[] {
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

async function focusOn(node: HTMLElement): Promise<void> {
  await act(async () => {
    node.focus();
  });
}

function pageHeader(container: HTMLElement): HTMLElement {
  return need(container.querySelector<HTMLElement>('header'), 'its header');
}

function heading(container: HTMLElement): HTMLElement {
  return need(container.querySelector<HTMLElement>('h1'), 'its <h1>');
}

function crumbOf(container: HTMLElement): HTMLAnchorElement {
  return need(pageHeader(container).querySelector<HTMLAnchorElement>('a[href="/songs"]'), 'the Songs crumb link');
}

function detailsCard(container: HTMLElement): HTMLElement {
  return need(container.querySelector<HTMLElement>('section[aria-label="Song details"]'), 'the metadata card');
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

function cardButton(container: HTMLElement, name: string): HTMLButtonElement {
  return need(buttonNamed(detailsCard(container), name), `${name} in the metadata card`);
}

function editForm(container: HTMLElement): HTMLFormElement {
  return need(detailsCard(container).querySelector<HTMLFormElement>('form'), 'the edit form');
}

function fieldInput(container: HTMLElement, label: string): HTMLInputElement {
  const name = need(
    [...editForm(container).querySelectorAll<HTMLLabelElement>('label')].find((candidate) => textOf(candidate).startsWith(label)),
    `the ${label} label`,
  );
  return need(document.getElementById(name.htmlFor) as HTMLInputElement | null, `the ${label} field`);
}

/** What a control's aria-describedby points at, joined: the hint and error a screen reader reads with it. */
function describedBy(control: Element): string {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => textOf(document.getElementById(id)))
    .join(' ');
}

/** The metadata card's terms and what they hold, in order. */
function detailTerms(container: HTMLElement): Array<[string, string]> {
  const list = need(detailsCard(container).querySelector('dl'), 'the details list');
  return [...list.children].map((group) => [textOf(group.querySelector('dt')), textOf(group.querySelector('dd'))]);
}

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"]');
}

/** One card per performance: the list under the "Performances" heading (the toasts are <li>s too). */
function performanceCards(container: HTMLElement): HTMLElement[] {
  const title = [...container.querySelectorAll('h2')].find((candidate) => textOf(candidate) === 'Performances');
  return [...(title?.parentElement?.querySelectorAll<HTMLElement>('ul > li') ?? [])];
}

function posterButton(container: HTMLElement, streamTitle: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="Play ${streamTitle}"]`);
}

function iframesOf(container: HTMLElement): HTMLIFrameElement[] {
  return [...container.querySelectorAll<HTMLIFrameElement>('iframe')];
}

/** Lets happy-dom's iframe navigation, which runs a few ticks behind the render, reach its request. */
async function flushFrames(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await settle();
}

/** The `src` YouTubeEmbed itself draws for this video: the pinned contract an active poster must equal. */
function embedSrc(videoId: string, startSeconds?: number): string {
  return (
    /src="([^"]*)"/.exec(renderToStaticMarkup(<YouTubeEmbed videoId={videoId} title="T" startSeconds={startSeconds} />))?.[1] ?? ''
  );
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

function toastPairs(container: HTMLElement): Array<{ message: string; detail: string }> {
  return toastsOf(container).map(({ message, detail }) => ({ message, detail }));
}

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user: AuthUser, id?: string, jumpTo?: string) => Promise<Mounted>;

/** A control that moves the router to another path, as a link to another song would. */
function Jump({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Jump
    </button>
  );
}

/** Opens the form the way a keyboard user does: Edit holds the focus, then is pressed. */
async function openForm(container: HTMLElement): Promise<HTMLFormElement> {
  const edit = cardButton(container, 'Edit');
  await focusOn(edit);
  await click(edit, 'Edit');
  return editForm(container);
}

// --- Scenarios ---

async function firstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const first = held();
  getReply = () => first.reply;
  const { container, unmount } = await mountPage(curator);

  // One request on mount, for this song and this streamer, and nothing else.
  assert(calls.length === 1 && getCalls().length === 1, 'mounting sends exactly one request, for the song');
  const initial = need(getCalls()[0], 'the song request');
  assert(initial.path === '/api/songs/s-1', `the request is for the song in the URL (got ${initial.path})`);
  assert(initial.params.toString() === 'streamer=mizuki', `it carries the current streamer (got ${initial.params.toString()})`);

  // The header is there before any data: the crumb, the <h1> that Retry hands the focus to, then a skeleton.
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
  assert(textOf(crumbOf(container)) === 'Songs', 'the crumb is a link named "Songs"');
  assert(crumbOf(container).querySelector('svg') !== null, 'a back chevron leads the crumb');
  assert(textOf(heading(container)) === 'Song', 'before the song arrives the <h1> is a plain "Song"');
  const skeleton = need(container.querySelector('[role="status"]'), 'a skeleton while the load is out');
  assert(textOf(skeleton) === 'Loading song…', 'the skeleton says what is loading');
  assert(
    container.querySelector('section[aria-label="Song details"]') === null && iframesOf(container).length === 0,
    'no card and no player before the response',
  );
  assert(!container.innerHTML.includes('Song not found'), 'an unanswered load is not an unknown song');
  assertNoRawColour(container.innerHTML, 'the loading page');

  await respond(first, ok(SONG));
  assert(container.querySelector('[role="status"]') === null, 'the response ends the loading state');
  assert(getCalls().length === 1, 'nothing else is requested once the page has loaded');

  // The header: the song's title (full text in `title`), its status pill and its artist.
  assert(textOf(heading(container)) === 'Lemon', "the <h1> is the song's title");
  assert(need(heading(container).querySelector('span'), 'the title span').getAttribute('title') === 'Lemon', 'the full title is in `title`');
  const meta = need(heading(container).nextElementSibling as HTMLElement | null, 'the meta row under the title');
  deepStrictEqual(
    [...meta.children].map((item) => textOf(item)),
    ['Pending', 'Kenshi Yonezu'],
  );
  assert(crumbOf(container).getAttribute('href') === '/songs', 'the crumb goes back to the list');
  assert(header.querySelector('button') === null, 'the header carries no actions: they sit in the metadata card');

  // The metadata card: artist, submitter, reviewer, created and updated, with the times as <time>.
  const card = detailsCard(container);
  assert(textOf(card.querySelector('h2')) === 'Details', 'the card is headed "Details"');
  const terms = detailTerms(container);
  deepStrictEqual(
    terms.map(([label]) => label),
    ['Artist', 'Submitted by', 'Reviewed by', 'Created', 'Updated'],
  );
  assert(terms[0]?.[1] === 'Kenshi Yonezu' && terms[1]?.[1] === 'fan@example.com', 'the artist and the submitter are shown');
  assert(terms[2]?.[1] === '—', 'a song nobody has reviewed shows a dash');
  assert(card.querySelector('dl')?.tagName === 'DL' && card.querySelectorAll('dt').length === 5, 'the terms are a <dl>');
  const times = [...card.querySelectorAll('time')];
  assert(times.length === 2, 'Created and Updated are two <time> elements');
  const [created, updated] = times;
  assert(created?.getAttribute('datetime') === '2020-03-04T12:00:00.000Z', 'Created carries its exact instant, as an ISO string');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(textOf(created)), `a date from another year reads like "2020-03-04" (got ${textOf(created)})`);
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(created?.getAttribute('title') ?? ''), 'and has its full time in the title');
  assert(updated?.getAttribute('datetime') === `${THIS_YEAR}-01-15T12:00:00.000Z`, 'Updated carries its exact instant too');
  assert(
    /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/.test(textOf(updated)),
    `a date this year reads like "Jan 15, 12:00" (got ${textOf(updated)})`,
  );
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(updated?.getAttribute('title') ?? ''), 'and has its full time in the title');
  assert(!card.innerHTML.includes('2020-03-04 12:00:00'), 'no raw stored time is shown');

  // A curator on a pending song: Edit, Approve and Reject, in the card.
  deepStrictEqual(
    [...card.querySelectorAll('button')].map((button) => textOf(button)),
    ['Edit', 'Approve', 'Reject'],
  );

  // The performances: one card each, with the stream, when it was sung, the note and the status; a poster, no player.
  deepStrictEqual(
    [...container.querySelectorAll('h2')].map((item) => textOf(item)),
    ['Details', 'Performances'],
  );
  const cards = performanceCards(container);
  assert(cards.length === 2, 'each performance has a card');
  const [firstCard, secondCard] = cards;
  assert(textOf(firstCard).includes('First Stream') && textOf(secondCard).includes('Second Stream'), 'the cards follow the worker order');
  assert(
    textOf(firstCard).includes('2026-03-01 · 1:15 – 5:10'),
    `a performance reads "date · start – end" (got ${textOf(firstCard)})`,
  );
  assert(textOf(firstCard).includes('Encore') && textOf(firstCard).includes('Approved'), 'the note and the status pill are shown');
  assert(
    textOf(secondCard).includes('2025-12-06 · 1:05:00') && !textOf(secondCard).includes('–') && textOf(secondCard).includes('Pending'),
    'a performance with no end shows only its start, with hours past the first',
  );
  const poster = need(posterButton(container, 'First Stream'), 'a poster for the first performance');
  assert(
    need(poster.querySelector('img'), 'its thumbnail').getAttribute('src') === youtubeThumbnailUrl('vid-one'),
    "the poster is the video's thumbnail",
  );
  assert(posterButton(container, 'Second Stream') !== null, 'and the second has one too');
  assert(iframesOf(container).length === 0, 'two performances load no player until one is asked for');
  await flushFrames();
  assert(frameRequests.length === 0, `and request nothing from YouTube (asked for ${frameRequests.join(', ')})`);

  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assert(toastsOf(container).length === 0, 'a load raises no toast');
  assert(unexpected.length === 0, `nothing but the song is requested (${unexpected.join(', ')})`);
  assertNoRawColour(container.innerHTML, 'the loaded page');

  await unmount();
  console.log('✓ Song Detail: one request, the header with its crumb, the metadata card with <time> cells, the performance posters');
}

async function editSavesTrimmedValues(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const edit = cardButton(container, 'Edit');
  assert(edit.type === 'button' && edit.querySelector('svg') !== null, 'Edit is a typed button with an icon');

  // Edit opens the form in the card, with the focus on its first field.
  await focusOn(edit);
  await click(edit, 'Edit');
  const form = editForm(container);
  const title = fieldInput(container, 'Song title');
  const artist = fieldInput(container, 'Original artist');
  assert(focused() === title, `Edit moves the focus to the title field (got ${focused()?.tagName})`);
  assert(!edit.isConnected && buttonNamed(detailsCard(container), 'Edit') === null, 'Edit leaves while the form is open');
  assert(title.value === 'Lemon' && artist.value === 'Kenshi Yonezu', 'the fields start from the saved values');
  assert(
    detailTerms(container).map(([label]) => label).join('|') === 'Submitted by|Reviewed by|Created|Updated',
    'the artist term gives way to its field, and the rest of the card stays',
  );

  // The form's contract: no browser validation bubble, required fields marked for assistive technology.
  assert(form.hasAttribute('novalidate'), 'the form carries noValidate, so the inline errors are the only ones');
  assert(!/\srequired(=|\s|>)/.test(form.outerHTML), 'no field carries the required attribute');
  assert(
    title.getAttribute('aria-required') === 'true' && artist.getAttribute('aria-required') === 'true',
    'both fields are aria-required',
  );
  assert(title.type === 'text' && artist.type === 'text', 'both fields are text inputs');
  assert(title.getAttribute('aria-invalid') === null && describedBy(title) === '', 'an untouched field is not invalid and has no description');
  assert(alertOf(container) === null, 'there is no note before anything fails');
  const save = cardButton(container, 'Save');
  const cancel = cardButton(container, 'Cancel');
  assert(save.type === 'submit' && cancel.type === 'button', 'Save submits the form; Cancel does not');

  // Both values typed with spaces around them: the trimmed values are what is sent.
  await typeInto(title, '  Kick Back  ');
  await typeInto(artist, '  Kenshi Yonezu (米津玄師)  ');
  await focusOn(save);
  const answer = held();
  putReply = () => answer.reply;
  await click(save, 'Save');
  assert(putCalls().length === 1, 'Save sends one request');
  const sent = need(putCalls()[0], 'the save request');
  assert(sent.path === '/api/songs/s-1', 'it updates the song in the URL');
  deepStrictEqual(sent.body, { title: 'Kick Back', originalArtist: 'Kenshi Yonezu (米津玄師)' });
  assert(
    save.getAttribute('aria-busy') === 'true' && save.getAttribute('aria-disabled') === 'true' && !save.hasAttribute('disabled'),
    'Save is busy, not disabled, while the request is out',
  );
  assert(cancel.hasAttribute('disabled'), 'Cancel is unavailable meanwhile: a request in flight cannot be taken back');
  assert(focused() === save, 'Save keeps the focus while its request is out');
  await click(save, 'the busy Save');
  assert(putCalls().length === 1, 'a second click on the busy Save sends nothing');
  assert(toastsOf(container).length === 0 && textOf(heading(container)) === 'Lemon', 'nothing changes until the worker has answered');

  await respond(answer, ok({ ...SONG, title: 'Kick Back', originalArtist: 'Kenshi Yonezu (米津玄師)', updatedAt: SAVED_AT }));
  assert(container.querySelector('form') === null, 'the form closes once the save succeeds');
  assert(textOf(heading(container)) === 'Kick Back', 'the header shows the new title');
  assert(
    [...(heading(container).nextElementSibling?.children ?? [])].map((item) => textOf(item)).join('|') === 'Pending|Kenshi Yonezu (米津玄師)',
    'and the new artist',
  );
  assert(detailTerms(container)[0]?.join('|') === 'Artist|Kenshi Yonezu (米津玄師)', 'the card shows the saved artist');
  assert(
    need(detailsCard(container).querySelectorAll('time')[1], 'the Updated time').getAttribute('datetime') === `${THIS_YEAR}-02-01T08:30:00.000Z`,
    "Updated follows the worker's answer",
  );
  deepStrictEqual(toastPairs(container), [{ message: 'Song saved', detail: 'Kick Back' }]);
  const editAgain = cardButton(container, 'Edit');
  assert(focused() === editAgain, `Save returns the focus to Edit (got ${focused()?.tagName})`);
  assert(getCalls().length === 1, 'the song is updated from the answer, not fetched again');
  assert(performanceCards(container).length === 2, 'the performances stay');
  assertNoRawColour(container.innerHTML, 'the saved page');

  await unmount();
  console.log('✓ Song Detail (curator): Edit focuses the title, Save sends the trimmed values, is busy meanwhile, toasts and returns the focus to Edit');
}

async function failedSaveStaysInTheCard(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const list = need(container.querySelector('ul'), 'the performance list');
  const headerNode = pageHeader(container);
  const cardNode = detailsCard(container);

  // A video is playing: a save that fails must not touch it.
  const poster = need(posterButton(container, 'First Stream'), 'the first poster');
  await click(poster, 'the first poster');
  const player = need(iframesOf(container)[0], 'the player');

  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Another title');
  const save = cardButton(container, 'Save');
  await focusOn(save);
  const answer = held();
  putReply = () => answer.reply;
  await click(save, 'Save');
  await respond(answer, failure(500, 'Database is locked'));

  assert(editForm(container).isConnected && container.querySelector('form') !== null, 'a failed save keeps the form open');
  assert(fieldInput(container, 'Song title').value === 'Another title', 'with what was typed');
  const note = need(alertOf(container), 'a danger note for the failed save');
  assert(detailsCard(container).contains(note), 'the note sits inside the metadata card');
  assert(textOf(note).includes('Database is locked'), "it carries the worker's message");
  assert(note.classList.contains('border-tone-danger-line'), 'and is a danger note');
  assert(buttonNamed(note, 'Retry') === null, 'a failed save offers no Retry: the form is still there to press Save again');
  assert(toastsOf(container).length === 0, 'and raises no toast');
  assert(detailsCard(container) === cardNode && pageHeader(container) === headerNode, 'the page is intact: the same card and header');
  assert(container.querySelector('ul') === list && iframesOf(container)[0] === player, 'the performances and the playing video are untouched');
  assert(textOf(heading(container)) === 'Lemon', 'the header still shows the saved title');
  assert(
    save.getAttribute('aria-busy') === null && save.getAttribute('aria-disabled') === null && !save.hasAttribute('disabled'),
    'Save is available again',
  );
  assert(focused() === save, 'the focus never left Save');
  assert(putCalls().length === 1 && getCalls().length === 1, 'nothing else was requested');
  assertNoRawColour(container.innerHTML, 'the page with a save failure');

  // The next attempt clears the note as it starts, and its success closes the form.
  const again = held();
  putReply = () => again.reply;
  await click(save, 'Save');
  assert(alertOf(container) === null, 'a new attempt clears the old note');
  assert(putCalls().length === 2, 'and sends the request again');
  await respond(again, ok({ ...SONG, title: 'Another title', updatedAt: SAVED_AT }));
  assert(container.querySelector('form') === null && textOf(heading(container)) === 'Another title', 'the second attempt saves');
  deepStrictEqual(toastPairs(container), [{ message: 'Song saved', detail: 'Another title' }]);
  assert(iframesOf(container)[0] === player, 'a save that works does not restart the video either');

  await unmount();
  console.log('✓ Song Detail: a failed save stays in the card as a danger note, the page and the playing video stay, and a retry clears it');
}

async function cancelRestoresTheSavedValues(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Abandoned title');
  await typeInto(fieldInput(container, 'Original artist'), 'Abandoned artist');
  const cancel = cardButton(container, 'Cancel');
  await focusOn(cancel);
  await click(cancel, 'Cancel');
  assert(container.querySelector('form') === null, 'Cancel closes the form');
  assert(putCalls().length === 0, 'and sends nothing');
  assert(textOf(heading(container)) === 'Lemon' && detailTerms(container)[0]?.[1] === 'Kenshi Yonezu', 'the saved values stay');
  assert(focused() === cardButton(container, 'Edit'), `Cancel returns the focus to Edit (got ${focused()?.tagName})`);
  assert(toastsOf(container).length === 0, 'and says nothing');

  // The abandoned text does not come back.
  await openForm(container);
  assert(fieldInput(container, 'Song title').value === 'Lemon', 'the next Edit starts from the saved title');
  assert(fieldInput(container, 'Original artist').value === 'Kenshi Yonezu', 'and the saved artist');

  // Nor do its errors or a failure note.
  await typeInto(fieldInput(container, 'Song title'), '   ');
  await click(cardButton(container, 'Save'), 'Save');
  assert(describedBy(fieldInput(container, 'Song title')) === 'Enter a title.', 'the blank title is reported');
  await click(cardButton(container, 'Cancel'), 'Cancel');
  await openForm(container);
  assert(
    describedBy(fieldInput(container, 'Song title')) === '' && fieldInput(container, 'Song title').getAttribute('aria-invalid') === null,
    'a reopened form shows no error',
  );
  assert(putCalls().length === 0, 'none of it reached the worker');

  putReply = () => failure(500, 'Database is locked');
  await click(cardButton(container, 'Save'), 'Save');
  assert(alertOf(container) !== null, 'a failed save shows its note');
  await click(cardButton(container, 'Cancel'), 'Cancel');
  await openForm(container);
  assert(alertOf(container) === null, 'a reopened form shows no note either');

  await unmount();
  console.log('✓ Song Detail: Cancel returns the focus to Edit, and the next Edit starts from the saved values, with no error or note');
}

async function emptyFieldsBlockSave(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  await openForm(container);
  const title = fieldInput(container, 'Song title');
  const artist = fieldInput(container, 'Original artist');
  const save = cardButton(container, 'Save');

  // A title of spaces is empty after trim: no request, an inline error, the focus on the field.
  await typeInto(title, '    ');
  await focusOn(save);
  await click(save, 'Save');
  assert(putCalls().length === 0, 'an empty title sends no request');
  assert(container.querySelector('form') !== null, 'and the form stays open');
  assert(describedBy(title) === 'Enter a title.', `the title field is described by "Enter a title." (got "${describedBy(title)}")`);
  assert(title.getAttribute('aria-invalid') === 'true', 'and is marked invalid');
  assert(
    artist.getAttribute('aria-invalid') === null && describedBy(artist) === '',
    'the artist field, which is fine, carries no error',
  );
  const message = need(editForm(container).querySelector('p.text-tone-danger-fg'), 'the inline error');
  assert(textOf(message) === 'Enter a title.' && editForm(container).contains(message), 'the error is inline, in the form');
  assert(focused() === title, `the focus goes to the field that needs fixing (got ${focused()?.tagName})`);
  assert(toastsOf(container).length === 0 && alertOf(container) === null, 'no toast and no alert: the field says it');

  // Fixing it clears the error at once.
  await typeInto(title, 'Lemon');
  assert(
    describedBy(title) === '' && title.getAttribute('aria-invalid') === null,
    'a title that is no longer empty is no longer reported',
  );

  // The same for the artist, with its own words; the focus goes to it.
  await typeInto(artist, ' \t ');
  await focusOn(save);
  await click(save, 'Save');
  assert(putCalls().length === 0, 'an empty artist sends no request');
  assert(describedBy(artist) === 'Enter the original artist.', `the artist field is described by "Enter the original artist." (got "${describedBy(artist)}")`);
  assert(artist.getAttribute('aria-invalid') === 'true' && title.getAttribute('aria-invalid') === null, 'only the artist is marked');
  assert(focused() === artist, 'the focus goes to the artist field');

  // Both empty: both reported, the focus on the first.
  await typeInto(title, '');
  await focusOn(save);
  await click(save, 'Save');
  assert(
    describedBy(title) === 'Enter a title.' && describedBy(artist) === 'Enter the original artist.',
    'two empty fields are both reported',
  );
  assert(focused() === title, 'the focus goes to the first of them');
  assert(putCalls().length === 0, 'and still nothing is sent');
  assertNoRawColour(container.innerHTML, 'the form with its errors');

  // Once both hold something, Save sends.
  await typeInto(title, ' Lemon ');
  await typeInto(artist, ' Kenshi Yonezu ');
  await click(save, 'Save');
  assert(putCalls().length === 1, 'a valid form sends its request');
  deepStrictEqual(need(putCalls()[0], 'the save request').body, { title: 'Lemon', originalArtist: 'Kenshi Yonezu' });

  await unmount();
  console.log('✓ Song Detail: a title or artist that is empty after trim blocks Save with an inline error and the focus, and fixing it clears it');
}

async function decideAndFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const approve = cardButton(container, 'Approve');
  const reject = cardButton(container, 'Reject');
  const edit = cardButton(container, 'Edit');
  assert(approve.type === 'button' && reject.type === 'button', 'Approve and Reject are typed buttons');

  // A keyboard user on Approve: it sends { status: 'approved' }, and is busy (still focusable) meanwhile.
  await focusOn(approve);
  const answer = held();
  patchReply = () => answer.reply;
  await click(approve, 'Approve');
  assert(patchCalls().length === 1, 'Approve sends one request');
  const sent = need(patchCalls()[0], 'the status request');
  assert(sent.path === '/api/songs/s-1/status' && sent.method === 'PATCH', 'it patches the song status');
  deepStrictEqual(sent.body, { status: 'approved' });
  assert(
    approve.getAttribute('aria-busy') === 'true' && approve.getAttribute('aria-disabled') === 'true' && !approve.hasAttribute('disabled'),
    'the clicked button is busy, not disabled',
  );
  assert(reject.hasAttribute('disabled') && edit.hasAttribute('disabled'), 'its sibling and Edit are unavailable while the request is out');
  assert(focused() === approve, 'Approve keeps the focus while its request is out');
  await click(approve, 'the busy Approve');
  assert(patchCalls().length === 1, 'a second click on the busy button sends nothing');
  assert(
    textOf(heading(container).nextElementSibling?.firstElementChild) === 'Pending' && toastsOf(container).length === 0,
    'the status reads Pending and nothing is announced until the worker has answered',
  );

  await respond(answer, ok({ ...SONG, status: 'approved', reviewedBy: 'curator@example.com', updatedAt: SAVED_AT }));
  patchReply = defaultPatchReply;
  assert(
    textOf(heading(container).nextElementSibling?.firstElementChild) === 'Approved',
    'the header pill shows the new status',
  );
  assert(detailTerms(container)[2]?.join('|') === 'Reviewed by|curator@example.com', 'the reviewer is shown');
  assert(buttonNamed(detailsCard(container), 'Approve') === null && buttonNamed(detailsCard(container), 'Reject') === null, 'the decided song offers no decision any more');
  assert(!approve.isConnected && !reject.isConnected, 'both buttons are gone');
  const editNow = cardButton(container, 'Edit');
  assert(!editNow.hasAttribute('disabled'), 'Edit is available again');
  assert(focused() === editNow, `the focus Approve held moves to Edit, not to <body> (got ${focused()?.tagName})`);
  deepStrictEqual(toastPairs(container), [{ message: 'Song approved', detail: 'Lemon' }]);
  assert(getCalls().length === 1, 'the song is updated from the answer, not fetched again');
  assert(performanceCards(container).length === 2, 'the performances stay');
  assertNoRawColour(container.innerHTML, 'the approved page');

  await unmount();
  console.log('✓ Song Detail (curator): Approve is busy meanwhile, then the pill, the reviewer, a toast and the focus on Edit');
}

async function rejectAndExtracted(mountPage: MountPage): Promise<void> {
  reset();
  serverSong = withStatus(SONG, 'extracted');
  const { container, unmount } = await mountPage(curator);
  assert(
    buttonNamed(detailsCard(container), 'Approve') !== null && buttonNamed(detailsCard(container), 'Reject') !== null,
    'an extracted song can be decided too',
  );
  assert(textOf(heading(container).nextElementSibling?.firstElementChild) === 'Extracted', 'the header shows Extracted');

  // A playing video stays put through the decision.
  await click(need(posterButton(container, 'Second Stream'), 'the second poster'), 'the second poster');
  const player = need(iframesOf(container)[0], 'the player');

  const reject = cardButton(container, 'Reject');
  await focusOn(reject);
  const answer = held();
  patchReply = () => answer.reply;
  await click(reject, 'Reject');
  deepStrictEqual(need(patchCalls()[0], 'the status request').body, { status: 'rejected' });
  assert(reject.getAttribute('aria-busy') === 'true', 'Reject is the busy one');
  assert(cardButton(container, 'Approve').hasAttribute('disabled'), 'Approve is unavailable meanwhile');
  await respond(answer, ok({ ...serverSong, status: 'rejected', reviewedBy: 'curator@example.com', updatedAt: SAVED_AT }));
  assert(textOf(heading(container).nextElementSibling?.firstElementChild) === 'Rejected', 'the header shows Rejected');
  assert(focused() === cardButton(container, 'Edit'), 'Reject hands its focus to Edit too');
  deepStrictEqual(toastPairs(container), [{ message: 'Song rejected', detail: 'Lemon' }]);
  assert(iframesOf(container)[0] === player && iframesOf(container).length === 1, 'the playing video is not restarted by the decision');

  await unmount();

  // Songs that are not waiting for a decision offer none.
  for (const status of ['approved', 'rejected', 'excluded'] as const) {
    reset();
    serverSong = withStatus(SONG, status);
    const other = await mountPage(curator);
    assert(
      buttonNamed(detailsCard(other.container), 'Approve') === null && buttonNamed(detailsCard(other.container), 'Reject') === null,
      `a ${status} song offers no Approve or Reject`,
    );
    assert(buttonNamed(detailsCard(other.container), 'Edit') !== null, `but a curator can still edit a ${status} song`);
    await other.unmount();
  }

  console.log('✓ Song Detail (curator): Reject and extracted songs; approved, rejected and excluded songs offer no decision');
}

async function failedDecisionOffersRetry(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const approve = cardButton(container, 'Approve');
  const reject = cardButton(container, 'Reject');

  patchReply = () => failure(400, 'Cannot transition from rejected to approved');
  await focusOn(approve);
  await click(approve, 'Approve');
  assert(textOf(heading(container).nextElementSibling?.firstElementChild) === 'Pending', 'a failed decision leaves the status as it was');
  assert(approve.isConnected && reject.isConnected, 'and keeps its buttons');
  assert(
    approve.getAttribute('aria-busy') === null && approve.getAttribute('aria-disabled') === null && !reject.hasAttribute('disabled'),
    'both are available again',
  );
  assert(!cardButton(container, 'Edit').hasAttribute('disabled'), 'and so is Edit');
  assert(focused() === approve, 'the focus never left Approve');
  assert(alertOf(container) === null, 'a failed decision is a toast, not a note in the card');
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
  patchReply = defaultPatchReply;
  await click(failed.retry, 'Retry in the toast');
  assert(patchCalls().length === 2, 'Retry sends the call again');
  const retried = need(patchCalls()[1], 'the retried request');
  assert(retried.path === '/api/songs/s-1/status', 'to the same song');
  deepStrictEqual(retried.body, { status: 'approved' });
  assert(textOf(heading(container).nextElementSibling?.firstElementChild) === 'Approved', 'the status changes');
  deepStrictEqual(toastPairs(container), [{ message: 'Song approved', detail: 'Lemon' }]);

  await unmount();

  // A failed Reject retries as a Reject.
  reset();
  const second = await mountPage(curator);
  patchReply = () => failure(500, 'Database is locked');
  await click(cardButton(second.container, 'Reject'), 'Reject');
  const locked = need(toastsOf(second.container).find((toast) => toast.message === 'Database is locked'), 'a toast with the server message');
  patchReply = defaultPatchReply;
  await click(locked.retry, 'Retry in the toast');
  deepStrictEqual(need(patchCalls()[1], 'the retried reject').body, { status: 'rejected' });
  assert(textOf(heading(second.container).nextElementSibling?.firstElementChild) === 'Rejected', 'the retried Reject takes effect');
  await second.unmount();

  console.log('✓ Song Detail (curator): a failed decision keeps the buttons, shows the server message and a Retry that sends the same call');
}

/*
 * A decision the worker made whose answer was lost on the way would otherwise read as failed until a Retry. A failed
 * decision reads the song back before it says anything, the card busy meanwhile: the three outcomes of that read.
 */

async function aFailedDecisionTheWorkerMadeIsDone(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const approve = cardButton(container, 'Approve');
  const reject = cardButton(container, 'Reject');

  // The approval went through, but its answer was lost on the way back: a gateway error.
  const reading = held();
  patchReply = () => failure(504, 'Gateway timeout');
  getReply = () => reading.reply;
  await focusOn(approve);
  await click(approve, 'Approve');
  assert(
    approve.getAttribute('aria-busy') === 'true' && reject.hasAttribute('disabled') && toastsOf(container).length === 0,
    'the failed change says nothing yet: the card stays busy while the song is read back',
  );
  assert(getCalls().length === 2 && getCalls()[1]?.path === '/api/songs/s-1', 'the song is read back, after the load');
  await respond(reading, ok({ ...SONG, status: 'approved', reviewedBy: 'curator@example.com', updatedAt: SAVED_AT }));
  assert(
    textOf(heading(container).nextElementSibling?.firstElementChild) === 'Approved',
    'the song already has the status: the decision is done, and the pill reads Approved',
  );
  deepStrictEqual(toastPairs(container), [{ message: 'Song approved', detail: 'Lemon' }]);
  assert(patchCalls().length === 1, 'one change was sent, and no second');
  assert(focused() === cardButton(container, 'Edit'), 'the focus that Approve held moves to Edit, as on any approval');
  assert(unexpected.length === 0, `nothing unstubbed is asked for (${unexpected.join(', ')})`);

  await unmount();
  console.log('✓ Song Detail (curator): a failed decision the worker has made after all reads as done, after the song is read back');
}

async function aFailedDecisionOnAnUnchangedSongStands(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  // The song is read back unchanged: the failure stands, with its Retry, and the Retry is the whole decision again.
  patchReply = () => failure(500, 'Database is locked');
  await click(cardButton(container, 'Reject'), 'Reject');
  assert(getCalls().length === 2, 'the failed change reads the song back');
  const locked = need(
    toastsOf(container).find((toast) => toast.message === 'Database is locked'),
    'the failure toast',
  );
  assert(
    locked.retry !== null && textOf(heading(container).nextElementSibling?.firstElementChild) === 'Pending',
    'the song is unchanged: the failure stands, with its Retry',
  );
  patchReply = defaultPatchReply;
  await click(locked.retry, 'Retry in the toast');
  assert(
    patchCalls().length === 2 && textOf(heading(container).nextElementSibling?.firstElementChild) === 'Rejected',
    'Retry sends the change again, and it goes through',
  );
  deepStrictEqual(toastPairs(container), [{ message: 'Song rejected', detail: 'Lemon' }]);

  await unmount();
  console.log('✓ Song Detail (curator): a failed decision on a song read back unchanged keeps its failure and its Retry');
}

async function aFailedReadKeepsTheDecisionsFailure(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  // The read fails too: what is reported is the change's own failure, with its Retry, not the read's.
  patchReply = () => failure(503, 'Status store is down');
  getReply = () => failure(500, 'Song store is down');
  await click(cardButton(container, 'Approve'), 'Approve');
  assert(getCalls().length === 2, 'the failed change tries to read the song back');
  const down = need(
    toastsOf(container).find((toast) => toast.message === 'Status store is down'),
    "the change's failure toast",
  );
  assert(down.retry !== null, 'with its Retry');
  assert(!toastsOf(container).some((toast) => toast.message === 'Song store is down'), "and the read's failure is not what is reported");
  assert(
    textOf(heading(container).nextElementSibling?.firstElementChild) === 'Pending' && alertOf(container) === null,
    'the song is as it was, and the page keeps its content',
  );

  await unmount();
  console.log("✓ Song Detail (curator): a failed decision whose read back fails too reports the change's own failure, with its Retry");
}

async function decisionWhileEditing(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Half typed');

  // With the form open, the decision's focus goes to the form's first field, and the draft stays.
  const approve = cardButton(container, 'Approve');
  await focusOn(approve);
  await click(approve, 'Approve');
  assert(
    textOf(heading(container).nextElementSibling?.firstElementChild) === 'Approved',
    'the decision goes through while the form is open',
  );
  assert(buttonNamed(detailsCard(container), 'Approve') === null, 'Approve leaves');
  assert(fieldInput(container, 'Song title').value === 'Half typed', 'the draft is kept');
  assert(focused() === fieldInput(container, 'Song title'), `the focus goes to the title field, there being no Edit (got ${focused()?.tagName})`);
  assert(!cardButton(container, 'Save').hasAttribute('disabled'), 'Save is available again');

  await unmount();
  console.log('✓ Song Detail (curator): a decision made with the form open keeps the draft and hands the focus to the title field');
}

async function retryWaitsForTheRequestThatIsOut(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  const refused = 'Cannot transition from rejected to approved';

  // Approve fails: its toast keeps a Retry until it is used, however long the page goes on.
  patchReply = () => failure(400, refused);
  await click(cardButton(container, 'Approve'), 'Approve');
  const first = need(toastsOf(container).find((toast) => toast.message === refused), 'the failure toast');
  assert(first.retry !== null, 'the failed decision offers a Retry');

  // The form opens and Save goes out; the worker has not answered yet.
  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Kick Back');
  const save = cardButton(container, 'Save');
  const saving = held();
  putReply = () => saving.reply;
  await focusOn(save);
  await click(save, 'Save');
  assert(putCalls().length === 1, 'Save sends its request');

  // The Retry is pressed while the save is out. A request that went out now would succeed.
  patchReply = defaultPatchReply;
  await click(first.retry, 'Retry in the toast');
  assert(
    patchCalls().length === 1,
    `a Retry pressed while a save is out sends nothing (saw ${patchCalls().length} status requests)`,
  );
  // The press took its toast down, so the same failure goes back up with its Retry: the retry is not lost.
  const raised = toastsOf(container).filter((toast) => toast.message === refused);
  assert(raised.length === 1, `the same failure is raised again, once (saw ${raised.length})`);
  assert(need(raised[0], 'the failure toast again').retry !== null, 'with its Retry intact');
  assert(toastsOf(container).length === 1, 'and nothing else is announced');
  // The save's state is untouched: it is still the request that is out, and everything else is still locked.
  assert(
    save.getAttribute('aria-busy') === 'true' && save.getAttribute('aria-disabled') === 'true' && !save.hasAttribute('disabled'),
    'Save is still the busy button',
  );
  const approve = cardButton(container, 'Approve');
  const reject = cardButton(container, 'Reject');
  const cancel = cardButton(container, 'Cancel');
  assert(
    approve.getAttribute('aria-busy') === null && approve.hasAttribute('disabled') && reject.hasAttribute('disabled') && cancel.hasAttribute('disabled'),
    'the other controls stay locked, and Approve is not the busy one',
  );
  assert(focused() === save, 'the focus is still on Save');

  // The save lands and the lock lifts; the raised Retry then sends its call, now that nothing else is out.
  const saved: Song = { ...SONG, title: 'Kick Back', updatedAt: SAVED_AT };
  serverSong = saved;
  await respond(saving, ok(saved));
  assert(textOf(heading(container)) === 'Kick Back' && container.querySelector('form') === null, 'the save goes through');
  assert(!approve.hasAttribute('disabled') && !reject.hasAttribute('disabled'), 'Approve and Reject are available again');
  assert(!cardButton(container, 'Edit').hasAttribute('disabled'), 'and so is Edit');
  const again = need(toastsOf(container).find((toast) => toast.message === refused), 'the failure toast, still up');
  await click(again.retry, 'the raised Retry');
  assert(patchCalls().length === 2, 'the raised Retry sends its call once nothing else is out');
  deepStrictEqual(need(patchCalls()[1], 'the retried request').body, { status: 'approved' });
  assert(textOf(heading(container).nextElementSibling?.firstElementChild) === 'Approved', 'and the status changes');
  deepStrictEqual(toastPairs(container), [
    { message: 'Song saved', detail: 'Kick Back' },
    { message: 'Song approved', detail: 'Kick Back' },
  ]);

  await unmount();
  console.log('✓ Song Detail (curator): a Retry pressed while another request is out sends nothing, comes back as the same toast, and works once nothing is out');
}

async function submitWaitsForTheRequestThatIsOut(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Kick Back');

  // A decision is out, so Save is unavailable: but a submit does not look at the button (requestSubmit, an extension).
  const approve = cardButton(container, 'Approve');
  const deciding = held();
  patchReply = () => deciding.reply;
  await focusOn(approve);
  await click(approve, 'Approve');
  assert(patchCalls().length === 1 && cardButton(container, 'Save').hasAttribute('disabled'), 'a decision is out, and Save is unavailable');
  await act(async () => {
    editForm(container).requestSubmit();
  });
  await settle();
  assert(putCalls().length === 0, `a submit that reaches the form meanwhile sends no save (saw ${putCalls().length})`);
  assert(
    approve.getAttribute('aria-busy') === 'true' && cardButton(container, 'Save').getAttribute('aria-busy') === null,
    'the decision is still the request that is out',
  );
  assert(cardButton(container, 'Cancel').hasAttribute('disabled'), 'and the card is still locked');

  // The decision lands: the draft is still there, and Save sends now.
  serverSong = { ...SONG, status: 'approved', reviewedBy: 'curator@example.com', updatedAt: SAVED_AT };
  await respond(deciding, ok(serverSong));
  assert(fieldInput(container, 'Song title').value === 'Kick Back', 'the draft is kept');
  assert(!cardButton(container, 'Save').hasAttribute('disabled') && !cardButton(container, 'Cancel').hasAttribute('disabled'), 'the lock lifts');
  await click(cardButton(container, 'Save'), 'Save');
  assert(putCalls().length === 1, 'Save sends once nothing else is out');
  deepStrictEqual(need(putCalls()[0], 'the save request').body, { title: 'Kick Back', originalArtist: 'Kenshi Yonezu' });

  await unmount();
  console.log('✓ Song Detail (curator): a submit that reaches the form while a decision is out sends no save');
}

async function focusIsNeverStolen(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);

  // A decision whose answer lands after the keyboard went elsewhere.
  const approve = cardButton(container, 'Approve');
  const decision = held();
  patchReply = () => decision.reply;
  await focusOn(approve);
  await click(approve, 'Approve');
  await focusOn(crumbOf(container));
  await respond(decision, ok({ ...SONG, status: 'approved', reviewedBy: 'curator@example.com', updatedAt: SAVED_AT }));
  assert(textOf(heading(container).nextElementSibling?.firstElementChild) === 'Approved', 'the status still changes');
  assert(focused() === crumbOf(container), 'the focus stays where the user put it');

  // A save whose answer lands after the keyboard went elsewhere.
  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Kick Back');
  const save = cardButton(container, 'Save');
  const saving = held();
  putReply = () => saving.reply;
  await focusOn(save);
  await click(save, 'Save');
  await focusOn(crumbOf(container));
  await respond(saving, ok({ ...SONG, title: 'Kick Back', status: 'approved', updatedAt: SAVED_AT }));
  assert(textOf(heading(container)) === 'Kick Back' && container.querySelector('form') === null, 'the save still goes through');
  assert(focused() === crumbOf(container), 'and the focus stays where the user put it');

  await unmount();
  console.log('✓ Song Detail: an answer that lands after the focus has moved on does not take it back');
}

async function oneVideoAtATime(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator);
  assert(iframesOf(container).length === 0, 'no iframe until a poster is clicked');
  const first = need(posterButton(container, 'First Stream'), 'the first poster');
  const second = need(posterButton(container, 'Second Stream'), 'the second poster');
  assert(first.type === 'button' && need(first.querySelector('img'), 'a thumbnail').getAttribute('loading') === 'lazy', 'a poster is a typed button with a lazy thumbnail');

  // Clicking the first poster loads its player, and only its.
  await focusOn(first);
  await click(first, 'the first poster');
  let frames = iframesOf(container);
  assert(frames.length === 1, `exactly one iframe after the first click (saw ${frames.length})`);
  assert(frames[0]?.getAttribute('src') === embedSrc('vid-one', 75), "it is the first performance's, at its start time");
  assert(frames[0]?.getAttribute('title') === 'First Stream', 'named for its stream');
  assert(focused() === frames[0], 'the poster hands its focus to its player, not to <body>');
  assert(posterButton(container, 'First Stream') === null, 'the playing performance shows no poster');
  assert(second.isConnected, 'the other performance is still a poster');
  await flushFrames();
  deepStrictEqual(frameRequests, [embedSrc('vid-one', 75)]);

  // Clicking the second leaves exactly one: the second's. The first is a poster again.
  await click(second, 'the second poster');
  frames = iframesOf(container);
  assert(frames.length === 1, `still exactly one iframe after the second click (saw ${frames.length})`);
  assert(frames[0]?.getAttribute('src') === embedSrc('vid-two', 3900), "it is now the second performance's");
  assert(posterButton(container, 'First Stream') !== null, 'the first performance is a poster again');
  assert(posterButton(container, 'Second Stream') === null, 'and the second is not');
  await flushFrames();
  deepStrictEqual(frameRequests, [embedSrc('vid-one', 75), embedSrc('vid-two', 3900)]);

  // And back: the page keeps one player, whichever poster is pressed.
  await click(need(posterButton(container, 'First Stream'), 'the first poster again'), 'the first poster again');
  frames = iframesOf(container);
  assert(frames.length === 1 && frames[0]?.getAttribute('src') === embedSrc('vid-one', 75), 'the first takes the player back');
  assert(toastsOf(container).length === 0 && putCalls().length === 0 && patchCalls().length === 0, 'playing a video sends and says nothing');
  assertNoRawColour(container.innerHTML, 'the page with a player');

  await unmount();
  console.log('✓ Song Detail: no iframe until a poster is clicked, then exactly one, and the second poster takes it over');
}

async function videoIdsAreTrimmed(mountPage: MountPage): Promise<void> {
  reset();
  serverSong = { ...SONG, performances: [performance({ id: 'perf-pad', streamTitle: 'Padded Stream', videoId: ' pad-id ', timestamp: 5 })] };
  const { container, unmount } = await mountPage(curator);
  const poster = need(posterButton(container, 'Padded Stream'), 'the poster');
  assert(
    need(poster.querySelector('img'), 'its thumbnail').getAttribute('src') === youtubeThumbnailUrl('pad-id'),
    'the thumbnail is asked for the trimmed video id, not one with spaces in it',
  );
  await click(poster, 'the poster');
  assert(iframesOf(container)[0]?.getAttribute('src') === embedSrc('pad-id', 5), 'and so is the player');
  await unmount();

  // A song with no performance says so, and a song whose list is absent does too.
  for (const performances of [[], undefined]) {
    reset();
    serverSong = { ...SONG, performances };
    const bare = await mountPage(curator);
    assert(textOf(bare.container).includes('No performances recorded.'), 'a song with no performances says so');
    assert(performanceCards(bare.container).length === 0 && bare.container.querySelector('button[aria-label^="Play "]') === null, 'and shows no poster');
    assertNoRawColour(bare.container.innerHTML, 'the page without performances');
    await bare.unmount();
  }
  console.log('✓ Song Detail: a padded video id is trimmed for the thumbnail; no performances is said plainly');
}

async function contributorView(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(contributor);

  assert(textOf(heading(container)) === 'Lemon', 'a contributor sees the same song');
  assert(detailTerms(container).map(([label]) => label).join('|') === 'Artist|Submitted by|Reviewed by|Created|Updated', 'and its details');
  assert(detailsCard(container).querySelector('button') === null, 'a contributor has no Edit, Approve or Reject, even on a pending song');
  assert(performanceCards(container).length === 2, 'and sees the performances');
  await click(need(posterButton(container, 'First Stream'), 'the first poster'), 'the first poster');
  assert(iframesOf(container).length === 1, 'and can play one');
  assert(putCalls().length === 0 && patchCalls().length === 0, 'a contributor sends no change');
  assertNoRawColour(container.innerHTML, "a contributor's page");

  await unmount();
  console.log('✓ Song Detail (contributor): the same song, read-only');
}

async function loadFailure(mountPage: MountPage): Promise<void> {
  reset();
  getReply = () => failure(500, 'The catalog is unavailable');
  const { container, unmount } = await mountPage(curator);

  const note = need(alertOf(container), 'a danger alert for a failed load');
  assert(textOf(note).includes('The catalog is unavailable'), "the alert carries the worker's message");
  assert(note.classList.contains('border-tone-danger-line'), 'the alert is a danger note');
  assert(
    textOf(heading(container)) === 'Song' && crumbOf(container).isConnected,
    'the header, with its crumb, stays',
  );
  assert(
    container.querySelector('section[aria-label="Song details"]') === null && container.querySelector('[role="status"]') === null,
    'with nothing loaded there is no card and no skeleton',
  );
  assert(!container.innerHTML.includes('Song not found'), 'a failure is not an unknown song');
  assert(toastsOf(container).length === 0, 'a load failure is an alert, not a toast');
  assertNoRawColour(container.innerHTML, 'the failed page');

  // Retry asks again. The alert leaves with it, so the focus it held goes to the heading.
  const retry = need(buttonNamed(note, 'Retry'), 'a Retry in the alert');
  assert(retry.type === 'button' && retry.querySelector('svg') !== null, 'Retry is a typed button with an icon');
  await focusOn(retry);
  assert(focused() === retry, 'the keyboard is on Retry');
  const again = held();
  getReply = () => again.reply;
  await click(retry, 'Retry');
  assert(getCalls().length === 2, 'Retry reloads the song');
  assert(getCalls()[1]?.path === '/api/songs/s-1', 'the same one');
  assert(
    focused() === heading(container),
    `the focus goes to the page heading, not to <body> (got ${focused()?.tagName})`,
  );
  assert(container.querySelector('[role="status"]') !== null && alertOf(container) === null, 'the skeleton shows while the retry is out');
  await respond(again, ok(SONG));
  assert(alertOf(container) === null, 'a successful retry clears the alert');
  assert(textOf(heading(container)) === 'Lemon' && performanceCards(container).length === 2, 'and shows the song');

  await unmount();

  // A retry that fails again shows the alert again.
  reset();
  getReply = () => failure(503, 'Still busy');
  const second = await mountPage(curator);
  await click(need(buttonNamed(need(alertOf(second.container), 'an alert'), 'Retry'), 'Retry'), 'Retry');
  assert(getCalls().length === 2 && textOf(alertOf(second.container)).includes('Still busy'), 'a failed retry raises the alert again');
  await second.unmount();

  console.log('✓ Song Detail: a load failure is a danger alert with a Retry that reloads and hands its focus to the heading');
}

async function movingToAnotherSong(mountPage: MountPage): Promise<void> {
  reset();
  const next = held();
  getReply = (_call, id) => (id === 's-2' ? next.reply : ok(SONG));
  const { container, unmount } = await mountPage(curator, 's-1', '/songs/s-2');
  assert(textOf(heading(container)) === 'Lemon', 'the first song is loaded');

  // An open form and a playing video belong to the song they were opened on.
  await openForm(container);
  await typeInto(fieldInput(container, 'Song title'), 'Half typed');
  await click(need(posterButton(container, 'First Stream'), 'the first poster'), 'the first poster');
  assert(iframesOf(container).length === 1, 'a video is playing');

  await click(need(buttonNamed(container, 'Jump'), 'the control that moves to another song'), 'Jump');
  assert(getCalls().length === 2 && getCalls()[1]?.path === '/api/songs/s-2', 'the other song is asked for');
  assert(
    textOf(heading(container)) === 'Song',
    `the last song's title is not shown under the new address (got "${textOf(heading(container))}")`,
  );
  assert(container.querySelector('[role="status"]') !== null, 'the skeleton shows while it loads');
  assert(
    container.querySelector('form') === null && iframesOf(container).length === 0 && container.querySelector('section[aria-label="Song details"]') === null,
    'nothing of the last song, its form or its video, carries across',
  );

  await respond(next, ok(OTHER_SONG));
  assert(textOf(heading(container)) === 'Second Song', 'the other song is shown');
  assert(detailTerms(container)[0]?.join('|') === 'Artist|Another Artist', 'with its own details');
  assert(
    container.querySelector('form') === null && iframesOf(container).length === 0 && posterButton(container, 'Third Stream') !== null,
    'its form is closed and its video is a poster',
  );

  await unmount();
  console.log('✓ Song Detail: moving to another song starts over: no stale title, open form or playing video');
}

async function unknownSong(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage(curator, 's-missing');

  assert(getCalls().length === 1 && getCalls()[0]?.path === '/api/songs/s-missing', 'the unknown song is asked for once');
  assert(textOf(container).includes('Song not found.'), 'an unknown song reads "Song not found."');
  assert(alertOf(container) === null, 'it is not reported as a failed load');
  assert(container.querySelector('[role="status"]') === null, 'and shows no skeleton');
  assert(
    container.querySelector('section[aria-label="Song details"]') === null && iframesOf(container).length === 0,
    'no card and no player',
  );
  assert(textOf(heading(container)) === 'Song' && crumbOf(container).isConnected, 'the header, with its crumb, stays');
  assert(buttonNamed(container, 'Retry') === null, 'there is nothing to retry');

  const gutter = need(container.firstElementChild?.children[1], 'the page gutter');
  const back = need(gutter.querySelector<HTMLAnchorElement>('a[href="/songs"]'), 'a link back to the list in the page');
  assert(textOf(back) === 'Back to Songs', 'the link reads "Back to Songs"');
  assert(back.className === buttonClasses({ variant: 'secondary' }), 'and looks like a button');
  assert(toastsOf(container).length === 0, 'an unknown song raises no toast');
  assertNoRawColour(container.innerHTML, 'the unknown-song page');

  await click(back, 'the link back');
  assert(textOf(container) === 'Song list', 'it goes to the list');

  await unmount();
  console.log('✓ Song Detail: a song the worker does not know reads "Song not found." with a link back to the list');
}

async function main(): Promise<void> {
  const win = installDom();
  // The test DOM loads no iframe page, and this suite counts the pages its players ask for: here an iframe navigates
  // again, as in a browser. happy-dom would fetch its src from the real network: answer it here, and keep what it asked for.
  win.happyDOM.settings.navigation.disableChildFrameNavigation = false;
  win.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async ({ request, window }) => {
      frameRequests.push(request.url);
      return new window.Response('<!doctype html><title>player</title>', { headers: { 'Content-Type': 'text/html' } });
    },
  };
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  setCurrentStreamer('mizuki');
  const { default: SongDetail } = await import('../src/pages/SongDetail');
  const { ToastProvider } = await import('../src/components/ui/toast');

  const mountPage: MountPage = (user, id = 's-1', jumpTo) =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <MemoryRouter initialEntries={[`/songs/${id}`]}>
          <Routes>
            <Route path="/songs/:id" element={<SongDetail user={user} />} />
            <Route path="/songs" element={<p>Song list</p>} />
          </Routes>
          {jumpTo === undefined ? null : <Jump to={jumpTo} />}
        </MemoryRouter>
      </ToastProvider>,
    );

  await firstLoadAndLayout(mountPage);
  await editSavesTrimmedValues(mountPage);
  await failedSaveStaysInTheCard(mountPage);
  await cancelRestoresTheSavedValues(mountPage);
  await emptyFieldsBlockSave(mountPage);
  await decideAndFocus(mountPage);
  await rejectAndExtracted(mountPage);
  await failedDecisionOffersRetry(mountPage);
  await aFailedDecisionTheWorkerMadeIsDone(mountPage);
  await aFailedDecisionOnAnUnchangedSongStands(mountPage);
  await aFailedReadKeepsTheDecisionsFailure(mountPage);
  await decisionWhileEditing(mountPage);
  await retryWaitsForTheRequestThatIsOut(mountPage);
  await submitWaitsForTheRequestThatIsOut(mountPage);
  await focusIsNeverStolen(mountPage);
  await oneVideoAtATime(mountPage);
  await videoIdsAreTrimmed(mountPage);
  await contributorView(mountPage);
  await loadFailure(mountPage);
  await unknownSong(mountPage);
  await movingToAnotherSong(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  const source = readFileSync(new URL('../src/pages/SongDetail.tsx', import.meta.url), 'utf8');
  assertNoRawColour(source, 'the page source');
  console.log('✓ Song Detail: no raw palette class and no arbitrary hex, in the markup or the source');
}

await main();
