import Link from 'next/link';
import {
  AlertCircle,
  Heart,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import type { RepeatMode, Track } from '../contexts/PlayerContext';
import { formatTime } from '../lib/format';
import AlbumArt from './AlbumArt';
import ProgressBar from './ProgressBar';
import VolumeControl from './VolumeControl';

interface DesktopMiniPlayerProps {
  currentTrack: Track;
  isPlaying: boolean;
  playerError: string | null;
  playerErrorId: string;
  pageSlug: string;
  liked: boolean;
  queueLength: number;
  repeatMode: RepeatMode;
  shuffleOn: boolean;
  trackCurrentTime: number;
  trackDuration: number | null;
  clampedProgress: number;
  hasKnownDuration: boolean;
  onOpenPlayer: () => void;
  onToggleLike: () => void;
  onOpenQueue: () => void;
  onTogglePlayPause: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onSeek: (percentage: number) => void;
}

export default function DesktopMiniPlayer({
  currentTrack,
  isPlaying,
  playerError,
  playerErrorId,
  pageSlug,
  liked,
  queueLength,
  repeatMode,
  shuffleOn,
  trackCurrentTime,
  trackDuration,
  clampedProgress,
  hasKnownDuration,
  onOpenPlayer,
  onToggleLike,
  onOpenQueue,
  onTogglePlayPause,
  onPrevious,
  onNext,
  onToggleRepeat,
  onToggleShuffle,
  onSeek,
}: DesktopMiniPlayerProps) {
  return (
    <div
      className="hidden lg:block"
      style={{
        height: '80px',
        background: 'var(--bg-surface-frosted)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-glass)',
      }}
    >
      {/* 3-column layout */}
      <div className="flex items-center h-full px-4 gap-4">
        {/* LEFT COLUMN: 280px — album art, track info */}
        <button
          type="button"
          className="flex flex-shrink-0 items-center gap-3 text-left"
          style={{ width: '280px' }}
          onClick={onOpenPlayer}
          aria-label={`開啟正在播放：${currentTrack.songTitle}`}
          aria-describedby={playerError ? playerErrorId : undefined}
        >
          {/* Album cover thumbnail — 48×48 desktop */}
          <AlbumArt
            alt={`${currentTrack.songTitle} - ${currentTrack.originalArtist}`}
            size={48}
          />

          {/* Track info */}
          <div className="min-w-0 flex-1">
            <div
              className="font-bold truncate"
              style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--text-primary)' }}
            >
              {currentTrack.songTitle}
            </div>
            {playerError ? (
              <div
                className="flex items-center gap-1 truncate text-red-500"
                style={{ fontSize: 'var(--font-size-xs)' }}
                data-testid="player-error-message"
                aria-hidden="true"
              >
                <AlertCircle style={{ width: '12px', height: '12px', flexShrink: 0 }} />
                <span>{playerError}</span>
              </div>
            ) : (
              <div
                className="truncate"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}
              >
                {currentTrack.originalArtist}
              </div>
            )}
          </div>
        </button>

        {/* CENTER COLUMN: fill — transport controls + progress bar */}
        <div
          className="flex-1 flex flex-col items-center justify-center gap-1"
          style={{ minWidth: 0 }}
        >
          {/* Transport controls row */}
          <div className="flex items-center gap-4">
            <button
              className={`transition-colors ${!shuffleOn ? 'hover-text-primary' : ''}`}
              aria-label="Shuffle"
              data-testid="desktop-shuffle-button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleShuffle();
              }}
              style={{ color: shuffleOn ? 'var(--accent-pink)' : 'var(--text-tertiary)' }}
            >
              <Shuffle style={{ width: '16px', height: '16px' }} />
            </button>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onPrevious();
              }}
              className="transition-colors hover-text-primary"
              aria-label="Previous"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <SkipBack style={{ width: '18px', height: '18px' }} />
            </button>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onTogglePlayPause();
              }}
              className="flex items-center justify-center flex-shrink-0 transition-[filter] hover:brightness-110 bg-accent-gradient"
              aria-label={isPlaying ? 'Pause' : 'Play'}
              data-testid="mini-player-play-button"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: 'var(--radius-circle)',
                color: 'white',
                flexShrink: 0,
              }}
            >
              {isPlaying ? (
                <Pause style={{ width: '18px', height: '18px', fill: 'currentColor' }} />
              ) : (
                <Play style={{ width: '18px', height: '18px', fill: 'currentColor', marginLeft: '2px' }} />
              )}
            </button>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onNext();
              }}
              className="transition-colors hover-text-primary"
              aria-label="Next"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <SkipForward style={{ width: '18px', height: '18px' }} />
            </button>

            <button
              className={`transition-colors ${repeatMode === 'off' ? 'hover-text-primary' : ''}`}
              aria-label="Repeat"
              data-testid="desktop-repeat-button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleRepeat();
              }}
              style={{ color: repeatMode !== 'off' ? 'var(--accent-pink)' : 'var(--text-tertiary)' }}
            >
              {repeatMode === 'one'
                ? <Repeat1 style={{ width: '16px', height: '16px' }} />
                : <Repeat style={{ width: '16px', height: '16px' }} />
              }
            </button>
          </div>

          {/* Progress bar row */}
          <div className="flex items-center gap-2 w-full" style={{ maxWidth: '480px' }}>
            <span
              className="flex-shrink-0 font-mono"
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', minWidth: '32px', textAlign: 'right' }}
            >
              {formatTime(trackCurrentTime)}
            </span>
            <ProgressBar
              progress={clampedProgress}
              onSeek={onSeek}
              disabled={!hasKnownDuration}
              height={4}
            />
            <span
              className="flex-shrink-0 font-mono"
              style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', minWidth: '32px' }}
            >
              {hasKnownDuration && trackDuration != null ? formatTime(trackDuration) : '--:--'}
            </span>
          </div>
        </div>

        {/* RIGHT COLUMN: 200px — expand, queue, volume */}
        <div
          className="flex items-center gap-3 flex-shrink-0 justify-end"
          style={{ width: '200px' }}
        >
          <Link
            href={pageSlug ? `/${pageSlug}/now-playing` : '#'}
            onClick={(event) => event.stopPropagation()}
            className="transition-colors hover-text-primary"
            aria-label="Expand to full page"
            data-testid="expand-now-playing-button"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Maximize2 style={{ width: '18px', height: '18px' }} />
          </Link>

          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleLike();
            }}
            className="transition-colors hover-text-primary"
            aria-label={liked ? '取消喜愛' : '喜愛'}
            data-testid="mini-player-like-button"
            style={{ color: liked ? 'var(--accent-pink)' : 'var(--text-tertiary)' }}
          >
            <Heart style={{ width: '18px', height: '18px' }} className={liked ? 'fill-current' : ''} />
          </button>

          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenQueue();
            }}
            className="relative transition-colors hover-text-primary"
            aria-label="Open queue"
            data-testid="queue-button"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ListMusic style={{ width: '18px', height: '18px' }} />
            {queueLength > 0 && (
              <span
                className="absolute -top-1 -right-1 flex items-center justify-center font-bold bg-accent-gradient"
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: 'var(--radius-circle)',
                  color: 'white',
                  fontSize: '10px',
                }}
              >
                {queueLength}
              </span>
            )}
          </button>

          <VolumeControl size="compact" />
        </div>
      </div>
    </div>
  );
}
