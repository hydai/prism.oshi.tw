import { useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { formatSongList } from '../lib/parse';
import type { AuroraSong } from './SongListEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  songs: AuroraSong[];
  vodUrl: string;
}

export default function ExportModal({ open, onClose, songs, vodUrl }: Props) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const formatted = formatSongList(
    songs.map((s) => ({
      title: s.name,
      originalArtist: s.artist,
      timestamp: s.startSeconds,
      endTimestamp: s.endSeconds,
    })),
  );

  const output = vodUrl ? `${vodUrl}\n\n${formatted}` : formatted;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            <Download size={18} className="text-[var(--accent-purple)]" />
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">匯出時間戳</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/[0.06]">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <textarea
            readOnly
            className="w-full h-64 rounded-lg border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] px-3 py-2 text-base font-mono outline-none resize-none"
            value={output}
            data-testid="export-textarea"
          />
          <p className="text-[11px] text-[var(--text-tertiary)] mt-2">
            {songs.length} 首歌曲 — 可直接貼到 YouTube 留言或傳給策展人匯入
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-default)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/[0.06]"
          >
            關閉
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[var(--accent-purple)] text-white hover:opacity-90"
            data-testid="copy-export-button"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已複製' : '複製到剪貼簿'}
          </button>
        </div>
      </div>
    </div>
  );
}
