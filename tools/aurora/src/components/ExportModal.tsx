import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyOperationIdRef = useRef(0);
  const titleId = useId();
  const textareaId = useId();

  const clearCopyFeedbackTimer = useCallback(() => {
    if (copyFeedbackTimerRef.current === null) return;
    clearTimeout(copyFeedbackTimerRef.current);
    copyFeedbackTimerRef.current = null;
  }, []);

  useEffect(() => () => {
    copyOperationIdRef.current += 1;
    clearCopyFeedbackTimer();
  }, [clearCopyFeedbackTimer]);

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

  const handleClose = () => {
    copyOperationIdRef.current += 1;
    clearCopyFeedbackTimer();
    setCopied(false);
    onClose();
  };

  const handleCopy = async () => {
    const operationId = ++copyOperationIdRef.current;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      if (copyOperationIdRef.current === operationId) {
        clearCopyFeedbackTimer();
        setCopied(false);
      }
      return;
    }
    if (copyOperationIdRef.current !== operationId) return;

    clearCopyFeedbackTimer();
    setCopied(true);
    copyFeedbackTimerRef.current = setTimeout(() => {
      copyFeedbackTimerRef.current = null;
      if (copyOperationIdRef.current === operationId) setCopied(false);
    }, 2000);
  };

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
    >
      <div className="relative flex h-full items-center justify-center">
        <button
          type="button"
          className="absolute inset-0 border-0 bg-black/30 p-0 backdrop-blur-sm"
          onClick={handleClose}
          aria-label="關閉匯出視窗背景"
        />
        <div
          className="relative z-10 w-full max-w-2xl mx-4 rounded-2xl shadow-xl border border-[var(--border-default)]"
          style={{ background: 'var(--bg-surface)' }}
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
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/[0.06]"
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
            onClick={handleClose}
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
    </dialog>
  );
}
