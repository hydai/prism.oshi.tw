import { useState } from 'react';
import { X, FileText, Plus, Replace } from 'lucide-react';
import { parseTextToSongs, type ParsedSong } from '../lib/parse';

function toHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (songs: ParsedSong[], mode: 'replace' | 'append') => void;
}

export default function PasteImportModal({ open, onClose, onImport }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'append'>('replace');

  if (!open) return null;

  const parsed = text.trim() ? parseTextToSongs(text) : [];

  const handleImport = () => {
    if (parsed.length === 0) return;
    onImport(parsed, mode);
    setText('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl shadow-xl border border-[var(--border-default)]"
        style={{ background: 'var(--bg-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-[var(--accent-purple)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">匯入時間戳</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('replace')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                mode === 'replace'
                  ? 'bg-[var(--accent-purple)] text-white'
                  : 'bg-white/60 dark:bg-white/[0.06] text-[var(--text-secondary)] hover:bg-white/80 dark:hover:bg-white/[0.10]'
              }`}
            >
              <Replace size={14} />
              取代
            </button>
            <button
              onClick={() => setMode('append')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                mode === 'append'
                  ? 'bg-[var(--accent-purple)] text-white'
                  : 'bg-white/60 dark:bg-white/[0.06] text-[var(--text-secondary)] hover:bg-white/80 dark:hover:bg-white/[0.10]'
              }`}
            >
              <Plus size={14} />
              附加
            </button>
          </div>

          {/* Textarea */}
          <textarea
            className="w-full h-40 rounded-lg border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] px-3 py-2 text-base font-mono outline-none focus:border-[var(--accent-purple)] resize-none"
            placeholder={'貼上時間戳文字...\n例如:\n0:00 歌名 / 原唱\n5:30 另一首歌 - 歌手'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            data-testid="paste-import-textarea"
            autoFocus
          />

          {/* Preview */}
          {parsed.length > 0 && (
            <div>
              <p className="text-[12px] text-[var(--text-secondary)] mb-2">
                預覽 — 識別到 {parsed.length} 首歌曲
              </p>
              <div className="rounded-lg border border-[var(--border-default)] bg-white/40 dark:bg-white/[0.04] overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[var(--border-default)] text-[var(--text-tertiary)]">
                      <th className="text-left px-3 py-1.5 font-medium">#</th>
                      <th className="text-left px-3 py-1.5 font-medium">歌名</th>
                      <th className="text-left px-3 py-1.5 font-medium">原唱</th>
                      <th className="text-left px-3 py-1.5 font-medium">開始</th>
                      <th className="text-left px-3 py-1.5 font-medium">結束</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((s, i) => (
                      <tr key={i} className="border-b border-[var(--border-default)] last:border-0" data-testid="import-preview-row">
                        <td className="px-3 py-1 font-mono text-[var(--text-tertiary)]">{String(i + 1).padStart(2, '0')}</td>
                        <td className="px-3 py-1 text-[var(--text-primary)]">{s.songName}</td>
                        <td className="px-3 py-1 text-[var(--text-secondary)]">{s.artist || '—'}</td>
                        <td className="px-3 py-1 font-mono text-emerald-600 dark:text-emerald-400">{toHMS(s.startSeconds)}</td>
                        <td className="px-3 py-1 font-mono text-orange-500 dark:text-orange-400">{s.endSeconds !== null ? toHMS(s.endSeconds) : '--:--:--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-default)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={parsed.length === 0}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--accent-purple)] text-white hover:opacity-90 disabled:opacity-40"
            data-testid="import-confirm-button"
          >
            匯入 {parsed.length > 0 ? `(${parsed.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
