import assert from 'node:assert/strict';
import { createElement, useEffect, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { LoadedListRevision } from '../src/hooks/useAuroraSongEditor';
import { useCurrentListLoader } from '../src/hooks/useCurrentListLoader';
import type { ParsedSong } from '../src/lib/parse';

const NOT_ARCHIVED = '這支影片還沒有收錄的歌單';
const LOAD_FAILED = '無法載入目前歌單，請稍後再試';
const REPLACE_CONFIRM = '要用目前歌單取代編輯器裡的內容嗎？';
const LIST_TEXT = '01. 0:01:00 ~ 0:04:30 Song A / Artist A\n02. 0:05:00 Song B / Artist B';

const confirms: string[] = [];
let confirmAnswer = true;
const win = new Window({ url: 'http://localhost/' });
// happy-dom's Window declares no confirm, so the stub is defined on it, as the other suites do.
Object.defineProperty(win, 'confirm', {
  configurable: true,
  writable: true,
  value: (message?: string) => {
    confirms.push(String(message));
    return confirmAnswer;
  },
});
for (const [name, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// A request waits until the test answers it. Like the real fetch, it rejects when its signal aborts,
// unless a scenario switches that off to prove the answer is dropped even by a fetch that ignores it.
interface PendingRequest {
  url: string;
  signal: AbortSignal;
  respond: (body: unknown, status?: number) => void;
  /** Fails the request the way a lost connection does. */
  fail: () => void;
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
      fail: () => reject(new TypeError('Failed to fetch')),
    });
    if (!ignoreAbort) {
      signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }
  });
}
Object.defineProperty(globalThis, 'fetch', { value: fakeFetch, configurable: true, writable: true });

interface Selection {
  streamerSlug: string;
  videoId: string | null;
  videoUrl: string;
  hasSongs: boolean;
}
const initialSelection: Selection = { streamerSlug: 'mizuki', videoId: 'x', videoUrl: 'https://youtu.be/x', hasSongs: false };
let selection = initialSelection;
// What the loader hands the editor: the lists it imports, each with its revision, and the revisions it has the editor
// forget, as [streamerSlug, videoId].
const imports: Array<{ songs: ParsedSong[]; mode: 'replace' | 'append'; revision: LoadedListRevision | null }> = [];
const forgets: Array<[string, string]> = [];
let loader!: ReturnType<typeof useCurrentListLoader>;
function Probe(props: Selection) {
  const value = useCurrentListLoader({
    ...props,
    importSongs: (songs, mode, revision) => { imports.push({ songs, mode, revision: revision ?? null }); },
    forgetListRevision: (streamerSlug, videoId) => { forgets.push([streamerSlug, videoId]); },
  });
  useEffect(() => { loader = value; });
  return null;
}

const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
// Each reset mounts a fresh hook, so no scenario starts with what the one before kept.
let generation = 0;
async function render(next: Partial<Selection> = {}) {
  selection = { ...selection, ...next };
  await act(async () => root.render(createElement(Probe, { ...selection, key: generation })));
}
async function reset() {
  requests = [];
  imports.length = 0;
  forgets.length = 0;
  confirms.length = 0;
  confirmAnswer = true;
  ignoreAbort = false;
  selection = initialSelection;
  generation += 1;
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

// --- The revision of the loaded list -------------------------------------------------------------------------------
// The list goes into the editor with its revision, for the streamer and the video id it was loaded for, and the editor
// keeps that revision with the video's session (tests/session-revision.test.ts). A declined replace and a failed or
// stale load hand the editor nothing; a load that finds no list has the editor forget the revision of that streamer
// and video, and no other, when the URL it asked about names that video.
const R1 = '1'.repeat(64);
const R2 = '2'.repeat(64);
async function loadList(revision: string | undefined, text = LIST_TEXT) {
  await startLoad();
  await answer(revision === undefined ? { archived: true, text } : { archived: true, text, revision });
}
const mizukiX = (revision: string) => ({ streamerSlug: 'mizuki', videoId: 'x', revision });
const handedOver = () => imports.map(({ mode, revision }) => ({ mode, revision }));

// Into an empty editor: the list, with its revision keyed on the video id, not on the URL text.
await reset();
await render({ videoUrl: 'https://www.youtube.com/watch?v=x&t=1' });
await loadList(R1);
assert.deepEqual(handedOver(), [{ mode: 'replace', revision: mizukiX(R1) }]);

// A declined replace hands over nothing; an accepted one the new list with its revision.
await render({ hasSongs: true });
confirmAnswer = false;
await loadList(R2);
assert.equal(imports.length, 1, 'declined: nothing handed over');
confirmAnswer = true;
await loadList(R2);
assert.deepEqual(handedOver().slice(1), [{ mode: 'replace', revision: mizukiX(R2) }]);

// A failed load hands over nothing: a refusal, a server error, a bad body, a lost connection.
for (const fail of [
  () => answer({ error: 'Forbidden' }, 403),
  () => answer({ error: 'boom' }, 500),
  () => answer({ archived: true, text: LIST_TEXT, revision: 42 }),
  () => act(async () => {
    requests[requests.length - 1]!.fail();
    await pending;
  }),
]) {
  await startLoad();
  await fail();
  assert.equal(loader.message, LOAD_FAILED);
}
assert.equal(imports.length, 2);
assert.deepEqual(forgets, []);

// A stale answer hands over nothing: the streamer switched in flight, or the video id did while the URL text stayed the
// same (a URL typed first, 載入 pressed after), even for a fetch that ignores the signal.
await startLoad();
await render({ streamerSlug: 'ichii' });
await act(async () => { await pending; });
await render({ streamerSlug: 'mizuki' });
await startLoad();
await render({ videoId: 'y' });
assert.equal(requests[requests.length - 1]!.signal.aborted, true, 'a new video id cancels the load');
await act(async () => { await pending; });
await render({ videoId: 'x' });
ignoreAbort = true;
await startLoad();
await render({ videoId: 'y' });
await answer({ archived: true, text: LIST_TEXT, revision: R1 });
ignoreAbort = false;
await render({ videoId: 'x' });
assert.equal(imports.length, 2, 'no stale answer handed anything over');
assert.deepEqual(forgets, []);

// Another streamer's list of the video comes with that streamer's revision; a Nova from before revisions gives none.
await render({ streamerSlug: 'ichii' });
await loadList(R1);
assert.deepEqual(imports[2]!.revision, { streamerSlug: 'ichii', videoId: 'x', revision: R1 });
await render({ streamerSlug: 'mizuki' });
await loadList(undefined);
assert.equal(imports.length, 4);
assert.equal(imports[3]!.revision, null);

// A load that finds nothing imports nothing, and has the editor forget its own streamer's revision of its own video:
// not archived, or archived with an empty list.
for (const nothing of [{ archived: false, text: '' }, { archived: true, text: '', revision: R2 }]) {
  forgets.length = 0;
  await startLoad();
  await answer(nothing);
  assert.equal(loader.message, NOT_ARCHIVED);
  assert.equal(imports.length, 4, `${JSON.stringify(nothing)} imports nothing`);
  assert.deepEqual(forgets, [['mizuki', 'x']]);
}
forgets.length = 0;
await render({ streamerSlug: 'ichii', videoId: 'y', videoUrl: 'https://youtu.be/y' });
await startLoad();
await answer({ archived: false, text: '' });
assert.deepEqual(forgets, [['ichii', 'y']], "the load's own streamer and video, never another's");

// The URL field can name another video than the player's before 載入 is pressed. The load asks Nova about that URL, as
// it always has, so finding nothing there says nothing of the player's video: its revision is left as it is. A URL
// that names the player's video, in any spelling, still has the editor forget it.
forgets.length = 0;
await render({ streamerSlug: 'mizuki', videoId: 'x', videoUrl: 'https://www.youtube.com/watch?v=y' });
await startLoad();
assert.equal(
  requests[requests.length - 1]!.url,
  `https://nova.oshi.tw/vod/api/current?streamer_slug=mizuki&url=${encodeURIComponent('https://www.youtube.com/watch?v=y')}`,
  'the load still asks about the URL the field names',
);
await answer({ archived: false, text: '' });
assert.equal(loader.message, NOT_ARCHIVED);
assert.deepEqual(forgets, [], "a load for another video's URL that finds nothing forgets nothing");
await render({ videoUrl: 'https://youtu.be/x' });
await startLoad();
await answer({ archived: true, text: '', revision: R2 });
assert.deepEqual(forgets, [['mizuki', 'x']], "one for the player's own video, spelt youtu.be, still forgets");

// Leaving the page cancels the request.
await reset();
await startLoad();
await act(async () => root.unmount());
assert.equal(requests[0]!.signal.aborted, true);
await pending;
assert.equal(imports.length, 0);

await win.happyDOM.close();
console.log('✓ the current-list loader asks before replacing, drops stale answers, says why it loaded nothing and hands the editor the list with its revision');
