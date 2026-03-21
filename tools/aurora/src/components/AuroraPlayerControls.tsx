import { Play, Pause, Rewind, FastForward } from 'lucide-react';
import { secondsToTimestamp } from '../lib/parse';

interface Props {
  isPlaying: boolean;
  currentTime: number;
  onTogglePlay: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
}

export default function AuroraPlayerControls({
  isPlaying,
  currentTime,
  onTogglePlay,
  onSeekBackward,
  onSeekForward,
}: Props) {
  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid="aurora-player-controls"
    >
    <div className="flex items-center justify-center gap-3">
      <button
        onClick={onSeekBackward}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple)]"
        style={{ touchAction: 'manipulation' }}
        title="倒退 5 秒 (←)"
        data-testid="seek-backward-button"
      >
        <Rewind size={16} />
      </button>
      <button
        onClick={onTogglePlay}
        className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent-purple)] text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple)] focus:ring-offset-2"
        style={{ touchAction: 'manipulation' }}
        title="播放/暫停 (Space)"
        data-testid="toggle-play-button"
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button
        onClick={onSeekForward}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-white/80 focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple)]"
        style={{ touchAction: 'manipulation' }}
        title="快進 5 秒 (→)"
        data-testid="seek-forward-button"
      >
        <FastForward size={16} />
      </button>
    </div>
      <span className="font-mono text-xs text-[var(--text-tertiary)]" data-testid="playback-timer">
        {secondsToTimestamp(Math.floor(currentTime))}
      </span>
    </div>
  );
}
