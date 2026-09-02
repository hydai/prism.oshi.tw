import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { parseTextToSongs, parsedSongKey } from '../../../../shared/parse';

const DEFAULT_EXAMPLE = '0:00 Song Title / Artist Name\n3:45 Another Song - Another Artist\n7:20 Third Song';
const DEFAULT_REPLACE_LABEL = 'Replace existing performances (delete current songs first)';

/**
 * Bulk import from a pasted timestamp list. The two pages that use it word the example and the
 * replace-mode checkbox differently, so both stay props rather than being unified silently.
 */
export function PasteImportModal({
  streamId,
  hasExisting,
  example = DEFAULT_EXAMPLE,
  replaceLabel = DEFAULT_REPLACE_LABEL,
  onDone,
  onCancel,
}: {
  streamId: string;
  hasExisting: boolean;
  example?: string;
  replaceLabel?: string;
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
            Paste a timestamp list (e.g. &quot;5:30 Song Name - Artist&quot;)
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <textarea
            ref={textareaRef}
            aria-label="Paste a timestamp list"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={example}
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
              {replaceLabel}
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
                      <tr key={parsedSongKey(song)} className="hover:bg-slate-50">
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
