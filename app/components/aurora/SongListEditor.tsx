'use client';

import { useState, useRef, useEffect } from 'react';
import { Trash2, ChevronUp, ChevronDown, Clock } from 'lucide-react';

export interface AuroraSong {
  id: string;
  name: string;
  artist: string;
  startSeconds: number;
  endSeconds: number | null;
}

function toHMS(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseHMS(value: string): number | null {
  const m = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  return h * 3600 + parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10);
}

interface InlineCellProps {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  onClick?: () => void;
  placeholder?: string;
}

function InlineCell({ value, onCommit, className = '', onClick, placeholder }: InlineCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`bg-white/80 border border-[var(--border-default)] rounded px-1 py-0.5 text-base w-full outline-none focus:border-[var(--accent-purple)] ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onCommit(draft); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { onCommit(draft); setEditing(false); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }

  return (
    <span
      className={`cursor-text hover:bg-white/60 rounded px-1 py-0.5 min-h-[24px] inline-block ${className}`}
      onClick={(e) => { onClick?.(); if (!onClick) setEditing(true); e.stopPropagation(); }}
      onDoubleClick={() => setEditing(true)}
      title={onClick ? '點擊跳轉 / 雙擊編輯' : '點擊編輯'}
    >
      {value || <span className="text-[var(--text-tertiary)]">{placeholder || '—'}</span>}
    </span>
  );
}

interface Props {
  songs: AuroraSong[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onUpdate: (index: number, patch: Partial<AuroraSong>) => void;
  onDelete: (index: number) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
  onSeekTo: (seconds: number) => void;
  onFillDuration?: (index: number) => void;
  fillingIndex?: number | null;
}

export default function SongListEditor({ songs, selectedIndex, onSelect, onUpdate, onDelete, onMove, onSeekTo, onFillDuration, fillingIndex }: Props) {
  return (
    <div className="flex flex-col gap-1 overflow-y-auto custom-scrollbar" data-testid="song-list-editor">
      {songs.length === 0 && (
        <div className="text-center py-12 text-[var(--text-tertiary)]">
          <p className="text-[15px] mb-1">尚未添加歌曲</p>
          <p className="text-[12px]">按 <kbd className="px-1 py-0.5 rounded bg-white/60 border border-[var(--border-default)] text-[11px] font-mono">A</kbd> 在當前時間添加，或使用匯入功能</p>
        </div>
      )}
      {songs.map((song, i) => (
        <div
          key={song.id}
          className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors cursor-pointer ${
            selectedIndex === i
              ? 'bg-[var(--accent-purple)]/10 border border-[var(--accent-purple)]/30'
              : 'hover:bg-white/40 border border-transparent'
          }`}
          onClick={() => onSelect(i)}
          data-testid="song-row"
        >
          {/* Row number */}
          <span className="text-[var(--text-tertiary)] text-[12px] font-mono w-6 text-right shrink-0">
            {String(i + 1).padStart(2, '0')}
          </span>

          {/* Song info */}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <InlineCell
                value={song.name}
                onCommit={(v) => onUpdate(i, { name: v })}
                className="font-medium text-[var(--text-primary)] flex-1"
                placeholder="歌名"
              />
            </div>
            <div className="flex items-center gap-2 text-[12px]">
              <InlineCell
                value={song.artist}
                onCommit={(v) => onUpdate(i, { artist: v })}
                className="text-[var(--text-secondary)] flex-1"
                placeholder="原唱"
              />
            </div>
          </div>

          {/* Timestamps */}
          <div className="flex items-center gap-1 shrink-0 font-mono text-[12px]">
            <InlineCell
              value={toHMS(song.startSeconds)}
              onClick={() => onSeekTo(song.startSeconds)}
              onCommit={(v) => {
                const sec = parseHMS(v);
                if (sec !== null) onUpdate(i, { startSeconds: sec });
              }}
              className="text-emerald-600 cursor-pointer hover:underline"
            />
            <span className="text-[var(--text-tertiary)]">~</span>
            <InlineCell
              value={song.endSeconds !== null ? toHMS(song.endSeconds) : '--:--:--'}
              onClick={() => { if (song.endSeconds !== null) onSeekTo(song.endSeconds); }}
              onCommit={(v) => {
                if (v === '--:--:--' || v === '') {
                  onUpdate(i, { endSeconds: null });
                } else {
                  const sec = parseHMS(v);
                  if (sec !== null) onUpdate(i, { endSeconds: sec });
                }
              }}
              className="text-orange-500 cursor-pointer hover:underline"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); onMove(i, 'up'); }}
              disabled={i === 0}
              className="p-1 rounded hover:bg-white/60 disabled:opacity-30"
              title="上移"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onMove(i, 'down'); }}
              disabled={i === songs.length - 1}
              className="p-1 rounded hover:bg-white/60 disabled:opacity-30"
              title="下移"
            >
              <ChevronDown size={14} />
            </button>
            {onFillDuration && (
              <button
                onClick={(e) => { e.stopPropagation(); onFillDuration(i); }}
                disabled={song.endSeconds !== null || fillingIndex !== undefined && fillingIndex !== null}
                className="p-1 rounded hover:bg-purple-100 text-purple-400 hover:text-purple-600 disabled:opacity-30"
                title="從 iTunes 自動填入結束時間"
                data-testid="fill-duration-button"
              >
                <Clock size={14} className={fillingIndex === i ? 'animate-spin' : ''} />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(i); }}
              className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600"
              title="刪除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
