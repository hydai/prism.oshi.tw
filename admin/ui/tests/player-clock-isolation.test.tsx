import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { StampPerformance, Stream, StreamDetail, StreamWithPending } from '../../shared/types';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { StampEditorView } from '../src/pages/StampEditor';
import type { StampEditorController } from '../src/pages/StampEditor';
import { StreamDetailView } from '../src/pages/StreamDetail';
import type { StreamDetailController } from '../src/pages/StreamDetail';
import { playerClock } from '../src/lib/player-clock-store';
import { startPlayerClock } from '../src/hooks/usePlayerClock';
import type { ClockTimers } from '../src/hooks/usePlayerClock';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const asyncNoop = async () => {};
const noop = () => {};

// --- A fake player and fake timers, so the probe drives real ticks with no browser ---

let playerPosition = 7;
const fakePlayer: YouTubePlayerHandle = {
  getCurrentTime: () => playerPosition,
  seekTo: noop,
  loadVideo: noop,
};
const playerRef: React.RefObject<YouTubePlayerHandle | null> = { current: fakePlayer };

const intervals = new Map<number, () => void>();
let nextIntervalId = 1;
const fakeTimers: ClockTimers = {
  setInterval: (run: () => void) => {
    const id = nextIntervalId++;
    intervals.set(id, run);
    return id;
  },
  clearInterval: (id: number) => {
    intervals.delete(id);
  },
};
function tick(): void {
  for (const run of [...intervals.values()]) run();
}

// --- Fixtures ---

const performances: StampPerformance[] = [
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
];

const stream: StreamWithPending = {
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

const detail: StreamDetail = {
  ...stream,
  status: 'pending',
  credit: { author: 'Timestamp Curator' },
  performances,
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

const stampController: StampEditorController = {
  user: { email: 'curator@example.com', role: 'curator' },
  streamSearch: '',
  setStreamSearch: noop,
  streamYearFilter: '',
  setStreamYearFilter: noop,
  selectedStreamId: stream.id,
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
  playerRef,
  selectedStream: stream,
  streamYears: ['2026', '2025'],
  filteredStreams: [stream],
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

const detailController: StreamDetailController = {
  streamId: detail.id,
  detail,
  loading: false,
  error: null,
  toast: null,
  editingField: null,
  setEditingField: noop,
  showPasteImport: false,
  setShowPasteImport: noop,
  playerRef,
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

// --- Helpers ---

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** The rows the curator scrolls: everything between the two markers, markers included. */
function rows(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  assert(start >= 0, `probe rows start (${open}) must exist in the rendered page`);
  const end = html.indexOf(close, start);
  assert(end > start, `probe rows end (${close}) must exist in the rendered page`);
  const section = html.slice(start, end + close.length);
  assert(section.includes('First Song') && section.includes('Second Song'), 'the probe rows must carry both songs');
  return section;
}

/**
 * The clock is an external store, so a tick must reach the two components that display time and
 * nothing else. Server rendering cannot count React re-renders, so the probe proves the same
 * property from the output side: after two real ticks the row markup is byte-identical, while the
 * time readout and the floating pill both moved. A page that still threaded `currentTime` through
 * its controller fails the first assertion — the tick never reaches the view at all.
 */
function probeTickIsolation(
  label: string,
  render: () => string,
  rowMarkers: { open: string; close: string },
): void {
  playerPosition = 7;
  playerClock.setTime(playerPosition);

  const before = render();
  assert(occurrences(before, '0:07') === 2, `${label}: the readout and the pill both show the clock before the tick`);
  const rowsBefore = rows(before, rowMarkers.open, rowMarkers.close);

  const stop = startPlayerClock(() => playerRef.current?.getCurrentTime() ?? 0, playerClock, fakeTimers);
  playerPosition = 122;
  tick();
  playerPosition = 185.9;
  tick();
  stop();
  assert(playerClock.getSnapshot() === 185.9, `${label}: two ticks land in the shared clock`);

  const after = render();
  assert(before !== after, `${label}: a clock tick must change what the page renders`);
  assert(occurrences(after, '3:05') === 2, `${label}: the readout and the pill are the only clock displays`);
  assert(
    before.split('0:07').join('3:05') === after,
    `${label}: a tick must change the clock text and nothing else on the page`,
  );

  const rowsAfter = rows(after, rowMarkers.open, rowMarkers.close);
  assert(rowsBefore === rowsAfter, `${label}: the song rows must be byte-identical across two clock ticks`);
}

probeTickIsolation(
  'StampEditor',
  () => renderToStaticMarkup(<StampEditorView controller={stampController} />),
  { open: '<ul aria-label="Songs in selected stream">', close: '</ul>' },
);

probeTickIsolation(
  'StreamDetail',
  () => renderToStaticMarkup(
    <MemoryRouter>
      <StreamDetailView controller={detailController} />
    </MemoryRouter>,
  ),
  { open: '<tbody', close: '</tbody>' },
);

// --- Regression net: the pages must not grow their own clock again ---
//
// Nothing above executes a controller — there is no hook renderer in admin/ui — and `tests/` sits
// outside the tsconfig, so a re-added `currentTime` state and its 500ms poll would sail through
// lint, tsc and every assertion here. A source grep is crude, but it is the only gate that fails.
for (const page of ['../src/pages/StampEditor.tsx', '../src/pages/StreamDetail.tsx']) {
  const source = readFileSync(new URL(page, import.meta.url), 'utf8');
  assert(!source.includes('setInterval('), `${page}: the 500ms poll belongs to usePlayerClock, not the page`);
  assert(
    !/const \[currentTime, setCurrentTime\] = useState/.test(source),
    `${page}: playback time belongs in the clock store, not in page state`,
  );
}

console.log('✓ a clock tick moves the time readout and the floating pill, and leaves every song row untouched');
