'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X, Copy, Check, Download } from 'lucide-react';
import { formatSongList } from '@/lib/parse';
import type { AuroraSong } from './SongListEditor';

interface Props {
  open: boolean;
  onClose: () => void;
  songs: AuroraSong[];
  vodUrl: string;
}

export default function ExportModal({ open, onClose, songs, vodUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const textareaId = useId();

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog.showModal();
    closeButtonRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      previouslyFocused?.focus();
    };
  }, [open]);

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
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex h-full items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl shadow-xl border border-[var(--border-default)]"
        style={{ background: 'var(--bg-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <Download size={18} className="text-[var(--accent-purple)]" />
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--text-primary)]">匯出時間戳</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-black/5"
            aria-label="關閉匯出時間戳對話框"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <label htmlFor={textareaId} className="block text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
            匯出內容
          </label>
          <textarea
            id={textareaId}
            readOnly
            className="w-full h-64 rounded-lg border border-[var(--border-default)] bg-white/60 px-3 py-2 text-base font-mono outline-none resize-none"
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
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--text-secondary)] hover:bg-black/5"
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
    </dialog>
  );
}
