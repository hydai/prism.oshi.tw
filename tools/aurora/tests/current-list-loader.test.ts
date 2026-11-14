import assert from 'node:assert/strict';
import { createElement, useEffect, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useCurrentListLoader } from '../src/hooks/useCurrentListLoader';
import type { ParsedSong } from '../src/lib/parse';

const NOT_ARCHIVED = '這支影片還沒有收錄的歌單';
const LOAD_FAILED = '無法載入目前歌單，請稍後再試';
const REPLACE_CONFIRM = '要用目前歌單取代編輯器裡的內容嗎？';
const LIST_TEXT = '01. 0:01:00 ~ 0:04:30 Song A / Artist A\n02. 0:05:00 Song B / Artist B';

const confirms: string[] = [];
let confirmAnswer = true;
const win = new Window({ url: 'http://localhost/' });
win.confirm = (message?: string) => {
  confirms.push(String(message));
  return confirmAnswer;
};
for (const [name, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// A request waits until the test answers it. Like the real fetch, it rejects when its signal aborts,
// unless a scenario switches that off to prove the answer is dropped even by a fetch that ignores it.
interface PendingRequest {
  url: string;
  signal: AbortSignal;
  respond: (body: unknown, status?: number) => void;
}
let requests: PendingRequest[] = [];
let ignoreAbort = false;
function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = init?.signal as AbortSignal;
    requests.push({
      url: String(input),
      signal,
      respond: (body, status = 200) => resolve(new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })),
    });
    if (!ignoreAbort) {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }
  });
}
Object.defineProperty(globalThis, 'fetch', { value: fakeFetch, configurable: true, writable: true });

interface Selection {
  streamerSlug: string;
  videoUrl: string;
  hasSongs: boolean;
}
const initialSelection: Selection = { streamerSlug: 'mizuki', videoUrl: 'https://youtu.be/x', hasSongs: false };
let selection = initialSelection;
const imports: Array<{ songs: ParsedSong[]; mode: 'replace' | 'append' }> = [];
let loader!: ReturnType<typeof useCurrentListLoader>;
function Probe(props: Selection) {
  const value = useCurrentListLoader({
    ...props,
    importSongs: (songs, mode) => { imports.push({ songs, mode }); },
  });
  useEffect(() => { loader = value; });
  return null;
}

const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
async function render(next: Partial<Selection> = {}) {
  selection = { ...selection, ...next };
  await act(async () => root.render(createElement(Probe, selection)));
}
async function reset() {
  requests = [];
  imports.length = 0;
  confirms.length = 0;
  confirmAnswer = true;
  ignoreAbort = false;
  selection = initialSelection;
  await render();
}
// Starts a load, which leaves its request in flight; `pending` settles when that load is done.
let pending: Promise<void> = Promise.resolve();
async function startLoad() {
  await act(async () => { pending = loader.load(); });
}
// Answers the newest request and waits for the load it belongs to to finish.
async function answer(body: unknown, status = 200) {
  await act(async () => {
    requests[requests.length - 1]!.respond(body, status);
    await pending;
  });
}

await render();

// The request names the streamer and the URL the editor is on; the button is busy until it answers.
await startLoad();
assert.equal(requests.length, 1);
assert.equal(requests[0]!.url, 'https://nova.oshi.tw/vod/api/current?streamer_slug=mizuki&url=https%3A%2F%2Fyoutu.be%2Fx');
assert.equal(loader.loading, true);
await answer({ archived: true, text: LIST_TEXT });
assert.equal(loader.loading, false);

// An archived VOD in an empty editor imports the list, replacing, without asking.
assert.equal(confirms.length, 0);
assert.equal(imports.length, 1);
assert.equal(imports[0]!.mode, 'replace');
assert.deepEqual(
  imports[0]!.songs.map(({ songName, artist, startSeconds, endSeconds }) => ({ songName, artist, startSeconds, endSeconds })),
  [
    { songName: 'Song A', artist: 'Artist A', startSeconds: 60, endSeconds: 270 },
    { songName: 'Song B', artist: 'Artist B', startSeconds: 300, endSeconds: null },
  ],
);
assert.equal(loader.message, null);

// Not archived: say so and touch nothing, even when the editor has songs.
await reset();
await render({ hasSongs: true });
await startLoad();
await answer({ archived: false, text: '' });
assert.equal(loader.message, NOT_ARCHIVED);
assert.equal(imports.length, 0);
assert.equal(confirms.length, 0);

// The note clears when the next load starts, and goes by itself after 8 seconds like the submit banner.
await startLoad();
assert.equal(loader.message, null);
const realSetTimeout = globalThis.setTimeout;
let dismiss: (() => void) | null = null;
globalThis.setTimeout = ((handler: () => void, delay?: number, ...rest: unknown[]) => {
  if (delay === 8000) {
    dismiss = handler;
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }
  return realSetTimeout(handler, delay, ...rest);
}) as typeof setTimeout;
await answer({ archived: false, text: '' });
globalThis.setTimeout = realSetTimeout;
assert.equal(loader.message, NOT_ARCHIVED);
assert.ok(dismiss, 'the note is scheduled to go away after 8 seconds');
await act(async () => dismiss!());
assert.equal(loader.message, null);

// An archived VOD whose public list is empty is nothing to load: never replace the editor with nothing.
await reset();
await render({ hasSongs: true });
await startLoad();
await answer({ archived: true, text: '' });
assert.equal(loader.message, NOT_ARCHIVED);
assert.equal(imports.length, 0);
assert.equal(confirms.length, 0);

// A non-empty editor asks first, with the Aurora copy; cancelling changes nothing.
await reset();
await render({ hasSongs: true });
confirmAnswer = false;
await startLoad();
await answer({ archived: true, text: LIST_TEXT });
assert.deepEqual(confirms, [REPLACE_CONFIRM]);
assert.equal(imports.length, 0);
assert.equal(loader.message, null);
assert.equal(loader.loading, false);

// Confirming replaces.
await reset();
await render({ hasSongs: true });
await startLoad();
await answer({ archived: true, text: LIST_TEXT });
assert.deepEqual(confirms, [REPLACE_CONFIRM]);
assert.equal(imports.length, 1);
assert.equal(imports[0]!.mode, 'replace');

// What the editor holds when the answer arrives decides whether to ask, not what it held at the click.
await reset();
await startLoad();
await render({ hasSongs: true });
await answer({ archived: true, text: LIST_TEXT });
assert.deepEqual(confirms, [REPLACE_CONFIRM]);

// Failures show the short neutral message and import nothing: a refusal, a server error, a bad body.
for (const [body, status] of [[{ error: 'Forbidden' }, 403], [{ error: 'boom' }, 500], [{ archived: 'yes' }, 200]] as const) {
  await reset();
  await startLoad();
  await answer(body, status);
  assert.equal(loader.message, LOAD_FAILED, `status ${status}`);
  assert.equal(imports.length, 0);
  assert.equal(loader.loading, false);
}

// Without a streamer or a video there is nothing to ask; a second click while loading asks nothing more.
await reset();
await render({ streamerSlug: '' });
await act(async () => { await loader.load(); });
await render({ streamerSlug: 'mizuki', videoUrl: '' });
await act(async () => { await loader.load(); });
assert.equal(requests.length, 0);
await render({ videoUrl: 'https://youtu.be/x' });
let second!: Promise<void>;
await act(async () => {
  pending = loader.load();
  second = loader.load();
});
assert.equal(requests.length, 1);
await answer({ archived: false, text: '' });
await act(async () => { await second; });
assert.equal(requests.length, 1);

// Switching streamer mid-flight aborts the request; its answer never lands on the new selection,
// and the button comes free again.
await reset();
await startLoad();
await render({ streamerSlug: 'ichii' });
assert.equal(requests[0]!.signal.aborted, true);
await act(async () => { await pending; });
assert.equal(loader.loading, false);
assert.equal(loader.message, null);
assert.equal(imports.length, 0);

// Even a fetch that ignores the signal cannot land a stale list.
await reset();
ignoreAbort = true;
await startLoad();
await render({ videoUrl: 'https://youtu.be/y' });
await answer({ archived: true, text: LIST_TEXT });
assert.equal(imports.length, 0);
assert.equal(confirms.length, 0);
assert.equal(loader.message, null);
assert.equal(loader.loading, false);

// Leaving the page cancels the request.
await reset();
await startLoad();
await act(async () => root.unmount());
assert.equal(requests[0]!.signal.aborted, true);
await pending;
assert.equal(imports.length, 0);

await win.happyDOM.close();
console.log('✓ the current-list loader asks before replacing, drops stale answers and says why it loaded nothing');
