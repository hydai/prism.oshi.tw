/**
 * Submit Song on the studio kit (spec §8.9; plan Q5 and Q15), mounted live the way App.tsx mounts every
 * page (ToastProvider > router) against a stubbed fetch: the two form cards, inline validation that
 * matches what POST /api/songs accepts (a title and an artist, then for each performance row a stream
 * ID, a whole-second start and an end after it), rows left empty skipped and reported, a server error
 * that keeps the form, the busy submit, and where the focus goes when a row leaves. The route itself is
 * pinned as a studio route: no legacy frame around it.
 */
import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, Song } from '../../shared/types';
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
const failure = (status: number, error: string): Reply => ({ status, body: { error } });

const calls: Call[] = [];
const unexpected: string[] = [];

/** What the worker answers a new song: the song it stored, with the title and artist it was sent. */
const defaultPostReply = (call: Call): Reply => {
  const sent = call.body as { title: string; originalArtist: string };
  return created({ ...CREATED, title: sent.title, originalArtist: sent.originalArtist });
};

/** What POST /api/songs answers next; a scenario swaps it. A promise holds the answer until released. */
let postReply: (call: Call) => Reply | Promise<Reply> = defaultPostReply;

function reset(): void {
  calls.length = 0;
  postReply = defaultPostReply;
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
      if (method !== 'POST' || url.pathname !== '/api/songs') {
        unexpected.push(`${method} ${url.pathname}${url.search}`);
        return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
      }
      const settled = await postReply(call);
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
    'the studio frame gives a page no gutter of its own, so the page brings it',
  );
  assert(!container.innerHTML.includes('legacy-frame'), 'the page renders in no legacy frame');
  assert(container.querySelectorAll('h1').length === 1, 'the page has exactly one <h1>');
  assert(textOf(heading(container)) === 'Submit Song', 'the <h1> is "Submit Song"');
  assert(textOf(heading(container).previousElementSibling) === 'CATALOG', 'the crumb reads CATALOG');
  assert(header.querySelector('button, a') === null, 'the header carries no actions: Submit and Cancel sit under the form');

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

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  setCurrentStreamer('mizuki');
  const { default: SubmitSong } = await import('../src/pages/SubmitSong');
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ADMIN_ROUTES, routeElement } = await import('../src/lib/routes');

  // The route sits in the studio frame: the page brings its own header and gutter, no legacy card wraps it.
  const route = need(ADMIN_ROUTES.find((candidate) => candidate.path === '/submit/song'), 'the /submit/song route');
  assert(route.frame === 'studio', '/submit/song is a studio route');
  assert(route.curatorOnly !== true, 'and it stays open to contributors, as POST /api/songs is');
  const framed = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/submit/song']}>
      <Routes>
        <Route path="/submit/song" element={routeElement(route, contributor)} />
      </Routes>
    </MemoryRouter>,
  );
  assert(framed !== '' && !framed.includes('legacy-frame'), 'the route renders with no LegacyFrame around it');
  console.log('✓ Submit Song: its route is a studio route, open to contributors');

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
}

await main();
