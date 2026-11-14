import assert from 'node:assert/strict';
import { createElement, useCallback, useEffect, useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useAuroraSongEditor, type LoadedListRevision } from '../src/hooks/useAuroraSongEditor';
import { parseTextToSongs } from '../src/lib/parse';

// The editor's session of a video is its list and the revision of the list it was loaded from. One save writes both,
// with the revision naming the list record it goes with, and a session comes back with the revision only beside that
// very list. A restored session therefore never pairs a list with a revision it was not saved with: not after a tab
// closed inside the 500 ms save window, nor after a save cut short or a list written by anything else; and a revision
// comes back only when it reads as one. In memory the revision lives for the session whatever the storage does, and no
// storage error breaks the editor.

const win = new Window({ url: 'http://localhost/' });
const answerConfirm = (answer: boolean) => Object.defineProperty(win, 'confirm', { configurable: true, writable: true, value: () => answer });
answerConfirm(true);
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

const A = 'vidAAAAAAAA';
const B = 'vidBBBBBBBB';
const R1 = '1'.repeat(64);
const R2 = '2'.repeat(64);
const L1 = parseTextToSongs('0:01:00 Song A / Artist A\n0:05:00 Song B / Artist B');
const L2 = parseTextToSongs('0:01:05 Song A / Artist A\n0:05:00 Song B / Artist B');
const at = (revision: string, videoId = A, streamerSlug = 'mizuki'): LoadedListRevision => ({ streamerSlug, videoId, revision });

// What App does with the editor: 載入 loads the video's session and makes the video the editor's, in one event.
let page!: { editor: ReturnType<typeof useAuroraSongEditor>; openVideo: (videoId: string) => void };
function MiniApp() {
  const [videoId, setVideoId] = useState<string | null>(null);
  const editor = useAuroraSongEditor(videoId, { current: null });
  const loadVideoSession = editor.loadVideoSession;
  const openVideo = useCallback((nextVideoId: string) => {
    loadVideoSession(nextVideoId);
    setVideoId(nextVideoId);
  }, [loadVideoSession]);
  useEffect(() => { page = { editor, openVideo }; });
  return null;
}
const roots: Root[] = [];
// A page opened on a video, over whatever storage the pages before it left. Pages before it stay as they are: a tab
// that closes runs none of its cleanup, so its pending save never happens.
async function openPage(videoId: string) {
  const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
  roots.push(root);
  await act(async () => root.render(createElement(MiniApp)));
  await act(async () => page.openVideo(videoId));
}
async function closePages() {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
}
// Past the editor's 500 ms save.
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
}
const starts = () => page.editor.songs.map((song) => song.startSeconds);

async function aSessionComesBackWithItsRevision() {
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  assert.deepEqual(page.editor.listRevision, at(R1));
  await settle();
  await openPage(A);
  assert.deepEqual(starts(), [60, 300]);
  assert.deepEqual(page.editor.listRevision, at(R1), 'the list comes back with its revision');
  // An edit is a correction of that list: the revision stays with it, through a save and a reload.
  await act(async () => page.editor.updateSong(0, { name: 'Song A (fixed)' }));
  await settle();
  await openPage(A);
  assert.equal(page.editor.songs[0]!.name, 'Song A (fixed)');
  assert.deepEqual(page.editor.listRevision, at(R1));
}

async function aSessionSavedBeforeRevisionsComesBackWithout() {
  const song = { id: 'old', name: 'Song A', artist: 'Artist A', startSeconds: 60, endSeconds: 270 };
  realStorage.setItem(`aurora:${A}`, JSON.stringify([song]));
  await openPage(A);
  assert.deepEqual(page.editor.songs, [song]);
  assert.equal(page.editor.listRevision, null);
}

async function eachVideoKeepsItsOwnRevision() {
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  await act(async () => page.openVideo(B));
  assert.equal(page.editor.listRevision, null, 'B has none of its own yet');
  await act(async () => page.editor.importSongs(L2, 'replace', at(R2, B)));
  await act(async () => page.openVideo(A));
  assert.deepEqual(starts(), [60, 300]);
  assert.deepEqual(page.editor.listRevision, at(R1), "A's session comes back with A's revision");
  await act(async () => page.openVideo(B));
  assert.deepEqual(starts(), [65, 300]);
  assert.deepEqual(page.editor.listRevision, at(R2, B));
}

async function theRulesActOnTheSavedSession() {
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  // An append keeps it: the rows it adds are edits of the list the editor holds, through a save and a reload.
  await act(async () => page.editor.importSongs(parseTextToSongs('0:09:00 Song C / Artist C'), 'append'));
  assert.deepEqual(page.editor.listRevision, at(R1), 'kept by an append');
  await settle();
  await openPage(A);
  assert.deepEqual(starts(), [60, 300, 540]);
  assert.deepEqual(page.editor.listRevision, at(R1), 'and by the saved session');
  // 清除 forgets it: the list it was loaded as is gone, and rows stamped by hand afterwards are no correction of it, so
  // sent with it they would be refused once the archive changed. A declined 清除 changes nothing.
  answerConfirm(false);
  await act(async () => page.editor.clearSongs());
  answerConfirm(true);
  assert.deepEqual(starts(), [60, 300, 540], 'a declined 清除 keeps the list');
  assert.deepEqual(page.editor.listRevision, at(R1), 'and its revision');
  await act(async () => page.editor.clearSongs());
  assert.deepEqual(starts(), []);
  assert.equal(page.editor.listRevision, null, '清除 forgets the revision');
  await settle();
  assert.equal(realStorage.getItem(`aurora:revision:${A}`), null, 'and the saved session drops its record');
  await openPage(A);
  assert.deepEqual(starts(), []);
  assert.equal(page.editor.listRevision, null, 'so it comes back without the revision');
  // Rows stamped by hand after that have none either, through a save and a reload.
  await act(async () => page.editor.addSong());
  await act(async () => page.editor.addSong());
  await settle();
  await openPage(A);
  assert.equal(page.editor.songs.length, 2);
  assert.equal(page.editor.listRevision, null, 'a list built from scratch after 清除 holds none');
  // A load that found nothing forgets it only for its own streamer and video.
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  await act(async () => page.editor.forgetListRevision('ichii', A));
  await act(async () => page.editor.forgetListRevision('mizuki', B));
  assert.deepEqual(page.editor.listRevision, at(R1), "another streamer's, or another video's, empty load leaves it");
  await act(async () => page.editor.forgetListRevision('mizuki', A));
  assert.equal(page.editor.listRevision, null);
  await settle();
  await openPage(A);
  assert.equal(page.editor.listRevision, null, 'and the session is saved without it');
  // A replace with no revision, a pasted list, forgets it; a replace with one takes it, key and all.
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1, A, 'ichii')));
  assert.deepEqual(page.editor.listRevision, at(R1, A, 'ichii'));
  await act(async () => page.editor.importSongs(L2, 'replace'));
  assert.equal(page.editor.listRevision, null);
  await settle();
  await openPage(A);
  assert.deepEqual(starts(), [65, 300]);
  assert.equal(page.editor.listRevision, null);
}

async function aRestoredListNeverPairsWithAnotherListsRevision() {
  // The tab closes inside the save window that follows a replace: the reopened session is the old list with the old
  // list's revision, never the old list with the new one.
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  await settle();
  await act(async () => page.editor.importSongs(L2, 'replace', at(R2)));
  await openPage(A);
  assert.deepEqual(starts(), [60, 300], 'the new list was not saved yet');
  assert.deepEqual(page.editor.listRevision, at(R1), "so the old list comes back with the old list's revision");
  await closePages();

  // A list written without its revision, as an older Aurora or another tab would: the revision no longer names it.
  realStorage.clear();
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  await settle();
  const edited = JSON.parse(realStorage.getItem(`aurora:${A}`)!) as Array<{ name: string }>;
  edited[0]!.name = 'Song A (edited elsewhere)';
  realStorage.setItem(`aurora:${A}`, JSON.stringify(edited));
  await openPage(A);
  assert.equal(page.editor.songs[0]!.name, 'Song A (edited elsewhere)');
  assert.equal(page.editor.listRevision, null, 'a list the revision was not saved with comes back without it');
  await closePages();

  // A save cut short: the list is written, its revision is not. The revision left from the last save names another list.
  realStorage.clear();
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  await settle();
  installStorage({
    value: {
      getItem: (key: string) => realStorage.getItem(key),
      removeItem: (key: string) => realStorage.removeItem(key),
      setItem: (key: string, value: string) => {
        if (key.startsWith('aurora:revision:')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        realStorage.setItem(key, value);
      },
    },
    writable: true,
  });
  try {
    await act(async () => page.editor.importSongs(L2, 'replace', at(R2)));
    await settle();
  } finally {
    installStorage({ value: realStorage, writable: true });
  }
  await openPage(A);
  assert.deepEqual(starts(), [65, 300], 'the new list was saved');
  assert.equal(page.editor.listRevision, null, 'without the old revision, which names the old list');

  // A value that is not a revision comes back as none.
  for (const corrupt of ['{not json', '{"streamerSlug":"mizuki","revision":"x"}', '{"streamerSlug":1,"revision":"x","list":"y"}', 'null']) {
    realStorage.setItem(`aurora:revision:${A}`, corrupt);
    await openPage(A);
    assert.equal(page.editor.listRevision, null, `saved ${corrupt}`);
  }
}

async function aRestoredRevisionMustReadAsOne() {
  // A record saved beside its very list must still read as a revision: 64 lowercase hex characters, as Nova gives one,
  // for a streamer with a name. One that does not (written by a later build, or edited by hand) brings its list back
  // without a revision, rather than have it sent as base_revision, which Nova would refuse.
  await openPage(A);
  await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
  await settle();
  const listRecord = realStorage.getItem(`aurora:${A}`)!;
  const saved = JSON.parse(realStorage.getItem(`aurora:revision:${A}`)!) as Record<string, unknown>;
  // Each restore puts back the very list the record names, so only the one field a case changes decides.
  const restoreWith = async (record: Record<string, unknown>) => {
    await closePages();
    realStorage.setItem(`aurora:${A}`, listRecord);
    realStorage.setItem(`aurora:revision:${A}`, JSON.stringify(record));
    await openPage(A);
  };
  await restoreWith(saved);
  assert.deepEqual(page.editor.listRevision, at(R1), 'the record as saved restores its revision');
  const cases: Array<[string, Record<string, unknown>]> = [
    ['an upper-case revision', { revision: 'A'.repeat(64) }],
    ['a revision of 63 characters', { revision: '1'.repeat(63) }],
    ['a revision of 65 characters', { revision: '1'.repeat(65) }],
    ['a revision that is not hex', { revision: 'g'.repeat(64) }],
    ['a revision with a line break after it', { revision: `${R1}\n` }],
    ['an empty revision', { revision: '' }],
    ['no revision', { revision: undefined }],
    ['an empty streamer', { streamerSlug: '' }],
    ['no streamer', { streamerSlug: undefined }],
  ];
  for (const [label, change] of cases) {
    await restoreWith({ ...saved, ...change });
    assert.deepEqual(starts(), [60, 300], `${label}: the list comes back`);
    assert.equal(page.editor.listRevision, null, `${label}: without a revision`);
  }
}

// A storage that refuses: the session keeps its revision in memory, and nothing throws, not the editor's save, its
// flush on a video switch, nor closing the page. Nothing could be saved, so a reload finds nothing.
const refuse = () => { throw new DOMException('The storage is not available.', 'SecurityError'); };
const refusingStorages: Array<[string, PropertyDescriptor]> = [
  ['every call throws', { value: { getItem: refuse, setItem: refuse, removeItem: refuse, clear: refuse, key: refuse, length: 0 }, writable: true }],
  ['reaching it throws', { get: refuse }],
];
async function aRefusingStorageKeepsTheSessionInMemory() {
  for (const [label, descriptor] of refusingStorages) {
    installStorage(descriptor);
    try {
      await openPage(A);
      await act(async () => page.editor.importSongs(L1, 'replace', at(R1)));
      await act(async () => page.editor.updateSong(0, { name: 'Song A (fixed)' }));
      await settle();
      assert.deepEqual(page.editor.listRevision, at(R1), `${label}: kept in memory`);
      assert.equal(page.editor.songs[0]!.name, 'Song A (fixed)');
      await act(async () => page.openVideo(B));
      await closePages();
      await openPage(A);
      assert.equal(page.editor.listRevision, null, `${label}: nothing was saved`);
      await closePages();
      assert.deepEqual(uncaught, [], `${label}: nothing threw`);
    } finally {
      installStorage({ value: realStorage, writable: true });
    }
  }
}

const scenarios = [
  aSessionComesBackWithItsRevision,
  aSessionSavedBeforeRevisionsComesBackWithout,
  eachVideoKeepsItsOwnRevision,
  theRulesActOnTheSavedSession,
  aRestoredListNeverPairsWithAnotherListsRevision,
  aRestoredRevisionMustReadAsOne,
  aRefusingStorageKeepsTheSessionInMemory,
];
let failed = 0;
for (const scenario of scenarios) {
  realStorage.clear();
  uncaught.length = 0;
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
  console.error(`${failed} of ${scenarios.length} editor session revision scenarios failed`);
  process.exitCode = 1;
} else {
  console.log(`✓ the editor saves a list and its revision in one save and restores them only together, a revision only when it reads as one; a refusing storage keeps the revision in memory and breaks nothing (${scenarios.length} scenarios)`);
}
