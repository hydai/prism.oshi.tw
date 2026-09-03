import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Stream, StreamDetail } from '../../shared/types';
import { StreamDetailView } from '../src/pages/StreamDetail';
import type { StreamDetailController } from '../src/pages/StreamDetail';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { InlineEdit } from '../src/components/stamp/InlineEdit';
import { handleInlineEditKeyDown } from '../src/lib/inline-edit';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const asyncNoop = async () => {};
const noop = () => {};

const detail: StreamDetail = {
  id: 'stream-current',
  streamerId: 'mizuki',
  title: 'Test Karaoke Stream',
  date: '2026-08-17',
  videoId: 'video-current',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-current',
  credit: { author: 'Timestamp Curator' },
  status: 'pending',
  submittedBy: 'submitter@example.com',
  reviewedBy: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  performances: [
    {
      id: 'performance-one',
      songId: 'song-one',
      title: 'First Song',
      originalArtist: 'First Artist',
      timestamp: 65,
      endTimestamp: 245,
      note: 'opening song',
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
  ],
};

function adjacentStream(id: string, date: string): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title: id,
    date,
    videoId: `${id}-video`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}-video`,
    credit: {},
    status: 'approved',
    submittedBy: null,
    reviewedBy: null,
    createdAt: '2026-08-17T00:00:00.000Z',
  };
}

const controller: StreamDetailController = {
  streamId: detail.id,
  detail,
  loading: false,
  error: null,
  toast: null,
  editingField: null,
  setEditingField: noop,
  showPasteImport: false,
  setShowPasteImport: noop,
  playerRef: React.createRef<YouTubePlayerHandle>(),
  playerBoxRef: React.createRef<HTMLDivElement>(),
  selectedIndex: 0,
  setSelectedIndex: noop,
  showAddModal: false,
  setShowAddModal: noop,
  fetchLog: [],
  clearFetchLog: noop,
  isCurator: true,
  prevStream: adjacentStream('stream-newer', '2026-08-18'),
  nextStream: adjacentStream('stream-older', '2026-08-16'),
  unstampedCount: 1,
  handleStreamStatus: asyncNoop,
  handleStreamSave: asyncNoop,
  handleDeleteStream: asyncNoop,
  handlePasteImportDone: asyncNoop,
  copyVodUrl: noop,
  exportSongList: noop,
  handleSave: asyncNoop,
  handleDelete: asyncNoop,
  handlePerformanceStatus: asyncNoop,
  handleApproveAll: asyncNoop,
  handleUnapproveAll: asyncNoop,
  clearEndTimestamp: asyncNoop,
  clearAllEndTimestamps: asyncNoop,
  handleAddSong: asyncNoop,
};

function renderView(overrides: Partial<StreamDetailController> = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StreamDetailView controller={{ ...controller, ...overrides }} />
    </MemoryRouter>,
  );
}

const html = renderView();
assert(html.includes('Test Karaoke Stream'), 'stream title remains visible');
assert(html.includes('Timestamp Curator'), 'stream credit remains visible');
assert(html.includes('2026-08-18') && html.includes('2026-08-16'), 'previous and next navigation remain visible');
assert(html.includes('Performances (2)'), 'performance count remains visible');
assert(html.includes('1 unstamped'), 'unstamped count remains visible');
assert(html.includes('First Song') && html.includes('Second Song'), 'all performances remain visible');
assert(html.includes('1:05') && html.includes('4:05') && html.includes('1:01:40'), 'timestamps keep their display format');
assert(html.includes('Approve All') && html.includes('Unapprove All'), 'curator bulk actions remain visible');
assert(html.includes('Delete stream'), 'pending streams retain the curator delete action');
assert(html.includes('Open in Stamp Editor'), 'stamp editor navigation remains visible');
assert(html.includes('performance-row-performance-one'), 'performance deep-link target remains on each row');

const contributorHtml = renderView({ isCurator: false });
assert(!contributorHtml.includes('Approve All'), 'contributors do not see curator bulk approval');
assert(!contributorHtml.includes('Delete stream'), 'contributors do not see stream deletion');

const loadingHtml = renderView({ loading: true, detail: null });
assert(loadingHtml.includes('Loading...'), 'loading state remains intact');
const errorHtml = renderView({ error: 'Unable to load stream', detail: null });
assert(errorHtml.includes('Unable to load stream'), 'error state remains intact');

const addModalHtml = renderView({ showAddModal: true });
assert(addModalHtml.includes('Song title *'), 'add-song modal remains wired to page state');

const pasteModalHtml = renderView({ showPasteImport: true });
assert(pasteModalHtml.includes('Paste a timestamp list'), 'paste-import modal remains wired to page state');
assert(
  pasteModalHtml.includes('Replace existing performances') && !pasteModalHtml.includes('delete current songs first'),
  'StreamDetail keeps its own replace-mode wording after the modal is shared',
);
assert(!pasteModalHtml.includes('7:20 Third Song'), 'StreamDetail keeps its two-line paste example');

// --- Inline edit: StreamDetail still saves a field that was emptied ---

function commitInlineEdit(text: string, value: string, allowEmpty: boolean): { saved: string[]; cancels: number } {
  const saved: string[] = [];
  let cancels = 0;
  handleInlineEditKeyDown(
    { key: 'Enter', preventDefault: noop },
    { text, value, allowEmpty, onSave: (val) => saved.push(val), onCancel: () => { cancels += 1; } },
  );
  return { saved, cancels };
}

const clearedNote = commitInlineEdit('   ', 'opening song', true);
assert(clearedNote.saved.length === 1 && clearedNote.saved[0] === '', 'emptying a StreamDetail field saves the empty value');

const alreadyEmpty = commitInlineEdit('', '', true);
assert(alreadyEmpty.saved.length === 0 && alreadyEmpty.cancels === 1, 'an already-empty field cancels');

// The `allowEmpty` opt-in lives at the call site, so walk the rendered tree of the page's own
// performance table and take the exact props it hands the shared component.
interface InlineEditCallProps {
  value: string;
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
}

// `componentName` narrows the walk to one sub-component's render output (e.g. the performance
// table); omit it to read InlineEdits that StreamDetailView renders directly, like the stream title.
function inlineEditProps(tree: React.ReactNode, componentName?: string): InlineEditCallProps[] {
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
  if (componentName !== undefined) {
    const host = seen.find((element) => (element.type as { name?: string }).name === componentName);
    assert(host !== undefined, `${componentName} renders inside the page view`);
    seen.length = 0;
    walk((host.type as (props: unknown) => React.ReactNode)(host.props));
  }
  return seen.filter((element) => element.type === InlineEdit).map((element) => element.props as InlineEditCallProps);
}

const savedNotes: string[] = [];
const editedTable = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'note' },
    handleSave: async (perfId, field, value) => { savedNotes.push(`${perfId}:${field}:${value}`); },
  },
});
const detailInlineEdits = inlineEditProps(editedTable, 'PerformanceTable');
assert(detailInlineEdits.length === 1, 'the edited performance row renders one shared InlineEdit');
assert(detailInlineEdits[0]?.allowEmpty === true, 'StreamDetail rows opt into empty saves');

// Drive the props the page actually handed the shared component: clearing a note must still save it.
const noteRow = detailInlineEdits[0]!;
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...noteRow, text: '   ' });
assert(
  savedNotes.join() === 'performance-one:note:',
  'a StreamDetail row left empty saves the blank value through the page callback',
);

// --- Inline edit: the two title sites no longer opt into empty saves ---
//
// Clearing a stream or performance title used to round-trip a `''` the server rejected with 400.
// The prop assertion pins the JSX no longer passing `allowEmpty`; driving the real extracted
// callbacks through the key handler pins the resulting behavior (cancel, not a rejected save).

const savedStreamTitles: string[] = [];
let streamTitleCancelled = false;
const streamTitleTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'stream', field: 'title' },
    handleStreamSave: async (field, value) => { savedStreamTitles.push(`${field}:${value}`); },
    setEditingField: () => { streamTitleCancelled = true; },
  },
});
const streamTitleEdits = inlineEditProps(streamTitleTree);
assert(streamTitleEdits.length === 1, 'the stream title renders one shared InlineEdit while editing');
assert(streamTitleEdits[0]?.allowEmpty === undefined, 'stream title no longer opts into empty saves');
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...streamTitleEdits[0]!, text: '   ' });
assert(savedStreamTitles.length === 0, 'clearing the stream title no longer saves the empty value');
assert(streamTitleCancelled, 'clearing the stream title cancels the edit instead of saving');

const savedPerfTitles: string[] = [];
let perfTitleCancelled = false;
const perfTitleTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'title' },
    handleSave: async (perfId, field, value) => { savedPerfTitles.push(`${perfId}:${field}:${value}`); },
    setEditingField: () => { perfTitleCancelled = true; },
  },
});
const perfTitleEdits = inlineEditProps(perfTitleTree, 'PerformanceTable');
assert(perfTitleEdits.length === 1, 'the edited performance title row renders one shared InlineEdit');
assert(perfTitleEdits[0]?.allowEmpty === undefined, 'performance title no longer opts into empty saves');
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...perfTitleEdits[0]!, text: '   ' });
assert(savedPerfTitles.length === 0, 'clearing a performance title no longer saves the empty value');
assert(perfTitleCancelled, 'clearing a performance title cancels the edit instead of saving');

// --- Artist keeps its empty-save opt-in (unchanged); the prop assertion is the pin here since
// the save-behavior path is already exercised above for note, an identical opted-in field. ---

const artistTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'artist' },
  },
});
const artistEdits = inlineEditProps(artistTree, 'PerformanceTable');
assert(artistEdits.length === 1, 'the edited performance artist row renders one shared InlineEdit');
assert(artistEdits[0]?.allowEmpty === true, 'artist keeps its empty-save opt-in');

console.log('✓ StreamDetail retains navigation, controls, rows, access boundaries, and its shared stamp components');
