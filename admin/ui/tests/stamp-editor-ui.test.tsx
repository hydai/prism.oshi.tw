import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StampPerformance, StreamWithPending } from '../../shared/types';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { StampEditorView } from '../src/pages/StampEditor';
import type { StampEditorController } from '../src/pages/StampEditor';

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
  currentTime: 90,
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

const unselectedHtml = renderView({
  selectedStreamId: null,
  selectedStream: undefined,
});
assert(unselectedHtml.includes('Select a stream to start stamping'), 'initial selection prompt remains intact');
assert(!unselectedHtml.includes('Songs in selected stream'), 'song list stays hidden until a stream is selected');

console.log('✓ StampEditor view retains filters, controls, song rows, and access boundaries');
