'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Play, Pause, SkipBack, SkipForward, ListMusic, AlertCircle, Shuffle, Repeat, Repeat1, Heart, Maximize2 } from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import AlbumArt from './AlbumArt';
import VolumeControl from './VolumeControl';
import ProgressBar from './ProgressBar';

export default function MiniPlayer() {
  const {
    currentTrack,
    isPlaying,
    playerError,
    trackCurrentTime,
    trackDuration,
    togglePlayPause,
    seekTo,
    previous,
    next,
    setShowModal,
    queue,
    setShowQueue,
    repeatMode,
    shuffleOn,
    toggleRepeat,
    toggleShuffle,
  } = usePlayer();

  const pathname = usePathname();
  const isNowPlayingPage = pathname === '/now-playing';

  const { isLiked: checkIsLiked, toggleLike } = useLikedSongs();

  const trackIsLiked = currentTrack ? checkIsLiked(currentTrack.id) : false;

  // Keyboard navigation: Space for play/pause when player is active
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Space if no input/textarea/button is focused
      const activeElement = document.activeElement;
      const isInputFocused = activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement;

      if (e.code === 'Space' && !isInputFocused && currentTrack) {
        e.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTrack, togglePlayPause]);

  if (!currentTrack) return null;

  const hasKnownDuration = trackDuration != null && trackDuration > 0;
  const progress = hasKnownDuration
    ? (trackCurrentTime / trackDuration) * 100
    : 0;

  const clampedProgress = Math.min(100, Math.max(0, progress));

  const handleSeek = (percentage: number) => {
    if (!hasKnownDuration) return;
    seekTo(currentTrack.timestamp + trackDuration * percentage);
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      data-testid="mini-player"
      className="fixed left-0 right-0 z-[60] mini-player-bottom"
      style={{ display: isNowPlayingPage ? 'none' : undefined }}
    >
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
        <ProgressBar progress={clampedProgress} onSeek={handleSeek} height={3} variant="mini" />

        {/* Content row: cover + song info + heart + play/pause */}
        <div
          className="flex items-center"
          style={{ padding: '10px 16px', gap: '12px', cursor: 'pointer' }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            setShowModal(true);
          }}
        >
          {/* Cover thumbnail — 40×40 */}
          <AlbumArt
            src={currentTrack.albumArtUrl}
            alt={`${currentTrack.title} - ${currentTrack.originalArtist}`}
            size={40}
          />

          {/* Song info — vertical, gap 2, fill remaining space */}
          <div className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
            <div
              className="truncate"
              style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}
            >
              {currentTrack.title}
            </div>
            <div
              className="truncate"
              style={{ fontSize: '11px', color: 'var(--text-secondary)' }}
            >
              {currentTrack.originalArtist}
            </div>
          </div>

          {/* Heart icon — 20px, accent-pink */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (currentTrack) {
                toggleLike({
                  performanceId: currentTrack.id,
                  songTitle: currentTrack.title,
                  originalArtist: currentTrack.originalArtist,
                  videoId: currentTrack.videoId,
                  timestamp: currentTrack.timestamp,
                  endTimestamp: currentTrack.endTimestamp,
                  albumArtUrl: currentTrack.albumArtUrl,
                });
              }
            }}
            className="flex-shrink-0"
            aria-label="Mobile Like"
            style={{ color: 'var(--accent-pink)', padding: '4px' }}
          >
            <Heart
              style={{
                width: '20px',
                height: '20px',
                fill: trackIsLiked ? 'var(--accent-pink)' : 'none',
              }}
            />
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

      {/* ── DESKTOP NOW PLAYING BAR (hidden on mobile) ── */}
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
        <div
          className="flex items-center h-full px-4 gap-4"
          onClick={(e) => {
            // Don't expand if clicking on buttons or interactive elements
            if ((e.target as HTMLElement).closest('button, input')) return;
            setShowModal(true);
          }}
          style={{ cursor: 'pointer' }}
        >
          {/* LEFT COLUMN: 280px — album art, track info, like */}
          <div
            className="flex items-center gap-3 flex-shrink-0"
            style={{ width: '280px' }}
          >
            {/* Album cover thumbnail — 48×48 desktop */}
            <AlbumArt
              src={currentTrack.albumArtUrl}
              alt={`${currentTrack.title} - ${currentTrack.originalArtist}`}
              size={48}
            />

            {/* Track info */}
            <div className="min-w-0 flex-1">
              {/* Song title — keep .font-bold.text-slate-800 for test compatibility */}
              <div
                className="font-bold text-slate-800 truncate"
                style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, color: 'var(--text-primary)' }}
              >
                {currentTrack.title}
              </div>
              {playerError ? (
                <div
                  className="flex items-center gap-1 truncate text-red-500"
                  style={{ fontSize: 'var(--font-size-xs)' }}
                  data-testid="player-error-message"
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

            {/* Heart/like button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (currentTrack) {
                  toggleLike({
                    performanceId: currentTrack.id,
                    songTitle: currentTrack.title,
                    originalArtist: currentTrack.originalArtist,
                    videoId: currentTrack.videoId,
                    timestamp: currentTrack.timestamp,
                    endTimestamp: currentTrack.endTimestamp,
                    albumArtUrl: currentTrack.albumArtUrl,
                  });
                }
              }}
              className="flex-shrink-0 transition-colors"
              aria-label="Like"
              style={{ color: trackIsLiked ? 'var(--accent-pink)' : 'var(--text-tertiary)' }}
            >
              <Heart
                style={{
                  width: '16px',
                  height: '16px',
                  fill: trackIsLiked ? 'var(--accent-pink)' : 'none',
                }}
              />
            </button>
          </div>

          {/* CENTER COLUMN: fill — transport controls + progress bar */}
          <div
            className="flex-1 flex flex-col items-center justify-center gap-1"
            style={{ minWidth: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Transport controls row */}
            <div className="flex items-center gap-4">
              {/* Shuffle */}
              <button
                className={`transition-colors ${!shuffleOn ? 'hover-text-primary' : ''}`}
                aria-label="Shuffle"
                data-testid="desktop-shuffle-button"
                onClick={(e) => { e.stopPropagation(); toggleShuffle(); }}
                style={{ color: shuffleOn ? 'var(--accent-pink)' : 'var(--text-tertiary)' }}
              >
                <Shuffle style={{ width: '16px', height: '16px' }} />
              </button>

              {/* Previous */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  previous();
                }}
                className="transition-colors hover-text-primary"
                aria-label="Previous"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <SkipBack style={{ width: '18px', height: '18px' }} />
              </button>

              {/* Play/Pause — 40×40 gradient circle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
                className="flex items-center justify-center flex-shrink-0 transition-all hover:brightness-110"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                data-testid="mini-player-play-button"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-circle)',
                  background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
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

              {/* Next */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
                className="transition-colors hover-text-primary"
                aria-label="Next"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <SkipForward style={{ width: '18px', height: '18px' }} />
              </button>

              {/* Repeat */}
              <button
                className={`transition-colors ${repeatMode === 'off' ? 'hover-text-primary' : ''}`}
                aria-label="Repeat"
                data-testid="desktop-repeat-button"
                onClick={(e) => { e.stopPropagation(); toggleRepeat(); }}
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
              <ProgressBar progress={clampedProgress} onSeek={handleSeek} height={4} />
              <span
                className="flex-shrink-0 font-mono"
                style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', minWidth: '32px' }}
              >
                {hasKnownDuration ? formatTime(trackDuration) : '--:--'}
              </span>
            </div>
          </div>

          {/* RIGHT COLUMN: 200px — queue, speaker, volume */}
          <div
            className="flex items-center gap-3 flex-shrink-0 justify-end"
            style={{ width: '200px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Expand to full Now Playing page */}
            <Link
              href="/now-playing"
              onClick={(e) => e.stopPropagation()}
              className="transition-colors hover-text-primary"
              aria-label="Expand to full page"
              data-testid="expand-now-playing-button"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <Maximize2 style={{ width: '18px', height: '18px' }} />
            </Link>

            {/* Queue button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowQueue(true);
              }}
              className="relative transition-colors hover-text-primary"
              aria-label="Open queue"
              data-testid="queue-button"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <ListMusic style={{ width: '18px', height: '18px' }} />
              {queue.length > 0 && (
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center font-bold"
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: 'var(--radius-circle)',
                    background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                    color: 'white',
                    fontSize: '10px',
                  }}
                >
                  {queue.length}
                </span>
              )}
            </button>

            {/* Volume control */}
            <VolumeControl size="compact" />
          </div>
        </div>
      </div>
    </div>
  );
}
