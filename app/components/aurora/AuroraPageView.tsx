'use client';

import type { RefObject } from 'react';
import { ArrowLeft, Clock, Download, FileText, Keyboard, Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { ParsedSong } from '@/lib/parse';
import AuroraPlayerControls from './AuroraPlayerControls';
import AuroraStampControls from './AuroraStampControls';
import ExportModal from './ExportModal';
import PasteImportModal from './PasteImportModal';
import SongListEditor, { type AuroraSong } from './SongListEditor';
import { YouTubeEmbed, type YouTubeEmbedHandle } from './YouTubeEmbed';

interface AuroraPageViewProps {
  slug: string;
  vodUrl: string;
  videoId: string | null;
  urlError: string;
  songs: AuroraSong[];
  selectedIndex: number | null;
  activeOverlay: AuroraOverlay;
  isPlaying: boolean;
  fillingIndex: number | null;
  bulkFillStatus: string | null;
  playerRef: RefObject<YouTubeEmbedHandle | null>;
  onVodUrlChange: (value: string) => void;
  onLoadVideo: () => void;
  onToggleShortcuts: () => void;
  onCloseShortcuts: () => void;
  onPlayingChange: (playing: boolean) => void;
  onTogglePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onAddSong: () => void;
  onOpenImport: () => void;
  onCloseImport: () => void;
  onImport: (songs: ParsedSong[], mode: 'replace' | 'append') => void;
  onOpenExport: () => void;
  onCloseExport: () => void;
  onFillAllDurations: () => void;
  onClear: () => void;
  onSetStart: () => void;
  onSetEnd: () => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
  onSelectSong: (index: number | null) => void;
  onUpdateSong: (index: number, patch: Partial<AuroraSong>) => void;
  onDeleteSong: (index: number) => void;
  onMoveSong: (index: number, direction: 'up' | 'down') => void;
  onSeekTo: (seconds: number) => void;
  onFillDuration: (index: number) => void;
}

export type AuroraOverlay = 'shortcuts' | 'import' | 'export' | null;

const SHORTCUTS = [
  ['T', '設定選取歌曲的開始時間'],
  ['M', '設定選取歌曲的結束時間'],
  ['S', '跳轉到選取歌曲的開始'],
  ['E', '跳轉到選取歌曲的結束'],
  ['N', '選取下一首歌'],
  ['P', '選取上一首歌'],
  ['A', '在當前播放時間新增歌曲'],
  ['F', '從 iTunes 填入選取歌曲的時長'],
  ['Space', '播放 / 暫停'],
  ['←', '倒退 5 秒'],
  ['→', '快進 5 秒'],
] as const;

export default function AuroraPageView({
  slug,
  vodUrl,
  videoId,
  urlError,
  songs,
  selectedIndex,
  activeOverlay,
  isPlaying,
  fillingIndex,
  bulkFillStatus,
  playerRef,
  onVodUrlChange,
  onLoadVideo,
  onToggleShortcuts,
  onCloseShortcuts,
  onPlayingChange,
  onTogglePlay,
  onSeekBackward,
  onSeekForward,
  onAddSong,
  onOpenImport,
  onCloseImport,
  onImport,
  onOpenExport,
  onCloseExport,
  onFillAllDurations,
  onClear,
  onSetStart,
  onSetEnd,
  onSeekToStart,
  onSeekToEnd,
  onSelectSong,
  onUpdateSong,
  onDeleteSong,
  onMoveSong,
  onSeekTo,
  onFillDuration,
}: AuroraPageViewProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--border-default)]" style={{ background: 'var(--bg-surface-frosted)', backdropFilter: 'blur(16px)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href={`/${slug}`} className="flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={16} />
            <span className="text-[13px]">MizukiPrism</span>
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--accent-purple)]" />
            <h1 className="text-[17px] font-bold bg-gradient-to-r from-purple-500 to-teal-400 bg-clip-text text-transparent">
              Aurora
            </h1>
          </div>
          <span className="text-[12px] text-[var(--text-tertiary)] hidden sm:inline">社群時間戳工具</span>
          <div className="flex-1" />
          <button
            onClick={onToggleShortcuts}
            className="p-2 rounded-lg hover:bg-black/5 text-[var(--text-tertiary)]"
            title="鍵盤快捷鍵"
          >
            <Keyboard size={16} />
          </button>
        </div>
      </header>

      {activeOverlay === 'shortcuts' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <button
            type="button"
            className="absolute inset-0"
            onClick={onCloseShortcuts}
            aria-label="關閉鍵盤快捷鍵"
          />
          <div
            className="relative mx-4 w-full max-w-sm rounded-2xl border border-[var(--border-default)] p-5 shadow-xl"
            style={{ background: 'var(--bg-surface)' }}
          >
            <h3 className="text-[15px] font-semibold mb-3 text-[var(--text-primary)]">鍵盤快捷鍵</h3>
            <p className="text-[11px] text-[var(--text-tertiary)] mb-3">在沒有輸入框聚焦時生效</p>
            <div className="space-y-2 text-[13px]">
              {SHORTCUTS.map(([key, description]) => (
                <div key={key} className="flex items-center gap-3">
                  <kbd className="w-7 text-center px-1.5 py-0.5 rounded bg-white/60 border border-[var(--border-default)] text-[12px] font-mono font-medium">{key}</kbd>
                  <span className="text-[var(--text-secondary)]">{description}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {!videoId ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Sparkles size={28} className="text-[var(--accent-purple)]" />
                <h2 className="text-[28px] font-bold bg-gradient-to-r from-purple-500 to-teal-400 bg-clip-text text-transparent">
                  MizukiAurora
                </h2>
              </div>
              <p className="text-[var(--text-secondary)] text-[14px]">社群時間戳工具 — 為歌枠直播建立結構化的時間戳列表</p>
            </div>
            <div className="w-full max-w-lg">
              <label htmlFor="aurora-vod-url" className="sr-only">
                YouTube 歌枠網址
              </label>
              <div className="flex gap-2">
                <input
                  id="aurora-vod-url"
                  className="flex-1 rounded-xl border border-[var(--border-default)] bg-white/60 px-4 py-3 text-base outline-none focus:border-[var(--accent-purple)] placeholder:text-[var(--text-tertiary)]"
                  placeholder="貼上 YouTube 歌枠網址..."
                  value={vodUrl}
                  onChange={(event) => onVodUrlChange(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') onLoadVideo(); }}
                  data-testid="vod-url-input"
                />
                <button
                  onClick={onLoadVideo}
                  className="px-5 py-3 rounded-xl bg-[var(--accent-purple)] text-white font-medium text-[14px] hover:opacity-90 transition-opacity shrink-0"
                  data-testid="load-video-button"
                >
                  載入
                </button>
              </div>
              {urlError && (
                <p className="text-red-500 text-[12px] mt-2" data-testid="url-error">{urlError}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6" data-testid="aurora-workspace">
            <div className="lg:w-1/2 flex flex-col gap-4">
              <YouTubeEmbed ref={playerRef} videoId={videoId} onStateChange={onPlayingChange} />
              <AuroraPlayerControls
                isPlaying={isPlaying}
                onTogglePlay={onTogglePlay}
                onSeekBackward={onSeekBackward}
                onSeekForward={onSeekForward}
              />
              <p className="text-[12px] text-[var(--text-tertiary)] font-mono truncate">
                {vodUrl || `https://youtube.com/watch?v=${videoId}`}
              </p>
            </div>

            <div className="lg:w-1/2 flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={onAddSong}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-purple)] text-white text-[13px] font-medium hover:opacity-90"
                  data-testid="add-song-button"
                >
                  <Plus size={14} />
                  新增歌曲
                </button>
                <button
                  onClick={onOpenImport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80"
                  data-testid="import-button"
                >
                  <FileText size={14} />
                  <span className="hidden sm:inline">匯入</span>
                </button>
                <button
                  onClick={onOpenExport}
                  disabled={songs.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 disabled:opacity-40"
                  data-testid="export-button"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">匯出</span>
                </button>
                <button
                  onClick={onFillAllDurations}
                  disabled={fillingIndex !== null || !songs.some((song) => song.endSeconds === null && song.name.trim() !== '')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 disabled:opacity-40"
                  data-testid="fill-all-durations-button"
                >
                  <Clock size={14} className={fillingIndex !== null ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">{bulkFillStatus ?? '填入時長'}</span>
                </button>
                <div className="flex-1" />
                {songs.length > 0 && (
                  <button
                    onClick={onClear}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 text-[13px] font-medium"
                  >
                    <Trash2 size={14} />
                    <span className="hidden sm:inline">清除</span>
                  </button>
                )}
              </div>

              <AuroraStampControls
                selectedIndex={selectedIndex}
                selectedSong={selectedIndex !== null ? songs[selectedIndex] ?? null : null}
                onSetStart={onSetStart}
                onSetEnd={onSetEnd}
                onSeekToStart={onSeekToStart}
                onSeekToEnd={onSeekToEnd}
              />

              <div
                className="flex-1 rounded-xl border border-[var(--border-default)] p-2 min-h-[300px]"
                style={{ background: 'var(--bg-surface-frosted)', backdropFilter: 'blur(8px)' }}
              >
                <SongListEditor
                  songs={songs}
                  selectedIndex={selectedIndex}
                  onSelect={onSelectSong}
                  onUpdate={onUpdateSong}
                  onDelete={onDeleteSong}
                  onMove={onMoveSong}
                  onSeekTo={onSeekTo}
                  onFillDuration={onFillDuration}
                  fillingIndex={fillingIndex}
                />
              </div>

              <p className="text-[11px] text-[var(--text-tertiary)]">
                {songs.length} 首歌曲 {selectedIndex !== null ? `· 已選取 #${selectedIndex + 1}` : ''}
              </p>
            </div>
          </div>
        )}
      </main>

      <PasteImportModal open={activeOverlay === 'import'} onClose={onCloseImport} onImport={onImport} />
      <ExportModal
        open={activeOverlay === 'export'}
        onClose={onCloseExport}
        songs={songs}
        vodUrl={vodUrl || (videoId ? `https://youtube.com/watch?v=${videoId}` : '')}
      />
    </div>
  );
}
