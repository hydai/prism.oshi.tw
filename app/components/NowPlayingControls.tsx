'use client';

import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1 } from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import VolumeControl from './VolumeControl';

interface NowPlayingControlsProps {
  size: 'desktop' | 'mobile';
}

export default function NowPlayingControls({ size }: NowPlayingControlsProps) {
  const {
    isPlaying,
    togglePlayPause,
    previous,
    next,
    repeatMode,
    shuffleOn,
    toggleRepeat,
    toggleShuffle,
  } = usePlayer();

  const isMobile = size === 'mobile';
  const shuffleSize = isMobile ? 22 : 20;
  const skipSize = isMobile ? 28 : 24;
  const playSize = isMobile ? 64 : 56;
  const playIconSize = isMobile ? 28 : 24;
  const gap = isMobile ? 40 : 32;

  return (
    <div className="flex flex-col items-center" style={{ gap: '16px' }}>
    <div
      className="flex items-center justify-center"
      style={{ gap: `${gap}px` }}
      data-testid="now-playing-controls"
    >
      {/* Shuffle */}
      <button
        onClick={toggleShuffle}
        className="transition-all hover:scale-110"
        aria-label="Shuffle"
        data-testid="np-shuffle-button"
        style={{ color: shuffleOn ? 'var(--accent-pink)' : '#94A3B8' }}
      >
        <Shuffle style={{ width: `${shuffleSize}px`, height: `${shuffleSize}px` }} />
      </button>

      {/* Previous */}
      <button
        onClick={previous}
        className="transition-all hover:scale-110"
        aria-label="Previous"
        style={{ color: 'var(--text-primary)' }}
      >
        <SkipBack style={{ width: `${skipSize}px`, height: `${skipSize}px` }} />
      </button>

      {/* Play/Pause — gradient circle */}
      <button
        onClick={togglePlayPause}
        className="flex items-center justify-center flex-shrink-0 transition-all hover:brightness-110 hover:scale-105"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        data-testid="np-play-button"
        style={{
          width: `${playSize}px`,
          height: `${playSize}px`,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
          color: 'white',
          boxShadow: '0 8px 24px rgba(244, 114, 182, 0.3)',
        }}
      >
        {isPlaying ? (
          <Pause style={{ width: `${playIconSize}px`, height: `${playIconSize}px`, fill: 'currentColor' }} />
        ) : (
          <Play style={{ width: `${playIconSize}px`, height: `${playIconSize}px`, fill: 'currentColor', marginLeft: '3px' }} />
        )}
      </button>

      {/* Next */}
      <button
        onClick={next}
        className="transition-all hover:scale-110"
        aria-label="Next"
        style={{ color: 'var(--text-primary)' }}
      >
        <SkipForward style={{ width: `${skipSize}px`, height: `${skipSize}px` }} />
      </button>

      {/* Repeat */}
      <button
        onClick={toggleRepeat}
        className="transition-all hover:scale-110"
        aria-label="Repeat"
        data-testid="np-repeat-button"
        style={{ color: repeatMode !== 'off' ? 'var(--accent-pink)' : '#94A3B8' }}
      >
        {repeatMode === 'one' ? (
          <Repeat1 style={{ width: `${shuffleSize}px`, height: `${shuffleSize}px` }} />
        ) : (
          <Repeat style={{ width: `${shuffleSize}px`, height: `${shuffleSize}px` }} />
        )}
      </button>
    </div>
    <VolumeControl size="full" />
    </div>
  );
}
