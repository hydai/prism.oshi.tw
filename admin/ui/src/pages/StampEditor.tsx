import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AuthUser, StreamWithPending, StampPerformance, StampStats } from '../../../shared/types';
import { api } from '../api/client';
import { YouTubePlayer } from '../components/YouTubePlayer';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { parseTextToSongs, formatSongList } from '../../../shared/parse';

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

// --- Toast ---

interface ToastState {
  message: string;
  isError: boolean;
  key: number;
}

function Toast({ toast }: { toast: ToastState | null }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timerRef.current);
  }, [toast]);

  if (!toast || !visible) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-opacity ${
        toast.isError
          ? 'bg-red-600 text-white'
          : 'bg-slate-800 text-white'
      }`}
    >
      {toast.message}
    </div>
  );
}

// --- Add Song Modal ---

function AddSongModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, artist: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), artist.trim());
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-slate-800">Add Song</h3>
        <div className="mt-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            placeholder="Song title *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
          <input
            type="text"
            placeholder="Original artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Paste Import Modal ---

function PasteImportModal({
  streamId,
  hasExisting,
  onDone,
  onCancel,
}: {
  streamId: string;
  hasExisting: boolean;
  onDone: (result: { created: number; replaced: boolean }) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const preview = useMemo(() => parseTextToSongs(text), [text]);

  const handleImport = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    setError(null);

    try {
      const result = await api.pasteImport(streamId, {
        text,
        replace: replaceMode,
      });
      if (!result.ok) {
        setError(result.errors.join(', ') || 'Import failed');
        setImporting(false);
        return;
      }
      onDone({ created: result.created, replaced: result.replaced });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl" style={{ maxHeight: '85vh' }}>
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">Paste Import</h3>
          <p className="mt-1 text-sm text-slate-500">
            Paste a timestamp list (e.g. "5:30 Song Name - Artist")
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`0:00 Song Title / Artist Name\n3:45 Another Song - Another Artist\n7:20 Third Song`}
            className="h-40 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          {hasExisting && (
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={replaceMode}
                onChange={(e) => setReplaceMode(e.target.checked)}
                className="rounded border-slate-300"
              />
              Replace existing performances (delete current songs first)
            </label>
          )}

          {/* Preview table */}
          {preview.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-slate-700">
                Preview ({preview.length} songs)
              </h4>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th>
                      <th className="px-3 py-2">Start</th>
                      <th className="px-3 py-2">End</th>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2">Artist</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((song, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{song.startTimestamp}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-400">
                          {song.endTimestamp ?? '—'}
                        </td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">{song.songName}</td>
                        <td className="px-3 py-1.5 text-slate-500">{song.artist || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            disabled={importing}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={preview.length === 0 || importing}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? 'Importing...' : `Import ${preview.length} Songs`}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Inline Edit ---

function InlineEdit({
  value,
  placeholder,
  onSave,
  onCancel,
}: {
  value: string;
  placeholder?: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
      className="w-full rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

// --- Main component ---

interface EditingField {
  index: number;
  field: 'title' | 'artist';
}

export default function StampEditor({ user }: { user: AuthUser }) {
  // Stream state
  const [streams, setStreams] = useState<StreamWithPending[]>([]);
  const [streamSearch, setStreamSearch] = useState('');
  const [streamYearFilter, setStreamYearFilter] = useState('');
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);

  // Performance state
  const [performances, setPerformances] = useState<StampPerformance[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // UI state
  const [toast, setToast] = useState<ToastState | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [loading, setLoading] = useState(false);

  // Stamp stats
  const [stampStats, setStampStats] = useState<StampStats | null>(null);

  // Fetch-all state
  const [isFetchingAll, setIsFetchingAll] = useState(false);

  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const toastKeyRef = useRef(0);

  const selectedStream = streams.find((s) => s.id === selectedStreamId);

  // --- Toast helper ---
  const showToast = useCallback((message: string, isError = false) => {
    toastKeyRef.current += 1;
    setToast({ message, isError, key: toastKeyRef.current });
  }, []);

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
  }, [performances, selectedIndex]);

  const seekToEnd = useCallback(() => {
    const perf = performances[selectedIndex];
    if (!perf?.endTimestamp || !playerRef.current) return;
    playerRef.current.seekTo(Math.max(0, perf.endTimestamp - 10));
  }, [performances, selectedIndex]);

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

  // --- Fetch duration from iTunes (Step 5) ---
  const fetchDuration = useCallback(async () => {
    if (selectedIndex < 0) return;
    const perf = performances[selectedIndex];
    if (!perf) return;

    showToast(`Fetching duration for ${perf.title}...`);
    try {
      const result = await api.fetchPerformanceDuration(perf.id);
      if (result.endTimestamp !== null) {
        setPerformances((prev) =>
          prev.map((p, i) =>
            i === selectedIndex ? { ...p, endTimestamp: result.endTimestamp } : p,
          ),
        );
        showToast(`${perf.title}: ${result.durationSec}s (${result.matchConfidence})`);
        loadStats();
        loadStreams();
      } else if (result.durationSec) {
        showToast(`${perf.title}: ${result.durationSec}s (already has end timestamp)`);
      } else {
        showToast(`${perf.title}: no match on iTunes`, true);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Fetch failed', true);
    }
  }, [performances, selectedIndex, showToast, loadStats, loadStreams]);

  // --- Fetch all missing durations (Step 6) ---
  const fetchAllDurations = useCallback(async () => {
    if (isFetchingAll) return;
    const missing = performances
      .map((p, i) => ({ perf: p, index: i }))
      .filter(({ perf }) => perf.endTimestamp === null);
    if (missing.length === 0) {
      showToast('All songs already have end timestamps');
      return;
    }

    setIsFetchingAll(true);
    let fetched = 0;
    let noMatch = 0;
    let errors = 0;

    for (let i = 0; i < missing.length; i++) {
      const { perf, index } = missing[i]!;
      showToast(`Fetching ${i + 1}/${missing.length}: ${perf.title}...`);

      try {
        const result = await api.fetchPerformanceDuration(perf.id);
        if (result.endTimestamp !== null) {
          fetched++;
          setPerformances((prev) =>
            prev.map((p, j) =>
              j === index ? { ...p, endTimestamp: result.endTimestamp } : p,
            ),
          );
        } else {
          noMatch++;
        }
      } catch {
        errors++;
      }

      // 1s delay between calls to respect iTunes rate limits
      if (i < missing.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    setIsFetchingAll(false);
    loadStats();
    loadStreams();
    showToast(`Fetched ${fetched}/${missing.length}, ${noMatch} no match, ${errors} errors`);
  }, [performances, isFetchingAll, showToast, loadStats, loadStreams]);

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'm':
          markEndTimestamp();
          break;
        case 't':
          markStartTimestamp();
          break;
        case 's':
          seekToStart();
          break;
        case 'e':
          seekToEnd();
          break;
        case 'n':
          selectNext();
          break;
        case 'p':
          selectPrev();
          break;
        case 'c':
          copyVideoUrl();
          break;
        case 'f':
          fetchDuration();
          break;
        case 'F':
          fetchAllDurations();
          break;
        case 'x':
          exportSongList();
          break;
        case 'i':
          if (selectedStreamId) setShowPasteImport(true);
          break;
        case 'ArrowLeft':
          if (playerRef.current) {
            e.preventDefault();
            playerRef.current.seekTo(playerRef.current.getCurrentTime() - 5);
          }
          break;
        case 'ArrowRight':
          if (playerRef.current) {
            e.preventDefault();
            playerRef.current.seekTo(playerRef.current.getCurrentTime() + 5);
          }
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [markEndTimestamp, markStartTimestamp, seekToStart, seekToEnd, selectNext, selectPrev, copyVideoUrl, exportSongList, fetchDuration, fetchAllDurations, selectedStreamId]);

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

  // --- Render ---

  return (
    <div className="flex h-full gap-4">
      {/* Stream sidebar */}
      <div className="flex w-64 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Streams</h3>
            {streamYears.length > 1 && (
              <select
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
            placeholder="Search streams..."
            value={streamSearch}
            onChange={(e) => setStreamSearch(e.target.value)}
            className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <ul className="flex-1 overflow-y-auto">
          {filteredStreams.map((stream) => (
            <li
              key={stream.id}
              onClick={() => selectStream(stream)}
              className={`cursor-pointer border-b border-slate-100 px-3 py-2.5 transition-colors hover:bg-slate-50 ${
                stream.id === selectedStreamId
                  ? 'border-l-2 border-l-blue-500 bg-blue-50'
                  : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-800">
                  {stream.title || stream.videoId}
                </span>
                {stream.pendingCount > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    {stream.pendingCount}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{stream.date}</div>
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
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">s</kbd>/
                <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">e</kbd>{' '}
                Seek start/end
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

            {/* Song list */}
            <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {loading ? (
                <div className="p-4 text-center text-sm text-slate-400">Loading...</div>
              ) : performances.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-400">
                  No songs in this stream
                </div>
              ) : (
                <ul>
                  {performances.map((perf, i) => (
                    <li
                      key={perf.id}
                      onClick={() => {
                        setSelectedIndex(i);
                        setEditingField(null);
                      }}
                      className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm transition-colors hover:bg-slate-50 ${
                        i === selectedIndex
                          ? 'border-l-2 border-l-blue-500 bg-blue-50'
                          : ''
                      }`}
                    >
                      {/* Index */}
                      <span className="w-8 flex-shrink-0 text-xs font-medium text-slate-400">
                        #{i + 1}
                      </span>

                      {/* Song name + artist (editable) */}
                      <div className="min-w-0 flex-1">
                        {editingField?.index === i && editingField.field === 'title' ? (
                          <InlineEdit
                            value={perf.title}
                            onSave={(val) => handleInlineEditSave(i, 'title', val)}
                            onCancel={() => setEditingField(null)}
                          />
                        ) : (
                          <span
                            className="cursor-text truncate font-medium text-slate-800"
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setEditingField({ index: i, field: 'title' });
                            }}
                            title="Double-click to edit title"
                          >
                            {perf.title}
                          </span>
                        )}
                        {editingField?.index === i && editingField.field === 'artist' ? (
                          <InlineEdit
                            value={perf.originalArtist}
                            placeholder="add artist"
                            onSave={(val) => handleInlineEditSave(i, 'artist', val)}
                            onCancel={() => setEditingField(null)}
                          />
                        ) : (
                          <span
                            className={`ml-1 cursor-text truncate text-xs ${
                              perf.originalArtist
                                ? 'text-slate-500'
                                : 'italic text-slate-400'
                            }`}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setEditingField({ index: i, field: 'artist' });
                            }}
                            title="Double-click to edit artist"
                          >
                            {perf.originalArtist ? ` \u2014 ${perf.originalArtist}` : ' add artist'}
                          </span>
                        )}
                      </div>

                      {/* Timestamps */}
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

                      {/* Undo clear end timestamp */}
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

                      {/* Delete */}
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
