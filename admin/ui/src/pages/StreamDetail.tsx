import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { AuthUser, StreamDetail as StreamDetailType, StampPerformance, Status, Stream } from '../../../shared/types';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import { YouTubePlayer } from '../components/YouTubePlayer';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { parseTextToSongs, formatSongList } from '../../../shared/parse';

// --- Helpers ---

function formatTimestamp(sec: number): string {
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- Toast ---

interface ToastState { message: string; isError: boolean; key: number }

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
    <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${toast.isError ? 'bg-red-600 text-white' : 'bg-slate-800 text-white'}`}>
      {toast.message}
    </div>
  );
}

// --- Inline Edit ---

function InlineEdit({ value, placeholder, onSave, onCancel }: {
  value: string; placeholder?: string;
  onSave: (val: string) => void; onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed !== value) onSave(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef} type="text" value={text} placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
      onBlur={onCancel}
      className="w-full rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

// --- Inline Date Edit ---

function InlineDateEdit({ value, onSave, onCancel }: {
  value: string;
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
      ref={inputRef} type="date" value={date}
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

// --- Add Song Modal ---

function AddSongModal({ onSubmit, onCancel }: {
  onSubmit: (title: string, artist: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), artist.trim());
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-800">Add Song</h3>
        <div className="mt-4 space-y-3">
          <input ref={inputRef} type="text" placeholder="Song title *" value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required />
          <input type="text" placeholder="Original artist" value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit"
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Add</button>
        </div>
      </form>
    </div>
  );
}

// --- Paste Import Modal ---

function PasteImportModal({ streamId, hasExisting, onDone, onCancel }: {
  streamId: string; hasExisting: boolean;
  onDone: (result: { created: number; replaced: boolean }) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [replaceMode, setReplaceMode] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const preview = (() => parseTextToSongs(text))();

  const handleImport = async () => {
    if (preview.length === 0) return;
    setImporting(true); setError(null);
    try {
      const result = await api.pasteImport(streamId, { text, replace: replaceMode });
      if (!result.ok) { setError(result.errors.join(', ') || 'Import failed'); setImporting(false); return; }
      onDone({ created: result.created, replaced: result.replaced });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed'); setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="flex w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl" style={{ maxHeight: '85vh' }}>
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">Paste Import</h3>
          <p className="mt-1 text-sm text-slate-500">Paste a timestamp list (e.g. "5:30 Song Name - Artist")</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <textarea ref={textareaRef} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={`0:00 Song Title / Artist Name\n3:45 Another Song - Another Artist`}
            className="h-40 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {hasExisting && (
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} className="rounded border-slate-300" />
              Replace existing performances
            </label>
          )}
          {preview.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-slate-700">Preview ({preview.length} songs)</h4>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">#</th><th className="px-3 py-2">Start</th>
                      <th className="px-3 py-2">End</th><th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2">Artist</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.map((song, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{song.startTimestamp}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{song.endTimestamp ?? '—'}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">{song.songName}</td>
                        <td className="px-3 py-1.5 text-slate-500">{song.artist || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" disabled={importing}>Cancel</button>
          <button onClick={handleImport} disabled={preview.length === 0 || importing}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            {importing ? 'Importing...' : `Import ${preview.length} Songs`}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main component ---

type EditingField =
  | { type: 'perf'; perfId: string; field: 'title' | 'artist' | 'note' }
  | { type: 'stream'; field: 'title' | 'date' };

export default function StreamDetail({ user }: { user: AuthUser }) {
  const { id: streamId } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<StreamDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [editingField, setEditingField] = useState<EditingField | null>(null);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const toastKeyRef = useRef(0);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // --- New state for navigation & stamp features ---
  const [allStreams, setAllStreams] = useState<Stream[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isFetchingAll, setIsFetchingAll] = useState(false);

  const isCurator = user.role === 'curator';

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
        if (prev < 0) return 0;
        return Math.min(prev, d.performances.length - 1);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stream');
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // --- Optimistic update helper ---
  const updatePerformance = useCallback((index: number, updates: Partial<StampPerformance>) => {
    setDetail(prev => prev ? {
      ...prev,
      performances: prev.performances.map((p, i) => i === index ? { ...p, ...updates } : p),
    } : prev);
  }, []);

  // --- Status action ---
  const handleStreamStatus = useCallback(async (status: Status) => {
    if (!streamId || !detail) return;
    try {
      await api.updateStreamStatus(streamId, { status });
      setDetail((prev) => prev ? { ...prev, status } : prev);
      showToast(`Stream ${status}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', true);
    }
  }, [streamId, detail, showToast]);

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

  // --- Export song list ---
  const exportSongList = useCallback(() => {
    if (!detail || detail.performances.length === 0) return;
    const text = formatSongList(detail.performances);
    navigator.clipboard.writeText(text).then(
      () => showToast('Copied song list to clipboard'),
      () => showToast('Failed to copy', true),
    );
  }, [detail, showToast]);

  // --- Stamp editor actions ---

  const markEndTimestamp = useCallback(async () => {
    if (selectedIndex < 0 || !detail || !playerRef.current) return;
    const perf = detail.performances[selectedIndex];
    if (!perf) return;
    const currentTime = Math.floor(playerRef.current.getCurrentTime());

    try {
      await api.updatePerformanceTimestamps(perf.id, { endTimestamp: currentTime });
      updatePerformance(selectedIndex, { endTimestamp: currentTime });
      showToast(`Marked ${perf.title} \u2192 ${formatTimestamp(currentTime)}`);

      // Auto-advance to next unstamped
      const nextIdx = detail.performances.findIndex(
        (p, i) => i > selectedIndex && p.endTimestamp === null,
      );
      if (nextIdx >= 0) setSelectedIndex(nextIdx);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mark timestamp', true);
    }
  }, [detail, selectedIndex, showToast, updatePerformance]);

  const markStartTimestamp = useCallback(async () => {
    if (selectedIndex < 0 || !detail || !playerRef.current) return;
    const perf = detail.performances[selectedIndex];
    if (!perf) return;
    const currentTime = Math.floor(playerRef.current.getCurrentTime());

    try {
      await api.updatePerformanceTimestamps(perf.id, { timestamp: currentTime });
      updatePerformance(selectedIndex, { timestamp: currentTime });
      showToast(`Start ${perf.title} \u2192 ${formatTimestamp(currentTime)}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to mark start', true);
    }
  }, [detail, selectedIndex, showToast, updatePerformance]);

  const seekToStart = useCallback(() => {
    if (selectedIndex < 0 || !detail || !playerRef.current) return;
    const perf = detail.performances[selectedIndex];
    if (perf) playerRef.current.seekTo(perf.timestamp);
  }, [detail, selectedIndex]);

  const seekToEnd = useCallback(() => {
    if (selectedIndex < 0 || !detail || !playerRef.current) return;
    const perf = detail.performances[selectedIndex];
    if (perf?.endTimestamp) playerRef.current.seekTo(Math.max(0, perf.endTimestamp - 10));
  }, [detail, selectedIndex]);

  const selectNext = useCallback(() => {
    if (!detail || detail.performances.length === 0) return;
    setSelectedIndex(i => Math.min(i + 1, detail.performances.length - 1));
  }, [detail]);

  const selectPrev = useCallback(() => {
    setSelectedIndex(i => Math.max(i - 1, 0));
  }, []);

  const clearEndTimestamp = useCallback(async (perfId: string, idx: number) => {
    try {
      await api.updatePerformanceTimestamps(perfId, { endTimestamp: null });
      updatePerformance(idx, { endTimestamp: null });
      showToast('Cleared end timestamp');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear', true);
    }
  }, [showToast, updatePerformance]);

  const clearAllEndTimestamps = useCallback(async () => {
    if (!streamId) return;
    if (!confirm('Clear ALL end timestamps for this stream?')) return;
    try {
      const { cleared } = await api.clearAllEndTimestamps(streamId);
      setDetail(prev => prev ? {
        ...prev,
        performances: prev.performances.map(p => ({ ...p, endTimestamp: null })),
      } : prev);
      showToast(`Cleared ${cleared} end timestamps`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to clear', true);
    }
  }, [streamId, showToast]);

  const fetchDuration = useCallback(async () => {
    if (selectedIndex < 0 || !detail) return;
    const perf = detail.performances[selectedIndex];
    if (!perf) return;

    showToast(`Fetching duration for ${perf.title}...`);
    try {
      const result = await api.fetchPerformanceDuration(perf.id);
      if (result.endTimestamp !== null) {
        updatePerformance(selectedIndex, { endTimestamp: result.endTimestamp });
        showToast(`${perf.title}: ${result.durationSec}s (${result.matchConfidence})`);
      } else if (result.durationSec) {
        showToast(`${perf.title}: ${result.durationSec}s (already has end timestamp)`);
      } else {
        showToast(`${perf.title}: no match on iTunes`, true);
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Fetch failed', true);
    }
  }, [detail, selectedIndex, showToast, updatePerformance]);

  const fetchAllDurations = useCallback(async () => {
    if (isFetchingAll || !detail) return;
    const missing = detail.performances
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
          updatePerformance(index, { endTimestamp: result.endTimestamp });
        } else {
          noMatch++;
        }
      } catch {
        errors++;
      }

      if (i < missing.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setIsFetchingAll(false);
    showToast(`Fetched ${fetched}/${missing.length}, ${noMatch} no match, ${errors} errors`);
  }, [detail, isFetchingAll, showToast, updatePerformance]);

  const handleAddSong = useCallback(async (title: string, artist: string) => {
    if (!streamId || !playerRef.current) return;
    const timestamp = Math.floor(playerRef.current.getCurrentTime());

    try {
      await api.createStampPerformance(streamId, {
        title,
        originalArtist: artist || 'Unknown',
        timestamp,
      });
      setShowAddModal(false);
      await loadDetail();
      showToast(`Added ${title} at ${formatTimestamp(timestamp)}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to add song', true);
    }
  }, [streamId, loadDetail, showToast]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (showAddModal || showPasteImport) return;

      switch (e.key) {
        case 'm': markEndTimestamp(); break;
        case 't': markStartTimestamp(); break;
        case 's': seekToStart(); break;
        case 'e': seekToEnd(); break;
        case 'n': selectNext(); break;
        case 'p': selectPrev(); break;
        case 'c': copyVodUrl(); break;
        case 'f': fetchDuration(); break;
        case 'F': fetchAllDurations(); break;
        case 'x': exportSongList(); break;
        case 'i': if (streamId) setShowPasteImport(true); break;
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
  }, [markEndTimestamp, markStartTimestamp, seekToStart, seekToEnd, selectNext, selectPrev, copyVodUrl, exportSongList, fetchDuration, fetchAllDurations, showAddModal, showPasteImport, streamId]);

  // --- Derived values ---
  const unstampedCount = detail ? detail.performances.filter(p => p.endTimestamp === null).length : 0;

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
                <InlineEdit value={detail.title} onSave={(v) => handleStreamSave('title', v)} onCancel={() => setEditingField(null)} />
              ) : (
                <span className={isCurator ? 'cursor-text' : ''} onDoubleClick={() => { if (isCurator) setEditingField({ type: 'stream', field: 'title' }); }} title={isCurator ? 'Double-click to edit' : undefined}>
                  {detail.title}
                </span>
              )}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              {editingField?.type === 'stream' && editingField.field === 'date' ? (
                <InlineDateEdit value={detail.date} onSave={(v) => handleStreamSave('date', v)} onCancel={() => setEditingField(null)} />
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
            </div>
          )}
        </div>
      </div>

      {/* YouTube Player */}
      <div className="mt-4">
        <YouTubePlayer ref={playerRef} videoId={detail.videoId} />

        {/* Current playback time */}
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="font-mono text-lg font-semibold text-slate-800">
            {formatTimestamp(currentTime)}
          </span>
          <span className="text-slate-400">current</span>
        </div>
      </div>

      {/* Keyboard shortcut hints */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">m</kbd>{' '}Mark end
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">t</kbd>{' '}Set start
        </span>
        <span>
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">s</kbd>/
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 font-mono">e</kbd>{' '}Seek start/end
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

      {/* Performances table */}
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
                <tr key={perf.id}
                  onClick={() => { setSelectedIndex(i); setEditingField(null); }}
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                    i === selectedIndex ? 'border-l-2 border-l-blue-500 bg-blue-50' : ''
                  }`}>
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>

                  {/* Title */}
                  <td className="px-4 py-3">
                    {editingField?.type === 'perf' && editingField.perfId === perf.id && editingField.field === 'title' ? (
                      <InlineEdit value={perf.title} onSave={(v) => handleSave(perf.id, 'title', v)} onCancel={() => setEditingField(null)} />
                    ) : (
                      <span className="cursor-text font-medium text-slate-800" onDoubleClick={(e) => { e.stopPropagation(); setEditingField({ type: 'perf', perfId: perf.id, field: 'title' }); }} title="Double-click to edit">
                        {perf.title}
                      </span>
                    )}
                  </td>

                  {/* Artist */}
                  <td className="px-4 py-3">
                    {editingField?.type === 'perf' && editingField.perfId === perf.id && editingField.field === 'artist' ? (
                      <InlineEdit value={perf.originalArtist} placeholder="add artist" onSave={(v) => handleSave(perf.id, 'artist', v)} onCancel={() => setEditingField(null)} />
                    ) : (
                      <span className={`cursor-text ${perf.originalArtist ? 'text-slate-600' : 'italic text-slate-400'}`}
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingField({ type: 'perf', perfId: perf.id, field: 'artist' }); }} title="Double-click to edit">
                        {perf.originalArtist || 'add artist'}
                      </span>
                    )}
                  </td>

                  {/* Timestamps */}
                  <td className="px-4 py-3 font-mono text-xs">
                    <button onClick={(e) => { e.stopPropagation(); playerRef.current?.seekTo(perf.timestamp); }} className="text-blue-600 hover:underline" title="Seek to start">
                      {formatTimestamp(perf.timestamp)}
                    </button>
                  </td>
                  <td className={`px-4 py-3 font-mono text-xs ${perf.endTimestamp !== null ? 'text-green-600' : 'text-slate-300'}`}>
                    <span className="inline-flex items-center gap-1">
                      {perf.endTimestamp !== null ? (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); playerRef.current?.seekTo(Math.max(0, perf.endTimestamp! - 10)); }} className="hover:underline" title="Seek near end">
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

                  {/* Note */}
                  <td className="max-w-48 px-4 py-3">
                    {editingField?.type === 'perf' && editingField.perfId === perf.id && editingField.field === 'note' ? (
                      <InlineEdit value={perf.note} placeholder="add note" onSave={(v) => handleSave(perf.id, 'note', v)} onCancel={() => setEditingField(null)} />
                    ) : (
                      <span className={`cursor-text truncate text-xs ${perf.note ? 'text-slate-600' : 'italic text-slate-400'}`}
                        onDoubleClick={(e) => { e.stopPropagation(); setEditingField({ type: 'perf', perfId: perf.id, field: 'note' }); }} title="Double-click to edit note">
                        {perf.note || 'add note'}
                      </span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3"><StatusBadge status={perf.status} /></td>

                  {/* Actions */}
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

      {/* Add Song Modal */}
      {showAddModal && (
        <AddSongModal onSubmit={handleAddSong} onCancel={() => setShowAddModal(false)} />
      )}

      {/* Paste Import Modal */}
      {showPasteImport && streamId && (
        <PasteImportModal
          streamId={streamId}
          hasExisting={detail.performances.length > 0}
          onDone={handlePasteImportDone}
          onCancel={() => setShowPasteImport(false)}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
