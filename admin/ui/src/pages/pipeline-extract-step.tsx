import { useId, useRef, useState, type Dispatch } from 'react';
import type { CandidateComment, PasteImportParsedSong, StreamCredit } from '../../../shared/types';
import { parseTextToSongs } from '../../../shared/parse';
import { api, ApiError } from '../api/client';
import { formatTimestamp } from '../lib/format-timestamp';
import type { EditableParsedSong, ExtractAction, ExtractState } from './pipeline-extract-state';

// --- Candidate Card ---

function CandidateCard({
  candidate: c,
  isActive,
  onUse,
}: {
  candidate: CandidateComment;
  isActive: boolean;
  onUse: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = c.text.split('\n').length;
  const isLong = lineCount > 6 || c.text.length > 300;

  return (
    <div
      className={`rounded-lg border p-3 ${
        isActive ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-slate-700">{c.author}</span>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span>{c.likes} likes</span>
            <span>{c.timestampCount} ts</span>
            {c.isPinned && (
              <span className="inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                PIN
              </span>
            )}
          </div>
        </div>
        {isActive ? (
          <span className="shrink-0 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
            Active
          </span>
        ) : (
          <button
            onClick={onUse}
            className="shrink-0 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200"
          >
            Use This
          </button>
        )}
      </div>
      <div className="relative">
        <pre
          className={`mt-2 whitespace-pre-wrap text-xs text-slate-500 ${
            expanded ? 'max-h-[60vh] overflow-y-auto' : 'max-h-28 overflow-hidden'
          }`}
        >
          {c.text}
        </pre>
        {!expanded && isLong && (
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t to-transparent ${
              isActive ? 'from-blue-50' : 'from-white'
            }`}
          />
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-blue-600 hover:underline"
        >
          {expanded ? '▲ Collapse' : `▼ Show all ${lineCount} lines`}
        </button>
      )}
    </div>
  );
}

// --- Extract ---

/** The Extract step's state. The page holds it, so a trip to Discover keeps the extract and its edits. */
export interface ExtractController {
  state: ExtractState;
  dispatch: Dispatch<ExtractAction>;
  /** Loads the ready-to-extract list again after a failed load. */
  retryStreams: () => void;
}

function useIdentifySongs() {
  const songIdPrefix = useId();
  const nextSongId = useRef(0);

  return (songs: PasteImportParsedSong[]): EditableParsedSong[] =>
    songs.map((song) => ({
      ...song,
      clientId: `${songIdPrefix}-${nextSongId.current++}`,
    }));
}

/** Step 2: find a stream's timestamp list, edit the parsed songs and import them. `hidden` hides it without unmounting it. */
export function ExtractStep({ hidden, extract }: { hidden: boolean; extract: ExtractController }) {
  const { state, dispatch } = extract;
  const {
    streams,
    selectedStreamId,
    loading,
    loadingStreams,
    error,
    extractResult,
    editedSongs,
    importStatus,
    importing,
  } = state;
  const creditRef = useRef<StreamCredit | null>(null);
  const identifySongs = useIdentifySongs();

  const handleExtract = async (streamId?: string) => {
    const id = streamId ?? selectedStreamId;
    if (!id) return;
    dispatch({ type: 'extractStarted', streamId: id });
    try {
      const res = await api.extractTimestamps(id);
      const identifiedSongs = identifySongs(res.parsedSongs);
      creditRef.current = res.credit;
      dispatch({ type: 'extractSucceeded', result: res, editedSongs: identifiedSongs });
    } catch (err) {
      dispatch({
        type: 'extractFailed',
        error: err instanceof Error ? err.message : 'Failed to extract',
      });
    }
  };

  const handleUseCandidate = (candidateText: string, candidateAuthor: string, candidateId: string) => {
    const parsed = parseTextToSongs(candidateText);
    const identifiedSongs = identifySongs(parsed);
    const selectedStream = streams.find((s) => s.id === selectedStreamId);
    creditRef.current = {
      author: candidateAuthor,
      commentUrl: `https://www.youtube.com/watch?v=${selectedStream?.videoId}&lc=${candidateId}`,
    };
    dispatch({
      type: 'candidateSelected',
      candidateId,
      parsedSongs: parsed,
      editedSongs: identifiedSongs,
    });
  };

  const updateSong = (index: number, field: keyof PasteImportParsedSong, value: string | number) => {
    dispatch({ type: 'songUpdated', index, field, value });
  };

  const removeSong = (index: number) => {
    dispatch({ type: 'songRemoved', index });
  };

  const handleImport = async (replace = false, creditSnapshot = creditRef.current) => {
    if (!selectedStreamId || editedSongs.length === 0) return;
    dispatch({ type: 'importStarted' });
    try {
      const res = await api.extractImport({
        streamId: selectedStreamId,
        songs: editedSongs.map((s) => ({
          songName: s.songName,
          artist: s.artist,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
        })),
        credit: creditSnapshot ?? undefined,
        replace,
      });
      dispatch({ type: 'importSucceeded', status: `Imported ${res.created} song(s)` });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const ok = window.confirm(`${err.message}\n\nDo you want to replace the existing songs?`);
        if (ok) {
          dispatch({ type: 'importFinished' });
          return handleImport(true, creditSnapshot);
        }
      } else {
        dispatch({
          type: 'importFailed',
          error: err instanceof Error ? err.message : 'Failed to import',
        });
      }
    } finally {
      dispatch({ type: 'importFinished' });
    }
  };

  return (
    // Padding only, no display utility: one would outrank the `hidden` attribute's display: none.
    // The studio frame gives the page no gutter, so the step brings its own.
    <section aria-label="Extract" hidden={hidden} className="p-4 lg:px-5">
      {/* Two-column layout: stream table (left) + candidates panel (right) */}
      <div className="flex gap-4">
        {/* Left column: Stream selector table */}
        <div className="flex-1 min-w-0">
          {loadingStreams ? (
            <span className="text-sm text-slate-500">Loading streams...</span>
          ) : streams.length === 0 ? (
            <p className="text-sm text-slate-500">No streams ready</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 w-8">#</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3 w-28">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {streams.map((s, i) => (
                    <tr
                      key={s.id}
                      className={selectedStreamId === s.id && (loading || extractResult) ? 'bg-blue-50' : 'hover:bg-slate-50'}
                    >
                      <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 text-slate-600">{s.date}</td>
                      <td className="px-4 py-3 font-medium">
                        <a
                          href={`https://www.youtube.com/watch?v=${s.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {s.title}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleExtract(s.id)}
                          disabled={loading}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {loading && selectedStreamId === s.id ? 'Extracting...' : 'Extract'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column: Candidates panel — sticky so it follows scroll; self-start
            un-stretches the flex item, otherwise sticky has no room to slide */}
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] w-96 shrink-0 self-start overflow-y-auto">
          {!extractResult && !loading ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
              Select a stream and click Extract
            </div>
          ) : loading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Extracting...
            </div>
          ) : extractResult && (
            <div className="space-y-3">
              {/* Source indicator */}
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <h4 className="text-xs font-medium uppercase text-slate-500">Source</h4>
                {extractResult.source === 'comment' && extractResult.candidateComment && (
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium">Comment</span> by{' '}
                    <span className="font-medium">{extractResult.candidateComment.author}</span>
                  </p>
                )}
                {extractResult.source === 'description' && (
                  <p className="mt-1 text-sm text-slate-600">Video description</p>
                )}
                {extractResult.source === null && (
                  <p className="mt-1 text-sm text-amber-600">No timestamps found</p>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {importStatus && <p className="text-sm text-green-600">{importStatus}</p>}

              {/* All candidates */}
              {extractResult.allCandidates.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase text-slate-500">
                    Candidates ({extractResult.allCandidates.length})
                  </h4>
                  {extractResult.allCandidates.map((c) => (
                    <CandidateCard
                      key={c.commentId}
                      candidate={c}
                      isActive={c.commentId === extractResult.candidateComment?.commentId}
                      onUse={() => handleUseCandidate(c.text, c.author, c.commentId)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error/status outside two-column when no extractResult (e.g. extraction error) */}
      {!extractResult && error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!extractResult && importStatus && <p className="mt-3 text-sm text-green-600">{importStatus}</p>}

      {/* Parsed songs table — full width below */}
      {editedSongs.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h4 className="text-sm font-medium text-slate-700">
              Parsed Songs ({editedSongs.length})
            </h4>
            <button
              onClick={() => handleImport()}
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
                <tr key={song.clientId} className="hover:bg-slate-50">
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
                      type="text" aria-label={`Song ${i + 1} title`}
                      value={song.songName}
                      onChange={(e) => updateSong(i, 'songName', e.target.value)}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text" aria-label={`Song ${i + 1} artist`}
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
    </section>
  );
}
