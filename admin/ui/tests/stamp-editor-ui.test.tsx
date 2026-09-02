import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StampPerformance, StreamWithPending } from '../../shared/types';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { StampEditorView } from '../src/pages/StampEditor';
import type { StampEditorController } from '../src/pages/StampEditor';
import { InlineEdit } from '../src/components/stamp/InlineEdit';
import { handleInlineEditKeyDown } from '../src/lib/inline-edit';
import { handleEditorShortcut } from '../src/hooks/useEditorShortcuts';
import type { EditorShortcutEvent, EditorShortcutHandlers } from '../src/hooks/useEditorShortcuts';

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
  toast: null,
  showAddModal: false,
  setShowAddModal: noop,
  showPasteImport: false,
  setShowPasteImport: noop,
  editingField: null,
  setEditingField: noop,
  loading: false,
  stampStats: { total: 2, filled: 1, remaining: 1 },
  fetchLog: [],
  clearFetchLog: noop,
  playerRef: React.createRef<YouTubePlayerHandle>(),
  selectedStream,
  streamYears: ['2026', '2025'],
  filteredStreams: [selectedStream, olderStream],
  selectStream: noop,
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
assert(html.includes('Current Karaoke Stream'), 'selected stream remains visible in the sidebar');
assert(html.includes('Older Karaoke Stream'), 'other filtered streams remain visible');
assert(html.includes('Filter streams by year'), 'year filter remains visible for multiple years');
assert(html.includes('Search streams'), 'stream search remains visible');
assert(html.includes('aria-pressed="true"'), 'selected stream and song retain pressed state');
assert(html.includes('1/2') && html.includes('(1 remaining)'), 'stamp statistics remain visible');
assert(html.includes('1 pending'), 'pending song count remains visible');
assert(html.includes('First Song') && html.includes('Second Song'), 'all song rows remain visible');
assert(html.includes('1:05') && html.includes('4:05') && html.includes('1:01:40'), 'song timestamps retain their format');
assert(html.includes('Approve All'), 'curators retain bulk approval');
assert(html.includes('Clear All') && html.includes('Paste Import') && html.includes('+ Add Song'), 'song actions remain visible');
assert(html.includes('Double-click or press F2 to edit title'), 'keyboard editing affordance remains visible');

const contributorHtml = renderView({
  user: { email: 'contributor@example.com', role: 'contributor' },
});
assert(!contributorHtml.includes('Approve All'), 'contributors do not see curator bulk approval');

const loadingHtml = renderView({ loading: true });
assert(loadingHtml.includes('Loading...'), 'song loading state remains intact');

const emptyHtml = renderView({ performances: [], selectedIndex: -1 });
assert(emptyHtml.includes('No songs in this stream'), 'empty song state remains intact');

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

// The `allowEmpty` opt-in lives at the call site, so walk the rendered tree of the page's own
// song list and take the exact props it hands the shared component.
interface InlineEditCallProps {
  value: string;
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
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
  const host = seen.find((element) => (element.type as { name?: string }).name === componentName);
  assert(host !== undefined, `${componentName} renders inside the page view`);
  seen.length = 0;
  walk((host.type as (props: unknown) => React.ReactNode)(host.props));
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
