import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { parseTextToSongs, parsedSongKey } from '../../../../shared/parse';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Checkbox, Textarea } from '../ui/Fields';
import { MICRO_LABEL } from '../ui/micro-label';

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
    <Dialog
      open
      // Escape raises the native `cancel` unconditionally (dismissible only gates backdrop clicks), so
      // without this guard it would bypass the Cancel button's own `disabled={importing}` and abandon
      // an in-flight import: the parent's onDone still fires when it resolves, or the failure is
      // silently dropped. Once the import settles, Escape/Cancel close the modal as normal.
      onClose={() => {
        if (!importing) onCancel();
      }}
      title="Paste Import"
      description={'Paste a timestamp list (e.g. "5:30 Song Name - Artist")'}
      dismissible={false}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={importing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleImport} disabled={preview.length === 0 || importing}>
            {importing ? 'Importing...' : `Import ${preview.length} Songs`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          ref={textareaRef}
          aria-label="Paste a timestamp list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={example}
          className="h-40 font-mono"
        />

        {hasExisting && (
          <Checkbox checked={replaceMode} onChange={setReplaceMode} label={replaceLabel} visibleLabel />
        )}

        {preview.length > 0 && (
          <div>
            <h4 className="text-token-sm font-medium text-fg">
              Preview ({preview.length} songs)
            </h4>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-radius-lg border border-field-line bg-field">
              <table className="w-full text-left text-token-sm">
                <thead className="sticky top-0 border-b border-line-soft bg-field">
                  <tr className={MICRO_LABEL}>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Start</th>
                    <th className="px-3 py-2">End</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Artist</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {preview.map((song, i) => (
                    <tr key={parsedSongKey(song)} className="hover:bg-tone-neutral-bg">
                      <td className="px-3 py-1.5 text-fg-subtle">{i + 1}</td>
                      <td className="px-3 py-1.5 font-mono text-token-xs">{song.startTimestamp}</td>
                      <td className="px-3 py-1.5 font-mono text-token-xs text-fg-subtle">
                        {song.endTimestamp ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 font-medium text-fg">{song.songName}</td>
                      <td className="px-3 py-1.5 text-fg-muted">{song.artist || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {error && <p className="text-token-sm text-tone-danger-fg">{error}</p>}
      </div>
    </Dialog>
  );
}
