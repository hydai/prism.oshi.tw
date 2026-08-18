import type { RefObject } from 'react';
import {
  Clock,
  Download,
  ExternalLink,
  FileText,
  Keyboard,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { StreamerOption } from '../lib/nova';
import type { AuroraSongEditorController } from '../hooks/useAuroraSongEditor';
import type { NovaSubmissionController } from '../hooks/useNovaSubmission';
import AuroraPlayerControls from './AuroraPlayerControls';
import AuroraStampControls from './AuroraStampControls';
import ExportModal from './ExportModal';
import PasteImportModal from './PasteImportModal';
import SongListEditor from './SongListEditor';
import ThemeToggle from './ThemeToggle';
import { YouTubeEmbed, type YouTubeEmbedHandle } from './YouTubeEmbed';

type SecondaryDialog = 'import' | 'export' | null;

interface StreamerSelection {
  options: StreamerOption[];
  selected: string;
  onChange: (slug: string) => void;
}

interface VideoController {
  url: string;
  id: string | null;
  error: string;
  onUrlChange: (url: string) => void;
  onLoad: () => void;
}

interface PlayerController {
  ref: RefObject<YouTubeEmbedHandle | null>;
  isPlaying: boolean;
  currentTime: number;
  onStateChange: (playing: boolean) => void;
  onTogglePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
}

interface ShortcutController {
  visible: boolean;
  onToggle: () => void;
}

interface DialogController {
  active: SecondaryDialog;
  open: (dialog: Exclude<SecondaryDialog, null>) => void;
  close: () => void;
}

export interface AuroraAppViewProps {
  streamer: StreamerSelection;
  video: VideoController;
  player: PlayerController;
  editor: AuroraSongEditorController;
  shortcuts: ShortcutController;
  dialogs: DialogController;
  submission: NovaSubmissionController;
}

const SHORTCUTS = [
  ['T', '設定開始時間'],
  ['M', '設定結束時間'],
  ['S', '跳轉到開始'],
  ['E', '跳轉到結束'],
  ['N', '下一首歌'],
  ['P', '上一首歌'],
  ['A', '新增歌曲'],
  ['F', '填入時長'],
  ['Space', '播放 / 暫停'],
  ['← →', '倒退 / 快進 5 秒'],
] as const;

function AuroraHeader({ streamer }: { streamer: StreamerSelection }) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-[var(--border-default)]"
      style={{ background: 'var(--bg-surface-frosted)', backdropFilter: 'blur(16px)' }}
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-[var(--accent-purple)]" />
          <h1 className="text-[17px] font-bold bg-gradient-to-r from-purple-500 to-teal-400 bg-clip-text text-transparent">
            Aurora
          </h1>
        </div>
        <span className="text-[12px] text-[var(--text-tertiary)] hidden sm:inline">社群時間戳工具</span>
        <div className="flex-1" />

        {streamer.options.length > 0 && (
          <select
            aria-label="選擇 VTuber"
            value={streamer.selected}
            onChange={(event) => streamer.onChange(event.target.value)}
            className="text-[13px] px-2 py-1.5 rounded-lg border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-purple)]"
          >
            <option value="">選擇 VTuber...</option>
            {streamer.options.map((option) => (
              <option key={option.slug} value={option.slug}>{option.display_name}</option>
            ))}
          </select>
        )}

        {streamer.selected && (
          <a
            href={`https://prism.oshi.tw/${streamer.selected}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--accent-purple)] transition-colors"
            title="在 Prism 中查看"
          >
            <ExternalLink size={12} />
            <span className="hidden md:inline">Prism</span>
          </a>
        )}

        <ThemeToggle />
      </div>
    </header>
  );
}

function AuroraLanding({ video }: { video: VideoController }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Sparkles size={28} className="text-[var(--accent-purple)]" />
          <h2 className="text-[28px] font-bold bg-gradient-to-r from-purple-500 to-teal-400 bg-clip-text text-transparent">
            Aurora
          </h2>
        </div>
        <p className="text-[var(--text-secondary)] text-[14px]">社群時間戳工具 — 為歌枠直播建立結構化的時間戳列表</p>
      </div>
      <div className="w-full max-w-lg">
        <div className="flex gap-2">
          <input
            aria-label="貼上 YouTube 歌枠網址"
            className="flex-1 rounded-xl border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] px-4 py-3 text-base outline-none focus:border-[var(--accent-purple)] placeholder:text-[var(--text-tertiary)]"
            placeholder="貼上 YouTube 歌枠網址..."
            value={video.url}
            onChange={(event) => video.onUrlChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') video.onLoad(); }}
            data-testid="vod-url-input"
          />
          <button
            onClick={video.onLoad}
            className="px-5 py-3 rounded-xl bg-[var(--accent-purple)] text-white font-medium text-[14px] hover:opacity-90 transition-opacity shrink-0"
            data-testid="load-video-button"
          >
            載入
          </button>
        </div>
        {video.error && (
          <p className="text-red-500 dark:text-red-400 text-[12px] mt-2" data-testid="url-error">
            {video.error}
          </p>
        )}
      </div>
    </div>
  );
}

interface VideoPanelProps {
  videoId: string;
  vodUrl: string;
  player: PlayerController;
  shortcuts: ShortcutController;
}

function AuroraVideoPanel({ videoId, vodUrl, player, shortcuts }: VideoPanelProps) {
  return (
    <div className="lg:w-1/2 flex flex-col gap-4">
      <YouTubeEmbed ref={player.ref} videoId={videoId} onStateChange={player.onStateChange} />
      <AuroraPlayerControls
        isPlaying={player.isPlaying}
        currentTime={player.currentTime}
        onTogglePlay={player.onTogglePlay}
        onSeekBackward={player.onSeekBackward}
        onSeekForward={player.onSeekForward}
      />
      <button
        onClick={shortcuts.onToggle}
        className="flex items-center gap-1.5 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors self-start"
      >
        <Keyboard size={14} />
        <span>快捷鍵</span>
      </button>
      {shortcuts.visible && (
        <div className="rounded-lg border border-[var(--border-default)] bg-white/40 dark:bg-white/[0.04] px-4 py-3">
          <p className="text-[11px] text-[var(--text-tertiary)] mb-2">在沒有輸入框聚焦時生效</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
            {SHORTCUTS.map(([key, description]) => (
              <div key={key} className="flex items-center gap-2">
                <kbd className="min-w-[28px] text-center px-1 py-0.5 rounded bg-white/60 dark:bg-white/[0.06] border border-[var(--border-default)] text-[11px] font-mono font-medium">
                  {key}
                </kbd>
                <span className="text-[var(--text-secondary)]">{description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[12px] text-[var(--text-tertiary)] font-mono truncate">
        {vodUrl || `https://youtube.com/watch?v=${videoId}`}
      </p>
    </div>
  );
}

interface SongEditorPanelProps {
  selectedStreamer: string;
  editor: AuroraSongEditorController;
  dialogs: DialogController;
  submission: NovaSubmissionController;
}

function AuroraSongEditorPanel({
  selectedStreamer,
  editor,
  dialogs,
  submission,
}: SongEditorPanelProps) {
  const selectedSong = editor.selectedIndex === null
    ? null
    : editor.songs[editor.selectedIndex] ?? null;

  return (
    <div className="lg:w-1/2 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={editor.addSong}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-purple)] text-white text-[13px] font-medium hover:opacity-90"
          data-testid="add-song-button"
        >
          <Plus size={14} />
          新增歌曲
        </button>
        <button
          onClick={() => dialogs.open('import')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 dark:bg-white/[0.06] border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 dark:hover:bg-white/[0.10]"
          data-testid="import-button"
        >
          <FileText size={14} />
          <span className="hidden sm:inline">匯入</span>
        </button>
        <button
          onClick={() => dialogs.open('export')}
          disabled={editor.songs.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 dark:bg-white/[0.06] border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 dark:hover:bg-white/[0.10] disabled:opacity-40"
          data-testid="export-button"
        >
          <Download size={14} />
          <span className="hidden sm:inline">匯出</span>
        </button>
        <button
          onClick={editor.fillAllDurations}
          disabled={editor.fillingIndex !== null || !editor.songs.some((song) => song.name.trim() !== '')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 dark:bg-white/[0.06] border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 dark:hover:bg-white/[0.10] disabled:opacity-40"
          data-testid="fill-all-durations-button"
        >
          <Clock size={14} className={editor.fillingIndex !== null ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{editor.bulkFillStatus ?? '填入時長'}</span>
        </button>
        <button
          onClick={submission.open}
          disabled={editor.songs.length === 0 || !selectedStreamer || submission.submitting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 dark:bg-emerald-600 text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
          title={!selectedStreamer ? '請先選擇 VTuber' : '提交到 Nova'}
          data-testid="submit-to-nova-button"
        >
          <Send size={14} />
          <span className="hidden sm:inline">提交 Nova</span>
        </button>
        <div className="flex-1" />
        {editor.songs.length > 0 && (
          <button
            onClick={editor.clearSongs}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 text-[13px] font-medium"
          >
            <Trash2 size={14} />
            <span className="hidden sm:inline">清除</span>
          </button>
        )}
      </div>

      {submission.status && (
        <div
          className={`text-[13px] px-3 py-2 rounded-lg ${
            submission.status.type === 'success'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
          }`}
        >
          {submission.status.message}
        </div>
      )}

      <AuroraStampControls
        selectedIndex={editor.selectedIndex}
        selectedSong={selectedSong}
        onSetStart={editor.setStart}
        onSetEnd={editor.setEnd}
        onSeekToStart={editor.seekToStart}
        onSeekToEnd={editor.seekToEnd}
      />

      <div
        className="flex-1 rounded-xl border border-[var(--border-default)] p-2 min-h-[300px]"
        style={{ background: 'var(--bg-surface-frosted)', backdropFilter: 'blur(8px)' }}
      >
        <SongListEditor
          songs={editor.songs}
          selectedIndex={editor.selectedIndex}
          onSelect={editor.selectSong}
          onUpdate={editor.updateSong}
          onDelete={editor.deleteSong}
          onMove={editor.moveSong}
          onSeekTo={editor.seekTo}
          onFillDuration={editor.fillDuration}
          fillingIndex={editor.fillingIndex}
        />
      </div>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        {editor.songs.length} 首歌曲 {editor.selectedIndex !== null ? `· 已選取 #${editor.selectedIndex + 1}` : ''}
      </p>
    </div>
  );
}

interface WorkspaceProps {
  videoId: string;
  vodUrl: string;
  selectedStreamer: string;
  player: PlayerController;
  editor: AuroraSongEditorController;
  shortcuts: ShortcutController;
  dialogs: DialogController;
  submission: NovaSubmissionController;
}

function AuroraWorkspace(props: WorkspaceProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-6" data-testid="aurora-workspace">
      <AuroraVideoPanel
        videoId={props.videoId}
        vodUrl={props.vodUrl}
        player={props.player}
        shortcuts={props.shortcuts}
      />
      <AuroraSongEditorPanel
        selectedStreamer={props.selectedStreamer}
        editor={props.editor}
        dialogs={props.dialogs}
        submission={props.submission}
      />
    </div>
  );
}

function AuroraFooter() {
  return (
    <footer className="py-4 text-center">
      <div className="flex items-center justify-center gap-4 text-[13px]">
        <a href="https://nova.oshi.tw/vod" className="text-[var(--accent-purple)] hover:opacity-70 transition-opacity">Nova VOD</a>
        <span className="text-[var(--text-tertiary)]">|</span>
        <a href="https://prism.oshi.tw" className="text-[var(--accent-purple)] hover:opacity-70 transition-opacity">前往 Prism 歌單</a>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)] mt-4">
        Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面
      </p>
    </footer>
  );
}

interface SubmitModalProps {
  streamer: StreamerSelection;
  editor: AuroraSongEditorController;
  submission: NovaSubmissionController;
}

function NovaSubmitModal({ streamer, editor, submission }: SubmitModalProps) {
  if (!submission.isOpen) return null;

  const streamerName = streamer.options.find((option) => option.slug === streamer.selected)?.display_name
    ?? streamer.selected;
  const songCount = editor.songs.filter((song) => song.name.trim() !== '').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0"
        onClick={submission.close}
        aria-label="關閉提交到 Nova 對話框"
      />
      <div
        className="relative mx-4 w-full max-w-sm rounded-2xl border border-[var(--border-default)] p-5 shadow-xl"
        style={{ background: 'var(--bg-surface)' }}
      >
        <h3 className="text-[15px] font-semibold mb-2 text-[var(--text-primary)]">提交到 Nova</h3>
        <p className="text-[13px] text-[var(--text-secondary)] mb-1">
          VTuber: <strong>{streamerName}</strong>
        </p>
        <p className="text-[13px] text-[var(--text-secondary)] mb-4">
          {songCount} 首歌曲的時間戳
        </p>

        <div className="flex flex-col gap-3 mb-4">
          <div>
            <label htmlFor="aurora-submit-stream-date" className="block text-[13px] text-[var(--text-secondary)] mb-1">
              直播日期
            </label>
            <input
              id="aurora-submit-stream-date"
              type="date"
              value={submission.streamDate}
              onChange={(event) => submission.setStreamDate(event.target.value)}
              className="w-full rounded-lg border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--accent-purple)]"
            />
          </div>
          <div>
            <label htmlFor="aurora-submit-note" className="block text-[13px] text-[var(--text-secondary)] mb-1">
              備註（選填）
            </label>
            <input
              id="aurora-submit-note"
              type="text"
              value={submission.note}
              onChange={(event) => submission.setNote(event.target.value)}
              placeholder="任何補充說明（選填）"
              className="w-full rounded-lg border border-[var(--border-default)] bg-white/60 dark:bg-white/[0.06] px-3 py-1.5 text-[13px] outline-none focus:border-[var(--accent-purple)] placeholder:text-[var(--text-tertiary)]"
            />
          </div>
        </div>

        <div className="flex justify-center mb-4">
          <div ref={submission.turnstileContainerRef} />
        </div>

        <div className="flex gap-2">
          <button
            onClick={submission.close}
            className="flex-1 px-4 py-2 rounded-lg bg-white/60 dark:bg-white/[0.06] border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 dark:hover:bg-white/[0.10]"
          >
            取消
          </button>
          <button
            onClick={submission.submit}
            disabled={!submission.turnstileToken || submission.submitting}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 dark:bg-emerald-600 text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            {submission.submitting ? '提交中...' : '確認提交'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuroraAppView({
  streamer,
  video,
  player,
  editor,
  shortcuts,
  dialogs,
  submission,
}: AuroraAppViewProps) {
  return (
    <div className="min-h-screen flex flex-col">
      <AuroraHeader streamer={streamer} />
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {video.id ? (
          <AuroraWorkspace
            videoId={video.id}
            vodUrl={video.url}
            selectedStreamer={streamer.selected}
            player={player}
            editor={editor}
            shortcuts={shortcuts}
            dialogs={dialogs}
            submission={submission}
          />
        ) : (
          <AuroraLanding video={video} />
        )}
      </main>
      <AuroraFooter />

      <PasteImportModal
        open={dialogs.active === 'import'}
        onClose={dialogs.close}
        onImport={editor.importSongs}
      />
      <ExportModal
        open={dialogs.active === 'export'}
        onClose={dialogs.close}
        songs={editor.songs}
        vodUrl={video.url || (video.id ? `https://youtube.com/watch?v=${video.id}` : '')}
      />
      <NovaSubmitModal streamer={streamer} editor={editor} submission={submission} />
    </div>
  );
}
