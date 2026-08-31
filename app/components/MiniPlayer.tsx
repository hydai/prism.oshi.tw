'use client';

import { useEffect, useId } from 'react';
import { usePathname } from 'next/navigation';
import { Play, Pause, ListMusic, Heart } from 'lucide-react';
import {
  useCurrentTrack,
  usePlayerActions,
  usePlayerStatus,
  usePlaybackTime,
  useQueue,
  useTransport,
} from '../contexts/PlayerContext';
import { useCurrentTrackLike } from '../lib/use-current-track-like';
import { useTrackProgress } from '../lib/use-track-progress';
import { useStreamer } from '../contexts/StreamerContext';
import AlbumArt from './AlbumArt';
import ProgressBar from './ProgressBar';
import DesktopMiniPlayer from './DesktopMiniPlayer';

export default function MiniPlayer() {
  const currentTrack = useCurrentTrack();
  const { isPlaying, repeatMode, shuffleOn } = useTransport();
  const { playerError } = usePlayerStatus();
  const queue = useQueue();
  const { togglePlayPause, previous, next, toggleRepeat, toggleShuffle, setShowModal, setShowQueue } = usePlayerActions();

  const { trackCurrentTime, trackDuration } = usePlaybackTime();
  const { liked, toggleCurrentLike } = useCurrentTrackLike();
  const { hasKnownDuration, progress, handleSeek } = useTrackProgress();
  const playerErrorId = useId();
  const pageSlug = useStreamer().slug;

  const pathname = usePathname();
  const isNowPlayingPage = pathname?.endsWith('/now-playing');

  // Keyboard navigation: Space for play/pause when player is active
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Let focused controls handle Space themselves.
      const activeElement = document.activeElement;
      const isControlFocused = activeElement instanceof HTMLElement
        && activeElement.matches('input, textarea, select, button, a[href], [role="slider"], [contenteditable="true"]');

      if (e.code === 'Space' && !isControlFocused && currentTrack) {
        e.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTrack, togglePlayPause]);

  if (!currentTrack) return null;

  return (
    <div
      data-testid="mini-player"
      className="fixed left-0 right-0 z-[60] mini-player-bottom"
      style={{ display: isNowPlayingPage ? 'none' : undefined }}
    >
      {playerError && (
        <span id={playerErrorId} role="status" className="sr-only">
          {playerError}
        </span>
      )}

      {/* ── MOBILE MINI PLAYER (hidden on lg+) ── */}
      <div
        className="lg:hidden"
        style={{
          background: 'var(--bg-surface-frosted)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-glass)',
          borderLeft: '1px solid var(--border-glass)',
          borderRight: '1px solid var(--border-glass)',
          borderRadius: '16px 16px 0 0',
        }}
      >
        {/* Progress bar at top — 3px height, gradient fill */}
        <ProgressBar
          progress={progress}
          onSeek={handleSeek}
          disabled={!hasKnownDuration}
          height={3}
          variant="mini"
        />

        {/* Content row: cover + song info + queue + play/pause */}
        <div
          className="flex items-center"
          style={{ padding: '10px 16px', gap: '12px' }}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center text-left"
            style={{ gap: '12px' }}
            onClick={() => setShowModal(true)}
            aria-label={`開啟正在播放：${currentTrack.songTitle}`}
            aria-describedby={playerError ? playerErrorId : undefined}
          >
            {/* Cover thumbnail — 40×40 */}
            <AlbumArt
              alt={`${currentTrack.songTitle} - ${currentTrack.originalArtist}`}
              size={40}
            />

            {/* Song info — vertical, gap 2, fill remaining space */}
            <div className="flex min-w-0 flex-1 flex-col" style={{ gap: '2px' }}>
              <div
                className="truncate"
                style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}
              >
                {currentTrack.songTitle}
              </div>
              <div
                className="truncate"
                style={{ fontSize: '11px', color: 'var(--text-secondary)' }}
              >
                {currentTrack.originalArtist}
              </div>
            </div>
          </button>

          {/* Like button — mobile */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleCurrentLike();
            }}
            className="flex-shrink-0"
            aria-label={liked ? '取消喜愛' : '喜愛'}
            data-testid="mini-player-like-button-mobile"
            style={{ color: liked ? 'var(--accent-pink)' : 'var(--text-secondary)', padding: '4px' }}
          >
            <Heart style={{ width: '20px', height: '20px' }} className={liked ? 'fill-current' : ''} />
          </button>

          {/* Queue button — mobile */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowQueue(true);
            }}
            className="flex-shrink-0 relative"
            aria-label="Open queue"
            data-testid="mini-player-queue-button-mobile"
            style={{ color: 'var(--text-secondary)', padding: '4px' }}
          >
            <ListMusic style={{ width: '20px', height: '20px' }} />
            {queue.length > 0 && (
              <span
                className="absolute -top-1 -right-1 flex items-center justify-center font-bold"
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: 'var(--radius-circle)',
                  background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                  color: 'white',
                  fontSize: '9px',
                }}
              >
                {queue.length}
              </span>
            )}
          </button>

          {/* Play/Pause icon — 24px, text-primary */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            className="flex-shrink-0"
            aria-label={isPlaying ? '暫停' : '播放'}
            data-testid="mini-player-play-button-mobile"
            style={{ color: 'var(--text-primary)', padding: '4px' }}
          >
            {isPlaying ? (
              <Pause style={{ width: '24px', height: '24px', fill: 'currentColor' }} />
            ) : (
              <Play style={{ width: '24px', height: '24px', fill: 'currentColor', marginLeft: '2px' }} />
            )}
          </button>
        </div>
      </div>

      <DesktopMiniPlayer
        currentTrack={currentTrack}
        isPlaying={isPlaying}
        playerError={playerError}
        playerErrorId={playerErrorId}
        pageSlug={pageSlug}
        liked={liked}
        queueLength={queue.length}
        repeatMode={repeatMode}
        shuffleOn={shuffleOn}
        trackCurrentTime={trackCurrentTime}
        trackDuration={trackDuration}
        clampedProgress={progress}
        hasKnownDuration={hasKnownDuration}
        onOpenPlayer={() => setShowModal(true)}
        onToggleLike={toggleCurrentLike}
        onOpenQueue={() => setShowQueue(true)}
        onTogglePlayPause={togglePlayPause}
        onPrevious={previous}
        onNext={next}
        onToggleRepeat={toggleRepeat}
        onToggleShuffle={toggleShuffle}
        onSeek={handleSeek}
      />
    </div>
  );
}
