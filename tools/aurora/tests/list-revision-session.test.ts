import assert from 'node:assert/strict';
import { createElement, useCallback, useEffect, useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useAuroraSongEditor } from '../src/hooks/useAuroraSongEditor';
import { useCurrentListLoader } from '../src/hooks/useCurrentListLoader';
import { useNovaSubmission } from '../src/hooks/useNovaSubmission';

// The editor, the current-list loader and the submission, wired as App.tsx wires them. The revision of a loaded list
// is part of the video's editor session: a session restored after a reload, or after another video's list, sends it;
// a list_changed refusal and a success keep it; a load that finds nothing for a URL naming another video keeps it; a
// tab closed inside the save window never brings back the old list with the new revision; and a storage that refuses
// costs the session nothing: the revision lives in memory, and nothing throws.

const win = new Window({ url: 'http://localhost/' });
Object.defineProperty(win, 'confirm', { configurable: true, writable: true, value: () => true });
for (const [name, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, localStorage: win.localStorage, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
const realStorage = win.localStorage;
function installStorage(descriptor: PropertyDescriptor) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
}
// An error thrown from a timer would otherwise end the run; it is collected instead, and the runner checks after
// every scenario that none was.
const uncaught: string[] = [];
process.on('uncaughtException', (error) => { uncaught.push(String(error)); });

// Turnstile issues a token through the callback the hook registers; this stub issues one whenever a test asks.
const callbacks: Array<(token: string) => void> = [];
Object.defineProperty(win, 'turnstile', {
  configurable: true,
  writable: true,
  value: {
    render: (_element: unknown, options: { callback: (token: string) => void }) => {
      callbacks.push(options.callback);
      return `widget-${callbacks.length}`;
    },
    remove: () => {},
    reset: () => {},
  },
});

const A = 'vidAAAAAAAA';
const B = 'vidBBBBBBBB';
const RA = 'a'.repeat(64);
const RB = 'b'.repeat(64);
const RA2 = 'c'.repeat(64);
const LIST = '01. 0:01:00 ~ 0:04:30 Song A / Artist A';
const LIST_MOVED = '01. 0:01:05 ~ 0:04:30 Song A / Artist A';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
// Nova as the hooks reach it: /vod/api/current answers from `lists` by streamer and video, and /vod/api/submit
// records the body and answers with the scenario's answer.
const lists = new Map<string, unknown>();
const submitted: Array<Record<string, unknown>> = [];
let submitAnswer: () => Response = () => json({ error: 'no_changes' }, 422);
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/vod/api/video-info') return json({});
    if (url.pathname === '/vod/api/current') {
      const videoId = /[?&]v=([\w-]+)/.exec(url.searchParams.get('url') ?? '')?.[1];
      return json(lists.get(`${url.searchParams.get('streamer_slug')}/${videoId}`) ?? { archived: false, text: '' });
    }
    if (url.pathname === '/vod/api/submit') {
      submitted.push(JSON.parse(String(init?.body)));
      return submitAnswer();
    }
    return json({ error: 'unexpected request' }, 404);
  },
});

interface Page {
  editor: ReturnType<typeof useAuroraSongEditor>;
  currentList: ReturnType<typeof useCurrentListLoader>;
  submission: ReturnType<typeof useNovaSubmission>;
  openVideo: (videoId: string) => void;
  /** Types in the URL field, which the contributor may do without pressing 載入: the video stays the one loaded. */
  typeUrl: (url: string) => void;
}
let app!: Page;
// App.tsx, less the player and the view: the URL field's text goes to the loader and the submission as App.tsx gives it
// to them, and 載入 loads the video's session into the editor and makes the video current.
function MiniApp({ streamerSlug }: { streamerSlug: string }) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [vodUrl, setVodUrl] = useState('');
  const editor = useAuroraSongEditor(videoId, { current: null });
  const submission = useNovaSubmission({
    selectedStreamer: streamerSlug,
    songs: editor.songs,
    videoId,
    vodUrl,
    loadedRevision: editor.listRevision,
  });
  const currentList = useCurrentListLoader({
    streamerSlug,
    videoId,
    videoUrl: videoId ? vodUrl || `https://youtube.com/watch?v=${videoId}` : '',
    hasSongs: editor.songs.length > 0,
    importSongs: editor.importSongs,
    forgetListRevision: editor.forgetListRevision,
  });
  const loadVideoSession = editor.loadVideoSession;
  const openVideo = useCallback((nextVideoId: string) => {
    loadVideoSession(nextVideoId);
    setVideoId(nextVideoId);
  }, [loadVideoSession]);
  useEffect(() => { app = { editor, currentList, submission, openVideo, typeUrl: setVodUrl }; });
  return createElement('div', { ref: submission.turnstileContainerRef });
}

const roots: Root[] = [];
// A page load: a fresh app over whatever storage the pages before it left, opened on a video. The pages before it
// stay as they are: a tab that closes runs none of its cleanup, so its pending save never happens.
async function openPage(videoId: string, streamerSlug = 'mizuki') {
  const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
  roots.push(root);
  await act(async () => root.render(createElement(MiniApp, { streamerSlug })));
  await act(async () => app.openVideo(videoId));
}
async function closePages() {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
}
async function loadList() {
  await act(async () => { await app.currentList.load(); });
}
// Past the editor's 500 ms save.
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
}
// Opens the modal, has Turnstile issue a token, submits, and returns the body Nova got.
async function submitList(answer: () => Response = () => json({ error: 'no_changes' }, 422)): Promise<Record<string, unknown>> {
  submitAnswer = answer;
  const before = submitted.length;
  await act(async () => app.submission.open());
  await act(async () => callbacks[callbacks.length - 1]!('token'));
  await act(async () => { await app.submission.submit(); });
  assert.equal(submitted.length, before + 1, 'the submission reached Nova');
  return submitted[before]!;
}

async function aReloadedSessionSendsItsRevision() {
  await openPage(A);
  await loadList();
  await settle();
  await openPage(A);
  assert.equal((await submitList()).base_revision, RA, 'the restored session sends its revision');
  // Under another streamer the same video's session sends none.
  await openPage(A, 'gabu');
  assert.equal('base_revision' in (await submitList()), false, 'not for another streamer');
}

async function eachVideoKeepsItsOwnRevision() {
  // A's list, then B's, then back to A.
  await openPage(A);
  await loadList();
  await act(async () => app.openVideo(B));
  await loadList();
  await act(async () => app.openVideo(A));
  assert.equal((await submitList()).base_revision, RA, "back on A, A's revision");
  await act(async () => app.openVideo(B));
  assert.equal((await submitList()).base_revision, RB, "and on B, B's");
}

async function aRefusalAndASuccessKeepIt() {
  await openPage(A);
  await loadList();
  assert.equal((await submitList(() => json({ error: 'list_changed' }, 409))).base_revision, RA);
  assert.equal((await submitList(() => json({ id: 'vod-1', kind: 'correction' }, 201))).base_revision, RA, 'the resubmit carries it');
  assert.equal((await submitList()).base_revision, RA, 'and so does the one after a success');
  await settle();
  await openPage(A);
  assert.equal((await submitList()).base_revision, RA, 'and a reload still finds it');
}

async function aTabClosedInsideTheSaveWindowKeepsListAndRevisionTogether() {
  await openPage(A);
  await loadList();
  await settle();
  // A curator moves the song; the contributor loads the new list, and the tab closes before the editor saves it.
  lists.set(`mizuki/${A}`, { archived: true, text: LIST_MOVED, revision: RA2 });
  await loadList();
  await openPage(A);
  assert.deepEqual(app.editor.songs.map((song) => song.startSeconds), [60], 'the old list comes back');
  assert.equal((await submitList()).base_revision, RA, "with the old list's revision, never the new one");
}

// A video Nova has no list for.
const UNARCHIVED = 'vidCCCCCCCC';
const urlOf = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

async function aLoadForAnotherVideosUrlKeepsTheRevision() {
  // A's list is loaded and corrected. The URL field is then edited to an unarchived video without pressing 載入, so
  // the player and the editor stay on A, and 載入目前歌單 asks Nova about the URL the field names. Finding nothing
  // there says nothing of A's list: A's revision stays, and goes with A's submit once the URL is back on A.
  await openPage(A);
  await act(async () => app.typeUrl(urlOf(A)));
  await loadList();
  await act(async () => app.editor.updateSong(0, { name: 'Song A (fixed)' }));
  await act(async () => app.typeUrl(urlOf(UNARCHIVED)));
  await loadList();
  assert.equal(app.currentList.message, '這支影片還沒有收錄的歌單', 'Nova has no list for the URL the field names');
  assert.equal(app.editor.songs[0]!.name, 'Song A (fixed)', "the editor keeps A's corrected list");
  assert.deepEqual(app.editor.listRevision, { streamerSlug: 'mizuki', videoId: A, revision: RA }, "and A's revision");
  await act(async () => app.typeUrl(urlOf(A)));
  const sent = await submitList();
  assert.equal(sent.video_url, urlOf(A));
  assert.equal(sent.base_revision, RA, "the revision goes with A's submit");
  // A load for A's own URL that finds nothing still forgets it.
  lists.delete(`mizuki/${A}`);
  await loadList();
  assert.equal(app.editor.listRevision, null, "a load for A's own URL that finds nothing forgets it");
  assert.equal('base_revision' in (await submitList()), false, 'and the next submit goes without it');
}

// A storage that refuses costs the session nothing: in one session the list is loaded, edited and submitted with its
// revision, and nothing throws, not the editor's save, its flush on a video switch, nor closing the page.
const refuse = () => { throw new DOMException('The storage is not available.', 'SecurityError'); };
const refusingStorages: Array<[string, PropertyDescriptor]> = [
  ['every call throws', { value: { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 }, writable: true }],
  ['reaching it throws', { get: refuse }],
];
async function aRefusingStorageStillSendsTheRevision() {
  for (const [label, descriptor] of refusingStorages) {
    installStorage(descriptor);
    try {
      await openPage(A);
      await loadList();
      assert.equal(app.currentList.message, null, `${label}: the list loaded`);
      await act(async () => app.editor.updateSong(0, { name: 'Song A (fixed)' }));
      const sent = await submitList();
      assert.equal(sent.base_revision, RA, `${label}: the revision goes with the edited list`);
      assert.equal((sent.songs as Array<{ song_title: string }>)[0]!.song_title, 'Song A (fixed)');
      await settle();
      await act(async () => app.openVideo(B));
      await closePages();
      assert.deepEqual(uncaught, [], `${label}: nothing threw`);
    } finally {
      installStorage({ value: realStorage, writable: true });
    }
  }
}

const scenarios = [
  aReloadedSessionSendsItsRevision,
  eachVideoKeepsItsOwnRevision,
  aRefusalAndASuccessKeepIt,
  aTabClosedInsideTheSaveWindowKeepsListAndRevisionTogether,
  aLoadForAnotherVideosUrlKeepsTheRevision,
  aRefusingStorageStillSendsTheRevision,
];
let failed = 0;
for (const scenario of scenarios) {
  realStorage.clear();
  uncaught.length = 0;
  lists.clear();
  lists.set(`mizuki/${A}`, { archived: true, text: LIST, revision: RA });
  lists.set(`mizuki/${B}`, { archived: true, text: LIST, revision: RB });
  try {
    await scenario();
    // Its pages are closed first, so that an error thrown from one of its timers, or from the save a close flushes,
    // counts against the scenario too: the listener above collects it, and would otherwise let it pass unseen.
    await closePages();
    assert.deepEqual(uncaught, [], 'nothing threw outside the scenario');
  } catch (error) {
    failed += 1;
    console.error(`✗ ${scenario.name}`);
    console.error(error);
  }
  await closePages();
}
await win.happyDOM.close();
if (failed > 0) {
  console.error(`${failed} of ${scenarios.length} list revision session scenarios failed`);
  process.exitCode = 1;
} else {
  console.log(`✓ a loaded list's revision is part of its video's session: back after a reload or another video, kept by a refusal, a success and an empty load for another video's URL, never restored beside another list, and kept in memory when storage refuses (${scenarios.length} scenarios)`);
}
