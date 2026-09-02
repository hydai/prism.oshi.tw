import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import type { AuthUser, StreamDetail as StreamDetailType, StampPerformance, Status, Stream } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { YouTubePlayer } from '../components/YouTubePlayer';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { FetchLogPanel } from '../components/FetchLogPanel';
import { FloatingPlaybackPill } from '../components/FloatingPlaybackPill';
import { PlaybackTime } from '../components/PlaybackTime';
import { Toast } from '../components/stamp/Toast';
import { InlineEdit } from '../components/stamp/InlineEdit';
import { AddSongModal } from '../components/stamp/AddSongModal';
import { PasteImportModal } from '../components/stamp/PasteImportModal';
import { useToast } from '../hooks/useToast';
import { useFetchLog } from '../hooks/useFetchLog';
import { useEditorShortcuts } from '../hooks/useEditorShortcuts';
import { useFetchAllDurations } from '../hooks/useFetchAllDurations';
import { usePerformances } from '../hooks/usePerformances';
import { usePlayerClock } from '../hooks/usePlayerClock';
import { formatTimestamp } from '../lib/format-timestamp';

// --- Inline Date Edit ---

function InlineDateEdit({ value, label, onSave, onCancel }: {
  value: string; label: string;
  onSave: (val: string) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    if (date && date !== value) onSave(date);
    else onCancel();
  };

  return (
    <input
      ref={inputRef} type="date" aria-label={label} value={date}
      onChange={(e) => setDate(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={commit}
      className="rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

// --- Main component ---

type EditingField =
  | { type: 'perf'; perfId: string; field: 'title' | 'artist' | 'note' }
  | { type: 'stream'; field: 'title' | 'date' };

function useStreamDetailController(user: AuthUser) {
  const { id: streamId } = useParams<{ id: string }>();
  const [initialParams] = useSearchParams();
  const requestedPerformanceId = initialParams.get('performance');
  const navigate = useNavigate();
  const [detail, setDetail] = useState<StreamDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const playerBoxRef = useRef<HTMLDivElement>(null);
  // The playback clock lives in an external store: only the pill and the readout hear its ticks.
  usePlayerClock(playerRef);

  // --- New state for navigation & stamp features ---
  const [allStreams, setAllStreams] = useState<Stream[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showAddModal, setShowAddModal] = useState(false);

  const isCurator = user.role === 'curator';

  const { toast, showToast } = useToast();
  const { fetchLog, appendFetchLog, clearFetchLog } = useFetchLog();

  // --- Fetch all streams for prev/next navigation ---
  useEffect(() => {
    api.listStreams().then(({ data }) => {
      const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
      setAllStreams(sorted);
    }).catch(() => {});
  }, []);

  // --- Derive prev/next streams ---
  const { prevStream, nextStream } = useMemo(() => {
    if (!streamId || allStreams.length === 0) return { prevStream: null, nextStream: null };
    const idx = allStreams.findIndex(s => s.id === streamId);
    if (idx < 0) return { prevStream: null, nextStream: null };
    return {
      prevStream: idx > 0 ? allStreams[idx - 1] : null,
      nextStream: idx < allStreams.length - 1 ? allStreams[idx + 1] : null,
    };
  }, [streamId, allStreams]);

  // --- Reset UI state on stream change ---
  useEffect(() => {
    setSelectedIndex(-1);
    setShowAddModal(false);
    setShowPasteImport(false);
    setEditingField(null);
    setError(null);
  }, [streamId]);

  const loadDetail = useCallback(async () => {
    if (!streamId) return;
    setLoading(true);
    try {
      const d = await api.getStreamDetail(streamId);
      setDetail(d);
      setSelectedIndex(prev => {
        if (d.performances.length === 0) return -1;
        if (requestedPerformanceId) {
          const requestedIndex = d.performances.findIndex((performance) => performance.id === requestedPerformanceId);
          if (requestedIndex >= 0) return requestedIndex;
        }
        if (prev < 0) return 0;
        return Math.min(prev, d.performances.length - 1);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stream');
    } finally {
      setLoading(false);
    }
  }, [requestedPerformanceId, streamId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (!detail || !requestedPerformanceId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`performance-row-${requestedPerformanceId}`)?.scrollIntoView({
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, requestedPerformanceId]);

  // --- Optimistic update helpers ---
  const patchRow = useCallback((index: number, updates: Partial<StampPerformance>) => {
    setDetail(prev => prev ? {
      ...prev,
      performances: prev.performances.map((p, i) => i === index ? { ...p, ...updates } : p),
    } : prev);
  }, []);

  const patchAllRows = useCallback((updates: Partial<StampPerformance>) => {
    setDetail(prev => prev ? {
      ...prev,
      performances: prev.performances.map(p => ({ ...p, ...updates })),
    } : prev);
  }, []);

  const closeAddModal = useCallback(() => setShowAddModal(false), []);

  const {
    markEndTimestamp,
    markStartTimestamp,
    seekToStart,
    seekToEnd,
    selectNext,
    selectPrev,
    clearEndTimestamp,
    clearAllEndTimestamps,
    addSong,
    saveEndTimestamp,
    exportSongList,
  } = usePerformances({
    streamId,
    performances: detail ? detail.performances : null,
    selectedIndex,
    setSelectedIndex,
    playerRef,
    showToast,
    patchRow,
    patchAllRows,
    reload: loadDetail,
    onSongCreated: closeAddModal,
  });

  // --- Status action ---
  const handleStreamStatus = useCallback(async (status: Status) => {
    if (!streamId || !detail) return;
    try {
      await api.updateStreamStatus(streamId, { status });
      // Approving a stream cascades to its songs/performances, matching the Streams
      // list page's Approve button so "approve a stream" never silently leaves its
      // songs pending. The standalone "Approve All" button stays for re-approving
      // songs added after the stream was already approved.
      if (status === 'approved') {
        const result = await api.approveAllForStream(streamId);
        await loadDetail();
        showToast(`Stream approved · ${result.songs} song(s), ${result.performances} performance(s)`);
      } else {
        setDetail((prev) => prev ? { ...prev, status } : prev);
        showToast(`Stream ${status}`);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', true);
    }
  }, [streamId, detail, loadDetail, showToast]);

  // --- Stream metadata inline edit save ---
  const handleStreamSave = useCallback(async (field: 'title' | 'date', value: string) => {
    if (!streamId) return;
    setEditingField(null);
    try {
      await api.updateStream(streamId, { [field]: value });
      await loadDetail();
      showToast(`Updated stream ${field}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update', true);
    }
  }, [streamId, loadDetail, showToast]);

  // --- Inline edit save ---
  const handleSave = useCallback(async (perfId: string, field: 'title' | 'artist' | 'note', value: string) => {
    setEditingField(null);
    try {
      if (field === 'note') {
        await api.updatePerformanceNote(perfId, value);
      } else {
        const body = field === 'title' ? { title: value } : { originalArtist: value };
        await api.updatePerformanceDetails(perfId, body);
      }
      await loadDetail();
      showToast(`Updated ${field}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update', true);
    }
  }, [loadDetail, showToast]);

  // --- Delete performance ---
  const handleDelete = useCallback(async (perf: StampPerformance) => {
    if (!confirm(`Delete "${perf.title}"?`)) return;
    try {
      await api.deletePerformance(perf.id);
      await loadDetail();
      showToast(`Deleted ${perf.title}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete', true);
    }
  }, [loadDetail, showToast]);

  // --- Performance status ---
  const handlePerformanceStatus = useCallback(async (perfId: string, status: Status) => {
    try {
      await api.updatePerformanceStatus(perfId, status);
      await loadDetail();
      showToast(`Performance ${status}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', true);
    }
  }, [loadDetail, showToast]);

  // --- Bulk approve all ---
  const handleApproveAll = useCallback(async () => {
    if (!streamId || !detail) return;
    const pendingCount = detail.performances.filter((p) => p.status !== 'approved').length;
    if (!confirm(`Approve all ${pendingCount} pending performances?`)) return;
    try {
      const result = await api.approveAllForStream(streamId);
      await loadDetail();
      showToast(`Approved ${result.songs} songs, ${result.performances} performances`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to approve all', true);
    }
  }, [streamId, detail, loadDetail, showToast]);

  // --- Bulk unapprove all ---
  const handleUnapproveAll = useCallback(async () => {
    if (!streamId || !detail) return;
    const approvedCount = detail.performances.filter((p) => p.status === 'approved').length;
    if (!confirm(`Unapprove all ${approvedCount} approved performances?`)) return;
    try {
      const result = await api.unapproveAllForStream(streamId);
      await loadDetail();
      showToast(`Unapproved ${result.songs} songs, ${result.performances} performances`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to unapprove all', true);
    }
  }, [streamId, detail, loadDetail, showToast]);

  // --- Hard-delete stream (blocked server-side for approved streams) ---
  const handleDeleteStream = useCallback(async () => {
    if (!streamId || !detail) return;
    const perfCount = detail.performances.length;
    if (!confirm(`Delete stream "${detail.title}" with ${perfCount} performances and their orphaned songs? This cannot be undone.`)) return;
    try {
      const result = await api.deleteStream(streamId);
      showToast(`Deleted stream (${result.songs} songs, ${result.performances} performances)`);
      navigate('/streams');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to delete stream', true);
    }
  }, [streamId, detail, navigate, showToast]);

  // --- Paste import done ---
  const handlePasteImportDone = useCallback(async (result: { created: number; replaced: boolean }) => {
    setShowPasteImport(false);
    await loadDetail();
    showToast(`Imported ${result.created} songs${result.replaced ? ' (replaced)' : ''}`);
  }, [loadDetail, showToast]);

  // --- Copy full VOD URL ---
  const copyVodUrl = useCallback(() => {
    if (!detail) return;
    const url = `https://www.youtube.com/watch?v=${detail.videoId}`;
    navigator.clipboard.writeText(url).then(
      () => showToast(`Copied ${url}`),
      () => showToast('Failed to copy', true),
    );
  }, [detail, showToast]);

  // --- iTunes duration lookup ---
  const { fetchDuration, fetchAllDurations } = useFetchAllDurations({
    performances: detail ? detail.performances : null,
    selectedIndex,
    showToast,
    appendFetchLog,
    saveEndTimestamp,
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
      copyVideoUrl: copyVodUrl,
      fetchDuration,
      fetchAllDurations,
      exportSongList,
      openPasteImport: () => {
        if (streamId) setShowPasteImport(true);
      },
    },
    { playerRef, disabled: showAddModal || showPasteImport },
  );

  // --- Derived values ---
  const unstampedCount = detail ? detail.performances.filter(p => p.endTimestamp === null).length : 0;

  return {
    streamId,
    detail,
    loading,
    error,
    toast,
    editingField,
    setEditingField,
    showPasteImport,
    setShowPasteImport,
    playerRef,
    playerBoxRef,
    selectedIndex,
    setSelectedIndex,
    showAddModal,
    setShowAddModal,
    fetchLog,
    clearFetchLog,
    isCurator,
    prevStream,
    nextStream,
    unstampedCount,
    handleStreamStatus,
    handleStreamSave,
    handleDeleteStream,
    handlePasteImportDone,
    copyVodUrl,
    exportSongList,
    handleSave,
    handleDelete,
    handlePerformanceStatus,
    handleApproveAll,
    handleUnapproveAll,
    clearEndTimestamp,
    clearAllEndTimestamps,
    handleAddSong: addSong,
  };
}

export type StreamDetailController = ReturnType<typeof useStreamDetailController>;

export function StreamDetailView({ controller }: { controller: StreamDetailController }) {
  const {
    streamId,
    detail,
    loading,
    error,
    toast,
    editingField,
    setEditingField,
    showPasteImport,
    setShowPasteImport,
    playerRef,
    playerBoxRef,
    selectedIndex,
    showAddModal,
    setShowAddModal,
    fetchLog,
    clearFetchLog,
    isCurator,
    prevStream,
    nextStream,
    unstampedCount,
    handleStreamStatus,
    handleStreamSave,
    handleDeleteStream,
    handlePasteImportDone,
    copyVodUrl,
    exportSongList,
    handleApproveAll,
    handleUnapproveAll,
    clearAllEndTimestamps,
    handleAddSong,
  } = controller;

  if (loading) return <div className="text-slate-500">Loading...</div>;
  if (error || !detail) return <div className="text-red-600">{error ?? 'Stream not found'}</div>;

  return (
    <div>
      {/* Breadcrumb with prev/next navigation */}
      <div className="mb-4 flex items-center justify-between text-sm">
        <div className="w-40">
          {prevStream && (
            <Link to={`/streams/${prevStream.id}`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <span>&larr;</span>
              <span>{prevStream.date}</span>
            </Link>
          )}
        </div>
        <div className="text-slate-500">
          <Link to="/streams" className="text-blue-600 hover:underline">Streams</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-700">{detail.title || detail.videoId}</span>
        </div>
        <div className="flex w-40 justify-end">
          {nextStream && (
            <Link to={`/streams/${nextStream.id}`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
              <span>{nextStream.date}</span>
              <span>&rarr;</span>
            </Link>
          )}
        </div>
      </div>

      {/* Stream header */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">
              {editingField?.type === 'stream' && editingField.field === 'title' ? (
                <InlineEdit allowEmpty value={detail.title} onSave={(v) => handleStreamSave('title', v)} onCancel={() => setEditingField(null)} />
              ) : (
                <span className={isCurator ? 'cursor-text' : ''} onDoubleClick={() => { if (isCurator) setEditingField({ type: 'stream', field: 'title' }); }} title={isCurator ? 'Double-click to edit' : undefined}>
                  {detail.title}
                </span>
              )}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {editingField?.type === 'stream' && editingField.field === 'date' ? (
                <InlineDateEdit value={detail.date} label="Stream date" onSave={(v) => handleStreamSave('date', v)} onCancel={() => setEditingField(null)} />
              ) : (
                <span className={isCurator ? 'cursor-text' : ''} onDoubleClick={() => { if (isCurator) setEditingField({ type: 'stream', field: 'date' }); }} title={isCurator ? 'Double-click to edit' : undefined}>
                  {detail.date}
                </span>
              )}
              <a href={`https://www.youtube.com/watch?v=${detail.videoId}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {detail.videoId}
              </a>
              <button onClick={copyVodUrl} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200">
                Copy URL
              </button>
              <StatusBadge status={detail.status} />
            </div>
            {detail.credit.author && (
              <p className="mt-1 text-xs text-slate-400">
                Credit: {detail.credit.author}
              </p>
            )}
          </div>
          {isCurator && (
            <div className="flex flex-wrap gap-2">
              {(detail.status === 'pending' || detail.status === 'extracted') && (
                <>
                  <button onClick={() => handleStreamStatus('approved')} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700">Approve</button>
                  <button onClick={() => handleStreamStatus('rejected')} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">Reject</button>
                </>
              )}
              {detail.status === 'approved' && (
                <button onClick={() => handleStreamStatus('pending')} className="rounded bg-yellow-500 px-3 py-1.5 text-sm text-white hover:bg-yellow-600">Unapprove</button>
              )}
              {detail.status !== 'excluded' && (
                <button onClick={() => handleStreamStatus('excluded')} className="rounded bg-slate-500 px-3 py-1.5 text-sm text-white hover:bg-slate-600">Exclude</button>
              )}
              {detail.status === 'excluded' && (
                <button onClick={() => handleStreamStatus('pending')} className="rounded bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600">Restore</button>
              )}
              {/* Hard delete is blocked for approved streams — unapprove first */}
              {detail.status !== 'approved' && (
                <button onClick={handleDeleteStream} className="rounded bg-red-800 px-3 py-1.5 text-sm text-white hover:bg-red-900">Delete stream</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* YouTube Player */}
      <div className="mt-4" ref={playerBoxRef}>
        <YouTubePlayer ref={playerRef} videoId={detail.videoId} />

        {/* Current playback time */}
        <div className="mt-2 flex items-center gap-2 text-sm">
          <PlaybackTime className="font-mono text-lg font-semibold text-slate-800" />
          <span className="text-slate-400">current</span>
        </div>
      </div>

      {/* Floating playback time pill (always visible; click scrolls back to the player) */}
      <FloatingPlaybackPill
        perf={selectedIndex >= 0 ? detail.performances[selectedIndex] ?? null : null}
        onClick={() => playerBoxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />

      {/* Keyboard shortcut hints */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">m</kbd>{' '}Mark end
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">t</kbd>{' '}Set start
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">s</kbd>{' '}Seek start
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">e</kbd>/
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">E</kbd>{' '}Seek end &minus;5s/exact
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">n</kbd>/
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">p</kbd>{' '}Next/prev
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">c</kbd>{' '}Copy URL
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">f</kbd>/
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">F</kbd>{' '}Fetch/all durations
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">x</kbd>{' '}Export
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">i</kbd>{' '}Paste import
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">&larr;</kbd>/
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">&rarr;</kbd>{' '}Seek &plusmn;5s
        </span>
      </div>

      {/* iTunes duration fetch log */}
      <FetchLogPanel entries={fetchLog} onClear={clearFetchLog} />

      {/* Performances header */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-800">
            Performances ({detail.performances.length})
          </h3>
          {unstampedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {unstampedCount} unstamped
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {isCurator && detail.performances.some((p) => p.status !== 'approved') && (
            <button onClick={handleApproveAll}
              className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700">
              Approve All
            </button>
          )}
          {isCurator && detail.performances.some((p) => p.status === 'approved') && (
            <button onClick={handleUnapproveAll}
              className="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-white hover:bg-amber-600">
              Unapprove All
            </button>
          )}
          <button onClick={() => setShowAddModal(true)}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
            + Add Song
          </button>
          <button onClick={clearAllEndTimestamps}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Clear All
          </button>
          <button onClick={exportSongList}
            disabled={detail.performances.length === 0}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50">
            Export
          </button>
          <button onClick={() => setShowPasteImport(true)}
            className="rounded-md border border-blue-600 px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50">
            Paste Import
          </button>
          <Link to="/stamp" className="rounded-md bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-300">
            Open in Stamp Editor
          </Link>
        </div>
      </div>

      <PerformanceTable controller={controller} />

      {/* Add Song Modal */}
      {showAddModal && (
        <AddSongModal onSubmit={handleAddSong} onCancel={() => setShowAddModal(false)} />
      )}

      {/* Paste Import Modal */}
      {showPasteImport && streamId && (
        <PasteImportModal
          streamId={streamId}
          hasExisting={detail.performances.length > 0}
          example={'0:00 Song Title / Artist Name\n3:45 Another Song - Another Artist'}
          replaceLabel="Replace existing performances"
          onDone={handlePasteImportDone}
          onCancel={() => setShowPasteImport(false)}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

function PerformanceTable({ controller }: { controller: StreamDetailController }) {
  const {
    detail,
    editingField,
    setEditingField,
    playerRef,
    selectedIndex,
    setSelectedIndex,
    isCurator,
    handleSave,
    handleDelete,
    handlePerformanceStatus,
    clearEndTimestamp,
  } = controller;

  if (!detail) return null;

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      {detail.performances.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-400">No performances in this stream.</div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Artist</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.performances.map((perf, i) => (
              <tr key={perf.id} id={`performance-row-${perf.id}`}
                onClick={() => { setSelectedIndex(i); setEditingField(null); }}
                className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                  i === selectedIndex ? 'border-l-2 border-l-blue-500 bg-blue-50' : ''
                }`}>
                <td className="px-4 py-3 text-slate-400">{i + 1}</td>

                <td className="px-4 py-3">
                  {editingField?.type === 'perf' && editingField.perfId === perf.id && editingField.field === 'title' ? (
                    <InlineEdit allowEmpty value={perf.title} onSave={(v) => handleSave(perf.id, 'title', v)} onCancel={() => setEditingField(null)} />
                  ) : (
                    <span className="cursor-text font-medium text-slate-800" onDoubleClick={(e) => { e.stopPropagation(); setEditingField({ type: 'perf', perfId: perf.id, field: 'title' }); }} title="Double-click to edit">
                      {perf.title}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3">
                  {editingField?.type === 'perf' && editingField.perfId === perf.id && editingField.field === 'artist' ? (
                    <InlineEdit allowEmpty value={perf.originalArtist} placeholder="add artist" onSave={(v) => handleSave(perf.id, 'artist', v)} onCancel={() => setEditingField(null)} />
                  ) : (
                    <span className={`cursor-text ${perf.originalArtist ? 'text-slate-600' : 'italic text-slate-400'}`}
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingField({ type: 'perf', perfId: perf.id, field: 'artist' }); }} title="Double-click to edit">
                      {perf.originalArtist || 'add artist'}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 font-mono text-xs">
                  <button onClick={(e) => { e.stopPropagation(); playerRef.current?.seekTo(perf.timestamp); }} className="text-blue-600 hover:underline" title="Seek to start">
                    {formatTimestamp(perf.timestamp)}
                  </button>
                </td>
                <td className={`px-4 py-3 font-mono text-xs ${perf.endTimestamp !== null ? 'text-green-600' : 'text-slate-300'}`}>
                  <span className="inline-flex items-center gap-1">
                    {perf.endTimestamp !== null ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); playerRef.current?.seekTo(Math.max(0, perf.endTimestamp! - (e.shiftKey ? 0 : 5))); }} className="hover:underline" title="Seek end -5s (Shift+click: exact end)">
                          {formatTimestamp(perf.endTimestamp)}
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); clearEndTimestamp(perf.id, i); }}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600" title="Clear end timestamp">
                          &#x21BA;
                        </button>
                      </>
                    ) : '—'}
                  </span>
                </td>

                <td className="max-w-48 px-4 py-3">
                  {editingField?.type === 'perf' && editingField.perfId === perf.id && editingField.field === 'note' ? (
                    <InlineEdit allowEmpty value={perf.note} placeholder="add note" onSave={(v) => handleSave(perf.id, 'note', v)} onCancel={() => setEditingField(null)} />
                  ) : (
                    <span className={`cursor-text truncate text-xs ${perf.note ? 'text-slate-600' : 'italic text-slate-400'}`}
                      onDoubleClick={(e) => { e.stopPropagation(); setEditingField({ type: 'perf', perfId: perf.id, field: 'note' }); }} title="Double-click to edit note">
                      {perf.note || 'add note'}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3"><StatusBadge status={perf.status} /></td>

                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {isCurator && perf.status !== 'approved' && (
                      <button onClick={(e) => { e.stopPropagation(); handlePerformanceStatus(perf.id, 'approved'); }}
                        className="rounded px-1.5 py-0.5 text-xs text-green-600 hover:bg-green-100" title="Approve">
                        &#x2713;
                      </button>
                    )}
                    {isCurator && perf.status === 'approved' && (
                      <button onClick={(e) => { e.stopPropagation(); handlePerformanceStatus(perf.id, 'pending'); }}
                        className="rounded px-1.5 py-0.5 text-xs text-yellow-600 hover:bg-yellow-100" title="Unapprove">
                        &#x21A9;
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(perf); }}
                      className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600" title="Delete">
                      &times;
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function StreamDetail({ user }: { user: AuthUser }) {
  const controller = useStreamDetailController(user);
  return <StreamDetailView controller={controller} />;
}
