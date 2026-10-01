/**
 * Submit Song and Submit Stream on the studio kit (spec §8.9; plan Q5, Q15 and Q16), mounted live the
 * way App.tsx mounts every page (ToastProvider > router) against a stubbed fetch.
 *
 * Submit Song: the two form cards, inline validation that matches what POST /api/songs accepts (a title
 * and an artist, then for each performance row a stream ID, a whole-second start and an end after it),
 * rows left empty skipped and reported, a server error that keeps the form, the busy submit, and where
 * the focus goes when a row leaves.
 *
 * Submit Stream: the Stream, Credit and Preview cards, a video ID read from every kind of YouTube link,
 * a preview that is a poster until it is clicked, inline validation that matches what POST /api/streams
 * accepts (a title, a date, a video ID, links that are links, a credit author for credit links), the
 * request it sends, a duplicate video that links to the stream it duplicates, a server error that keeps
 * the form, and the busy submit.
 *
 * Each route is pinned too: it renders through `routeElement`, open to contributors.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, Song } from '../../shared/types';
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

const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };

const CREATED: Song = {
  id: 's-new',
  workId: null,
  title: 'Lemon',
  originalArtist: 'Kenshi Yonezu',
  tags: [],
  status: 'pending',
  submittedBy: 'contributor@example.com',
  reviewedBy: null,
  createdAt: '2026-10-01 10:00:00',
  updatedAt: '2026-10-01 10:00:00',
  performances: [],
};

/** Every text the form validates with, as the page words it. */
const TEXT = {
  title: 'Enter a title.',
  artist: 'Enter the original artist.',
  stream: 'Enter the stream ID.',
  startEmpty: 'Enter the start in seconds.',
  startFormat: 'Start must be a whole number of seconds.',
  endFormat: 'End must be a whole number of seconds, or empty.',
  endOrder: 'End must be after the start.',
} as const;

/** Every text the Submit Stream form validates and answers with, as the page words it. */
const STREAM_TEXT = {
  title: 'Enter a title.',
  dateEmpty: 'Enter the stream date.',
  dateFormat: 'Enter the date as YYYY-MM-DD.',
  videoId: 'Enter the video ID.',
  link: 'Enter a full URL, starting with http:// or https://.',
  author: 'Enter the credit author, or clear the links.',
  urlHint: 'Video ID will be extracted automatically.',
  exists: 'A stream with this video already exists.',
} as const;

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

const created = (body: unknown): Reply => ({ status: 201, body });
const failure = (status: number, error: string, code?: string): Reply => ({
  status,
  body: code === undefined ? { error } : { error, code },
});

const calls: Call[] = [];
const unexpected: string[] = [];

/** What happy-dom asked YouTube for on behalf of an iframe: it fetches an iframe's src itself. */
const frameRequests: string[] = [];

/** What the worker answers a new song: the song it stored, with the title and artist it was sent. */
const defaultPostReply = (call: Call): Reply => {
  const sent = call.body as { title: string; originalArtist: string };
  return created({ ...CREATED, title: sent.title, originalArtist: sent.originalArtist });
};

/** What the worker answers a new stream: its id and its status, and nothing else. */
const defaultStreamReply = (): Reply => created({ id: 'stream-2026-03-01', status: 'pending' });

/** What POST /api/songs and POST /api/streams answer next; a scenario swaps them. A promise holds the answer until released. */
let postReply: (call: Call) => Reply | Promise<Reply> = defaultPostReply;
let streamReply: (call: Call) => Reply | Promise<Reply> = defaultStreamReply;

function reset(): void {
  calls.length = 0;
  frameRequests.length = 0;
  postReply = defaultPostReply;
  streamReply = defaultStreamReply;
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
      if (method === 'POST' && url.pathname === '/api/songs') reply = postReply(call);
      else if (method === 'POST' && url.pathname === '/api/streams') reply = streamReply(call);
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

function postCalls(): Call[] {
  return calls.filter((call) => call.method === 'POST' && call.path === '/api/songs');
}

/** The body of the one request a scenario expects to have been sent. */
function sentBody(): unknown {
  assert(postCalls().length === 1, `exactly one song was sent (got ${postCalls().length})`);
  return need(postCalls()[0], 'the song request').body;
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

function formOf(container: HTMLElement): HTMLFormElement {
  return need(container.querySelector<HTMLFormElement>('form'), 'the form');
}

function cardOf(container: HTMLElement, name: string): HTMLElement {
  return need(container.querySelector<HTMLElement>(`section[aria-label="${name}"]`), `the ${name} card`);
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  return need(buttonNamed(container, 'Submit Song'), 'the Submit Song button');
}

function addButton(container: HTMLElement): HTMLButtonElement {
  return need(buttonNamed(container, 'Add performance'), 'the Add performance button');
}

/** The input whose label starts with `label`, found through the label's `for`, as a screen reader does. */
function inputLabelled(root: ParentNode, label: string): HTMLInputElement {
  const name = need(
    [...root.querySelectorAll<HTMLLabelElement>('label')].find((candidate) => textOf(candidate).startsWith(label)),
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

function alertOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="alert"]');
}

/** One group per performance row, in order. */
function performanceRows(container: HTMLElement): HTMLElement[] {
  return [...formOf(container).querySelectorAll<HTMLElement>('[role="group"]')];
}

function rowAt(container: HTMLElement, number: number): HTMLElement {
  return need(performanceRows(container)[number - 1], `performance row ${number}`);
}

function removeButton(container: HTMLElement, number: number): HTMLButtonElement {
  return need(
    container.querySelector<HTMLButtonElement>(`button[aria-label="Remove performance ${number}"]`),
    `the Remove button of performance ${number}`,
  );
}

/** The labels of every field in `root`, with the required asterisk left out. */
function labelsIn(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLLabelElement>('label')].map((label) =>
    textOf(label).replace(/\*$/, ''),
  );
}

interface ToastView {
  message: string;
  detail: string;
}

function toastsOf(container: HTMLElement): ToastView[] {
  const section = container.querySelector('section[aria-label="Notifications"]');
  return [...(section?.querySelectorAll<HTMLElement>('li') ?? [])].map((item) => {
    const lines = [...item.querySelectorAll('p')].map((line) => textOf(line));
    return { message: lines[0] ?? '', detail: lines[1] ?? '' };
  });
}

// Toasts stay up until dismissed, so a scenario reads every one of them, and no real timer outlives it.
const NO_TIMERS = { setTimeout: () => 0, clearTimeout: () => undefined };

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = () => Promise<Mounted>;

/** Shows where the router is, for a harness that keeps the page mounted across a navigation. */
function Where() {
  return <span data-where>{useLocation().pathname}</span>;
}

interface RowFill {
  stream?: string;
  start?: string;
  end?: string;
  note?: string;
}

async function fillRow(row: HTMLElement, fill: RowFill): Promise<void> {
  if (fill.stream !== undefined) await typeInto(inputLabelled(row, 'Stream ID'), fill.stream);
  if (fill.start !== undefined) await typeInto(inputLabelled(row, 'Start'), fill.start);
  if (fill.end !== undefined) await typeInto(inputLabelled(row, 'End'), fill.end);
  if (fill.note !== undefined) await typeInto(inputLabelled(row, 'Note'), fill.note);
}

/** Adds a row the way the button does and types `fill` into it; the row comes back. */
async function addRow(container: HTMLElement, fill: RowFill = {}): Promise<HTMLElement> {
  const before = performanceRows(container).length;
  await click(addButton(container), 'Add performance');
  const rows = performanceRows(container);
  assert(rows.length === before + 1, 'Add performance adds exactly one row');
  const row = need(rows[rows.length - 1], 'the new row');
  await fillRow(row, fill);
  return row;
}

async function fillSong(container: HTMLElement, title = 'Lemon', artist = 'Kenshi Yonezu'): Promise<void> {
  await typeInto(inputLabelled(container, 'Title'), title);
  await typeInto(inputLabelled(container, 'Original artist'), artist);
}

/** Presses Submit from the keyboard: the button holds the focus, then is pressed. */
async function pressSubmit(container: HTMLElement): Promise<void> {
  const submit = submitButton(container);
  await focusOn(submit);
  await click(submit, 'Submit Song');
}

// --- Scenarios ---

async function firstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  assert(calls.length === 0, `mounting sends no request (got ${calls.map((call) => call.path).join(', ')})`);

  // The header is the page's first child, so it sticks to <main>; the form brings the gutter.
  const header = pageHeader(container);
  const root = need(container.firstElementChild as HTMLElement | null, 'a page root');
  assert(root.firstElementChild === header, 'the header is the page first child, so it sticks to <main>');
  assert(!/overflow|blur|transform|filter/.test(root.className), 'the page root has no blur, transform or overflow');
  const form = formOf(container);
  assert(root.children[1] === form, 'the form follows the header');
  assert(
    form.classList.contains('p-4') && form.classList.contains('lg:px-5'),
    '<main> gives a page no gutter of its own, so the page brings it',
  );
  assert(container.querySelectorAll('h1').length === 1, 'the page has exactly one <h1>');
  assert(textOf(heading(container)) === 'Submit Song', 'the <h1> is "Submit Song"');
  assert(textOf(heading(container).previousElementSibling) === 'CATALOG', 'the crumb reads CATALOG');
  assert(header.querySelector('button, a') === null, 'the header carries no actions: Submit and Cancel sit under the form');
  // It is title-only (no actions, children or meta row), so below 1024 px there is nothing of it to show:
  // it takes no room there, instead of an empty bar between the top bar and the form, and its <h1> stays
  // in the accessibility tree (visually hidden the way its title block is, never display:none).
  assert(header.classList.contains('max-lg:sr-only'), 'the header is title-only, so below 1024 px it takes no room');
  assert(
    header.children.length === 1 && header.firstElementChild === heading(container).parentElement,
    'it holds nothing but its title block: no children, actions or meta row',
  );
  assert(
    ![header, ...header.querySelectorAll('*')].some((node) => /(^|\s|:)(hidden|invisible|collapse)(\s|$)/.test(node.getAttribute('class') ?? '')),
    'and nothing in it is display:none or visibility:hidden, so the <h1> stays in the accessibility tree',
  );

  // Two glass cards: the song, then its performances.
  deepStrictEqual(
    [...form.querySelectorAll('h2')].map((item) => textOf(item)),
    ['Song', 'Performances'],
  );
  assert(
    cardOf(container, 'Song').classList.contains('glass-card') && cardOf(container, 'Performances').classList.contains('glass-card'),
    'both sections are glass cards',
  );

  // The form's contract: no browser validation bubble, the required fields marked for assistive technology.
  assert(form.hasAttribute('novalidate'), 'the form carries noValidate, so the inline errors are the only ones');
  assert(!/\srequired(=|\s|>)/.test(form.outerHTML), 'no field carries the required attribute');
  deepStrictEqual(labelsIn(cardOf(container, 'Song')), ['Title', 'Original artist']);
  const title = inputLabelled(container, 'Title');
  const artist = inputLabelled(container, 'Original artist');
  assert(cardOf(container, 'Song').contains(title) && cardOf(container, 'Song').contains(artist), 'both sit in the Song card');
  assert(title.type === 'text' && artist.type === 'text', 'both are text inputs');
  assert(
    title.getAttribute('aria-required') === 'true' && artist.getAttribute('aria-required') === 'true',
    'both are aria-required',
  );
  assert(
    textOf(labelFor(container, title)).endsWith('*') && labelFor(container, title).querySelector('[aria-hidden="true"]') !== null,
    'the asterisk is decoration, hidden from assistive technology',
  );
  assert(
    title.value === '' && artist.value === '' && title.getAttribute('aria-invalid') === null && describedBy(title) === '',
    'the fields start empty and unreported',
  );

  // No performance row to begin with, as before; "Add performance" and the actions follow.
  assert(performanceRows(container).length === 0, 'the form starts with no performance row');
  assert(formOf(container).querySelectorAll('input').length === 2, 'two inputs: the title and the artist');
  deepStrictEqual(
    [...form.querySelectorAll('button')].map((button) => textOf(button)),
    ['Add performance', 'Submit Song', 'Cancel'],
  );
  const add = addButton(container);
  const submit = submitButton(container);
  const cancel = need(buttonNamed(container, 'Cancel'), 'Cancel');
  assert(add.type === 'button' && add.querySelector('svg') !== null, 'Add performance is a typed button with an icon');
  assert(submit.type === 'submit' && cancel.type === 'button', 'Submit submits the form; Cancel does not');
  assert(submit.className === buttonClasses({ variant: 'primary' }), 'Submit is the primary button');
  assert(
    submit.getAttribute('aria-busy') === null && submit.getAttribute('aria-disabled') === null && !submit.hasAttribute('disabled'),
    'Submit starts available',
  );
  assert(alertOf(container) === null && toastsOf(container).length === 0, 'there is no note and no toast before anything happens');
  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assertNoRawColour(container.innerHTML, 'the empty form');

  await unmount();
  console.log('✓ Submit Song: no request on mount, the header with its crumb, the Song and Performances cards, noValidate and aria-required');
}

/** The `<label>` of a control. */
function labelFor(container: HTMLElement, control: HTMLElement): HTMLLabelElement {
  return need(
    [...container.querySelectorAll<HTMLLabelElement>('label')].find((label) => label.htmlFor === control.id),
    'the label of the field',
  );
}

async function performanceRowFields(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // Add performance appends an empty row and the focus stays on the button that was pressed.
  const add = addButton(container);
  await focusOn(add);
  await click(add, 'Add performance');
  await click(add, 'Add performance');
  assert(performanceRows(container).length === 2, 'two presses add two rows');
  assert(focused() === add, 'the focus stays on Add performance');
  assert(postCalls().length === 0 && calls.length === 0, 'adding rows sends nothing');

  // Each row: Stream ID, start, end and note, and nothing the worker never reads (plan Q5).
  const row = rowAt(container, 1);
  deepStrictEqual(labelsIn(row), ['Stream ID', 'Start (seconds)', 'End (seconds, optional)', 'Note (optional)']);
  const inputs = [...row.querySelectorAll<HTMLInputElement>('input')];
  assert(inputs.length === 4, `a row has four inputs (got ${inputs.length})`);
  assert(inputs.every((input) => input.value === ''), 'a new row is empty, its start too: there is no 0 to begin with');
  assert(row.querySelector('input[type="date"]') === null, 'there is no date input');
  for (const dropped of ['Date', 'Stream title', 'Video ID']) {
    assert(!labelsIn(container).some((label) => label.includes(dropped)), `there is no ${dropped} field`);
  }
  assert(!/video-id|stream-title/i.test(formOf(container).innerHTML), 'nothing of the dropped inputs is left in the markup');
  const [stream, start, end, note] = inputs;
  assert(stream !== undefined && start !== undefined && end !== undefined && note !== undefined, 'the four inputs');
  assert(
    [stream, start, end, note].every((input) => input.type === 'text'),
    'every field is a text input, so what was typed is what is checked (a number input hides non-numeric text as empty)',
  );
  assert(
    start.getAttribute('inputmode') === 'numeric' && end.getAttribute('inputmode') === 'numeric',
    'the start and the end bring up a numeric keypad',
  );
  assert(stream.getAttribute('inputmode') === null && note.getAttribute('inputmode') === null, 'the stream ID and the note do not');
  assert(
    inputs.every((input) => input.getAttribute('aria-required') === null),
    'no row field is aria-required: an empty row is skipped, so a row needs these only once it holds something',
  );

  // Every field has its own label, and the ids are unique across rows.
  const ids = [...formOf(container).querySelectorAll('input')].map((input) => input.id);
  assert(ids.every((id) => id !== '') && new Set(ids).size === ids.length, 'every field has a unique id');
  for (const label of formOf(container).querySelectorAll<HTMLLabelElement>('label')) {
    assert(document.getElementById(label.htmlFor) !== null, `the label "${textOf(label)}" points at a field`);
  }

  // The row is a named group, so a screen reader says which performance a "Stream ID" belongs to.
  const second = rowAt(container, 2);
  assert(textOf(document.getElementById(row.getAttribute('aria-labelledby') ?? '')) === 'Performance #1', 'the first row is named Performance #1');
  assert(textOf(document.getElementById(second.getAttribute('aria-labelledby') ?? '')) === 'Performance #2', 'the second Performance #2');
  const remove = removeButton(container, 1);
  assert(remove.type === 'button' && remove.querySelector('svg') !== null, 'Remove is a typed icon button, named by its performance');
  assert(row.contains(remove) && !second.contains(remove), 'and sits in its own row');

  // Spec §9: forms are one column below 1024 px and two from lg.
  const grid = need(row.querySelector<HTMLElement>('div.grid'), "the row's field grid");
  assert(grid.classList.contains('grid-cols-1'), 'the fields are one column by default');
  assert(grid.classList.contains('lg:grid-cols-2'), 'and two from lg (1024 px)');
  deepStrictEqual(
    grid.className.split(/\s+/).filter((name) => name.includes('grid-cols-')).sort(),
    ['grid-cols-1', 'lg:grid-cols-2'],
  );
  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assertNoRawColour(container.innerHTML, 'the form with two rows');

  await unmount();
  console.log('✓ Submit Song: a row has Stream ID, start, end and note only; one column below lg, two from lg; Add keeps the focus');
}

async function titleAndArtistAreChecked(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const title = inputLabelled(container, 'Title');
  const artist = inputLabelled(container, 'Original artist');
  const submit = submitButton(container);

  // Nothing is reported while the form is being filled in.
  await typeInto(title, '   ');
  assert(describedBy(title) === '' && title.getAttribute('aria-invalid') === null, 'a field is not reported before Submit is pressed');

  // A title of spaces is an empty title: nothing is sent, the field says so, and the focus goes to it.
  await pressSubmit(container);
  assert(postCalls().length === 0, 'an empty title sends no request');
  assert(describedBy(title) === TEXT.title, `the title is described by "${TEXT.title}" (got "${describedBy(title)}")`);
  assert(title.getAttribute('aria-invalid') === 'true', 'and marked invalid');
  assert(describedBy(artist) === TEXT.artist && artist.getAttribute('aria-invalid') === 'true', 'the empty artist is reported too, with its own words');
  assert(focused() === title, `the focus goes to the first field that needs fixing (got ${focused()?.tagName})`);
  assert(toastsOf(container).length === 0 && alertOf(container) === null, 'no toast and no alert: the field says it');
  assert(
    submit.getAttribute('aria-busy') === null && !submit.hasAttribute('disabled'),
    'a refused submit leaves the button available',
  );
  assert(textOf(document.getElementById(`${title.id}-error`)) === TEXT.title, 'the error is the paragraph the field points at');
  assertNoRawColour(container.innerHTML, 'the form with its errors');

  // Pressing Submit again with the same errors still takes the focus to the first of them.
  await focusOn(submit);
  await click(submit, 'Submit Song');
  assert(focused() === title, 'a second refused submit moves the focus to the title again');
  assert(postCalls().length === 0, 'and sends nothing');

  // Fixing a field clears its error at once, and the next press goes to the field that is left.
  await typeInto(title, 'Lemon');
  assert(describedBy(title) === '' && title.getAttribute('aria-invalid') === null, 'a title that is filled in is no longer reported');
  assert(describedBy(artist) === TEXT.artist, 'the artist still is');
  await pressSubmit(container);
  assert(postCalls().length === 0 && focused() === artist, 'the focus goes to the artist, the first field still wrong');

  // An artist of spaces is empty too.
  await typeInto(artist, ' \t ');
  await pressSubmit(container);
  assert(postCalls().length === 0 && describedBy(artist) === TEXT.artist, 'a blank artist is refused');

  // Both filled in, with spaces around them: the trimmed values are what is sent.
  await typeInto(title, '  Lemon  ');
  await typeInto(artist, '  Kenshi Yonezu (米津玄師)  ');
  await pressSubmit(container);
  deepStrictEqual(sentBody(), { title: 'Lemon', originalArtist: 'Kenshi Yonezu (米津玄師)' });

  await unmount();
  console.log('✓ Submit Song: a title or artist that is empty after trim blocks Submit with an inline error and the focus; fixing it clears it');
}

async function startAndEndAreChecked(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillSong(container);
  const row = await addRow(container, { stream: 'stream-2026-03-01' });
  const stream = inputLabelled(row, 'Stream ID');
  const start = inputLabelled(row, 'Start');
  const end = inputLabelled(row, 'End');

  // A row with a Stream ID and no start: the start says so, nothing else does, nothing is sent.
  await pressSubmit(container);
  assert(postCalls().length === 0, 'a row with no start sends no request');
  assert(describedBy(start) === TEXT.startEmpty, `the start is described by "${TEXT.startEmpty}" (got "${describedBy(start)}")`);
  assert(start.getAttribute('aria-invalid') === 'true', 'and marked invalid');
  assert(
    describedBy(stream) === '' && describedBy(end) === '' && stream.getAttribute('aria-invalid') === null && end.getAttribute('aria-invalid') === null,
    'the stream ID and the end are not reported',
  );
  assert(focused() === start, `the focus goes to the start (got ${focused()?.tagName})`);
  assert(alertOf(container) === null && toastsOf(container).length === 0, 'no alert and no toast: the field says it');
  assertNoRawColour(container.innerHTML, 'the form with a row error');

  // A start of spaces is empty too.
  await typeInto(start, '   ');
  await pressSubmit(container);
  assert(describedBy(start) === TEXT.startEmpty && postCalls().length === 0, 'a start of spaces is no start');

  // An end that is not after the start: equal, or before, is refused; after it is sent.
  await typeInto(start, '100');
  assert(describedBy(start) === '' && start.getAttribute('aria-invalid') === null, 'a start that is filled in is no longer reported');
  await typeInto(end, '100');
  await pressSubmit(container);
  assert(postCalls().length === 0, 'an end equal to the start sends no request');
  assert(describedBy(end) === TEXT.endOrder && end.getAttribute('aria-invalid') === 'true', `the end says "${TEXT.endOrder}"`);
  assert(describedBy(start) === '' && focused() === end, 'only the end is reported, and it has the focus');
  await typeInto(end, '99');
  await pressSubmit(container);
  assert(postCalls().length === 0 && describedBy(end) === TEXT.endOrder, 'an end before the start is refused');
  await typeInto(start, '0');
  await typeInto(end, '0');
  await pressSubmit(container);
  assert(postCalls().length === 0 && describedBy(end) === TEXT.endOrder, 'a start and an end of 0 is refused: the end must be greater');
  await typeInto(end, ' 1 ');
  assert(describedBy(end) === '', 'fixing the end clears its error at once');

  // The start and the end are whole numbers: digits and nothing else, after trim.
  const notWhole = ['1.5', '-1', '+5', '1e3', 'abc', '1:15', '1,000', '1 2', '0x10', '٣', '１２', '9'.repeat(20)];
  for (const text of notWhole) {
    await typeInto(end, '');
    await typeInto(start, text);
    await pressSubmit(container);
    assert(postCalls().length === 0, `a start of "${text}" sends no request`);
    assert(describedBy(start) === TEXT.startFormat, `a start of "${text}" says "${TEXT.startFormat}" (got "${describedBy(start)}")`);
    assert(focused() === start, `and the focus goes to the start for "${text}"`);
  }
  await typeInto(start, '5');
  for (const text of notWhole) {
    await typeInto(end, text);
    await pressSubmit(container);
    assert(postCalls().length === 0, `an end of "${text}" sends no request`);
    assert(describedBy(end) === TEXT.endFormat, `an end of "${text}" says "${TEXT.endFormat}" (got "${describedBy(end)}")`);
    assert(focused() === end, `and the focus goes to the end for "${text}"`);
  }
  // With no start to compare it to, an end that is a number is not reported as out of order (0 would
  // be, against a start read as 0): the start says what is wrong, and the end is left alone.
  await typeInto(start, 'abc');
  await typeInto(end, '0');
  await pressSubmit(container);
  assert(describedBy(end) === '' && describedBy(start) === TEXT.startFormat, 'an end is compared only with a start that is a number');
  await typeInto(start, '');
  await pressSubmit(container);
  assert(describedBy(end) === '' && describedBy(start) === TEXT.startEmpty, 'nor against a start that is empty');

  // Whole numbers go through, however they are padded; the answer fails so the form stays for the next.
  postReply = () => failure(500, 'Database is locked');
  const accepted: Array<[string, string, number, number | null]> = [
    ['0', '', 0, null],
    ['007', ' 8 ', 7, 8],
    [' 75 ', '', 75, null],
    ['9007199254740990', '9007199254740991', 9007199254740990, 9007199254740991],
  ];
  for (const [startText, endText, startValue, endValue] of accepted) {
    calls.length = 0;
    await typeInto(start, startText);
    await typeInto(end, endText);
    await pressSubmit(container);
    assert(describedBy(start) === '' && describedBy(end) === '', `a start of "${startText}" and an end of "${endText}" are accepted`);
    const performance = (sentBody() as { performances: Array<{ timestamp: number; endTimestamp: number | null }> }).performances[0];
    assert(
      performance?.timestamp === startValue && performance.endTimestamp === endValue,
      `"${startText}" and "${endText}" are sent as ${startValue} and ${endValue} (got ${JSON.stringify(performance)})`,
    );
  }

  await unmount();
  console.log('✓ Submit Song: a row needs a whole-second start, and an empty end or one after the start; each error is inline with the focus');
}

async function streamIdAndPartlyFilledRows(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillSong(container);

  // A row holding only a start has no Stream ID.
  const row = await addRow(container, { start: '30' });
  const stream = inputLabelled(row, 'Stream ID');
  await pressSubmit(container);
  assert(postCalls().length === 0, 'a row with no stream ID sends no request');
  assert(describedBy(stream) === TEXT.stream && stream.getAttribute('aria-invalid') === 'true', `the stream ID says "${TEXT.stream}"`);
  assert(focused() === stream, 'the focus goes to it');
  await typeInto(stream, '   ');
  await pressSubmit(container);
  assert(describedBy(stream) === TEXT.stream, 'a stream ID of spaces is empty');

  // A row holding only a note is partly filled: it has neither a stream ID nor a start, and the stream ID comes first.
  await typeInto(stream, '');
  await typeInto(inputLabelled(row, 'Start'), '');
  await typeInto(inputLabelled(row, 'Note'), 'Encore');
  await pressSubmit(container);
  assert(postCalls().length === 0, 'a row with only a note is partly filled, and refused');
  assert(
    describedBy(stream) === TEXT.stream && describedBy(inputLabelled(row, 'Start')) === TEXT.startEmpty,
    'it reports both the stream ID and the start',
  );
  assert(focused() === stream, 'the focus goes to the first of them, the stream ID');

  // A row holding only an end is partly filled too.
  await typeInto(inputLabelled(row, 'Note'), '');
  await typeInto(inputLabelled(row, 'End'), '9');
  await pressSubmit(container);
  assert(postCalls().length === 0 && describedBy(stream) === TEXT.stream, 'a row with only an end is refused');

  // Emptied again, the row is skipped, and what it said goes with it.
  await typeInto(inputLabelled(row, 'End'), '');
  assert(
    describedBy(stream) === '' && describedBy(inputLabelled(row, 'Start')) === '' && stream.getAttribute('aria-invalid') === null,
    'a row that is empty again reports nothing',
  );
  await pressSubmit(container);
  deepStrictEqual(sentBody(), { title: 'Lemon', originalArtist: 'Kenshi Yonezu' });

  await unmount();
  console.log('✓ Submit Song: a partly filled row needs its stream ID and start; a row emptied again is skipped and reports nothing');
}

async function firstInvalidFieldTakesTheFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  // Three rows: the first is fine, the second has an end before its start, the third has no stream ID.
  const first = await addRow(container, { stream: 'stream-a', start: '10' });
  const second = await addRow(container, { stream: 'stream-b', start: '50', end: '20' });
  const third = await addRow(container, { start: '5' });
  await pressSubmit(container);
  assert(postCalls().length === 0, 'nothing is sent');
  assert(
    describedBy(inputLabelled(container, 'Title')) === TEXT.title && describedBy(inputLabelled(container, 'Original artist')) === TEXT.artist,
    'the title and the artist are reported',
  );
  assert(focused() === inputLabelled(container, 'Title'), 'the title comes first, before any row');
  assert(
    describedBy(inputLabelled(first, 'Stream ID')) === '' && describedBy(inputLabelled(first, 'Start')) === '',
    'the row that is fine reports nothing',
  );
  assert(describedBy(inputLabelled(second, 'End')) === TEXT.endOrder, 'the second row reports its end');
  assert(describedBy(inputLabelled(third, 'Stream ID')) === TEXT.stream, 'the third row reports its stream ID');

  // Then the artist, then the rows from the top; inside a row, the stream ID, the start, the end.
  await fillSong(container);
  await pressSubmit(container);
  assert(focused() === inputLabelled(second, 'End'), 'with the song filled in, the focus is on the first invalid row (the second)');
  await typeInto(inputLabelled(second, 'End'), '80');
  await pressSubmit(container);
  assert(focused() === inputLabelled(third, 'Stream ID'), 'then on the third');
  await typeInto(inputLabelled(third, 'Stream ID'), 'stream-c');
  await pressSubmit(container);
  assert(postCalls().length === 1, 'once every row is right the form is sent');
  deepStrictEqual(sentBody(), {
    title: 'Lemon',
    originalArtist: 'Kenshi Yonezu',
    performances: [
      { streamId: 'stream-a', timestamp: 10, endTimestamp: null, note: '' },
      { streamId: 'stream-b', timestamp: 50, endTimestamp: 80, note: '' },
      { streamId: 'stream-c', timestamp: 5, endTimestamp: null, note: '' },
    ],
  });

  await unmount();
  console.log('✓ Submit Song: the focus goes to the first invalid field in document order: title, artist, then the rows from the top');
}

async function blankRowsAreSkippedAndReported(mountPage: MountPage): Promise<void> {
  // A fully blank row beside one valid row: one performance goes, and the toast says one row was left out.
  reset();
  let page = await mountPage();
  let { container } = page;
  await fillSong(container, '  Lemon ', ' Kenshi Yonezu ');
  await addRow(container);
  await addRow(container, { stream: ' stream-2026-03-01 ', start: ' 75 ', end: ' 310 ', note: '  Encore  ' });
  assert(performanceRows(container).length === 2, 'two rows are on the page');
  await pressSubmit(container);

  assert(postCalls().length === 1, 'Submit sends one request');
  const sent = need(postCalls()[0], 'the song request');
  assert(sent.path === '/api/songs', 'it creates a song');
  assert(sent.params.toString() === 'streamer=mizuki', `it carries the current streamer (got ${sent.params.toString()})`);
  deepStrictEqual(sent.body, {
    title: 'Lemon',
    originalArtist: 'Kenshi Yonezu',
    performances: [{ streamId: 'stream-2026-03-01', timestamp: 75, endTimestamp: 310, note: 'Encore' }],
  });
  assert(
    Object.keys(need((sent.body as { performances: object[] }).performances[0], 'the performance')).sort().join(',') ===
      'endTimestamp,note,streamId,timestamp',
    'the performance is exactly those four fields: no songId, date, stream title or video ID',
  );
  deepStrictEqual(toastsOf(container), [{ message: 'Song submitted', detail: '1 empty performance row skipped' }]);
  assert(container.querySelector('form') === null && textOf(container).includes('Song list'), 'the page goes on to the song list');
  assert(unexpected.length === 0, 'and nothing else was requested');
  assertNoRawColour(container.innerHTML, 'the page after a submit');
  await page.unmount();

  // Two blank rows, one on each side of a valid one: the count follows, in the plural; a row of spaces is blank, a start of 0 is a start.
  reset();
  page = await mountPage();
  ({ container } = page);
  await fillSong(container);
  await addRow(container);
  await addRow(container, { stream: 'stream-x', start: '0' });
  await addRow(container, { stream: '   ', start: ' ', end: '', note: ' \t ' });
  await pressSubmit(container);
  deepStrictEqual(sentBody(), {
    title: 'Lemon',
    originalArtist: 'Kenshi Yonezu',
    performances: [{ streamId: 'stream-x', timestamp: 0, endTimestamp: null, note: '' }],
  });
  deepStrictEqual(toastsOf(container), [{ message: 'Song submitted', detail: '2 empty performance rows skipped' }]);
  assert(textOf(container).includes('Song list'), 'the page goes on to the song list');
  await page.unmount();

  console.log('✓ Submit Song: a blank row plus a valid one sends one trimmed {streamId, timestamp, endTimestamp, note}, toasts "Song submitted" with the skip count, and goes to the list');
}

async function noRowsLeftOrNoneAtAll(mountPage: MountPage): Promise<void> {
  // Only blank rows: the song goes with no performances at all, and the toast says how many were left out.
  reset();
  let page = await mountPage();
  await fillSong(page.container);
  await addRow(page.container);
  await addRow(page.container);
  await addRow(page.container);
  await pressSubmit(page.container);
  const body = sentBody() as Record<string, unknown>;
  deepStrictEqual(body, { title: 'Lemon', originalArtist: 'Kenshi Yonezu' });
  assert(!('performances' in body), 'performances is left out of the body when no row is left');
  deepStrictEqual(toastsOf(page.container), [{ message: 'Song submitted', detail: '3 empty performance rows skipped' }]);
  assert(textOf(page.container).includes('Song list'), 'the page goes on to the song list');
  await page.unmount();

  // No rows at all: nothing was skipped, so the toast has no detail.
  reset();
  page = await mountPage();
  await fillSong(page.container);
  await pressSubmit(page.container);
  deepStrictEqual(sentBody(), { title: 'Lemon', originalArtist: 'Kenshi Yonezu' });
  deepStrictEqual(toastsOf(page.container), [{ message: 'Song submitted', detail: '' }]);
  assert(
    page.container.querySelector('section[aria-label="Notifications"] li p + p') === null,
    'a submit that skipped nothing says nothing more',
  );
  await page.unmount();

  // Valid rows only: they all go, in order, nothing is skipped and nothing is said about it.
  reset();
  page = await mountPage();
  await fillSong(page.container);
  await addRow(page.container, { stream: 'stream-a', start: '1', end: '2', note: 'First' });
  await addRow(page.container, { stream: 'stream-b', start: '3' });
  await pressSubmit(page.container);
  deepStrictEqual(sentBody(), {
    title: 'Lemon',
    originalArtist: 'Kenshi Yonezu',
    performances: [
      { streamId: 'stream-a', timestamp: 1, endTimestamp: 2, note: 'First' },
      { streamId: 'stream-b', timestamp: 3, endTimestamp: null, note: '' },
    ],
  });
  deepStrictEqual(toastsOf(page.container), [{ message: 'Song submitted', detail: '' }]);
  await page.unmount();

  console.log('✓ Submit Song: a blank row is skipped and counted in the toast; no rows left sends no performances; none skipped says nothing');
}

async function serverErrorKeepsTheForm(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillSong(container);
  const row = await addRow(container, { stream: 'x', start: '12', end: '34', note: 'Encore' });
  const second = await addRow(container, { stream: 'stream-ok', start: '1' });
  const submit = submitButton(container);
  postReply = () => failure(404, 'Stream not found: x');
  await pressSubmit(container);

  // The worker's message is a danger note above the actions.
  assert(postCalls().length === 1, 'the form was sent once');
  const note = need(alertOf(container), 'a danger note for the failed submit');
  assert(formOf(container).contains(note), 'the note sits in the form');
  assert(textOf(note).includes('Stream not found: x'), `it carries the worker's message (got "${textOf(note)}")`);
  assert(note.classList.contains('border-tone-danger-line'), 'and is a danger note');
  assert(note.nextElementSibling === submit.parentElement, 'it sits directly above the actions');
  assert(buttonNamed(note, 'Retry') === null, 'it offers no Retry: Submit is still there to press again');
  assert(toastsOf(container).length === 0, 'a failure raises no toast');

  // The form stays, as it was typed: the same fields, with their values.
  assert(container.querySelector('form') !== null && !textOf(container).includes('Song list'), 'the page goes nowhere');
  assert(inputLabelled(container, 'Title').value === 'Lemon' && inputLabelled(container, 'Original artist').value === 'Kenshi Yonezu', 'the song is kept');
  assert(performanceRows(container)[0] === row && performanceRows(container)[1] === second, 'the same two rows are on the page');
  deepStrictEqual(
    [...row.querySelectorAll('input')].map((input) => input.value),
    ['x', '12', '34', 'Encore'],
  );
  deepStrictEqual(
    [...second.querySelectorAll('input')].map((input) => input.value),
    ['stream-ok', '1', '', ''],
  );
  assert(
    describedBy(inputLabelled(row, 'Stream ID')) === '' && inputLabelled(container, 'Title').getAttribute('aria-invalid') === null,
    'a server error marks no field',
  );

  // Submit is available again, and the focus never left it.
  assert(
    submit.getAttribute('aria-busy') === null && submit.getAttribute('aria-disabled') === null && !submit.hasAttribute('disabled'),
    'Submit is available again',
  );
  assert(focused() === submit, `the focus stays on Submit (got ${focused()?.tagName})`);
  assertNoRawColour(container.innerHTML, 'the form with a server error');

  // A press the form refuses takes the old note down: it answers a press that no longer stands, and the fields speak now.
  const stream = inputLabelled(row, 'Stream ID');
  await typeInto(stream, '');
  await pressSubmit(container);
  assert(postCalls().length === 1, 'the refused press sends nothing');
  assert(alertOf(container) === null, 'and the worker\'s old message is gone');
  assert(describedBy(stream) === TEXT.stream && focused() === stream, 'the stream ID says what is wrong, and has the focus');

  // The same stream ID, fixed, fails again; the next press clears that note as its request starts, and the answer takes over.
  await typeInto(stream, 'x');
  await pressSubmit(container);
  assert(postCalls().length === 2 && alertOf(container) !== null, 'the same failure comes back for the same stream ID');
  await typeInto(stream, 'stream-2026-03-01');
  const answer = held();
  postReply = () => answer.reply;
  await click(submit, 'Submit Song');
  assert(postCalls().length === 3 && alertOf(container) === null, 'the next attempt clears the note as it starts');
  await respond(answer, created(CREATED));
  assert(container.querySelector('form') === null && textOf(container).includes('Song list'), 'and its success goes to the song list');
  deepStrictEqual(toastsOf(container), [{ message: 'Song submitted', detail: '' }]);

  await unmount();
  console.log('✓ Submit Song: a 404 from the worker is a danger note above the actions; every field stays, nothing navigates, the focus stays on Submit');
}

async function submitIsBusyWhileSending(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillSong(container);
  await addRow(container, { stream: 'stream-a', start: '1' });
  const submit = submitButton(container);
  const cancel = need(buttonNamed(container, 'Cancel'), 'Cancel');
  const answer = held();
  postReply = () => answer.reply;

  await focusOn(submit);
  await click(submit, 'Submit Song');
  assert(postCalls().length === 1, 'Submit sends one request');
  assert(
    submit.getAttribute('aria-busy') === 'true' && submit.getAttribute('aria-disabled') === 'true' && !submit.hasAttribute('disabled'),
    'Submit is busy, not disabled, while the request is out',
  );
  assert(submit.querySelector('svg') !== null, 'and shows a spinner');
  assert(focused() === submit, 'it keeps the focus');
  assert(cancel.hasAttribute('disabled'), 'Cancel is unavailable meanwhile: a request in flight cannot be taken back');

  // Neither a second click nor the form's own submit event sends a second request.
  await click(submit, 'the busy Submit');
  assert(postCalls().length === 1, 'a second click on the busy Submit sends nothing');
  await act(async () => {
    formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  assert(postCalls().length === 1, 'a submit event while the request is out is ignored by the form itself');
  assert(toastsOf(container).length === 0 && container.querySelector('form') !== null, 'nothing changes until the worker has answered');

  // The answer is a success: the page leaves for the list, and was never available for a second press.
  await respond(answer, created(CREATED));
  assert(postCalls().length === 1, 'still one request');
  assert(container.querySelector('form') === null && textOf(container).includes('Song list'), 'the page goes to the song list');

  await unmount();
  console.log('✓ Submit Song: the busy Submit keeps its focus and ignores a second click and a second submit event; Cancel waits');
}

async function submitStaysBusyAfterSuccess(mountStaying: MountPage): Promise<void> {
  // Here both routes render the page, so it is still mounted once the router has moved on: as a route
  // change that is slow to show would leave it. The song is stored, so the form must not be sendable again.
  reset();
  const { container, unmount } = await mountStaying();
  const where = (): string => textOf(container.querySelector('[data-where]'));
  assert(where() === '/submit/song', 'the harness starts on the submit route');
  await fillSong(container);
  const submit = submitButton(container);
  await pressSubmit(container);

  assert(postCalls().length === 1, 'Submit sends one request');
  assert(where() === '/songs', `the page asked the router for the song list (got ${where()})`);
  deepStrictEqual(toastsOf(container), [{ message: 'Song submitted', detail: '' }]);
  assert(submit.isConnected, 'the page is still mounted in this harness');
  assert(
    submit.getAttribute('aria-busy') === 'true' && submit.getAttribute('aria-disabled') === 'true' && !submit.hasAttribute('disabled'),
    'Submit stays busy once the song is stored',
  );
  assert(need(buttonNamed(container, 'Cancel'), 'Cancel').hasAttribute('disabled'), 'and Cancel stays unavailable');
  await click(submit, 'the busy Submit');
  await act(async () => {
    formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  assert(postCalls().length === 1, 'neither a click nor a submit event stores the song a second time');
  assert(toastsOf(container).length === 1, 'and nothing more is announced');

  await unmount();
  console.log('✓ Submit Song: once the song is stored the form stays busy until the route takes it away, so it cannot be stored twice');
}

async function removingARowKeepsTheFocus(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillSong(container);
  await addRow(container, { stream: 'a', start: '1' });
  await addRow(container, { stream: 'b', start: '2' });
  await addRow(container, { stream: 'c', start: '3' });
  const streamB = inputLabelled(rowAt(container, 2), 'Stream ID');
  const streamC = inputLabelled(rowAt(container, 3), 'Stream ID');
  deepStrictEqual(
    [1, 2, 3].map((number) => textOf(document.getElementById(rowAt(container, number).getAttribute('aria-labelledby') ?? ''))),
    ['Performance #1', 'Performance #2', 'Performance #3'],
  );

  // Remove on the first row, from the keyboard: the focus goes to the Stream ID of the row that follows.
  await focusOn(removeButton(container, 1));
  await click(removeButton(container, 1), 'Remove performance 1');
  assert(performanceRows(container).length === 2, 'the row is gone');
  assert(
    streamB.isConnected && inputLabelled(rowAt(container, 1), 'Stream ID') === streamB && streamB.value === 'b',
    'the row that followed is now first, with what was typed in it',
  );
  assert(focused() === streamB, `the focus goes to the next row's Stream ID (got ${focused()?.tagName})`);
  deepStrictEqual(
    [1, 2].map((number) => textOf(document.getElementById(rowAt(container, number).getAttribute('aria-labelledby') ?? ''))),
    ['Performance #1', 'Performance #2'],
  );
  assert(removeButton(container, 2) !== null && container.querySelector('button[aria-label="Remove performance 3"]') === null, 'the rows are numbered again');

  // Remove on the last row: no row follows, so the focus goes to Add performance.
  await focusOn(removeButton(container, 2));
  await click(removeButton(container, 2), 'Remove performance 2');
  assert(performanceRows(container).length === 1 && !streamC.isConnected, 'the last row is gone');
  assert(focused() === addButton(container), `with no row after it, the focus goes to Add performance (got ${focused()?.tagName})`);

  // Remove on the only row.
  await focusOn(removeButton(container, 1));
  await click(removeButton(container, 1), 'Remove performance 1');
  assert(performanceRows(container).length === 0, 'the form has no row left');
  assert(focused() === addButton(container), 'the focus goes to Add performance');
  assert(postCalls().length === 0 && calls.length === 0, 'removing rows sends nothing');

  // A Remove pressed while the focus is elsewhere (a click in a browser that does not focus buttons) takes nothing.
  await addRow(container, { stream: 'd' });
  await addRow(container, { stream: 'e' });
  const title = inputLabelled(container, 'Title');
  await focusOn(title);
  await click(removeButton(container, 1), 'Remove performance 1');
  assert(performanceRows(container).length === 1 && focused() === title, 'the focus is not taken from the field it was on');

  // Errors belong to their row, not to its place: removing the first leaves the second's error on it.
  const rowE = rowAt(container, 1);
  await addRow(container, { stream: 'f', start: '9', end: '3' });
  await pressSubmit(container);
  assert(describedBy(inputLabelled(rowAt(container, 2), 'End')) === TEXT.endOrder, 'the second row reports its end');
  await focusOn(removeButton(container, 1));
  await click(removeButton(container, 1), 'Remove performance 1');
  assert(!rowE.isConnected && performanceRows(container).length === 1, 'the first row is gone');
  assert(describedBy(inputLabelled(rowAt(container, 1), 'End')) === TEXT.endOrder, 'the error stayed with the row it was about');
  assert(focused() === inputLabelled(rowAt(container, 1), 'Stream ID'), 'and the focus is on that row');

  await unmount();
  console.log('✓ Submit Song: removing a row moves the focus to the next row\'s Stream ID, or to Add performance; a Remove that does not hold the focus takes none');
}

async function cancelGoesBack(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillSong(container);
  await addRow(container, { stream: 'stream-a', start: '1' });
  const cancel = need(buttonNamed(container, 'Cancel'), 'Cancel');
  assert(!cancel.hasAttribute('disabled'), 'Cancel is available when nothing is out');
  await click(cancel, 'Cancel');
  assert(container.querySelector('form') === null && textOf(container).includes('Song list'), 'Cancel goes back to the song list');
  assert(calls.length === 0, 'and sends nothing');
  assert(toastsOf(container).length === 0, 'and says nothing');
  await unmount();
  console.log('✓ Submit Song: Cancel goes back to the song list without a request or a toast');
}

// --- Submit Stream: lookups and fills ---

function streamCalls(): Call[] {
  return calls.filter((call) => call.method === 'POST' && call.path === '/api/streams');
}

/** The one stream request a scenario expects to have been sent. */
function sentStream(): Call {
  assert(streamCalls().length === 1, `exactly one stream was sent (got ${streamCalls().length})`);
  return need(streamCalls()[0], 'the stream request');
}

function streamSubmitButton(container: HTMLElement): HTMLButtonElement {
  return need(buttonNamed(container, 'Submit Stream'), 'the Submit Stream button');
}

/** Presses Submit Stream from the keyboard: the button holds the focus, then is pressed. */
async function pressStreamSubmit(container: HTMLElement): Promise<void> {
  const submit = streamSubmitButton(container);
  await focusOn(submit);
  await click(submit, 'Submit Stream');
}

interface StreamFill {
  title?: string;
  date?: string;
  url?: string;
  videoId?: string;
  author?: string;
  authorUrl?: string;
  commentUrl?: string;
}

/** Types `fill` into the form, the URL before the video ID, so that an ID typed by hand is the one that stays. */
async function fillStream(container: HTMLElement, fill: StreamFill): Promise<void> {
  const fields: Array<[string, string | undefined]> = [
    ['Title', fill.title],
    ['Date', fill.date],
    ['YouTube URL', fill.url],
    ['Video ID', fill.videoId],
    ['Credit author', fill.author],
    ['Author URL', fill.authorUrl],
    ['Comment URL', fill.commentUrl],
  ];
  for (const [label, text] of fields) {
    if (text !== undefined) await typeInto(inputLabelled(container, label), text);
  }
}

/** The three fields the worker requires, filled in. */
const REQUIRED_STREAM: StreamFill = { title: 'Karaoke night', date: '2026-03-01', videoId: 'abc123' };

/** What a stream sent with only `REQUIRED_STREAM` filled in looks like on the wire. */
const REQUIRED_STREAM_BODY = {
  title: 'Karaoke night',
  date: '2026-03-01',
  videoId: 'abc123',
  youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
};

function iframesOf(container: HTMLElement): HTMLIFrameElement[] {
  return [...container.querySelectorAll<HTMLIFrameElement>('iframe')];
}

/** The poster button of the preview, or `null`. */
function posterOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('section[aria-label="Preview"] button');
}

/** Lets happy-dom's iframe navigation, which runs a few ticks behind the render, reach its request. */
async function flushFrames(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await settle();
}

/** The `src` YouTubeEmbed itself draws for this video: the pinned contract the preview's player must equal. */
function embedSrc(videoId: string): string {
  return /src="([^"]*)"/.exec(renderToStaticMarkup(<YouTubeEmbed videoId={videoId} title="T" />))?.[1] ?? '';
}

/** The seven inputs of the form, in document order. */
const STREAM_FIELDS = [
  { label: 'Title', type: 'text', required: true, placeholder: 'e.g. 歌枠 2024-12-25' },
  { label: 'Date', type: 'date', required: true, placeholder: null },
  { label: 'YouTube URL', type: 'url', required: false, placeholder: 'https://www.youtube.com/watch?v=...' },
  { label: 'Video ID', type: 'text', required: true, placeholder: 'Auto-extracted or enter manually' },
  { label: 'Credit author', type: 'text', required: false, placeholder: 'e.g. Timestamp contributor' },
  { label: 'Author URL', type: 'url', required: false, placeholder: 'https://...' },
  { label: 'Comment URL', type: 'url', required: false, placeholder: 'https://...' },
] as const;

// --- Submit Stream: scenarios ---

async function streamFirstLoadAndLayout(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();

  assert(calls.length === 0, `mounting sends no request (got ${calls.map((call) => call.path).join(', ')})`);

  // The header is the page's first child, so it sticks to <main>; the form brings the gutter.
  const header = pageHeader(container);
  const root = need(container.firstElementChild as HTMLElement | null, 'a page root');
  assert(root.firstElementChild === header, 'the header is the page first child, so it sticks to <main>');
  assert(!/overflow|blur|transform|filter/.test(root.className), 'the page root has no blur, transform or overflow');
  const form = formOf(container);
  assert(root.children[1] === form, 'the form follows the header');
  assert(
    form.classList.contains('p-4') && form.classList.contains('lg:px-5'),
    '<main> gives a page no gutter of its own, so the page brings it',
  );
  assert(container.querySelectorAll('h1').length === 1, 'the page has exactly one <h1>');
  assert(textOf(heading(container)) === 'Submit Stream', 'the <h1> is "Submit Stream"');
  assert(textOf(heading(container).previousElementSibling) === 'CATALOG', 'the crumb reads CATALOG');
  assert(header.querySelector('button, a') === null, 'the header carries no actions: Submit and Cancel sit under the form');
  assert(header.classList.contains('max-lg:sr-only'), 'the header is title-only, so below 1024 px it takes no room');
  assert(
    header.children.length === 1 && header.firstElementChild === heading(container).parentElement,
    'it holds nothing but its title block: no children, actions or meta row',
  );

  // Two glass cards while there is no video ID: the stream, then its credit. The preview comes with an ID.
  deepStrictEqual(
    [...form.querySelectorAll('h2')].map((item) => textOf(item)),
    ['Stream', 'Credit (optional)'],
  );
  assert(
    cardOf(container, 'Stream').classList.contains('glass-card') && cardOf(container, 'Credit (optional)').classList.contains('glass-card'),
    'both sections are glass cards',
  );
  assert(
    container.querySelector('section[aria-label="Preview"]') === null && container.querySelector('img, iframe') === null,
    'there is no preview, no thumbnail and no player before there is a video ID',
  );
  deepStrictEqual(labelsIn(cardOf(container, 'Stream')), ['Title', 'Date', 'YouTube URL', 'Video ID']);
  deepStrictEqual(labelsIn(cardOf(container, 'Credit (optional)')), ['Credit author', 'Author URL', 'Comment URL']);

  // The form's contract: no browser validation bubble, the required fields marked for assistive technology.
  assert(form.hasAttribute('novalidate'), 'the form carries noValidate, so the inline errors are the only ones');
  assert(!/\srequired(=|\s|>)/.test(form.outerHTML), 'no field carries the required attribute');
  assert(formOf(container).querySelectorAll('input').length === STREAM_FIELDS.length, 'seven inputs, and no other');
  for (const field of STREAM_FIELDS) {
    const input = inputLabelled(container, field.label);
    assert(input.type === field.type, `${field.label} is a ${field.type} input (got ${input.type})`);
    assert(
      input.getAttribute('aria-required') === (field.required ? 'true' : null),
      `${field.label} is ${field.required ? '' : 'not '}aria-required`,
    );
    const marked = textOf(labelFor(container, input)).endsWith('*');
    assert(marked === field.required, `${field.label} ${field.required ? 'shows' : 'shows no'} asterisk`);
    assert(
      !marked || labelFor(container, input).querySelector('[aria-hidden="true"]') !== null,
      `the asterisk of ${field.label} is decoration, hidden from assistive technology`,
    );
    assert(input.getAttribute('placeholder') === field.placeholder, `${field.label} keeps its placeholder (got ${input.getAttribute('placeholder')})`);
    assert(input.value === '' && input.getAttribute('aria-invalid') === null, `${field.label} starts empty and unreported`);
  }
  assert(
    describedBy(inputLabelled(container, 'YouTube URL')) === STREAM_TEXT.urlHint,
    'the URL field says the ID is extracted automatically, as a hint it is described by',
  );
  for (const label of ['Title', 'Date', 'Video ID', 'Credit author', 'Author URL', 'Comment URL']) {
    assert(describedBy(inputLabelled(container, label)) === '', `${label} has nothing to be described by yet`);
  }

  // The actions: Submit sends, Cancel goes back.
  deepStrictEqual(
    [...form.querySelectorAll('button')].map((button) => textOf(button)),
    ['Submit Stream', 'Cancel'],
  );
  const submit = streamSubmitButton(container);
  const cancel = need(buttonNamed(container, 'Cancel'), 'Cancel');
  assert(submit.type === 'submit' && cancel.type === 'button', 'Submit submits the form; Cancel does not');
  assert(submit.className === buttonClasses({ variant: 'primary' }), 'Submit is the primary button');
  assert(
    submit.getAttribute('aria-busy') === null && submit.getAttribute('aria-disabled') === null && !submit.hasAttribute('disabled'),
    'Submit starts available',
  );
  assert(alertOf(container) === null && toastsOf(container).length === 0, 'there is no note and no toast before anything happens');
  assert(
    [...container.querySelectorAll('button')].every((button) => button.hasAttribute('type')),
    'every button states its type',
  );
  assertNoRawColour(container.innerHTML, 'the empty form');

  await unmount();
  console.log('✓ Submit Stream: no request on mount, the header with its crumb, the Stream and Credit cards, noValidate and aria-required on the three required fields');
}

async function theUrlFillsTheVideoId(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const url = inputLabelled(container, 'YouTube URL');
  const videoId = inputLabelled(container, 'Video ID');
  // Read through a call, so that an assertion on one value does not narrow the next one's type.
  const idValue = (): string => videoId.value;

  // Every kind of YouTube link fills the video ID, and the URL stays as it was typed.
  const links: Array<[string, string]> = [
    ['https://youtu.be/abc1', 'abc1'],
    ['https://www.youtube.com/watch?v=abc2&t=1', 'abc2'],
    ['https://www.youtube.com/live/abc3', 'abc3'],
    ['https://www.youtube.com/shorts/abc4', 'abc4'],
    ['https://www.youtube.com/embed/abc5', 'abc5'],
  ];
  for (const [link, id] of links) {
    await typeInto(url, link);
    assert(idValue() === id, `${link} fills the video ID with ${id} (got "${idValue()}")`);
    assert(url.value === link, `and the URL stays as typed (got "${url.value}")`);
  }

  // A link that names no video leaves the ID alone, and so does clearing the URL.
  await typeInto(url, 'https://example.com/x');
  assert(idValue() === 'abc5', `a link that names no video leaves the ID as it was (got "${idValue()}")`);
  await typeInto(url, 'not a url');
  assert(idValue() === 'abc5', 'and so does text that is not a link');
  await typeInto(url, '');
  assert(idValue() === 'abc5', 'clearing the URL does not clear the ID');

  // The ID stays editable by hand, and the next link that names a video fills it in again.
  await typeInto(videoId, 'by-hand');
  assert(idValue() === 'by-hand' && url.value === '', 'the video ID can be typed by hand');
  await typeInto(url, 'https://youtu.be/xyz9');
  assert(idValue() === 'xyz9', 'and the next link that names a video fills it in again');
  assert(calls.length === 0, 'reading a link sends nothing');

  await unmount();
  console.log('✓ Submit Stream: a youtu.be, ?v=, /live/, /shorts/ or /embed/ link fills the video ID; other text leaves it alone; the ID stays editable');
}

async function thePreviewIsAPosterUntilItIsClicked(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const title = inputLabelled(container, 'Title');
  const videoId = inputLabelled(container, 'Video ID');
  const form = formOf(container);

  assert(container.querySelector('section[aria-label="Preview"]') === null, 'there is no preview card without a video ID');

  // An ID typed by hand, a character at a time: a poster each time, and never a player.
  for (const typed of ['a', 'ab', 'abc']) {
    await typeInto(videoId, typed);
    assert(posterOf(container) !== null && iframesOf(container).length === 0, `"${typed}" shows a poster and loads no player`);
  }
  await flushFrames();
  assert(frameRequests.length === 0, `typing an ID requests nothing from YouTube (asked for ${frameRequests.join(', ')})`);
  const card = cardOf(container, 'Preview');
  assert(card.classList.contains('glass-card') && textOf(card.querySelector('h2')) === 'Preview', 'the preview is a glass card headed "Preview"');
  deepStrictEqual(
    [...form.querySelectorAll('h2')].map((item) => textOf(item)),
    ['Stream', 'Credit (optional)', 'Preview'],
  );
  assert(cardOf(container, 'Credit (optional)').nextElementSibling === card, 'it follows the credit card');
  const poster = need(posterOf(container), 'the poster');
  assert(poster.type === 'button', 'the poster is a typed button');
  assert(
    poster.getAttribute('aria-label') === 'Play Stream preview',
    `with no title the poster is named "Play Stream preview" (got "${poster.getAttribute('aria-label')}")`,
  );
  assert(poster.querySelector('img')?.getAttribute('src') === youtubeThumbnailUrl('abc'), "the thumbnail is the video's");
  assert(poster.parentElement?.classList.contains('max-w-md') === true, 'the poster is not as wide as the card');

  // The poster is named for the stream's title, trimmed; a title of spaces is no title.
  await typeInto(title, '  Karaoke night  ');
  assert(need(posterOf(container), 'the poster').getAttribute('aria-label') === 'Play Karaoke night', 'the poster is named for the title, trimmed');
  await typeInto(title, '   ');
  assert(need(posterOf(container), 'the poster').getAttribute('aria-label') === 'Play Stream preview', 'a title of spaces is no title');
  await typeInto(title, 'Karaoke night');

  // The ID is trimmed for the preview: spaces make no video, and are no part of one.
  await typeInto(videoId, '   ');
  assert(container.querySelector('section[aria-label="Preview"]') === null, 'an ID of spaces shows no preview');
  await typeInto(videoId, '  abc  ');
  assert(
    posterOf(container)?.querySelector('img')?.getAttribute('src') === youtubeThumbnailUrl('abc'),
    'a padded ID shows its trimmed thumbnail',
  );

  // Clicking loads the player: one iframe, the embed of the trimmed ID, named for the stream, holding the focus.
  await focusOn(need(posterOf(container), 'the poster'));
  await click(posterOf(container), 'the poster');
  const frames = iframesOf(container);
  assert(frames.length === 1, `exactly one iframe after the click (saw ${frames.length})`);
  const player = need(frames[0], 'the player');
  assert(player.getAttribute('src') === embedSrc('abc'), "it is the trimmed ID's embed");
  assert(player.getAttribute('title') === 'Karaoke night', 'named for the stream');
  assert(posterOf(container) === null, 'the poster is gone');
  assert(focused() === player, `the poster hands its focus to its player, not to <body> (got ${focused()?.tagName})`);
  await flushFrames();
  deepStrictEqual(frameRequests, [embedSrc('abc')]);

  // A new title renames the player and keeps it playing: only the video ID re-arms the poster.
  await typeInto(title, 'Karaoke night 2');
  assert(iframesOf(container)[0] === player && player.getAttribute('title') === 'Karaoke night 2', 'a new title renames the player and does not restart it');

  // A different ID is a poster again, and so is the first one when it is typed back: no click, no player.
  await typeInto(videoId, 'abcd');
  assert(iframesOf(container).length === 0 && posterOf(container) !== null, 'a different video ID is a poster again, with no player');
  assert(posterOf(container)?.querySelector('img')?.getAttribute('src') === youtubeThumbnailUrl('abcd'), 'with its own thumbnail');
  await typeInto(videoId, 'abc');
  assert(iframesOf(container).length === 0 && posterOf(container) !== null, 'the first video, typed back, is a poster too: a player never loads without a click');
  await flushFrames();
  deepStrictEqual(frameRequests, [embedSrc('abc')]);

  // A link changes the ID, so it re-arms the poster the same way.
  await click(posterOf(container), 'the poster again');
  assert(iframesOf(container).length === 1, 'the poster plays again when it is clicked');
  await typeInto(inputLabelled(container, 'YouTube URL'), 'https://www.youtube.com/live/xyz');
  assert(iframesOf(container).length === 0, 'a link that names another video re-arms the poster');
  assert(posterOf(container)?.querySelector('img')?.getAttribute('src') === youtubeThumbnailUrl('xyz'), 'with that video\'s thumbnail');

  // Clearing the ID takes the preview away.
  await typeInto(videoId, '');
  assert(container.querySelector('section[aria-label="Preview"]') === null && iframesOf(container).length === 0, 'with no ID there is no preview again');
  assert(calls.length === 0, 'the preview sends nothing to the worker');
  assertNoRawColour(container.innerHTML, 'the form with a preview');

  await unmount();
  console.log('✓ Submit Stream: the preview is a poster named for the title until it is clicked, no player loads per keystroke, and a different video ID re-arms it');
}

async function titleDateAndVideoIdAreRequired(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  const title = inputLabelled(container, 'Title');
  const date = inputLabelled(container, 'Date');
  const videoId = inputLabelled(container, 'Video ID');
  const submit = streamSubmitButton(container);

  // Nothing is reported while the form is being filled in.
  await typeInto(title, '   ');
  await typeInto(videoId, '   ');
  assert(describedBy(title) === '' && title.getAttribute('aria-invalid') === null, 'a field is not reported before Submit is pressed');

  // A title of spaces and a video ID of spaces are empty, and so is a date nobody picked.
  await pressStreamSubmit(container);
  assert(streamCalls().length === 0, 'an empty form sends no request');
  assert(describedBy(title) === STREAM_TEXT.title && title.getAttribute('aria-invalid') === 'true', `the title says "${STREAM_TEXT.title}" (got "${describedBy(title)}")`);
  assert(describedBy(date) === STREAM_TEXT.dateEmpty && date.getAttribute('aria-invalid') === 'true', `the date says "${STREAM_TEXT.dateEmpty}" (got "${describedBy(date)}")`);
  assert(describedBy(videoId) === STREAM_TEXT.videoId && videoId.getAttribute('aria-invalid') === 'true', `the video ID says "${STREAM_TEXT.videoId}" (got "${describedBy(videoId)}")`);
  for (const label of ['YouTube URL', 'Credit author', 'Author URL', 'Comment URL']) {
    assert(inputLabelled(container, label).getAttribute('aria-invalid') === null, `${label} is optional, and not reported`);
  }
  assert(describedBy(inputLabelled(container, 'YouTube URL')) === STREAM_TEXT.urlHint, 'the URL field keeps its hint, and nothing more');
  assert(focused() === title, `the focus goes to the first field that needs fixing (got ${focused()?.tagName})`);
  assert(toastsOf(container).length === 0 && alertOf(container) === null, 'no toast and no alert: the fields say it');
  assert(
    submit.getAttribute('aria-busy') === null && !submit.hasAttribute('disabled'),
    'a refused submit leaves the button available',
  );
  assert(textOf(document.getElementById(`${title.id}-error`)) === STREAM_TEXT.title, 'the error is the paragraph the field points at');
  assertNoRawColour(container.innerHTML, 'the form with its errors');

  // Pressing again with the same errors still takes the focus to the first of them.
  await focusOn(submit);
  await click(submit, 'Submit Stream');
  assert(focused() === title, 'a second refused submit moves the focus to the title again');
  assert(streamCalls().length === 0, 'and sends nothing');

  // Fixing a field clears its error at once, and the next press goes to the field that is left, in document order.
  await typeInto(title, 'Karaoke night');
  assert(describedBy(title) === '' && title.getAttribute('aria-invalid') === null, 'a title that is filled in is no longer reported');
  assert(describedBy(date) === STREAM_TEXT.dateEmpty && describedBy(videoId) === STREAM_TEXT.videoId, 'the date and the video ID still are');
  await pressStreamSubmit(container);
  assert(streamCalls().length === 0 && focused() === date, `the focus goes to the date, the first field still wrong (got ${focused()?.tagName})`);
  await typeInto(date, '2026-03-01');
  assert(describedBy(date) === '' && date.getAttribute('aria-invalid') === null, 'a date that is filled in is no longer reported');
  await pressStreamSubmit(container);
  assert(streamCalls().length === 0 && focused() === videoId, 'the focus goes to the video ID, the last field still wrong');

  // Filled in, with spaces around the text: the trimmed values are what is sent.
  await typeInto(title, '  Karaoke night  ');
  await typeInto(videoId, '  abc123  ');
  await pressStreamSubmit(container);
  deepStrictEqual(sentStream().body, REQUIRED_STREAM_BODY);

  await unmount();
  console.log('✓ Submit Stream: a missing title, date or video ID (spaces count as missing) blocks Submit with an inline error and the focus; fixing it clears it');
}

async function theDateFormatIsChecked(): Promise<void> {
  // A date input of a browser takes a year of up to six digits, which the worker refuses: it wants four.
  // happy-dom empties such a value itself, so the rule is read where the page reads it.
  const { BLANK_STREAM, checkStream } = await import('../src/pages/submit-stream-form');
  const dateError = (date: string): string | null => checkStream({ ...BLANK_STREAM, date }).dateError;

  assert(dateError('') === STREAM_TEXT.dateEmpty, 'no date is asked for');
  assert(dateError('   ') === STREAM_TEXT.dateEmpty, 'a date of spaces is no date');
  for (const date of ['2026-03-01', '0001-01-01', '9999-12-31', ' 2026-03-01 ']) {
    assert(dateError(date) === null, `${JSON.stringify(date)} is a date`);
  }
  for (const date of ['20260-03-01', '275760-09-13', '2026-3-1', '26-03-01', '2026/03/01', '03-01-2026', '2026-03-01T10:00', '2026-03', 'abc']) {
    assert(dateError(date) === STREAM_TEXT.dateFormat, `${JSON.stringify(date)} is not YYYY-MM-DD (got ${JSON.stringify(dateError(date))})`);
  }
  assert(!checkStream({ ...BLANK_STREAM, date: '20260-03-01' }).valid, 'a date in the wrong form blocks the submit');
  console.log('✓ Submit Stream: a date that is not YYYY-MM-DD (a five or six digit year) is refused with its own text');
}

async function theRulesReadWhatWasTyped(): Promise<void> {
  // A url input of a browser trims its value itself and happy-dom's does too, so the page alone cannot show
  // that the rules do not count on it: they read the form as typed, spaces and all.
  const { BLANK_STREAM, checkStream, streamRequest } = await import('../src/pages/submit-stream-form');

  deepStrictEqual(checkStream(BLANK_STREAM), {
    titleError: STREAM_TEXT.title,
    dateError: STREAM_TEXT.dateEmpty,
    youtubeUrlError: null,
    videoIdError: STREAM_TEXT.videoId,
    creditAuthorError: null,
    creditAuthorUrlError: null,
    creditCommentUrlError: null,
    valid: false,
  });

  const filled = { ...BLANK_STREAM, title: 'Karaoke night', date: '2026-03-01', videoId: 'abc123' };
  assert(checkStream(filled).valid, 'a title, a date and a video ID are a form');
  for (const field of ['youtubeUrl', 'creditAuthorUrl', 'creditCommentUrl'] as const) {
    const withAuthor = { ...filled, creditAuthor: 'Mika' };
    assert(checkStream({ ...withAuthor, [field]: '   ' }).valid, `${field} of spaces is empty, and a link may be empty`);
    assert(checkStream({ ...withAuthor, [field]: '  https://example.com/x  ' }).valid, `${field} with spaces around a link is a link`);
    assert(!checkStream({ ...withAuthor, [field]: '  not a link  ' }).valid, `${field} with spaces around text that is no link is not`);
  }
  assert(checkStream({ ...filled, creditAuthorUrl: '   ', creditAuthor: '   ' }).valid, 'a link and an author of spaces are no credit at all');
  assert(checkStream({ ...filled, creditCommentUrl: '  https://example.com/c  ' }).creditAuthorError !== null, 'a link with spaces around it still needs an author');

  // The request is trimmed all through, the date included; a link or an author of spaces is nothing.
  deepStrictEqual(
    streamRequest({
      title: '  Karaoke night  ',
      date: ' 2026-03-01 ',
      youtubeUrl: '  https://example.com/x  ',
      videoId: ' abc123 ',
      creditAuthor: '  Mika  ',
      creditAuthorUrl: ' https://example.com/mika ',
      creditCommentUrl: '   ',
    }),
    {
      title: 'Karaoke night',
      date: '2026-03-01',
      videoId: 'abc123',
      youtubeUrl: 'https://example.com/x',
      credit: { author: 'Mika', authorUrl: 'https://example.com/mika' },
    },
  );
  deepStrictEqual(streamRequest({ ...filled, youtubeUrl: '   ', creditAuthor: '   ', creditAuthorUrl: '   ' }), REQUIRED_STREAM_BODY);
  console.log('✓ Submit Stream: the rules read the form as typed: spaces around a link, a date or an author are not part of it, and a field of spaces is empty');
}

async function linksAreChecked(mountPage: MountPage): Promise<void> {
  reset();
  streamReply = () => failure(500, 'Database is locked');
  const { container, unmount } = await mountPage();
  await fillStream(container, REQUIRED_STREAM);
  const url = inputLabelled(container, 'YouTube URL');
  const author = inputLabelled(container, 'Credit author');
  const authorUrl = inputLabelled(container, 'Author URL');
  const commentUrl = inputLabelled(container, 'Comment URL');

  // The browser's own check of a url input is off (noValidate), so the page makes it: a full http or https URL, or nothing.
  const notLinks = ['not a url', 'youtu.be/abc', 'www.youtube.com/watch?v=abc', 'ftp://example.com/x', 'javascript:alert(1)', 'mailto:me@example.com', 'https://', 'http:/'];
  for (const [index, bad] of notLinks.entries()) {
    await typeInto(url, bad);
    // Nothing is said while the form is being filled in; from the first press on, the errors follow what is typed.
    assert(
      describedBy(url) === (index === 0 ? STREAM_TEXT.urlHint : `${STREAM_TEXT.urlHint} ${STREAM_TEXT.link}`),
      `"${bad}" is ${index === 0 ? 'not ' : ''}reported ${index === 0 ? 'before Submit is pressed' : 'as soon as it is typed once Submit has been pressed'}`,
    );
    await pressStreamSubmit(container);
    assert(streamCalls().length === 0, `"${bad}" as the YouTube URL sends no request`);
    assert(
      describedBy(url) === `${STREAM_TEXT.urlHint} ${STREAM_TEXT.link}` && url.getAttribute('aria-invalid') === 'true',
      `"${bad}" is described by the hint and then "${STREAM_TEXT.link}" (got "${describedBy(url)}")`,
    );
    assert(focused() === url, `and the focus goes to the URL for "${bad}" (got ${focused()?.tagName})`);
    assert(alertOf(container) === null && toastsOf(container).length === 0, 'with no alert and no toast: the field says it');
  }
  assertNoRawColour(container.innerHTML, 'the form with a URL error');
  // The URL field is optional, and a link of any kind is a link: a YouTube one, or another site's.
  for (const good of ['', 'https://example.com/x', 'http://example.com/x', 'https://www.youtube.com/watch?v=abc123', 'HTTPS://EXAMPLE.COM']) {
    await typeInto(url, good);
    assert(describedBy(url) === STREAM_TEXT.urlHint && url.getAttribute('aria-invalid') === null, `"${good}" is fine: the error goes at once`);
  }
  await typeInto(url, '');

  // The two credit links are checked the same way, each on its own field.
  await typeInto(author, 'Mika');
  for (const [field, label] of [[authorUrl, 'Author URL'], [commentUrl, 'Comment URL']] as const) {
    await typeInto(field, 'not a url');
    await pressStreamSubmit(container);
    assert(streamCalls().length === 0, `a ${label} that is not a link sends no request`);
    assert(describedBy(field) === STREAM_TEXT.link && field.getAttribute('aria-invalid') === 'true', `the ${label} says "${STREAM_TEXT.link}" (got "${describedBy(field)}")`);
    assert(focused() === field, `and has the focus (got ${focused()?.tagName})`);
    assert(describedBy(author) === '' && author.getAttribute('aria-invalid') === null, 'the author is not what is wrong');
    await typeInto(field, 'ftp://example.com/c');
    assert(describedBy(field) === STREAM_TEXT.link, `an ftp link is not a link for the ${label} either`);
    await typeInto(field, 'https://example.com/c');
    assert(describedBy(field) === '' && field.getAttribute('aria-invalid') === null, `a link clears the ${label} error at once`);
    await typeInto(field, '');
  }

  // With no author, a link that is not a link is reported on its own field and on the author's.
  await typeInto(author, '');
  await typeInto(authorUrl, 'not a url');
  await pressStreamSubmit(container);
  assert(describedBy(author) === STREAM_TEXT.author && describedBy(authorUrl) === STREAM_TEXT.link, 'a bad link with no author is reported twice, each on its field');
  assert(focused() === author, 'and the author comes first');
  assert(streamCalls().length === 0, 'nothing was sent in all that');

  await unmount();
  console.log('✓ Submit Stream: a YouTube URL, an author URL and a comment URL that are filled in must be http(s) links, each reported on its own field');
}

async function creditLinksNeedAnAuthor(mountPage: MountPage): Promise<void> {
  reset();
  streamReply = () => failure(500, 'Database is locked');
  const { container, unmount } = await mountPage();
  await fillStream(container, REQUIRED_STREAM);
  const title = inputLabelled(container, 'Title');
  const author = inputLabelled(container, 'Credit author');
  const authorUrl = inputLabelled(container, 'Author URL');
  const commentUrl = inputLabelled(container, 'Comment URL');

  // An author URL with no author used to be dropped without a word: now the author field says so, and nothing is sent.
  await typeInto(authorUrl, 'https://example.com/mika');
  assert(describedBy(author) === '', 'a credit link with no author is not reported before Submit is pressed');
  await pressStreamSubmit(container);
  assert(streamCalls().length === 0, 'a credit link with no author sends no request');
  assert(describedBy(author) === STREAM_TEXT.author && author.getAttribute('aria-invalid') === 'true', `the author says "${STREAM_TEXT.author}" (got "${describedBy(author)}")`);
  assert(describedBy(authorUrl) === '' && authorUrl.getAttribute('aria-invalid') === null, 'the link itself is not what is wrong');
  assert(focused() === author, `the focus goes to the author (got ${focused()?.tagName})`);
  assert(alertOf(container) === null && toastsOf(container).length === 0, 'no alert and no toast: the field says it');
  assertNoRawColour(container.innerHTML, 'the form with an author error');

  // Typing the author clears it at once; the form is then fine.
  await typeInto(author, 'Mika');
  assert(describedBy(author) === '' && author.getAttribute('aria-invalid') === null, 'an author that is filled in is no longer reported');

  // A comment URL alone is the same, and so is an author of spaces.
  await typeInto(author, '');
  await typeInto(authorUrl, '');
  await typeInto(commentUrl, 'https://example.com/c/1');
  await pressStreamSubmit(container);
  assert(streamCalls().length === 0 && describedBy(author) === STREAM_TEXT.author, 'a comment URL with no author is refused too');
  await typeInto(author, '   ');
  await pressStreamSubmit(container);
  assert(streamCalls().length === 0 && describedBy(author) === STREAM_TEXT.author, 'an author of spaces is no author');
  await typeInto(authorUrl, 'https://example.com/mika');
  assert(describedBy(author) === STREAM_TEXT.author, 'both links with no author are one error on the author');
  assert(textOf(document.getElementById(`${author.id}-error`)) === STREAM_TEXT.author, 'the error is the paragraph the author points at');

  // With no link left, the author is not needed; the title still comes before it in the focus order.
  await typeInto(authorUrl, '');
  await typeInto(commentUrl, '');
  assert(describedBy(author) === '' && author.getAttribute('aria-invalid') === null, 'with no link left the error goes at once');
  await typeInto(commentUrl, 'https://example.com/c/1');
  await typeInto(title, '');
  await pressStreamSubmit(container);
  assert(describedBy(title) === STREAM_TEXT.title && describedBy(author) === STREAM_TEXT.author, 'the title and the author are both reported');
  assert(focused() === title, 'the focus goes to the first of them in the document, the title');
  await typeInto(title, 'Karaoke night');
  await typeInto(commentUrl, '');
  await typeInto(author, '');

  // An author alone is a credit, with the links it has: nothing else is sent in the credit.
  const credits: Array<[Pick<StreamFill, 'author' | 'authorUrl' | 'commentUrl'>, unknown]> = [
    [{ author: 'Mika' }, { author: 'Mika' }],
    [{ author: '  Mika  ' }, { author: 'Mika' }],
    [{ author: 'Mika', authorUrl: 'https://example.com/mika' }, { author: 'Mika', authorUrl: 'https://example.com/mika' }],
    [{ author: 'Mika', commentUrl: 'https://example.com/c/1' }, { author: 'Mika', commentUrl: 'https://example.com/c/1' }],
    [
      { author: 'Mika', authorUrl: 'https://example.com/mika', commentUrl: 'https://example.com/c/1' },
      { author: 'Mika', authorUrl: 'https://example.com/mika', commentUrl: 'https://example.com/c/1' },
    ],
  ];
  for (const [fill, credit] of credits) {
    calls.length = 0;
    await typeInto(author, '');
    await typeInto(authorUrl, '');
    await typeInto(commentUrl, '');
    await fillStream(container, fill);
    await pressStreamSubmit(container);
    deepStrictEqual(sentStream().body, { ...REQUIRED_STREAM_BODY, credit });
  }

  await unmount();
  console.log('✓ Submit Stream: a credit link without an author is an error on the author field (nothing is dropped silently); credit carries the author and only the links that were typed');
}

async function aValidFormIsSent(mountPage: MountPage): Promise<void> {
  // Everything typed, with spaces around it, and a link that fills the video ID: the trimmed values go, in the shape the worker reads.
  reset();
  let page = await mountPage();
  let { container } = page;
  await fillStream(container, {
    title: '  Karaoke night  ',
    date: '2026-03-01',
    url: 'https://www.youtube.com/live/abc123?feature=share',
    author: '  Mika  ',
    authorUrl: ' https://example.com/mika ',
    commentUrl: 'https://example.com/c/1',
  });
  assert(inputLabelled(container, 'Video ID').value === 'abc123', 'the link filled in the video ID');
  await pressStreamSubmit(container);
  const sent = sentStream();
  assert(sent.path === '/api/streams', 'it creates a stream');
  assert(sent.params.toString() === 'streamer=mizuki', `it carries the current streamer (got ${sent.params.toString()})`);
  deepStrictEqual(sent.body, {
    title: 'Karaoke night',
    date: '2026-03-01',
    videoId: 'abc123',
    youtubeUrl: 'https://www.youtube.com/live/abc123?feature=share',
    credit: { author: 'Mika', authorUrl: 'https://example.com/mika', commentUrl: 'https://example.com/c/1' },
  });
  deepStrictEqual(toastsOf(container), [{ message: 'Stream submitted', detail: '' }]);
  assert(container.querySelector('form') === null && textOf(container).includes('Stream list'), 'the page goes on to the stream list');
  assert(unexpected.length === 0, 'and nothing else was requested');
  assertNoRawColour(container.innerHTML, 'the page after a submit');
  await page.unmount();

  // No link: the URL defaults from the ID, which is trimmed; with no author there is no credit at all.
  reset();
  page = await mountPage();
  ({ container } = page);
  await fillStream(container, { title: 'Karaoke night', date: '2026-03-01', videoId: ' abc123 ' });
  await pressStreamSubmit(container);
  const bare = sentStream().body as Record<string, unknown>;
  deepStrictEqual(bare, REQUIRED_STREAM_BODY);
  assert(!('credit' in bare), 'a stream with no author sends no credit key at all');
  deepStrictEqual(toastsOf(container), [{ message: 'Stream submitted', detail: '' }]);
  assert(textOf(container).includes('Stream list'), 'the page goes on to the stream list');
  await page.unmount();

  // The default URL keeps an unusual ID inside its parameter.
  reset();
  page = await mountPage();
  ({ container } = page);
  await fillStream(container, { title: 'Karaoke night', date: '2026-03-01', videoId: ' a b&c ' });
  await pressStreamSubmit(container);
  deepStrictEqual(sentStream().body, { ...REQUIRED_STREAM_BODY, videoId: 'a b&c', youtubeUrl: 'https://www.youtube.com/watch?v=a%20b%26c' });
  await page.unmount();

  // A link and then an ID of one's own: each goes as typed.
  reset();
  page = await mountPage();
  ({ container } = page);
  await fillStream(container, { title: 'Karaoke night', date: '2026-03-01', url: 'https://youtu.be/first1', videoId: 'second2' });
  await pressStreamSubmit(container);
  deepStrictEqual(sentStream().body, { ...REQUIRED_STREAM_BODY, videoId: 'second2', youtubeUrl: 'https://youtu.be/first1' });
  await page.unmount();

  // A link that is not YouTube's is kept as the stream's URL when the ID comes from the user.
  reset();
  page = await mountPage();
  ({ container } = page);
  await fillStream(container, { title: 'Karaoke night', date: '2026-03-01', url: 'https://example.com/x', videoId: 'abc123' });
  await pressStreamSubmit(container);
  deepStrictEqual(sentStream().body, { ...REQUIRED_STREAM_BODY, youtubeUrl: 'https://example.com/x' });
  await page.unmount();

  console.log('✓ Submit Stream: a valid form sends the trimmed {title, date, videoId, youtubeUrl} (the URL defaults from the ID) and a credit only with an author, toasts "Stream submitted" and goes to the list');
}

/** Link-aware list page of the harness: it says where the router has put it, search included. */
function StreamList() {
  const location = useLocation();
  return <p data-list>{`Stream list${location.search}`}</p>;
}

async function aDuplicateVideoLinksToIt(mountPage: MountPage): Promise<void> {
  reset();
  streamReply = () => failure(409, 'A stream with this video already exists', 'STREAM_EXISTS');
  const { container, unmount } = await mountPage();
  await fillStream(container, { ...REQUIRED_STREAM, videoId: '  abc123  ' });
  const submit = streamSubmitButton(container);
  await pressStreamSubmit(container);

  assert(streamCalls().length === 1, 'the form was sent once');
  const note = need(alertOf(container), 'a danger note for the duplicate');
  assert(formOf(container).contains(note), 'the note sits in the form');
  assert(note.classList.contains('border-tone-danger-line'), 'and is a danger note');
  assert(note.nextElementSibling === submit.parentElement, 'it sits directly above the actions');
  assert(
    textOf(note) === `Couldn't submit the stream. ${STREAM_TEXT.exists} Find it in Streams`,
    `it says "${STREAM_TEXT.exists}", in the page's own words and with its full stop, then offers the link (got "${textOf(note)}")`,
  );
  assert(note.querySelector('svg') !== null, 'the note leads with its alert icon');
  const link = need(note.querySelector('a'), 'a link in the note');
  assert(textOf(link) === 'Find it in Streams', `the link reads "Find it in Streams" (got "${textOf(link)}")`);
  assert(link.classList.contains('underline'), 'the link is underlined, so it does not rest on its colour alone');
  // An explicit empty status is Streams' All: with no status in the link, Streams falls back to the status chip
  // remembered in storage (say Pending), and a duplicate that is Approved would not be in the list it opens.
  assert(
    link.getAttribute('href') === '/streams?search=abc123&status=',
    `it searches Streams for the submitted video ID, trimmed, in every status (got ${link.getAttribute('href')})`,
  );
  assert(note.querySelectorAll('a').length === 1 && buttonNamed(note, 'Retry') === null, 'it is the only link, and there is no Retry: Submit is still there to press again');
  assert(toastsOf(container).length === 0, 'a failure raises no toast');
  assert(describedBy(inputLabelled(container, 'Video ID')) === '' && inputLabelled(container, 'Video ID').getAttribute('aria-invalid') === null, 'the video ID field is not marked: the note says it');
  assertNoRawColour(container.innerHTML, 'the form with a duplicate note');

  // The form stays as typed, Submit is available again, and the focus never left it.
  assert(container.querySelector('form') !== null && !textOf(container).includes('Stream list'), 'the page goes nowhere');
  deepStrictEqual(
    STREAM_FIELDS.map((field) => inputLabelled(container, field.label).value),
    ['Karaoke night', '2026-03-01', '', '  abc123  ', '', '', ''],
  );
  assert(
    submit.getAttribute('aria-busy') === null && submit.getAttribute('aria-disabled') === null && !submit.hasAttribute('disabled'),
    'Submit is available again',
  );
  assert(focused() === submit, `the focus stays on Submit (got ${focused()?.tagName})`);

  // The link names the ID that was sent: editing the field afterwards does not move it.
  await typeInto(inputLabelled(container, 'Video ID'), 'another9');
  assert(
    note.isConnected && note.querySelector('a')?.getAttribute('href') === '/streams?search=abc123&status=',
    'the note keeps pointing at the video that was sent',
  );

  // It is a router link: it opens the list in the app, with the search in the URL.
  await click(link, 'the link in the note');
  assert(container.querySelector('form') === null, 'the link leaves the form');
  assert(
    textOf(container.querySelector('[data-list]')) === 'Stream list?search=abc123&status=',
    `and opens the stream list searched for the video, in every status (got "${textOf(container.querySelector('[data-list]'))}")`,
  );
  assert(streamCalls().length === 1 && toastsOf(container).length === 0, 'with nothing sent and nothing said');
  await unmount();

  // An ID that needs encoding stays one search term.
  reset();
  streamReply = () => failure(409, 'A stream with this video already exists', 'STREAM_EXISTS');
  const odd = await mountPage();
  await fillStream(odd.container, { ...REQUIRED_STREAM, videoId: 'a b&c' });
  await pressStreamSubmit(odd.container);
  assert(
    odd.container.querySelector('[role="alert"] a')?.getAttribute('href') === '/streams?search=a%20b%26c&status=',
    `an ID with a space and an ampersand is encoded (got ${odd.container.querySelector('[role="alert"] a')?.getAttribute('href')})`,
  );
  await odd.unmount();

  console.log('✓ Submit Stream: a 409 STREAM_EXISTS reads "A stream with this video already exists." with a router link to /streams?search=<the video ID sent>&status= (every status); the form stays');
}

async function anyOtherFailureKeepsTheForm(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillStream(container, { ...REQUIRED_STREAM, author: 'Mika', authorUrl: 'https://example.com/mika' });
  const submit = streamSubmitButton(container);
  streamReply = () => failure(500, 'Database is locked');
  await pressStreamSubmit(container);

  // The worker's message is a danger note above the actions, with no link.
  assert(streamCalls().length === 1, 'the form was sent once');
  const note = need(alertOf(container), 'a danger note for the failed submit');
  assert(formOf(container).contains(note), 'the note sits in the form');
  assert(textOf(note) === "Couldn't submit the stream. Database is locked", `it carries the worker's message (got "${textOf(note)}")`);
  assert(note.querySelector('svg') !== null, 'the note leads with its alert icon');
  assert(note.classList.contains('border-tone-danger-line'), 'and is a danger note');
  assert(note.nextElementSibling === submit.parentElement, 'it sits directly above the actions');
  assert(note.querySelector('a') === null && buttonNamed(note, 'Retry') === null, 'it has no link and no Retry');
  assert(!textOf(note).includes(STREAM_TEXT.exists), 'and does not claim a duplicate');
  assert(toastsOf(container).length === 0, 'a failure raises no toast');

  // The form stays, as it was typed; Submit is available again with the focus on it.
  assert(container.querySelector('form') !== null && !textOf(container).includes('Stream list'), 'the page goes nowhere');
  deepStrictEqual(
    STREAM_FIELDS.map((field) => inputLabelled(container, field.label).value),
    ['Karaoke night', '2026-03-01', '', 'abc123', 'Mika', 'https://example.com/mika', ''],
  );
  assert(
    submit.getAttribute('aria-busy') === null && submit.getAttribute('aria-disabled') === null && !submit.hasAttribute('disabled'),
    'Submit is available again',
  );
  assert(focused() === submit, `the focus stays on Submit (got ${focused()?.tagName})`);
  assert(
    describedBy(inputLabelled(container, 'Title')) === '' && inputLabelled(container, 'Title').getAttribute('aria-invalid') === null,
    'a server error marks no field',
  );
  assertNoRawColour(container.innerHTML, 'the form with a server error');

  // A 409 that does not say STREAM_EXISTS is not a duplicate; neither is one with another code.
  streamReply = () => failure(409, 'Conflict');
  await click(submit, 'Submit Stream');
  assert(textOf(alertOf(container)).includes('Conflict') && alertOf(container)?.querySelector('a') === null, 'a 409 with no code shows its message and no link');
  streamReply = () => failure(409, 'Locked by another curator', 'STREAM_LOCKED');
  await click(submit, 'Submit Stream');
  assert(textOf(alertOf(container)).includes('Locked by another curator') && alertOf(container)?.querySelector('a') === null, 'a 409 with another code shows its message and no link');

  // A request that never reached the worker shows what the browser said, or a plain text when it said nothing.
  streamReply = () => {
    throw new TypeError('Failed to fetch');
  };
  await click(submit, 'Submit Stream');
  assert(textOf(alertOf(container)).includes('Failed to fetch'), 'a network failure shows its message');
  streamReply = () => {
    throw new Error('');
  };
  await click(submit, 'Submit Stream');
  assert(textOf(alertOf(container)).includes('Submission failed'), `an error with no message reads "Submission failed" (got "${textOf(alertOf(container))}")`);
  assert(focused() === submit && streamCalls().length === 5, 'and the focus is still on Submit after every one');

  // A press the form refuses takes the old note down: it answers a press that no longer stands, and the fields speak now.
  const title = inputLabelled(container, 'Title');
  await typeInto(title, '');
  await pressStreamSubmit(container);
  assert(streamCalls().length === 5, 'the refused press sends nothing');
  assert(alertOf(container) === null, 'and the old message is gone');
  assert(describedBy(title) === STREAM_TEXT.title && focused() === title, 'the title says what is wrong, and has the focus');

  // The next attempt clears the note as its request starts, and its answer takes over.
  await typeInto(title, 'Karaoke night');
  streamReply = () => failure(500, 'Database is locked');
  await pressStreamSubmit(container);
  assert(alertOf(container) !== null, 'the failure comes back');
  const answer = held();
  streamReply = () => answer.reply;
  await click(submit, 'Submit Stream');
  assert(streamCalls().length === 7 && alertOf(container) === null, 'the next attempt clears the note as it starts');
  await respond(answer, created({ id: 'stream-2026-03-01', status: 'pending' }));
  assert(container.querySelector('form') === null && textOf(container).includes('Stream list'), 'and its success goes to the stream list');
  deepStrictEqual(toastsOf(container), [{ message: 'Stream submitted', detail: '' }]);

  await unmount();
  console.log('✓ Submit Stream: any other failure is a danger note with the worker\'s message and no link; every field stays, nothing navigates, the focus stays on Submit');
}

async function streamSubmitIsBusyWhileSending(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillStream(container, REQUIRED_STREAM);
  const submit = streamSubmitButton(container);
  const cancel = need(buttonNamed(container, 'Cancel'), 'Cancel');
  const answer = held();
  streamReply = () => answer.reply;

  await focusOn(submit);
  await click(submit, 'Submit Stream');
  assert(streamCalls().length === 1, 'Submit sends one request');
  assert(
    submit.getAttribute('aria-busy') === 'true' && submit.getAttribute('aria-disabled') === 'true' && !submit.hasAttribute('disabled'),
    'Submit is busy, not disabled, while the request is out',
  );
  assert(submit.querySelector('svg') !== null, 'and shows a spinner');
  assert(focused() === submit, 'it keeps the focus');
  assert(cancel.hasAttribute('disabled'), 'Cancel is unavailable meanwhile: a request in flight cannot be taken back');

  // Neither a second click nor the form's own submit event sends a second request.
  await click(submit, 'the busy Submit');
  assert(streamCalls().length === 1, 'a second click on the busy Submit sends nothing');
  await act(async () => {
    formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  assert(streamCalls().length === 1, 'a submit event while the request is out is ignored by the form itself');
  assert(toastsOf(container).length === 0 && container.querySelector('form') !== null, 'nothing changes until the worker has answered');

  // The answer is a success: the page leaves for the list, and was never available for a second press.
  await respond(answer, created({ id: 'stream-2026-03-01', status: 'pending' }));
  assert(streamCalls().length === 1, 'still one request');
  assert(container.querySelector('form') === null && textOf(container).includes('Stream list'), 'the page goes to the stream list');

  await unmount();
  console.log('✓ Submit Stream: the busy Submit keeps its focus and ignores a second click and a second submit event; Cancel waits');
}

async function streamSubmitStaysBusyAfterSuccess(mountStaying: MountPage): Promise<void> {
  // Here both routes render the page, so it is still mounted once the router has moved on: as a route
  // change that is slow to show would leave it. The stream is stored, so the form must not be sendable again.
  reset();
  const { container, unmount } = await mountStaying();
  const where = (): string => textOf(container.querySelector('[data-where]'));
  assert(where() === '/submit/stream', 'the harness starts on the submit route');
  await fillStream(container, REQUIRED_STREAM);
  const submit = streamSubmitButton(container);
  await pressStreamSubmit(container);

  assert(streamCalls().length === 1, 'Submit sends one request');
  assert(where() === '/streams', `the page asked the router for the stream list (got ${where()})`);
  deepStrictEqual(toastsOf(container), [{ message: 'Stream submitted', detail: '' }]);
  assert(submit.isConnected, 'the page is still mounted in this harness');
  assert(
    submit.getAttribute('aria-busy') === 'true' && submit.getAttribute('aria-disabled') === 'true' && !submit.hasAttribute('disabled'),
    'Submit stays busy once the stream is stored',
  );
  assert(need(buttonNamed(container, 'Cancel'), 'Cancel').hasAttribute('disabled'), 'and Cancel stays unavailable');
  await click(submit, 'the busy Submit');
  await act(async () => {
    formOf(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
  assert(streamCalls().length === 1, 'neither a click nor a submit event stores the stream a second time');
  assert(toastsOf(container).length === 1, 'and nothing more is announced');

  await unmount();
  console.log('✓ Submit Stream: once the stream is stored the form stays busy until the route takes it away, so it cannot be stored twice');
}

async function streamCancelGoesBack(mountPage: MountPage): Promise<void> {
  reset();
  const { container, unmount } = await mountPage();
  await fillStream(container, { ...REQUIRED_STREAM, author: 'Mika' });
  const cancel = need(buttonNamed(container, 'Cancel'), 'Cancel');
  assert(!cancel.hasAttribute('disabled'), 'Cancel is available when nothing is out');
  await click(cancel, 'Cancel');
  assert(container.querySelector('form') === null && textOf(container).includes('Stream list'), 'Cancel goes back to the stream list');
  assert(calls.length === 0, 'and sends nothing');
  assert(toastsOf(container).length === 0, 'and says nothing');
  await unmount();
  console.log('✓ Submit Stream: Cancel goes back to the stream list without a request or a toast');
}

async function main(): Promise<void> {
  const win = installDom();
  // happy-dom fetches an iframe's src itself, from the real network: answer it here, and keep what it asked for.
  win.happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async ({ request, window }) => {
      frameRequests.push(request.url);
      return new window.Response('<!doctype html><title>player</title>', { headers: { 'Content-Type': 'text/html' } });
    },
  };
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  setCurrentStreamer('mizuki');
  const { default: SubmitSong } = await import('../src/pages/SubmitSong');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES, routeElement } = await import('../src/lib/routes');

  // The route renders through `routeElement`: the page brings its own header and gutter.
  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/submit/song'), 'the /submit/song route');
  assert(route.curatorOnly !== true, 'it stays open to contributors, as POST /api/songs is');
  const rendered = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/submit/song']}>
      <Routes>
        <Route path="/submit/song" element={routeElement(route, contributor)} />
      </Routes>
    </MemoryRouter>,
  );
  assert(rendered !== '', 'the route renders');
  console.log('✓ Submit Song: its route renders, open to contributors');

  const mountPage: MountPage = () =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <MemoryRouter initialEntries={['/submit/song']}>
          <Routes>
            <Route path="/submit/song" element={<SubmitSong />} />
            <Route path="/songs" element={<p>Song list</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

  // Both routes render the page, so it outlives the navigation (see submitStaysBusyAfterSuccess).
  const mountStaying: MountPage = () =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <MemoryRouter initialEntries={['/submit/song']}>
          <Routes>
            <Route path="/submit/song" element={<SubmitSong />} />
            <Route path="/songs" element={<SubmitSong />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>,
    );

  await firstLoadAndLayout(mountPage);
  await performanceRowFields(mountPage);
  await titleAndArtistAreChecked(mountPage);
  await startAndEndAreChecked(mountPage);
  await streamIdAndPartlyFilledRows(mountPage);
  await firstInvalidFieldTakesTheFocus(mountPage);
  await blankRowsAreSkippedAndReported(mountPage);
  await noRowsLeftOrNoneAtAll(mountPage);
  await serverErrorKeepsTheForm(mountPage);
  await submitIsBusyWhileSending(mountPage);
  await submitStaysBusyAfterSuccess(mountStaying);
  await removingARowKeepsTheFocus(mountPage);
  await cancelGoesBack(mountPage);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  // The markup the suite cannot reach (a class behind a state it never enters) is checked in the source.
  const source = readFileSync(new URL('../src/pages/SubmitSong.tsx', import.meta.url), 'utf8');
  assertNoRawColour(source, 'the page source');
  console.log('✓ Submit Song: no raw palette class and no arbitrary hex, in the markup or the source');

  // --- Submit Stream ---

  const { default: SubmitStream } = await import('../src/pages/SubmitStream');

  // The route renders through `routeElement` too: the page brings its own header and gutter.
  const streamRoute = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/submit/stream'), 'the /submit/stream route');
  assert(streamRoute.curatorOnly !== true, 'it stays open to contributors, as POST /api/streams is');
  const streamRendered = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/submit/stream']}>
      <Routes>
        <Route path="/submit/stream" element={routeElement(streamRoute, contributor)} />
      </Routes>
    </MemoryRouter>,
  );
  assert(streamRendered !== '', 'the route renders');
  console.log('✓ Submit Stream: its route renders, open to contributors');

  const mountStream: MountPage = () =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <MemoryRouter initialEntries={['/submit/stream']}>
          <Routes>
            <Route path="/submit/stream" element={<SubmitStream />} />
            <Route path="/streams" element={<StreamList />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );

  // Both routes render the page, so it outlives the navigation (see streamSubmitStaysBusyAfterSuccess).
  const mountStreamStaying: MountPage = () =>
    mount(
      <ToastProvider timers={NO_TIMERS}>
        <MemoryRouter initialEntries={['/submit/stream']}>
          <Routes>
            <Route path="/submit/stream" element={<SubmitStream />} />
            <Route path="/streams" element={<SubmitStream />} />
          </Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>,
    );

  await streamFirstLoadAndLayout(mountStream);
  await theUrlFillsTheVideoId(mountStream);
  await thePreviewIsAPosterUntilItIsClicked(mountStream);
  await titleDateAndVideoIdAreRequired(mountStream);
  await theDateFormatIsChecked();
  await theRulesReadWhatWasTyped();
  await linksAreChecked(mountStream);
  await creditLinksNeedAnAuthor(mountStream);
  await aValidFormIsSent(mountStream);
  await aDuplicateVideoLinksToIt(mountStream);
  await anyOtherFailureKeepsTheForm(mountStream);
  await streamSubmitIsBusyWhileSending(mountStream);
  await streamSubmitStaysBusyAfterSuccess(mountStreamStaying);
  await streamCancelGoesBack(mountStream);

  assert(unexpected.length === 0, `no unstubbed request (${unexpected.join(', ')})`);

  const streamSource = readFileSync(new URL('../src/pages/SubmitStream.tsx', import.meta.url), 'utf8');
  const streamRules = readFileSync(new URL('../src/pages/submit-stream-form.ts', import.meta.url), 'utf8');
  assertNoRawColour(streamSource, 'the page source');
  assertNoRawColour(streamRules, 'the rules source');
  console.log('✓ Submit Stream: no raw palette class and no arbitrary hex, in the markup or the source');
}

await main();
