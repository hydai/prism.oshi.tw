import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Stream, StreamDetail } from '../../shared/types';
import { StreamDetailView } from '../src/pages/StreamDetail';
import type { StreamDetailController } from '../src/pages/StreamDetail';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const asyncNoop = async () => {};
const noop = () => {};

const detail: StreamDetail = {
  id: 'stream-current',
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
  currentTime: 90,
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

console.log('✓ StreamDetail view retains navigation, controls, rows, and access boundaries');
