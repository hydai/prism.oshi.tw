import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser, ListResponse, StampPerformance, StampStats, StreamWithPending } from '../../shared/types';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { StampEditorView } from '../src/pages/StampEditor';
import type { StampEditorController } from '../src/pages/StampEditor';
import StampEditorPage from '../src/pages/StampEditor';
import { InlineEdit } from '../src/components/stamp/InlineEdit';
import { StampConsole } from '../src/components/workbench/StampConsole';
import { WorkbenchCard } from '../src/components/workbench/WorkbenchCard';
import { handleInlineEditKeyDown } from '../src/lib/inline-edit';
import { handleEditorShortcut } from '../src/hooks/useEditorShortcuts';
import type { EditorShortcutEvent, EditorShortcutHandlers } from '../src/hooks/useEditorShortcuts';
import { installIntersectionObserverStub } from './helpers/dom';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const asyncNoop = async () => {};
const noop = () => {};

const selectedStream: StreamWithPending = {
  id: 'stream-current',
  streamerId: 'mizuki',
  title: 'Current Karaoke Stream',
  date: '2026-08-17',
  videoId: 'video-current',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-current',
  credit: {},
  status: 'approved',
  submittedBy: null,
  reviewedBy: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  pendingCount: 1,
};

const olderStream: StreamWithPending = {
  ...selectedStream,
  id: 'stream-older',
  title: 'Older Karaoke Stream',
  date: '2025-12-31',
  videoId: 'video-older',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-older',
  pendingCount: 0,
};

const performances: StampPerformance[] = [
  {
    id: 'performance-one',
    songId: 'song-one',
    title: 'First Song',
    originalArtist: 'First Artist',
    timestamp: 65,
    endTimestamp: 245,
    note: '',
    status: 'pending',
  },
  {
    id: 'performance-two',
    songId: 'song-two',
    title: 'Second Song',
    originalArtist: '',
    timestamp: 3700,
    endTimestamp: null,
    note: '',
    status: 'approved',
  },
];

const controller: StampEditorController = {
  user: { email: 'curator@example.com', role: 'curator' },
  streamSearch: '',
  setStreamSearch: noop,
  streamYearFilter: '',
  setStreamYearFilter: noop,
  selectedStreamId: selectedStream.id,
  performances,
  selectedIndex: 0,
  setSelectedIndex: noop,
  showAddModal: false,
  setShowAddModal: noop,
  showPasteImport: false,
  setShowPasteImport: noop,
  editingField: null,
  setEditingField: noop,
  loading: false,
  stampStats: { total: 2, filled: 1, remaining: 1 },
  statsUnavailable: false,
  pickerOpen: false,
  setPickerOpen: noop,
  shortcutsOpen: false,
  setShortcutsOpen: noop,
  fetchLog: [],
  clearFetchLog: noop,
  playerRef: React.createRef<YouTubePlayerHandle>(),
  playerBoxRef: React.createRef<HTMLDivElement>(),
  selectedStream,
  streamYears: ['2026', '2025'],
  filteredStreams: [selectedStream, olderStream],
  selectStream: noop,
  selectAdjacentStream: noop,
  markStartTimestamp: asyncNoop,
  markEndTimestamp: asyncNoop,
  seekToStart: noop,
  seekToEnd: noop,
  seekTo: noop,
  clearEndTimestamp: asyncNoop,
  deletePerformance: asyncNoop,
  handleAddSong: asyncNoop,
  handlePasteImportDone: asyncNoop,
  handleInlineEditSave: asyncNoop,
  exportSongList: noop,
  clearAllEndTimestampsAction: asyncNoop,
  approveAllAction: asyncNoop,
};

function renderView(overrides: Partial<StampEditorController> = {}): string {
  return renderToStaticMarkup(
    <StampEditorView controller={{ ...controller, ...overrides }} />,
  );
}

const html = renderView();
assert(html.includes('Current Karaoke Stream'), 'the selected stream remains visible in the picker');
assert(html.includes('Older Karaoke Stream'), 'other filtered streams remain visible');
assert(html.includes('Filter streams by year'), 'year filter remains visible for multiple years');
assert(html.includes('Search streams'), 'stream search remains visible');
assert(html.includes('aria-pressed="true"'), 'the selected song row retains its pressed state');
assert(
  /<li[^>]*role="option"[^>]*aria-selected="true"[^>]*title="Current Karaoke Stream"/.test(html)
    && /<li[^>]*role="option"[^>]*aria-selected="false"[^>]*title="Older Karaoke Stream"/.test(html),
  "the picker marks the selected stream's option, and only it, aria-selected",
);
assert(html.includes('1/2') && html.includes('(1 remaining)'), 'stamp statistics remain visible');
assert(html.includes('1 unstamped'), 'unstamped song count remains visible');
assert(html.includes('First Song') && html.includes('Second Song'), 'all song rows remain visible');
assert(html.includes('1:05') && html.includes('4:05') && html.includes('1:01:40'), 'song timestamps retain their format');
assert(html.includes('Approve All'), 'curators retain bulk approval');
assert(html.includes('Clear All') && html.includes('Paste Import') && html.includes('Add Song'), 'song actions remain visible');
assert(html.includes('Double-click or press F2 to edit title'), 'keyboard editing affordance remains visible');

// Below 640px neither describes anything a touch phone can act on: hidden via `max-sm:hidden`
// (still in the DOM, never `hidden`'s all-widths removal), visible again from 640px up.
const keyboardShortcutsButtonTag = /<button[^>]*aria-label="Keyboard shortcuts"[^>]*>/.exec(html)?.[0];
assert(keyboardShortcutsButtonTag !== undefined, 'the header keyboard-shortcuts button renders');
assert(
  keyboardShortcutsButtonTag.includes('max-sm:hidden'),
  'the header "Keyboard shortcuts" button is hidden below 640px',
);
assert(
  html.includes('<div class="mt-auto max-sm:hidden">'),
  'the ShortcutHints row is hidden below 640px, its mt-auto moved up so it still sticks to the bottom from 640px up',
);

const contributorHtml = renderView({
  user: { email: 'contributor@example.com', role: 'contributor' },
});
assert(!contributorHtml.includes('Approve All'), 'contributors do not see curator bulk approval');

const loadingHtml = renderView({ loading: true });
assert(loadingHtml.includes('Loading...'), 'song loading state remains intact');

const emptyHtml = renderView({ performances: [], selectedIndex: -1 });
assert(emptyHtml.includes('No songs in this stream'), 'empty song state remains intact');

/** The opening tag of the song-actions menu item labelled `label`. */
function menuItemTag(markup: string, label: string): string {
  const item = markup.match(/<button[^>]*role="menuitem"[^>]*>.*?<\/button>/g)?.find((button) => button.includes(`>${label}<`));
  return /^<button[^>]*>/.exec(item ?? '')?.[0] ?? '';
}
// Clear All has nothing to clear until a row has an end timestamp: no confirm, no DELETE for nothing.
assert(
  menuItemTag(html, 'Clear All') !== '' && !menuItemTag(html, 'Clear All').includes('disabled=""'),
  'Clear All is enabled while a row has an end timestamp',
);
const noEndsHtml = renderView({ performances: performances.map((perf) => ({ ...perf, endTimestamp: null })) });
assert(menuItemTag(noEndsHtml, 'Clear All').includes('disabled=""'), 'Clear All is disabled when no row has an end timestamp');
assert(menuItemTag(emptyHtml, 'Clear All').includes('disabled=""'), 'Clear All is disabled on a stream with no songs');

const addModalHtml = renderView({ showAddModal: true });
assert(addModalHtml.includes('Song title *'), 'add-song modal remains wired to page state');

const pasteModalHtml = renderView({ showPasteImport: true });
assert(pasteModalHtml.includes('Paste a timestamp list'), 'paste-import modal remains wired to page state');
assert(
  pasteModalHtml.includes('Replace existing performances (delete current songs first)'),
  'StampEditor keeps its own replace-mode wording after the modal is shared',
);
assert(
  pasteModalHtml.includes('7:20 Third Song'),
  'StampEditor keeps its three-line paste example after the modal is shared',
);

const unselectedHtml = renderView({
  selectedStreamId: null,
  selectedStream: undefined,
});
assert(unselectedHtml.includes('Select a stream to start stamping'), 'initial selection prompt remains intact');
assert(!unselectedHtml.includes('Songs in selected stream'), 'song list stays hidden until a stream is selected');

const statsDownHtml = renderView({ statsUnavailable: true });
assert(
  statsDownHtml.includes('Stats unavailable') && !statsDownHtml.includes('(1 remaining)'),
  'a failed stats load reads "Stats unavailable" in the picker, not stale numbers',
);

/** Every element of a hook-free tree, through `children` and element-valued props (`action`, `actions`). */
function elementsIn(node: React.ReactNode, found: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsIn(child, found);
    return found;
  }
  if (!React.isValidElement(node)) return found;
  found.push(node);
  for (const value of Object.values(node.props as Record<string, unknown>)) {
    if (Array.isArray(value) || React.isValidElement(value)) elementsIn(value as React.ReactNode, found);
  }
  return found;
}

const pickerOpenRequests: React.SetStateAction<boolean>[] = [];
const emptyTree = StampEditorView({
  controller: {
    ...controller,
    selectedStreamId: null,
    selectedStream: undefined,
    setPickerOpen: (open) => { pickerOpenRequests.push(open); },
  },
});
const chooseStream = elementsIn(emptyTree).find(
  (element) => (element.props as { children?: unknown }).children === 'Choose a stream',
);
assert(chooseStream !== undefined, 'the empty state offers a "Choose a stream" button');
(chooseStream.props as { onClick: () => void }).onClick();
assert(pickerOpenRequests.length === 1 && pickerOpenRequests[0] === true, '"Choose a stream" opens the stream picker');

// The console's End-slot Seek is the `e` shortcut's 5 s preview, as its label and key cap say
// (tests/workbench.test.tsx pins those) — not the exact-end `E`. StampConsole now renders inside
// the shared WorkbenchCard, so this walks StampEditorView's tree to the WorkbenchCard element,
// renders that component to reach its own StampConsole element, then fires onSeekEnd.
const seekEndOffsets: number[] = [];
const consoleTree = StampEditorView({
  controller: { ...controller, seekToEnd: (offsetSeconds) => { seekEndOffsets.push(offsetSeconds); } },
});
const workbenchCardElement = elementsIn(consoleTree).find((element) => element.type === WorkbenchCard);
assert(workbenchCardElement !== undefined, 'the view renders the WorkbenchCard');
const workbenchCardTree = componentOf(workbenchCardElement.type)(workbenchCardElement.props);
const stampConsole = elementsIn(workbenchCardTree).find((element) => element.type === StampConsole);
assert(stampConsole !== undefined, 'the WorkbenchCard renders the StampConsole');
(stampConsole.props as { onSeekEnd: () => void }).onSeekEnd();
assert(seekEndOffsets.join() === '5', `the console's End-slot Seek seeks 5 s before the end, got offsets [${seekEndOffsets.join()}]`);

// --- Inline edit: StampEditor still refuses to save a field that was emptied ---

function commitInlineEdit(text: string, allowEmpty: boolean, key = 'Enter'): { saved: string[]; cancels: number } {
  const saved: string[] = [];
  let cancels = 0;
  handleInlineEditKeyDown(
    { key, preventDefault: noop },
    { text, value: 'First Song', allowEmpty, onSave: (val) => saved.push(val), onCancel: () => { cancels += 1; } },
  );
  return { saved, cancels };
}

const renamed = commitInlineEdit('  Renamed Song  ', false);
assert(renamed.saved.join() === 'Renamed Song' && renamed.cancels === 0, 'Enter saves a changed title, trimmed');

const emptied = commitInlineEdit('   ', false);
assert(emptied.saved.length === 0 && emptied.cancels === 1, 'emptying a StampEditor field cancels instead of saving');

const unchanged = commitInlineEdit('First Song', false);
assert(unchanged.saved.length === 0 && unchanged.cancels === 1, 'an unchanged title cancels');

const escaped = commitInlineEdit('Renamed Song', false, 'Escape');
assert(escaped.saved.length === 0 && escaped.cancels === 1, 'Escape abandons the edit');

// The shared field renders inside the rebuilt rows, so it takes the Studio tokens, not raw blue.
const inlineEditHtml = renderToStaticMarkup(<InlineEdit value="First Song" onSave={noop} onCancel={noop} />);
assert(
  !/\b(bg|text|border|ring)-(slate|gray|blue|green|red|amber|yellow)-\d/.test(inlineEditHtml),
  'InlineEdit uses no raw Tailwind palette classes',
);
assert(inlineEditHtml.includes('border-accent-fg') && inlineEditHtml.includes('bg-field'), 'InlineEdit draws with Studio tokens');

// At lg an idle row that is not selected floats its actions over the end of its title. A row being
// edited (F2 on a row that is not the selected one) keeps them in the row instead, so the overlay
// its focus reveals never covers the inline editor.
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
assert(occurrences(html, 'lg:absolute') === 1, 'the idle unselected row floats its actions at lg; the selected row does not');
const editingOtherRowHtml = renderView({ editingField: { index: 1, field: 'title' } });
assert(!editingOtherRowHtml.includes('lg:absolute'), 'the row being edited keeps its actions in the row, clear of the editor');

// The `allowEmpty` opt-in lives at the call site, so walk the rendered tree of the page's own
// song list and take the exact props it hands the shared component.
interface InlineEditCallProps {
  value: string;
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
}

/**
 * `memo(Component)` is an object whose `.type` is the function, so a walker that reads `type.name`
 * or calls `type(props)` has to see through it — otherwise it silently stops matching the moment a
 * component is memoized.
 */
type RenderFunction = ((props: unknown) => React.ReactNode) & { name?: string };

function componentOf(type: React.ReactElement['type']): RenderFunction {
  const memoized = type as { $$typeof?: symbol; type?: unknown };
  return (memoized.$$typeof === Symbol.for('react.memo') ? memoized.type : type) as RenderFunction;
}

function inlineEditProps(tree: React.ReactNode, componentName: string): InlineEditCallProps[] {
  const seen: React.ReactElement[] = [];
  const walk = (node: React.ReactNode): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!React.isValidElement(node)) return;
    seen.push(node);
    walk((node.props as { children?: React.ReactNode }).children);
  };

  walk(tree);
  const host = seen.find((element) => componentOf(element.type).name === componentName);
  assert(host !== undefined, `${componentName} renders inside the page view`);
  seen.length = 0;
  walk(componentOf(host.type)(host.props));
  return seen.filter((element) => element.type === InlineEdit).map((element) => element.props as InlineEditCallProps);
}

const savedTitles: string[] = [];
let titleEditsCancelled = 0;
const editedSongList = StampEditorView({
  controller: {
    ...controller,
    editingField: { index: 0, field: 'title' },
    handleInlineEditSave: async (index, field, value) => { savedTitles.push(`${index}:${field}:${value}`); },
    setEditingField: () => { titleEditsCancelled += 1; },
  },
});
const stampInlineEdits = inlineEditProps(editedSongList, 'SongList');
assert(stampInlineEdits.length === 1, 'the edited song row renders one shared InlineEdit');
assert(!stampInlineEdits[0]?.allowEmpty, 'StampEditor rows never opt into empty saves');

// Drive the props the page actually handed the shared component — no `allowEmpty` among them — so the
// handler's own default is what decides. Emptying the title must reach `onCancel`, never `onSave`.
const titleRow = stampInlineEdits[0]!;
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...titleRow, text: '   ' });
assert(
  savedTitles.length === 0 && titleEditsCancelled === 1,
  'a StampEditor row left empty cancels the edit instead of saving a blank title',
);

handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...titleRow, text: '  Renamed Song  ' });
assert(savedTitles.join() === '0:title:Renamed Song', 'a StampEditor row still saves a real rename, trimmed');

// --- Keyboard shortcuts: the shared dispatcher, and StampEditor's new modal guard ---

const fired: string[] = [];
const seeked: number[] = [];
let prevented = 0;

const shortcutHandlers: EditorShortcutHandlers = {
  markEndTimestamp: () => fired.push('markEndTimestamp'),
  markStartTimestamp: () => fired.push('markStartTimestamp'),
  seekToStart: () => fired.push('seekToStart'),
  seekToEnd: (offsetSeconds: number) => fired.push(`seekToEnd:${offsetSeconds}`),
  selectNext: () => fired.push('selectNext'),
  selectPrev: () => fired.push('selectPrev'),
  copyVideoUrl: () => fired.push('copyVideoUrl'),
  fetchDuration: () => fired.push('fetchDuration'),
  fetchAllDurations: () => fired.push('fetchAllDurations'),
  exportSongList: () => fired.push('exportSongList'),
  openPasteImport: () => fired.push('openPasteImport'),
};

const shortcutPlayerRef: React.RefObject<YouTubePlayerHandle | null> = {
  current: {
    getCurrentTime: () => 100,
    seekTo: (seconds: number) => seeked.push(seconds),
    loadVideo: noop,
  },
};

function keyEvent(key: string, tagName = 'DIV'): EditorShortcutEvent {
  return {
    key,
    target: { tagName } as unknown as EventTarget,
    preventDefault: () => { prevented += 1; },
  };
}

const shortcutKeys = ['m', 't', 's', 'e', 'E', 'n', 'p', 'c', 'f', 'F', 'x', 'i', 'ArrowLeft', 'ArrowRight'];

for (const key of shortcutKeys) {
  handleEditorShortcut(keyEvent(key), shortcutHandlers, { playerRef: shortcutPlayerRef, disabled: false });
}
assert(
  fired.join(',') === 'markEndTimestamp,markStartTimestamp,seekToStart,seekToEnd:5,seekToEnd:0,'
    + 'selectNext,selectPrev,copyVideoUrl,fetchDuration,fetchAllDurations,exportSongList,openPasteImport',
  'every editor shortcut still reaches its handler',
);
assert(seeked.join(',') === '95,105' && prevented === 2, 'arrow keys still seek ±5s and swallow the default');

fired.length = 0;
handleEditorShortcut(keyEvent('f', 'INPUT'), shortcutHandlers, { playerRef: shortcutPlayerRef, disabled: false });
handleEditorShortcut(keyEvent('f', 'TEXTAREA'), shortcutHandlers, { playerRef: shortcutPlayerRef, disabled: false });
assert(fired.length === 0, 'typing in a field never triggers a shortcut');

// Sanctioned delta: StampEditor now guards its shortcuts behind its open modals, as StreamDetail does.
for (const key of shortcutKeys) {
  handleEditorShortcut(keyEvent(key), shortcutHandlers, { playerRef: shortcutPlayerRef, disabled: true });
}
assert(fired.length === 0 && seeked.length === 2, 'an open modal disables every editor shortcut');

console.log('✓ StampEditor retains filters, controls, song rows, access boundaries, and its shared stamp components');

// --- Review Focus 4: a very long stream title is cut by CSS in the picker, never in the markup ---

/** 110 characters (code points) of CJK and emoji; every emoji here is a single code point. */
const LONG_TITLE = Array.from('【歌枠】週六晚上唱歌給你聽✨土曜の夜は歌とともにゆっくりお休み🎤初見さん大歓迎🎵'.repeat(4))
  .slice(0, 110)
  .join('');
assert(Array.from(LONG_TITLE).length === 110, 'the long fixture title is 110 characters');
assert(/\p{Script=Han}/u.test(LONG_TITLE) && /\p{Extended_Pictographic}/u.test(LONG_TITLE), 'it mixes CJK and emoji');

const longStream: StreamWithPending = { ...selectedStream, title: LONG_TITLE };
const parseWin = new Window();
const longView = parseWin.document.createElement('div');
longView.innerHTML = renderView({ selectedStream: longStream, filteredStreams: [longStream, olderStream] });

function classesOf(element: DomElement): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/);
}

const pickerTrigger = longView.querySelector<DomElement>('button[aria-haspopup="listbox"]');
assert(pickerTrigger !== null, 'the stream picker trigger renders');
const triggerTitle = [...pickerTrigger.querySelectorAll<DomElement>('[title]')].find(
  (element) => element.getAttribute('title') === LONG_TITLE,
);
assert(triggerTitle !== undefined, 'the picker trigger carries the full 110-character title in `title`');
assert(triggerTitle.textContent === LONG_TITLE, 'the trigger keeps the whole title in the DOM: only CSS cuts it');
assert(
  classesOf(triggerTitle).includes('truncate') && classesOf(triggerTitle).includes('min-w-0'),
  'the trigger title truncates (a shrinkable, single-line, ellipsised box)',
);

const longOption = [...longView.querySelectorAll<DomElement>('[role="option"]')].find(
  (element) => element.getAttribute('title') === LONG_TITLE,
);
assert(longOption !== undefined, 'the long stream\'s option carries the full title in `title`');
const optionTitle = longOption.querySelector<DomElement>('.truncate');
assert(optionTitle?.textContent === LONG_TITLE, 'the option truncates the title by CSS and keeps its full text');
await parseWin.happyDOM.close();

console.log('✓ a 110-character CJK/emoji stream title is truncated in the picker trigger and its option, full text in `title`');

// --- Deep-link selection: the requested stream and performance are picked from inside the async
// loaders (the stream fetch's success handler, then `loadPerformances`'s own), never from an
// effect that re-derives selection from other state on every change.
//
// This drives the real controller — `useStampEditorController`, `useStreamPicker`,
// `loadPerformances` — against fake fetches in a live DOM, the same technique
// `tests/song-table-memo.test.tsx` uses to mount these editors for real.

const deepLinkWin = new Window({
  url: 'http://localhost/',
  // The editor mounts a YouTube player, which appends the IFrame API script tag; nothing here
  // needs that script, and fetching it would reach the network.
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
});

for (const [name, value] of Object.entries({
  window: deepLinkWin,
  document: deepLinkWin.document,
  navigator: deepLinkWin.navigator,
  HTMLElement: deepLinkWin.HTMLElement,
  Element: deepLinkWin.Element,
  Node: deepLinkWin.Node,
  Event: deepLinkWin.Event,
  MouseEvent: deepLinkWin.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function stubDeepLinkFetch(handle: (pathname: string) => unknown): void {
  const fetchStub: typeof fetch = async (input) => {
    const { pathname } = new URL(String(input), 'http://localhost/');
    const payload = handle(pathname);
    if (payload === undefined) throw new Error(`unstubbed request: ${pathname}`);
    return { ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response;
  };
  Object.defineProperty(globalThis, 'fetch', { value: fetchStub, configurable: true, writable: true });
}

type DeepLinkContainer = DomElement;

/** Lets React finish the load → select → load chain the editor runs on mount. */
async function settleDeepLink(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mountDeepLinkPage(
  element: React.ReactElement,
  options: { strict?: boolean } = {},
): Promise<{ container: DeepLinkContainer; unmount: () => Promise<void> }> {
  const container = deepLinkWin.document.createElement('div');
  deepLinkWin.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  const tree = options.strict ? React.createElement(React.StrictMode, null, element) : element;
  await act(async () => {
    root.render(tree);
  });
  await settleDeepLink();
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function clickDeepLink(node: { click: () => void } | null | undefined, what: string): Promise<void> {
  assert(node !== null && node !== undefined, `the page renders ${what}`);
  await act(async () => {
    node.click();
  });
  await settleDeepLink();
}

async function clickDeepLinkSelector(container: DeepLinkContainer, selector: string, what: string): Promise<void> {
  await clickDeepLink(container.querySelector<DomElement>(selector), what);
}

/**
 * A stream in the picker: the listbox option naming its title. The picker's panel is always
 * mounted (hidden while closed), so its options are there to find and click.
 */
function findStreamOption(container: DeepLinkContainer, title: string): DomElement | undefined {
  return [...container.querySelectorAll<DomElement>('[role="option"]')].find((candidate) =>
    candidate.textContent.includes(title),
  );
}

async function clickStreamOption(container: DeepLinkContainer, title: string): Promise<void> {
  await clickDeepLink(findStreamOption(container, title), `the stream option naming ${title}`);
}

function isPressed(container: DeepLinkContainer, selector: string): boolean {
  return container.querySelector<DomElement>(selector)?.getAttribute('aria-pressed') === 'true';
}

const deepLinkCurator: AuthUser = { email: 'curator@example.com', role: 'curator' };

const deepLinkStreamA: StreamWithPending = {
  id: 'stream-deep-a',
  streamerId: 'mizuki',
  title: 'Deep Link Stream Alpha',
  date: '2026-08-20',
  videoId: 'video-deep-a',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-deep-a',
  credit: {},
  status: 'pending',
  submittedBy: null,
  reviewedBy: null,
  createdAt: '2026-08-20T00:00:00.000Z',
  pendingCount: 3,
};

const deepLinkStreamB: StreamWithPending = {
  ...deepLinkStreamA,
  id: 'stream-deep-b',
  title: 'Deep Link Stream Beta',
  date: '2026-08-19',
  videoId: 'video-deep-b',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-deep-b',
};

const deepLinkPerformances: StampPerformance[] = [
  {
    id: 'perf-deep-1',
    songId: 'song-deep-1',
    title: 'Deep Link Song One',
    originalArtist: 'Artist One',
    timestamp: 10,
    endTimestamp: 100,
    note: '',
    status: 'pending',
  },
  {
    id: 'perf-deep-2',
    songId: 'song-deep-2',
    title: 'Deep Link Song Two',
    originalArtist: 'Artist Two',
    timestamp: 110,
    endTimestamp: 200,
    note: '',
    status: 'pending',
  },
  {
    id: 'perf-deep-3',
    songId: 'song-deep-3',
    title: 'Deep Link Song Three',
    originalArtist: 'Artist Three',
    timestamp: 210,
    endTimestamp: null,
    note: '',
    status: 'pending',
  },
];

stubDeepLinkFetch((pathname) => {
  if (pathname === '/api/stamp/stats') return { total: 3, filled: 2, remaining: 1 } satisfies StampStats;
  if (pathname === '/api/stamp/streams') {
    return { data: [deepLinkStreamA, deepLinkStreamB], total: 2 } satisfies ListResponse<StreamWithPending>;
  }
  if (pathname === `/api/streams/${deepLinkStreamA.id}/performances`) {
    // A fresh array each load, as the real API is: ids/order persist across a reload.
    return {
      data: [...deepLinkPerformances],
      total: deepLinkPerformances.length,
    } satisfies ListResponse<StampPerformance>;
  }
  return undefined;
});

// `?stream=&performance=` is StampEditor's deep link: it opens on the requested stream and song.
const deepLinkPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={[`/stamp?stream=${deepLinkStreamA.id}&performance=perf-deep-3`]}>
    <StampEditorPage user={deepLinkCurator} />
  </MemoryRouter>,
);

assert(
  !deepLinkPage.container.innerHTML.includes('Select a stream to start stamping'),
  'the deep-linked stream replaces the empty-selection placeholder',
);
assert(
  findStreamOption(deepLinkPage.container, deepLinkStreamA.title)?.getAttribute('aria-selected') === 'true',
  'a ?stream deep link selects the requested stream once the stream list loads',
);
assert(
  isPressed(deepLinkPage.container, '[title="Select song 3"]'),
  'a ?performance deep link selects the requested performance once its stream\'s performances load',
);

// A later user pick, then a reload of the same (deep-linked) stream: the reload must not snap the
// selection back to the deep-linked performance. The effect this replaced re-derived the selected
// index from `performances`/`requestedStreamId`/`selectedStreamId` on every change, so it fired
// again on every reload of the requested stream, forever — this is what "selected once" fixes.
await clickDeepLinkSelector(deepLinkPage.container, '[title="Select song 2"]', 'song row 2');
assert(isPressed(deepLinkPage.container, '[title="Select song 2"]'), 'the user pick took effect');

// Re-picking the already-open stream reloads its performances into a new array.
await clickStreamOption(deepLinkPage.container, deepLinkStreamA.title);
assert(
  !isPressed(deepLinkPage.container, '[title="Select song 3"]'),
  'reloading the deep-linked stream must not re-select the deep-linked performance over a later user pick',
);
assert(
  isPressed(deepLinkPage.container, '[title="Select song 1"]'),
  'a reload of a stream whose deep-linked performance was already applied falls back to the '
    + 'ordinary default (the first row), the same as any other reload',
);

await deepLinkPage.unmount();

// --- The same deep link, under `<StrictMode>` (the tree `src/main.tsx:8` renders in dev). React
// double-invokes the mount effect; without a cancellation guard the first resolution consumes
// `requestedPerformanceAppliedRef` and the second — which always resolves after it — resets the
// deep-linked pick back to row 0, while `loadPerformances` (and so the performances endpoint) runs
// twice instead of once.

let strictPerformancesFetchCount = 0;
stubDeepLinkFetch((pathname) => {
  if (pathname === '/api/stamp/stats') return { total: 3, filled: 2, remaining: 1 } satisfies StampStats;
  if (pathname === '/api/stamp/streams') {
    return { data: [deepLinkStreamA, deepLinkStreamB], total: 2 } satisfies ListResponse<StreamWithPending>;
  }
  if (pathname === `/api/streams/${deepLinkStreamA.id}/performances`) {
    strictPerformancesFetchCount += 1;
    return {
      data: [...deepLinkPerformances],
      total: deepLinkPerformances.length,
    } satisfies ListResponse<StampPerformance>;
  }
  return undefined;
});

const strictDeepLinkPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={[`/stamp?stream=${deepLinkStreamA.id}&performance=perf-deep-3`]}>
    <StampEditorPage user={deepLinkCurator} />
  </MemoryRouter>,
  { strict: true },
);

assert(
  isPressed(strictDeepLinkPage.container, '[title="Select song 3"]'),
  'under StrictMode, a ?performance deep link still selects the requested performance once its '
    + "stream's performances load",
);
const strictFetchCount = strictPerformancesFetchCount;
assert(
  strictFetchCount === 1,
  `under StrictMode, the performances endpoint is fetched exactly once (was ${strictFetchCount})`,
);

await strictDeepLinkPage.unmount();

console.log(
  "✓ StampEditor's deep-link mount chain is cancellable: StrictMode's double effect still "
    + 'selects the requested performance from a single performances fetch',
);

// --- Without query params, nothing is auto-selected: the editor waits for a manual pick ---

const noQueryPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={['/stamp']}>
    <StampEditorPage user={deepLinkCurator} />
  </MemoryRouter>,
);
assert(
  noQueryPage.container.innerHTML.includes('Select a stream to start stamping'),
  'with no ?stream param, no stream is auto-selected and the empty-selection placeholder stays',
);
assert(
  findStreamOption(noQueryPage.container, deepLinkStreamA.title)?.getAttribute('aria-selected') === 'false'
    && findStreamOption(noQueryPage.container, deepLinkStreamB.title)?.getAttribute('aria-selected') === 'false',
  'with no ?stream param, neither stream is selected in the picker',
);

await noQueryPage.unmount();

// Resolve requests in reverse order: the selected stream owns the table even
// when the previous stream's response arrives last.
const pendingLoads = new Map<string, (value: unknown) => void>();
stubDeepLinkFetch((pathname) => {
  if (pathname === '/api/streamers') return [{ slug: 'mizuki', displayName: 'Mizuki' }];
  if (pathname === '/api/stamp/streams') return { data: [deepLinkStreamA, deepLinkStreamB], total: 2 };
  if (pathname.endsWith('/performances')) {
    return new Promise((resolve) => pendingLoads.set(pathname, resolve));
  }
  return [];
});
const racePage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={['/stamp']}><StampEditorPage user={deepLinkCurator} /></MemoryRouter>,
);
await clickStreamOption(racePage.container, deepLinkStreamA.title);
await clickStreamOption(racePage.container, deepLinkStreamB.title);
const finishLoad = async (streamId: string, title: string) => {
  const resolve = pendingLoads.get(`/api/streams/${streamId}/performances`);
  assert(!!resolve, `a request is pending for ${streamId}`);
  await act(async () => resolve({ data: [{ ...deepLinkPerformances[0], id: streamId, title }], total: 1 }));
  await settleDeepLink();
};
await finishLoad(deepLinkStreamB.id, 'Current Beta Song');
await finishLoad(deepLinkStreamA.id, 'Obsolete Alpha Song');
assert(racePage.container.textContent.includes('Current Beta Song'), 'latest selection keeps its songs');
assert(!racePage.container.textContent.includes('Obsolete Alpha Song'), 'obsolete load cannot overwrite the table');
await racePage.unmount();

// A timestamp save can finish after its row was deleted. The next row now
// occupies index zero, but it must keep its own end timestamp.
let finishTimestamp!: (value: unknown) => void;
stubDeepLinkFetch((pathname) => {
  if (pathname === '/api/stamp/stats') return { total: 2, filled: 2, remaining: 0 };
  if (pathname === '/api/stamp/streams') return { data: [deepLinkStreamA], total: 1 };
  if (pathname.endsWith('/performances')) return { data: deepLinkPerformances.slice(0, 2), total: 2 };
  if (pathname.endsWith('/timestamps')) return new Promise(resolve => { finishTimestamp = resolve; });
  if (pathname === '/api/performances/perf-deep-1') return { ok: true };
  return undefined;
});
Object.defineProperty(deepLinkWin, 'confirm', { value: () => true, configurable: true });
const mutationPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={[`/stamp?stream=${deepLinkStreamA.id}`]}><StampEditorPage user={deepLinkCurator} /></MemoryRouter>,
);
await clickDeepLinkSelector(mutationPage.container, 'button[aria-label="Clear end timestamp"]', 'clear first timestamp');
await clickDeepLinkSelector(mutationPage.container, 'button[aria-label="Delete song"]', 'delete first row');
await act(async () => finishTimestamp({ ok: true }));
await settleDeepLink();
assert(!mutationPage.container.textContent.includes('Deep Link Song One'), 'deleted row stays deleted');
assert(mutationPage.container.textContent.includes('Deep Link Song Two'), 'remaining row stays visible');
assert(mutationPage.container.querySelectorAll('button[aria-label="Clear end timestamp"]').length === 1, 'late save cannot clear the next row');
await mutationPage.unmount();

// --- The controller's own paths behind the new chrome: a failing stats load, the exact confirm
// titles, and Newer / Older stepping through the newest-first filtered list ---

const failingStatsFetch: typeof fetch = async (input) => {
  const { pathname } = new URL(String(input), 'http://localhost/');
  if (pathname === '/api/stamp/stats') {
    return { ok: false, status: 500, statusText: 'Internal Server Error', text: () => Promise.resolve('') } as unknown as Response;
  }
  if (pathname !== '/api/stamp/streams') throw new Error(`unstubbed request: ${pathname}`);
  const payload = { data: [deepLinkStreamA, deepLinkStreamB], total: 2 } satisfies ListResponse<StreamWithPending>;
  return { ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response;
};
Object.defineProperty(globalThis, 'fetch', { value: failingStatsFetch, configurable: true, writable: true });
const statsDownPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={['/stamp']}><StampEditorPage user={deepLinkCurator} /></MemoryRouter>,
);
assert(
  statsDownPage.container.textContent.includes('Stats unavailable'),
  'a failing stampStats() leaves "Stats unavailable" in the picker footer',
);
await statsDownPage.unmount();

// The native fallback records what it was asked; declining keeps every action from calling the API.
const confirmTitles: string[] = [];
Object.defineProperty(deepLinkWin, 'confirm', {
  value: (message?: string) => {
    confirmTitles.push(String(message));
    return false;
  },
  configurable: true,
});
stubDeepLinkFetch((pathname) => {
  if (pathname === '/api/stamp/stats') return { total: 3, filled: 2, remaining: 1 } satisfies StampStats;
  if (pathname === '/api/stamp/streams') {
    return { data: [deepLinkStreamA, deepLinkStreamB], total: 2 } satisfies ListResponse<StreamWithPending>;
  }
  if (pathname === `/api/streams/${deepLinkStreamA.id}/performances`) {
    return { data: [...deepLinkPerformances], total: deepLinkPerformances.length } satisfies ListResponse<StampPerformance>;
  }
  if (pathname === `/api/streams/${deepLinkStreamB.id}/performances`) {
    return {
      data: [{ ...deepLinkPerformances[0]!, id: 'perf-beta', title: 'Beta Stream Song' }],
      total: 1,
    } satisfies ListResponse<StampPerformance>;
  }
  return undefined;
});
const actionsPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={[`/stamp?stream=${deepLinkStreamA.id}`]}><StampEditorPage user={deepLinkCurator} /></MemoryRouter>,
);
assert(!actionsPage.container.textContent.includes('Stats unavailable'), 'a stats load that succeeds shows its counts instead');

await clickDeepLinkSelector(actionsPage.container, 'button[aria-label="Delete song"]', "the first row's Delete song");
await clickDeepLink(
  [...actionsPage.container.querySelectorAll<DomElement>('button')].find((button) => button.textContent.trim() === 'Approve All'),
  'Approve All',
);
await clickDeepLink(
  [...actionsPage.container.querySelectorAll<DomElement>('[role="menuitem"]')].find((item) => item.textContent.includes('Clear All')),
  'the Clear All menu item',
);
const expectedTitles = [
  'Delete #1 Deep Link Song One?',
  'Approve all 3 pending songs & performances for this stream?',
  'Clear ALL end timestamps for this stream?',
];
assert(
  confirmTitles.join('|') === expectedTitles.join('|'),
  `Delete, Approve All and Clear All ask with their exact titles (asked: ${confirmTitles.join(' | ')})`,
);

const selectedStreamTitle = () =>
  actionsPage.container.querySelector<DomElement>('[role="option"][aria-selected="true"]')?.getAttribute('title');
const streamStep = (label: string) => actionsPage.container.querySelector<DomElement>(`button[aria-label="${label}"]`);
assert(
  selectedStreamTitle() === deepLinkStreamA.title && streamStep('Newer stream')?.hasAttribute('disabled') === true,
  'the newest stream has no newer neighbour',
);
await clickDeepLink(streamStep('Older stream'), 'Older stream');
assert(selectedStreamTitle() === deepLinkStreamB.title, '"Older stream" selects the next entry of the filtered list');
assert(actionsPage.container.textContent.includes('Beta Stream Song'), "the older stream's songs load");
assert(streamStep('Older stream')?.hasAttribute('disabled') === true, 'the oldest stream has no older neighbour');
await clickDeepLink(streamStep('Newer stream'), 'Newer stream');
assert(selectedStreamTitle() === deepLinkStreamA.title, '"Newer stream" selects the previous entry of the filtered list');
await actionsPage.unmount();

console.log(
  '✓ StampEditor live: a failing stats load reads "Stats unavailable"; Delete, Approve All and Clear All ask '
    + 'with their exact titles; Newer / Older step through the filtered list and stop at its ends',
);

// --- The floating playback pill watches the Stamp Editor's own player box: the workbench card ---

stubDeepLinkFetch((pathname) => {
  if (pathname === '/api/stamp/stats') return { total: 3, filled: 2, remaining: 1 } satisfies StampStats;
  if (pathname === '/api/stamp/streams') return { data: [deepLinkStreamA], total: 1 } satisfies ListResponse<StreamWithPending>;
  if (pathname === `/api/streams/${deepLinkStreamA.id}/performances`) {
    return { data: [...deepLinkPerformances], total: deepLinkPerformances.length } satisfies ListResponse<StampPerformance>;
  }
  return undefined;
});
const observerStub = installIntersectionObserverStub();
const pillPage = await mountDeepLinkPage(
  <MemoryRouter initialEntries={[`/stamp?stream=${deepLinkStreamA.id}`]}>
    <StampEditorPage user={deepLinkCurator} />
  </MemoryRouter>,
);
/** The fixed pill: a plain surface here, with no click of its own. */
const pillOf = () => pillPage.container.querySelector<DomElement>('[class*="fixed bottom-4 right-4"]');
const pillIsHidden = () =>
  (pillOf()?.getAttribute('class') ?? '').split(' ').includes('invisible') && pillOf()?.getAttribute('aria-hidden') === 'true';
const watchers = observerStub.observers.filter((observer) => observer.observed.length > 0 && !observer.disconnected);
const watchedCard = watchers[0]?.observed[0] as DomElement | undefined;
assert(
  watchers.length === 1 && watchedCard?.querySelector('[aria-label="Stream timeline"]') !== null && watchedCard?.querySelector('.aspect-video') !== null,
  "the pill watches the Stamp Editor's player box: the workbench card, player and timeline included",
);
assert(pillOf() !== null && pillIsHidden(), 'while the workbench is on screen, the pill is hidden, still mounted');
await act(async () => {
  watchers[0]?.report(false);
});
assert(!pillIsHidden(), 'once the workbench scrolls out of view, the pill shows');
await act(async () => {
  watchers[0]?.report(true);
});
assert(pillIsHidden(), 'and hides again when it comes back');
await pillPage.unmount();
assert(watchers[0]?.disconnected === true, 'leaving the page disconnects the observer');
observerStub.restore();

console.log('✓ StampEditor live: the floating pill shows only once the workbench has scrolled out of view');

await deepLinkWin.happyDOM.close();

console.log(
  '✓ StampEditor selects a ?stream&performance deep link once from inside its loaders, never '
    + 're-applies it on a later reload, and leaves selection alone with no query params',
);
