import { useState, useEffect } from 'react';
import type {
  AuthUser,
  DiscoveredStream,
  ExtractResponse,
  PasteImportParsedSong,
  Stream,
  StreamCredit,
} from '../../../shared/types';
import { parseTextToSongs } from '../../../shared/parse';
import { api } from '../api/client';

// --- Helpers ---

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// --- Discover Tab ---

function DiscoverTab() {
  const [streams, setStreams] = useState<DiscoveredStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<string | null>(null);

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    setImportResult(null);
    try {
      const res = await api.discoverStreams();
      setStreams(res.streams);
      // Pre-select new streams
      setSelected(new Set(res.streams.filter((s) => s.isNew).map((s) => s.videoId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discover streams');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (videoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const toggleAll = () => {
    const newStreams = streams.filter((s) => s.isNew);
    if (selected.size === newStreams.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(newStreams.map((s) => s.videoId)));
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.importStreams({ videoIds: [...selected] });
      setImportResult(`Imported ${res.created} stream(s)`);
      // Re-run discover to update badges
      const updated = await api.discoverStreams();
      setStreams(updated.streams);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
    }
  };

  const newCount = streams.filter((s) => s.isNew).length;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleDiscover}
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Discovering...' : 'Discover Streams'}
        </button>
        {streams.length > 0 && (
          <button
            onClick={handleImport}
            disabled={importing || selected.size === 0}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {importing ? 'Importing...' : `Import Selected (${selected.size})`}
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {importResult && <p className="mt-3 text-sm text-green-600">{importResult}</p>}

      {streams.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === newCount && newCount > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Video ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {streams.map((s) => (
                <tr key={s.videoId} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {s.isNew ? (
                      <input
                        type="checkbox"
                        checked={selected.has(s.videoId)}
                        onChange={() => toggleSelect(s.videoId)}
                        className="rounded"
                      />
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{s.title}</td>
                  <td className="px-4 py-3 text-slate-600">{s.date}</td>
                  <td className="px-4 py-3">
                    {s.isNew ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        NEW
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        {s.existingStatus?.toUpperCase() ?? 'EXISTING'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`https://www.youtube.com/watch?v=${s.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {s.videoId}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Extract Tab ---

function ExtractTab() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResponse | null>(null);
  const [editedSongs, setEditedSongs] = useState<PasteImportParsedSong[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [credit, setCredit] = useState<StreamCredit | null>(null);

  // Fetch streams needing extraction (status = pending)
  useEffect(() => {
    api
      .listStreams({ status: 'pending' })
      .then((res) => {
        setStreams(res.data);
        if (res.data.length > 0) setSelectedStreamId(res.data[0]!.id);
      })
      .catch(() => {})
      .finally(() => setLoadingStreams(false));
  }, []);

  const handleExtract = async () => {
    if (!selectedStreamId) return;
    setLoading(true);
    setError(null);
    setExtractResult(null);
    setImportStatus(null);
    try {
      const res = await api.extractTimestamps(selectedStreamId);
      setExtractResult(res);
      setEditedSongs([...res.parsedSongs]);
      setCredit(res.credit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract');
    } finally {
      setLoading(false);
    }
  };

  const handleUseCandidate = (candidateText: string, candidateAuthor: string, candidateId: string) => {
    const parsed = parseTextToSongs(candidateText);
    setEditedSongs(parsed);
    const selectedStream = streams.find((s) => s.id === selectedStreamId);
    setCredit({
      author: candidateAuthor,
      commentUrl: `https://www.youtube.com/watch?v=${selectedStream?.videoId}&lc=${candidateId}`,
    });
    setExtractResult((prev) =>
      prev
        ? {
            ...prev,
            source: 'comment',
            parsedSongs: parsed,
            candidateComment: prev.allCandidates.find((c) => c.commentId === candidateId) ?? null,
          }
        : null,
    );
  };

  const updateSong = (index: number, field: keyof PasteImportParsedSong, value: string | number) => {
    setEditedSongs((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    );
  };

  const removeSong = (index: number) => {
    setEditedSongs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    if (!selectedStreamId || editedSongs.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.extractImport({
        streamId: selectedStreamId,
        songs: editedSongs.map((s) => ({
          songName: s.songName,
          artist: s.artist,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
        })),
        credit: credit ?? undefined,
        replace: false,
      });
      setImportStatus(`Imported ${res.created} song(s)`);
      setExtractResult(null);
      setEditedSongs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      {/* Stream selector */}
      <div className="flex items-center gap-3">
        {loadingStreams ? (
          <span className="text-sm text-slate-500">Loading streams...</span>
        ) : (
          <select
            value={selectedStreamId}
            onChange={(e) => {
              setSelectedStreamId(e.target.value);
              setExtractResult(null);
              setEditedSongs([]);
              setImportStatus(null);
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {streams.length === 0 && <option value="">No streams ready</option>}
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.date} — {s.title}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={handleExtract}
          disabled={loading || !selectedStreamId}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Extracting...' : 'Extract Timestamps'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {importStatus && <p className="mt-3 text-sm text-green-600">{importStatus}</p>}

      {/* Extract results */}
      {extractResult && (
        <div className="mt-4 space-y-4">
          {/* Source indicator */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-medium text-slate-700">Source</h4>
            {extractResult.source === 'comment' && extractResult.candidateComment && (
              <div className="mt-1 text-sm text-slate-600">
                <span className="font-medium">Comment</span> by{' '}
                <span className="font-medium">{extractResult.candidateComment.author}</span>
                {' — '}
                {extractResult.candidateComment.likes} likes,{' '}
                {extractResult.candidateComment.timestampCount} timestamps
                {extractResult.candidateComment.isPinned && (
                  <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    PINNED
                  </span>
                )}
              </div>
            )}
            {extractResult.source === 'description' && (
              <p className="mt-1 text-sm text-slate-600">
                From video description (no suitable comment found)
              </p>
            )}
            {extractResult.source === null && (
              <p className="mt-1 text-sm text-amber-600">
                No timestamps found in comments or description. Use the Stamp Editor paste import instead.
              </p>
            )}
          </div>

          {/* Alternate candidates */}
          {extractResult.allCandidates.length > 1 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setShowCandidates(!showCandidates)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <span>
                  Other candidates ({extractResult.allCandidates.length - 1})
                </span>
                <span>{showCandidates ? '▲' : '▼'}</span>
              </button>
              {showCandidates && (
                <div className="border-t border-slate-200 divide-y divide-slate-100">
                  {extractResult.allCandidates
                    .filter((c) => c.commentId !== extractResult.candidateComment?.commentId)
                    .map((c) => (
                      <div key={c.commentId} className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600">
                            <span className="font-medium">{c.author}</span> — {c.likes} likes, {c.timestampCount} timestamps
                          </span>
                          <button
                            onClick={() => handleUseCandidate(c.text, c.author, c.commentId)}
                            className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200"
                          >
                            Use This
                          </button>
                        </div>
                        <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-slate-500">
                          {c.text.slice(0, 500)}{c.text.length > 500 ? '...' : ''}
                        </pre>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Song preview table */}
          {editedSongs.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <h4 className="text-sm font-medium text-slate-700">
                  Parsed Songs ({editedSongs.length})
                </h4>
                <button
                  onClick={handleImport}
                  disabled={importing || editedSongs.length === 0}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {importing ? 'Importing...' : `Import ${editedSongs.length} Songs`}
                </button>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2 w-8">#</th>
                    <th className="px-4 py-2">Start</th>
                    <th className="px-4 py-2">End</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Artist</th>
                    <th className="px-4 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editedSongs.map((song, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                      <td className="px-4 py-2 text-slate-600 font-mono text-xs">
                        {formatTimestamp(song.startSeconds)}
                      </td>
                      <td className="px-4 py-2 text-slate-600 font-mono text-xs">
                        {song.endSeconds !== null
                          ? formatTimestamp(song.endSeconds)
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={song.songName}
                          onChange={(e) => updateSong(i, 'songName', e.target.value)}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={song.artist}
                          onChange={(e) => updateSong(i, 'artist', e.target.value)}
                          className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => removeSong(i)}
                          className="text-red-400 hover:text-red-600"
                          title="Remove"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Pipeline Page ---

type Tab = 'discover' | 'extract';

export default function Pipeline({ user: _user }: { user: AuthUser }) {
  const [activeTab, setActiveTab] = useState<Tab>('discover');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'discover', label: 'Discover' },
    { key: 'extract', label: 'Extract' },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800">Pipeline</h2>
      <p className="mt-1 text-sm text-slate-500">
        Discover karaoke streams from YouTube and extract song timestamps.
      </p>

      {/* Tab bar */}
      <div className="mt-4 flex border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === 'discover' && <DiscoverTab />}
        {activeTab === 'extract' && <ExtractTab />}
      </div>
    </div>
  );
}
