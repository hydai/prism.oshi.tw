import { Timer, TimerOff, SkipBack, SkipForward } from 'lucide-react';
import type { AuroraSong } from './SongListEditor';

interface Props {
  selectedIndex: number | null;
  selectedSong: AuroraSong | null;
  onSetStart: () => void;
  onSetEnd: () => void;
  onSeekToStart: () => void;
  onSeekToEnd: () => void;
}

const btnBase =
  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple)] min-h-[44px]';
const btnSecondary =
  'bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-white/80';
const btnDisabled = 'opacity-40 cursor-not-allowed';

export default function AuroraStampControls({
  selectedIndex,
  selectedSong,
  onSetStart,
  onSetEnd,
  onSeekToStart,
  onSeekToEnd,
}: Props) {
  const noSong = selectedIndex === null;
  const noEnd = noSong || selectedSong?.endSeconds == null;

  return (
    <div
      className="grid grid-cols-2 sm:flex sm:items-center gap-2"
      style={{ touchAction: 'manipulation' }}
      data-testid="aurora-stamp-controls"
    >
      {/* Timestamp editing */}
      <button
        onClick={onSetStart}
        disabled={noSong}
        className={`${btnBase} ${btnSecondary} ${noSong ? btnDisabled : ''}`}
        title="設定開始時間 (T)"
        data-testid="set-start-button"
      >
        <Timer size={14} />
        設定開始
      </button>
      <button
        onClick={onSetEnd}
        disabled={noSong}
        className={`${btnBase} ${btnSecondary} ${noSong ? btnDisabled : ''}`}
        title="設定結束時間 (M)"
        data-testid="set-end-button"
      >
        <TimerOff size={14} />
        設定結束
      </button>
      <button
        onClick={onSeekToStart}
        disabled={noSong}
        className={`${btnBase} ${btnSecondary} ${noSong ? btnDisabled : ''}`}
        title="跳轉到開始 (S)"
        data-testid="seek-to-start-button"
      >
        <SkipBack size={14} />
        跳至開始
      </button>
      <button
        onClick={onSeekToEnd}
        disabled={noEnd}
        className={`${btnBase} ${btnSecondary} ${noEnd ? btnDisabled : ''}`}
        title="跳轉到結束 (E)"
        data-testid="seek-to-end-button"
      >
        <SkipForward size={14} />
        跳至結束
      </button>
    </div>
  );
}
