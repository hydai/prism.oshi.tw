import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AuthUser, StreamWithPending, StampPerformance, StampStats } from '../../../shared/types';
import { api } from '../api/client';
import { YouTubePlayer } from '../components/YouTubePlayer';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { formatSongList } from '../../../shared/parse';
import { FetchLogPanel } from '../components/FetchLogPanel';
import { FloatingPlaybackPill } from '../components/FloatingPlaybackPill';
import { Toast } from '../components/stamp/Toast';
import { InlineEdit } from '../components/stamp/InlineEdit';
import { AddSongModal } from '../components/stamp/AddSongModal';
import { PasteImportModal } from '../components/stamp/PasteImportModal';
import { useToast } from '../hooks/useToast';
import { useFetchLog } from '../hooks/useFetchLog';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { useFetchAllDurations } from '../hooks/useFetchAllDurations';
import { useSearchParams } from 'react-router-dom';

// --- Helpers ---

function formatTimestamp(sec: number): string {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- Main component ---

interface EditingField {
  index: number;
  field: 'title' | 'artist';
}

function useStampEditorController(user: AuthUser) {
  const [initialParams] = useSearchParams();
  const requestedStreamId = initialParams.get('stream');
  const requestedPerformanceId = initialParams.get('performance');
  // Stream state
  const [streams, setStreams] = useState<StreamWithPending[]>([]);
  const [streamSearch, setStreamSearch] = useState('');
  const [streamYearFilter, setStreamYearFilter] = useState('');
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);

  // Performance state
  const [performances, setPerformances] = useState<StampPerformance[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // UI state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [loading, setLoading] = useState(false);

  // Stamp stats
  const [stampStats, setStampStats] = useState<StampStats | null>(null);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const { toast, showToast } = useToast();
  const { fetchLog, appendFetchLog, clearFetchLog } = useFetchLog();

  const selectedStream = streams.find((s) => s.id === selectedStreamId);

  // --- Poll current playback time ---
  useEffect(() => {
    const interval = setInterval(() => {
      const t = playerRef.current?.getCurrentTime() ?? 0;
      setCurrentTime(t);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // --- Load streams + stats ---
  const loadStats = useCallback(() => {
    api.stampStats().then(setStampStats).catch(() => {});
  }, []);

  const loadStreams = useCallback(() => {
    api.listStampStreams().then(({ data }) => setStreams(data));
  }, []);

  useEffect(() => {
    loadStreams();
    loadStats();
  }, [loadStreams, loadStats]);

  // --- Load performances when stream changes ---
  const loadPerformances = useCallback(
    async (streamId: string) => {
      setLoading(true);
      try {
        const { data } = await api.listStreamPerformances(streamId);
        setPerformances(data);
        setSelectedIndex(data.length > 0 ? 0 : -1);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to load performances', true);
      } finally {
        setLoading(false);
      }
    },
    [showToast],
  );

  const selectStream = useCallback(
    (stream: StreamWithPending) => {
      setSelectedStreamId(stream.id);
      setEditingField(null);
      loadPerformances(stream.id);
    },
    [loadPerformances],
  );

  useEffect(() => {
    if (!requestedStreamId || selectedStreamId !== null) return;
    const requested = streams.find((stream) => stream.id === requestedStreamId);
    if (requested) selectStream(requested);
  }, [requestedStreamId, selectedStreamId, selectStream, streams]);

  useEffect(() => {
    if (!requestedPerformanceId || selectedStreamId !== requestedStreamId) return;
    const index = performances.findIndex((performance) => performance.id === requestedPerformanceId);
    if (index >= 0) setSelectedIndex(index);
  }, [performances, requestedPerformanceId, requestedStreamId, selectedStreamId]);

  // --- Actions ---

  const markEndTimestamp = useCallback(async () => {
    if (selectedIndex < 0 || !playerRef.current) return;
    const perf = performances[selectedIndex];
    if (!perf) return;
    const currentTime = Math.floor(playerRef.current.getCurrentTime());

    try {
      await api.updatePerformanceTimestamps(perf.id, { endTimestamp: currentTime });
      setPerformances((prev) =>
        prev.map((p, i) => (i === selectedIndex ? { ...p, endTimestamp: currentTime } : p)),
      );
      showToast(`Marked ${perf.title} \u2192 ${formatTimestamp(currentTime)}`);
      loadStats();
      loadStreams();

      // Auto-advance to next unstamped
      const nextIdx = performances.findIndex(
        (p, i) => i > selectedIndex && p.endTimestamp === null,
      );
      if (nextIdx >= 0) {
        setSelectedIndex(nextIdx);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mark timestamp', true);
    }
  }, [performances, selectedIndex, showToast, loadStats, loadStreams]);

  const markStartTimestamp = useCallback(async () => {
    if (selectedIndex < 0 || !playerRef.current) return;
    const perf = performances[selectedIndex];
    if (!perf) return;
    const currentTime = Math.floor(playerRef.current.getCurrentTime());

    try {
      await api.updatePerformanceTimestamps(perf.id, { timestamp: currentTime });
      setPerformances((prev) =>
        prev.map((p, i) => (i === selectedIndex ? { ...p, timestamp: currentTime } : p)),
      );
      showToast(`Start ${perf.title} \u2192 ${formatTimestamp(currentTime)}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mark start', true);
    }
  }, [performances, selectedIndex, showToast]);

  const seekToStart = useCallback(() => {
    const perf = performances[selectedIndex];
    if (!perf || !playerRef.current) return;
    playerRef.current.seekTo(perf.timestamp);
    showToast(`Seek start → ${formatTimestamp(perf.timestamp)}`);
  }, [performances, selectedIndex, showToast]);

  const seekToEnd = useCallback((offsetSeconds: number) => {
    const perf = performances[selectedIndex];
    if (!perf?.endTimestamp || !playerRef.current) return;
    const target = Math.max(0, perf.endTimestamp - offsetSeconds);
    playerRef.current.seekTo(target);
    showToast(
      offsetSeconds > 0
        ? `Seek end -${offsetSeconds}s → ${formatTimestamp(target)} (end ${formatTimestamp(perf.endTimestamp)})`
        : `Seek end → ${formatTimestamp(perf.endTimestamp)}`
    );
  }, [performances, selectedIndex, showToast]);

  const selectNext = useCallback(() => {
    if (performances.length === 0) return;
    setSelectedIndex((i) => Math.min(i + 1, performances.length - 1));
  }, [performances.length]);

  const selectPrev = useCallback(() => {
    setSelectedIndex((i) => Math.max(i - 1, 0));
  }, []);

  const clearEndTimestamp = useCallback(
    async (perfId: string, idx: number) => {
      try {
        await api.updatePerformanceTimestamps(perfId, { endTimestamp: null });
        setPerformances((prev) =>
          prev.map((p, i) => (i === idx ? { ...p, endTimestamp: null } : p)),
        );
        showToast('Cleared end timestamp');
        loadStats();
        loadStreams();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to clear', true);
      }
    },
    [showToast, loadStats, loadStreams],
  );

  const deletePerformance = useCallback(
    async (perfId: string, idx: number) => {
      const perf = performances[idx];
      if (!perf) return;
      if (!confirm(`Delete #${idx + 1} ${perf.title}?`)) return;

      try {
        await api.deletePerformance(perfId);
        const newPerfs = performances.filter((_, i) => i !== idx);
        setPerformances(newPerfs);

        if (newPerfs.length === 0) {
          setSelectedIndex(-1);
        } else if (idx >= newPerfs.length) {
          setSelectedIndex(newPerfs.length - 1);
        } else {
          setSelectedIndex(idx);
        }
        showToast(`Deleted ${perf.title}`);
        loadStats();
        loadStreams();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to delete', true);
      }
    },
    [performances, showToast, loadStats, loadStreams],
  );

  const handleAddSong = useCallback(
    async (title: string, artist: string) => {
      if (!selectedStreamId || !playerRef.current) return;
      const timestamp = Math.floor(playerRef.current.getCurrentTime());

      try {
        await api.createStampPerformance(selectedStreamId, {
          title,
          originalArtist: artist || 'Unknown',
          timestamp,
        });
        setShowAddModal(false);
        await loadPerformances(selectedStreamId);
        showToast(`Added ${title} at ${formatTimestamp(timestamp)}`);
        loadStats();
        loadStreams();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to add song', true);
      }
    },
    [selectedStreamId, loadPerformances, showToast, loadStats, loadStreams],
  );

  const handlePasteImportDone = useCallback(
    async (result: { created: number; replaced: boolean }) => {
      setShowPasteImport(false);
      if (selectedStreamId) {
        await loadPerformances(selectedStreamId);
      }
      showToast(
        `Imported ${result.created} songs${result.replaced ? ' (replaced existing)' : ''}`,
      );
      loadStats();
      loadStreams();
    },
    [selectedStreamId, loadPerformances, showToast, loadStats, loadStreams],
  );

  const handleInlineEditSave = useCallback(
    async (index: number, field: 'title' | 'artist', value: string) => {
      const perf = performances[index];
      if (!perf) return;
      setEditingField(null);

      try {
        const body =
          field === 'title' ? { title: value } : { originalArtist: value };
        await api.updatePerformanceDetails(perf.id, body);
        setPerformances((prev) =>
          prev.map((p, i) =>
            i === index
              ? field === 'title'
                ? { ...p, title: value }
                : { ...p, originalArtist: value }
              : p,
          ),
        );
        showToast(`Updated ${field}`);
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Failed to update', true);
      }
    },
    [performances, showToast],
  );

  // --- Copy full VOD URL ---
  const copyVideoUrl = useCallback(() => {
    if (!selectedStream) return;
    const url = `https://www.youtube.com/watch?v=${selectedStream.videoId}`;
    navigator.clipboard.writeText(url).then(
      () => showToast(`Copied ${url}`),
      () => showToast('Failed to copy', true),
    );
  }, [selectedStream, showToast]);

  // --- Export song list ---
  const exportSongList = useCallback(() => {
    if (performances.length === 0) return;
    const text = formatSongList(performances);
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied song list to clipboard'),
      () => showToast('Failed to copy', true),
    );
  }, [performances, showToast]);

  // --- Clear all end timestamps (Step 4) ---
  const clearAllEndTimestampsAction = useCallback(async () => {
    if (!selectedStreamId) return;
    if (!confirm('Clear ALL end timestamps for this stream?')) return;

    try {
      const { cleared } = await api.clearAllEndTimestamps(selectedStreamId);
      setPerformances((prev) =>
        prev.map((p) => ({ ...p, endTimestamp: null })),
      );
      showToast(`Cleared ${cleared} end timestamps`);
      loadStats();
      loadStreams();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear', true);
    }
  }, [selectedStreamId, showToast, loadStats, loadStreams]);

  // --- Bulk approve all pending for this stream ---
  const approveAllAction = useCallback(async () => {
    if (!selectedStreamId) return;
    const pendingCount = performances.filter((p) => p.status === 'pending').length;
    if (pendingCount === 0) {
      showToast('No pending performances to approve');
      return;
    }
    if (!confirm(`Approve all ${pendingCount} pending songs & performances for this stream?`)) return;

    try {
      const { songs, performances: perfs } = await api.approveAllForStream(selectedStreamId);
      showToast(`Approved ${songs} songs, ${perfs} performances`);
      loadPerformances(selectedStreamId);
      loadStats();
      loadStreams();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to approve', true);
    }
  }, [selectedStreamId, performances, showToast, loadPerformances, loadStats, loadStreams]);

  // --- Fetch durations from iTunes (Steps 5 & 6) ---
  const refreshStampCounts = useCallback(() => {
    loadStats();
    loadStreams();
  }, [loadStats, loadStreams]);

  const saveEndTimestamp = useCallback(
    async (index: number, perf: StampPerformance, endTimestamp: number) => {
      await api.updatePerformanceTimestamps(perf.id, { endTimestamp });
      setPerformances((prev) =>
        prev.map((p, i) => (i === index ? { ...p, endTimestamp } : p)),
      );
    },
    [],
  );

  const { fetchDuration, fetchAllDurations } = useFetchAllDurations({
    performances,
    selectedIndex,
    showToast,
    appendFetchLog,
    saveEndTimestamp,
    onRefresh: refreshStampCounts,
  });

  // --- Keyboard shortcuts ---
  useEditorShortcuts(
    {
      markEndTimestamp,
      markStartTimestamp,
      seekToStart,
      seekToEnd,
      selectNext,
      selectPrev,
      copyVideoUrl,
      fetchDuration,
      fetchAllDurations,
      exportSongList,
      openPasteImport: () => {
        if (selectedStreamId) setShowPasteImport(true);
      },
    },
    { playerRef, disabled: showAddModal || showPasteImport },
  );

  // --- Filter streams ---
  const streamYears = useMemo(() => {
    const ySet = new Set<string>();
    for (const s of streams) {
      const y = s.date?.slice(0, 4);
      if (y) ySet.add(y);
    }
    return [...ySet].sort().reverse();
  }, [streams]);

  const filteredStreams = useMemo(() => {
    let list = streams;
    if (streamYearFilter) {
      list = list.filter((s) => s.date?.startsWith(streamYearFilter));
    }
    if (streamSearch) {
      const q = streamSearch.toLowerCase();
      list = list.filter(
        (s) => s.title.toLowerCase().includes(q) || s.date.includes(streamSearch),
      );
    }
    return list;
  }, [streams, streamYearFilter, streamSearch]);

  return {
    user,
    streamSearch,
    setStreamSearch,
    streamYearFilter,
    setStreamYearFilter,
    selectedStreamId,
    performances,
    selectedIndex,
    setSelectedIndex,
    toast,
    showAddModal,
    setShowAddModal,
    showPasteImport,
    setShowPasteImport,
    editingField,
    setEditingField,
    loading,
    stampStats,
    fetchLog,
    clearFetchLog,
    playerRef,
    currentTime,
    selectedStream,
    streamYears,
    filteredStreams,
    selectStream,
    clearEndTimestamp,
    deletePerformance,
    handleAddSong,
    handlePasteImportDone,
    handleInlineEditSave,
    exportSongList,
    clearAllEndTimestampsAction,
    approveAllAction,
  };
}

export type StampEditorController = ReturnType<typeof useStampEditorController>;

export function StampEditorView({ controller }: { controller: StampEditorController }) {
  const {
    user,
    streamSearch,
    setStreamSearch,
    streamYearFilter,
    setStreamYearFilter,
    selectedStreamId,
    performances,
    selectedIndex,
    toast,
    showAddModal,
    setShowAddModal,
    showPasteImport,
    setShowPasteImport,
    stampStats,
    fetchLog,
    clearFetchLog,
    playerRef,
    currentTime,
    selectedStream,
    streamYears,
    filteredStreams,
    selectStream,
    handleAddSong,
    handlePasteImportDone,
    exportSongList,
    clearAllEndTimestampsAction,
    approveAllAction,
  } = controller;

  return (
    <div className="flex h-full gap-4">
      {/* Stream sidebar */}
      <div className="flex w-64 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Streams</h3>
            {streamYears.length > 1 && (
              <select
                aria-label="Filter streams by year"
                value={streamYearFilter}
                onChange={(e) => setStreamYearFilter(e.target.value)}
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              >
                <option value="">All</option>
                {streamYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
          </div>
          <input
            type="text"
            aria-label="Search streams"
            placeholder="Search streams..."
            value={streamSearch}
            onChange={(e) => setStreamSearch(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filteredStreams.map((stream) => (
            <li key={stream.id}>
              <button
                type="button"
                onClick={() => selectStream(stream)}
                aria-pressed={stream.id === selectedStreamId}
                className={`block w-full cursor-pointer border-b border-slate-100 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 ${
                  stream.id === selectedStreamId
                    ? 'border-l-2 border-l-blue-500 bg-blue-50'
                    : ''
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-slate-800">
                    {stream.title || stream.videoId}
                  </span>
                  {stream.pendingCount > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                      {stream.pendingCount}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{stream.date}</span>
              </button>
            </li>
          ))}
          {filteredStreams.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-slate-400">No streams</li>
          )}
        </ul>
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden">
        {!selectedStreamId ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            Select a stream to start stamping
          </div>
        ) : (
          <>
            {/* YouTube Player */}
            <YouTubePlayer ref={playerRef} videoId={selectedStream?.videoId} />

            {/* Current playback time */}
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-lg font-semibold text-slate-800">
                {formatTimestamp(currentTime)}
              </span>
              <span className="text-slate-400">current</span>
            </div>

            {/* Floating playback time pill (non-clickable: the player is always pinned here) */}
            <FloatingPlaybackPill
              currentTime={currentTime}
              perf={selectedIndex >= 0 ? performances[selectedIndex] ?? null : null}
            />

            {/* Keyboard shortcuts hint */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">m</kbd>{' '}
                Mark end
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">t</kbd>{' '}
                Set start
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">s</kbd>{' '}
                Seek start
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">e</kbd>/
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">E</kbd>{' '}
                Seek end &minus;5s/exact
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">n</kbd>/
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">p</kbd>{' '}
                Next/prev
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">c</kbd>{' '}
                Copy URL
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">f</kbd>/
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">F</kbd>{' '}
                Fetch/all durations
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">x</kbd>{' '}
                Export
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">i</kbd>{' '}
                Paste import
              </span>
              <span>
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">&larr;</kbd>/
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">&rarr;</kbd>{' '}
                Seek &plusmn;5s
              </span>
            </div>

            {/* iTunes duration fetch log */}
            <FetchLogPanel entries={fetchLog} onClear={clearFetchLog} />

            {/* Stamp stats */}
            {stampStats && (
              <div className="text-xs text-slate-500">
                <span className="font-medium text-slate-700">{stampStats.filled}/{stampStats.total}</span> stamped
                {stampStats.remaining > 0 && (
                  <span className="ml-1 text-amber-600">({stampStats.remaining} remaining)</span>
                )}
              </div>
            )}

            {/* Song list header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700">Songs</h3>
                {performances.length > 0 && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {performances.filter((p) => p.endTimestamp === null).length} pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {user.role === 'curator' && performances.some((p) => p.status === 'pending') && (
                  <button
                    onClick={approveAllAction}
                    className="rounded-md border border-green-300 bg-green-50 px-3 py-1 text-sm font-medium text-green-700 hover:bg-green-100"
                  >
                    Approve All
                  </button>
                )}
                <button
                  onClick={clearAllEndTimestampsAction}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Clear All
                </button>
                <button
                  onClick={exportSongList}
                  disabled={performances.length === 0}
                  className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  Export
                </button>
                <button
                  onClick={() => setShowPasteImport(true)}
                  className="rounded-md border border-blue-600 px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50"
                >
                  Paste Import
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
                >
                  + Add Song
                </button>
              </div>
            </div>

            <SongList controller={controller} />
          </>
        )}
      </div>

      {/* Add Song Modal */}
      {showAddModal && (
        <AddSongModal
          onSubmit={handleAddSong}
          onCancel={() => setShowAddModal(false)}
        />
      )}

      {/* Paste Import Modal */}
      {showPasteImport && selectedStreamId && (
        <PasteImportModal
          streamId={selectedStreamId}
          hasExisting={performances.length > 0}
          onDone={handlePasteImportDone}
          onCancel={() => setShowPasteImport(false)}
        />
      )}

      {/* Toast */}
      <Toast toast={toast} />
    </div>
  );
}

function SongList({ controller }: { controller: StampEditorController }) {
  const {
    performances,
    loading,
    selectedIndex,
    setSelectedIndex,
    editingField,
    setEditingField,
    handleInlineEditSave,
    clearEndTimestamp,
    deletePerformance,
  } = controller;

  return (
    <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white">
      {loading ? (
        <div className="p-4 text-center text-sm text-slate-400">Loading...</div>
      ) : performances.length === 0 ? (
        <div className="p-4 text-center text-sm text-slate-400">
          No songs in this stream
        </div>
      ) : (
        <ul aria-label="Songs in selected stream">
          {performances.map((perf, i) => (
            <li
              key={perf.id}
              className={`flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm transition-colors hover:bg-slate-50 ${
                i === selectedIndex
                  ? 'border-l-2 border-l-blue-500 bg-blue-50'
                  : ''
              }`}
            >
              <button
                type="button"
                className="w-8 flex-shrink-0 text-left text-xs font-medium text-slate-400"
                onClick={() => {
                  setSelectedIndex(i);
                  setEditingField(null);
                }}
                aria-pressed={i === selectedIndex}
                title={`Select song ${i + 1}`}
              >
                #{i + 1}
              </button>

              <div className="min-w-0 flex-1">
                {editingField?.index === i && editingField.field === 'title' ? (
                  <InlineEdit
                    value={perf.title}
                    onSave={(val) => handleInlineEditSave(i, 'title', val)}
                    onCancel={() => setEditingField(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className="max-w-full cursor-text truncate text-left align-bottom font-medium text-slate-800"
                    onClick={() => setSelectedIndex(i)}
                    onDoubleClick={() => {
                      setEditingField({ index: i, field: 'title' });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault();
                        setEditingField({ index: i, field: 'title' });
                      }
                    }}
                    title="Double-click or press F2 to edit title"
                  >
                    {perf.title}
                  </button>
                )}
                {editingField?.index === i && editingField.field === 'artist' ? (
                  <InlineEdit
                    value={perf.originalArtist}
                    placeholder="add artist"
                    onSave={(val) => handleInlineEditSave(i, 'artist', val)}
                    onCancel={() => setEditingField(null)}
                  />
                ) : (
                  <button
                    type="button"
                    className={`ml-1 max-w-full cursor-text truncate text-left align-bottom text-xs ${
                      perf.originalArtist
                        ? 'text-slate-500'
                        : 'italic text-slate-400'
                    }`}
                    onClick={() => setSelectedIndex(i)}
                    onDoubleClick={() => {
                      setEditingField({ index: i, field: 'artist' });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'F2') {
                        event.preventDefault();
                        setEditingField({ index: i, field: 'artist' });
                      }
                    }}
                    title="Double-click or press F2 to edit artist"
                  >
                    {perf.originalArtist ? ` \u2014 ${perf.originalArtist}` : ' add artist'}
                  </button>
                )}
              </div>

              <span className="flex-shrink-0 text-xs text-slate-500">
                {formatTimestamp(perf.timestamp)}
              </span>
              <span className="flex-shrink-0 text-xs font-medium">
                &rarr;
              </span>
              <span
                className={`flex-shrink-0 text-xs font-medium ${
                  perf.endTimestamp !== null
                    ? 'text-green-600'
                    : 'text-slate-300'
                }`}
              >
                {perf.endTimestamp !== null
                  ? formatTimestamp(perf.endTimestamp)
                  : '\u2014'}
              </span>

              {perf.endTimestamp !== null && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearEndTimestamp(perf.id, i);
                  }}
                  className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                  title="Clear end timestamp"
                >
                  &#x21BA;
                </button>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deletePerformance(perf.id, i);
                }}
                className="flex-shrink-0 rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                title="Delete song"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function StampEditor({ user }: { user: AuthUser }) {
  const controller = useStampEditorController(user);
  return <StampEditorView controller={controller} />;
}
