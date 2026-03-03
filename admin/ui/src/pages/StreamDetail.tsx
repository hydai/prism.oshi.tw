import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { AuthUser, StreamDetail as StreamDetailType, StampPerformance, Status } from '../../../shared/types';
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

// --- Paste Import Modal (reuse from StampEditor pattern) ---

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

interface EditingField { perfId: string; field: 'title' | 'artist' | 'note' }

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

  const isCurator = user.role === 'curator';

  const showToast = useCallback((message: string, isError = false) => {
    toastKeyRef.current += 1;
    setToast({ message, isError, key: toastKeyRef.current });
  }, []);

  const loadDetail = useCallback(async () => {
    if (!streamId) return;
    setLoading(true);
    try {
      const d = await api.getStreamDetail(streamId);
      setDetail(d);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stream');
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

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
      // Reload to get fresh data
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

  if (loading) return <div className="text-slate-500">Loading...</div>;
  if (error || !detail) return <div className="text-red-600">{error ?? 'Stream not found'}</div>;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4 text-sm text-slate-500">
        <Link to="/streams" className="text-blue-600 hover:underline">Streams</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-700">{detail.title || detail.videoId}</span>
      </div>

      {/* Stream header */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">{detail.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span>{detail.date}</span>
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
      </div>

      {/* Performances header */}
      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800">
          Performances ({detail.performances.length})
        </h3>
        <div className="flex gap-2">
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
                <tr key={perf.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-400">{i + 1}</td>

                  {/* Title */}
                  <td className="px-4 py-3">
                    {editingField?.perfId === perf.id && editingField.field === 'title' ? (
                      <InlineEdit value={perf.title} onSave={(v) => handleSave(perf.id, 'title', v)} onCancel={() => setEditingField(null)} />
                    ) : (
                      <span className="cursor-text font-medium text-slate-800" onDoubleClick={() => setEditingField({ perfId: perf.id, field: 'title' })} title="Double-click to edit">
                        {perf.title}
                      </span>
                    )}
                  </td>

                  {/* Artist */}
                  <td className="px-4 py-3">
                    {editingField?.perfId === perf.id && editingField.field === 'artist' ? (
                      <InlineEdit value={perf.originalArtist} placeholder="add artist" onSave={(v) => handleSave(perf.id, 'artist', v)} onCancel={() => setEditingField(null)} />
                    ) : (
                      <span className={`cursor-text ${perf.originalArtist ? 'text-slate-600' : 'italic text-slate-400'}`}
                        onDoubleClick={() => setEditingField({ perfId: perf.id, field: 'artist' })} title="Double-click to edit">
                        {perf.originalArtist || 'add artist'}
                      </span>
                    )}
                  </td>

                  {/* Timestamps */}
                  <td className="px-4 py-3 font-mono text-xs">
                    <button onClick={() => playerRef.current?.seekTo(perf.timestamp)} className="text-blue-600 hover:underline" title="Seek to start">
                      {formatTimestamp(perf.timestamp)}
                    </button>
                  </td>
                  <td className={`px-4 py-3 font-mono text-xs ${perf.endTimestamp !== null ? 'text-green-600' : 'text-slate-300'}`}>
                    {perf.endTimestamp !== null ? (
                      <button onClick={() => playerRef.current?.seekTo(Math.max(0, perf.endTimestamp! - 10))} className="hover:underline" title="Seek near end">
                        {formatTimestamp(perf.endTimestamp)}
                      </button>
                    ) : '—'}
                  </td>

                  {/* Note */}
                  <td className="max-w-48 px-4 py-3">
                    {editingField?.perfId === perf.id && editingField.field === 'note' ? (
                      <InlineEdit value={perf.note} placeholder="add note" onSave={(v) => handleSave(perf.id, 'note', v)} onCancel={() => setEditingField(null)} />
                    ) : (
                      <span className={`cursor-text truncate text-xs ${perf.note ? 'text-slate-600' : 'italic text-slate-400'}`}
                        onDoubleClick={() => setEditingField({ perfId: perf.id, field: 'note' })} title="Double-click to edit note">
                        {perf.note || 'add note'}
                      </span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3"><StatusBadge status={perf.status} /></td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <button onClick={() => handleDelete(perf)}
                      className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-600" title="Delete">
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
