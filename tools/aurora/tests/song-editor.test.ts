import assert from 'node:assert/strict';
import { createElement, useEffect, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useAuroraSongEditor } from '../src/hooks/useAuroraSongEditor';
import { applyDuration } from '../src/lib/duration-update';
import type { fetchItunesDuration } from '../src/lib/itunes';

const win = new Window({ url: 'http://localhost/' });
for (const [name, value] of Object.entries({ window: win, document: win.document, localStorage: win.localStorage, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
let finishFetch!: (response: Awaited<ReturnType<typeof fetchItunesDuration>>) => void;
const lookup: typeof fetchItunesDuration = async () => new Promise(resolve => { finishFetch = resolve; });
const found = { durationSec: 60 } as Awaited<ReturnType<typeof fetchItunesDuration>>;
let editor!: ReturnType<typeof useAuroraSongEditor>;
const player = { current: null };
function Probe() {
  const value = useAuroraSongEditor('video-a', player, lookup);
  useEffect(() => { editor = value; });
  return null;
}
const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
await act(async () => root.render(createElement(Probe)));
const initial = [
  { songName: 'A', artist: 'Artist A', startSeconds: 10, endSeconds: null },
  { songName: 'B', artist: 'Artist B', startSeconds: 100, endSeconds: null },
];
await act(async () => editor.importSongs(initial, 'replace'));
let filling!: Promise<void>;
await act(async () => { filling = editor.fillDuration(0); });
await act(async () => editor.deleteSong(0));
await act(async () => {
  finishFetch(found);
  await filling;
});
assert.equal(editor.songs[0].name, 'B');
assert.equal(editor.songs[0].endSeconds, null, 'deleting the target never applies its duration to the next row');

// Cached lookup still yields a promise; switching sessions in the same event
// must invalidate its eventual result before it can touch the replacement list.
await act(async () => editor.importSongs(initial, 'replace'));
await act(async () => {
  filling = editor.fillDuration(0);
  editor.loadVideoSession('video-b');
  finishFetch(found);
  await filling;
});
assert.deepEqual(editor.songs, [], 'a previous video cannot populate the new session');
const target = { id: 'a', name: 'A', artist: 'Artist', startSeconds: 10, endSeconds: null };
assert.equal(applyDuration([{ ...target, startSeconds: 20 }], target, 60)[0].endSeconds, null, 'manual edits made while fetching win');
assert.equal(applyDuration([{ ...target, endSeconds: 40 }], target, 60)[0].endSeconds, 40, 'manual end stamp wins');
assert.equal(applyDuration([{ ...target, id: 'b' }, target], target, 60)[1].endSeconds, 70, 'reordered target is updated by ID');
await act(async () => root.unmount());
await win.happyDOM.close();
console.log('✓ duration updates survive deletion, reordering, manual edits and session switches');
