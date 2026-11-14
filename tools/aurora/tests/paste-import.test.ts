import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { Window } from 'happy-dom';
import AuroraAppView from '../src/components/AuroraAppView';
import type { ParsedSong } from '../src/lib/parse';

// The paste dialog imports into the editor with no revision: a pasted list was not loaded from one, so a replace leaves
// the session without the loaded list's revision, and an append keeps it (tests/session-revision.test.ts). This drives
// the real dialog and checks that its import reaches the editor, in the mode the curator picked, carrying no revision.

const win = new Window({ url: 'http://localhost/' });
for (const [name, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, localStorage: win.localStorage, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
// Loaded only now: react-dom/client decides once, when it is first evaluated, whether a DOM exists. Evaluated before
// the window above, it would treat text fields as IE9-era and never fire onChange for typed text.
const { createRoot } = await import('react-dom/client');

const noop = () => {};
// Every call the editor's importSongs gets, with all its arguments.
const editorImports: unknown[][] = [];

// The view only reads its controllers, so plain stubs stand in for them; no video is loaded, so the dialog sits
// over the landing page.
const view = createElement(AuroraAppView, {
  streamer: { options: [{ slug: 'mizuki', display_name: 'Mizuki', avatar_url: '' }], selected: 'mizuki', onChange: noop },
  video: { url: '', id: null, error: '', onUrlChange: noop, onLoad: noop },
  player: { ref: { current: null }, isPlaying: false, currentTime: 0, onStateChange: noop, onTogglePlay: noop, onSeekBackward: noop, onSeekForward: noop },
  editor: {
    songs: [],
    selectedIndex: null,
    fillingIndex: null,
    bulkFillStatus: null,
    importSongs: (...args: unknown[]) => { editorImports.push(args); },
  },
  shortcuts: { visible: false, onToggle: noop },
  dialogs: { active: 'import', open: noop, close: noop },
  submission: { status: null, submitting: false, isOpen: false },
  currentList: { load: noop, loading: false, message: null },
} as never);

const container = win.document.createElement('div');
win.document.body.appendChild(container);
const root = createRoot(container as unknown as HTMLElement);
await act(async () => root.render(view));

function find(selector: string): HTMLElement {
  const found = container.querySelector(selector);
  assert.ok(found, `the dialog has ${selector}`);
  return found as unknown as HTMLElement;
}
function button(label: string): HTMLElement {
  const found = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label);
  assert.ok(found, `the dialog has a ${label} button`);
  return found as unknown as HTMLElement;
}
// React reads a textarea's typing from its input event, after the value changes through the native setter.
async function paste(text: string) {
  const textarea = find('[data-testid="paste-import-textarea"]');
  const setValue = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(textarea, text);
    textarea.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
  });
}
async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}

// Replace is the dialog's default.
await paste('0:20:00 Song C / Artist C');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual(editorImports.map((args) => args[1]), ['replace']);
assert.deepEqual((editorImports[0]![0] as ParsedSong[]).map(({ songName, artist, startSeconds }) => ({ songName, artist, startSeconds })), [
  { songName: 'Song C', artist: 'Artist C', startSeconds: 1200 },
]);

await click(button('附加'));
await paste('0:30:00 Song D / Artist D');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual(editorImports.map((args) => args[1]), ['replace', 'append']);
assert.deepEqual((editorImports[1]![0] as ParsedSong[]).map(({ songName }) => songName), ['Song D']);
assert.deepEqual(editorImports.map((args) => args.length), [2, 2], 'a pasted list comes with no revision');

// A song missed in the middle of the list and typed below the rows around it. The parser ends a line where the next line
// starts, so the dialog reads the lines in time order: Missed ends where B starts, not where C does, in the preview
// and in what the editor gets.
await paste('0:01:40 ~ 0:03:20 A / a\n0:05:00 ~ 0:06:40 B / b\n0:04:00 Missed / m\n0:08:20 ~ 0:10:00 C / c');
const previewedNames = [...container.querySelectorAll('[data-testid="import-preview-row"]')].map((row) => row.querySelectorAll('td')[1]!.textContent);
assert.deepEqual(previewedNames, ['A', 'Missed', 'B', 'C'], 'the preview lists the rows in time order');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual(editorImports.map((args) => args[1]), ['replace', 'append', 'append']);
assert.deepEqual((editorImports[2]![0] as ParsedSong[]).map(({ songName, startSeconds, endSeconds }) => [songName, startSeconds, endSeconds]), [
  ['A', 100, 200],
  ['Missed', 240, 300],
  ['B', 300, 400],
  ['C', 500, 600],
], 'the import carries the rows in time order, each end filled from the next row in time');

// Rows that start together keep the order they were typed in, and a line the parser cannot read is dropped.
await paste('Setlist\n0:02:00 ~ 0:03:00 First / x\n0:01:00 ~ 0:01:30 Early / x\n\n0:02:00 ~ 0:04:00 Second / x');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual((editorImports[3]![0] as ParsedSong[]).map(({ songName, startSeconds, endSeconds }) => [songName, startSeconds, endSeconds]), [
  ['Early', 60, 90],
  ['First', 120, 180],
  ['Second', 120, 240],
], 'rows that start together stay as typed');

// Appended (附加) below rows the editor holds, a line that gives no end ends where the next row starts in time, the
// editor's rows included: M1 at 0:04:00 ends where B starts, not where M2 does, and M2 where C starts. The editor's
// rows are only read: the import carries the pasted rows alone, and A, B and C keep their ends.
const held = [
  { id: 'a', name: 'A', artist: 'a', startSeconds: 100, endSeconds: 200 },
  { id: 'b', name: 'B', artist: 'b', startSeconds: 300, endSeconds: 400 },
  { id: 'c', name: 'C', artist: 'c', startSeconds: 500, endSeconds: 600 },
];
const heldBefore = structuredClone(held);
const viewProps = view.props as { editor: object };
await act(async () => root.render(createElement(AuroraAppView, { ...viewProps, editor: { ...viewProps.editor, songs: held } } as never)));
const previewedEnds = () => [...container.querySelectorAll('[data-testid="import-preview-row"]')].map((row) => row.querySelectorAll('td')[4]!.textContent);
await click(button('附加'));
await paste('0:04:00 M1 / m\n0:07:00 M2 / m');
assert.deepEqual(previewedEnds(), ['0:05:00', '0:08:20'], 'the preview shows the ends the append fills');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual(editorImports.at(-1)!.slice(1), ['append']);
assert.deepEqual((editorImports.at(-1)![0] as ParsedSong[]).map(({ songName, startSeconds, endSeconds, endTimestamp }) => [songName, startSeconds, endSeconds, endTimestamp]), [
  ['M1', 240, 300, '5:00'],
  ['M2', 420, 500, '8:20'],
], 'each missing end is filled from the next row of the merged list in time');
assert.deepEqual(held, heldBefore, 'A, B and C keep their ends');

// A typed end stays, and a replace fills the ends among the pasted rows alone, as before.
await paste('0:04:00 ~ 0:04:30 M1 / m\n0:07:00 M2 / m');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual((editorImports.at(-1)![0] as ParsedSong[]).map(({ songName, endSeconds }) => [songName, endSeconds]), [['M1', 270], ['M2', 500]], 'a typed end stays');
await click(button('取代'));
await paste('0:04:00 M1 / m\n0:07:00 M2 / m');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual(editorImports.at(-1)!.slice(1), ['replace']);
assert.deepEqual((editorImports.at(-1)![0] as ParsedSong[]).map(({ songName, endSeconds }) => [songName, endSeconds]), [['M1', 420], ['M2', null]], 'a replace fills among the pasted rows');

// Copilot r16: an editor row with no name is not sent (useNovaSubmission skips it), so an append fills no end from it.
// With blank rows at 0:02:30 and 0:03:20 and Named at 0:05:00, a line pasted at 0:01:40 ends where Named starts.
const drafts = [
  { id: 'blank', name: '', artist: '', startSeconds: 150, endSeconds: null },
  { id: 'spaces', name: '   ', artist: '', startSeconds: 200, endSeconds: null },
  { id: 'named', name: 'Named', artist: 'n', startSeconds: 300, endSeconds: 400 },
];
await act(async () => root.render(createElement(AuroraAppView, { ...viewProps, editor: { ...viewProps.editor, songs: drafts } } as never)));
await click(button('附加'));
await paste('0:01:40 Pasted / p');
assert.deepEqual(previewedEnds(), ['0:05:00'], 'the preview ends the pasted line where the named row starts');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual(editorImports.at(-1)!.slice(1), ['append']);
assert.deepEqual((editorImports.at(-1)![0] as ParsedSong[]).map(({ songName, startSeconds, endSeconds }) => [songName, startSeconds, endSeconds]), [
  ['Pasted', 100, 300],
], 'the import ends it there too: a blank editor row ends nothing');

// Copilot r20: a pasted line with no name is left out of the submission as well, so it ends nothing either. Pasted at
// 0:01:40 above a nameless line at 0:03:20, with the blank editor row at 0:02:30 between them, the line ends where
// Named starts: ended at 0:03:20, it would keep that end, since the submission refills an end only from the row right
// below it, the blank editor row. The nameless line is still imported, so the preview warns about it, and it ends where
// Named starts too.
await paste('0:01:40 Pasted / p\n0:03:20 / D / W');
assert.deepEqual(previewedEnds(), ['0:05:00', '0:05:00'], 'the preview ends both lines where the named row starts');
await click(find('[data-testid="import-confirm-button"]'));
assert.deepEqual((editorImports.at(-1)![0] as ParsedSong[]).map(({ songName, startSeconds, endSeconds }) => [songName, startSeconds, endSeconds]), [
  ['Pasted', 100, 300],
  ['', 200, 300],
], 'a nameless pasted line ends no line above it, and is still imported');

// A line with no title: `0:04:10 / D / W` reads as an empty name and the artist D / W (a spaced slash with nothing before
// it), and the submission leaves a row with no name out (useNovaSubmission). The preview says so in the title cell of that
// row, and the artist cell and the other rows read as ever.
await click(button('取代'));
await paste('0:01:40 A / a\n0:04:10 / D / W\n0:05:00 B / b');
const previewColumn = (column: number) => [...container.querySelectorAll('[data-testid="import-preview-row"]')].map((row) => row.querySelectorAll('td')[column]!.textContent);
assert.deepEqual(previewColumn(1), ['A', '這行沒有歌名，送出時會略過', 'B'], 'only the line with no title carries the warning');
assert.deepEqual(previewColumn(2), ['a', 'D / W', 'b'], 'and its artist still shows');

await act(async () => root.unmount());
await win.happyDOM.close();
console.log('✓ the paste dialog imports into the editor with no revision, in the mode the curator picked, reading the lines in time order, an append filling a missing end from the editor\'s rows; the preview warns about a line with no title');
