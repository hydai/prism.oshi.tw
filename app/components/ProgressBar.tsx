'use client';

import { useRef, useCallback } from 'react';

interface ProgressBarProps {
  progress: number;
  onSeek: (percentage: number) => void;
  height?: number;
  showTimestamps?: boolean;
  currentTime?: string;
  totalTime?: string;
  variant?: 'mini' | 'full';
}

export default function ProgressBar({
  progress,
  onSeek,
  height = 4,
  showTimestamps,
  currentTime,
  totalTime,
  variant = 'full',
}: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const clamped = Math.min(100, Math.max(0, progress));

  const getPercentage = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onSeek(getPercentage(e.clientX));
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    onSeek(getPercentage(e.touches[0].clientX));
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    onSeek(getPercentage(e.touches[0].clientX));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const current = clamped / 100;
    const next = (() => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          return current + 0.05;
        case 'ArrowLeft':
        case 'ArrowDown':
          return current - 0.05;
        case 'PageUp':
          return current + 0.1;
        case 'PageDown':
          return current - 0.1;
        case 'Home':
          return 0;
        case 'End':
          return 1;
        default:
          return null;
      }
    })();

    if (next === null) return;
    e.preventDefault();
    onSeek(Math.min(1, Math.max(0, next)));
  };

  if (variant === 'mini') {
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label="播放進度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-valuetext={`${Math.round(clamped)}%`}
        onKeyDown={handleKeyDown}
        ref={barRef}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-pink-light)]"
        style={{
          height: `${height}px`,
          background: 'var(--bg-surface-muted)',
          borderRadius: '16px 16px 0 0',
          overflow: 'hidden',
          touchAction: 'none',
        }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        <div
          style={{
            height: '100%',
            width: `${clamped}%`,
            background: 'linear-gradient(90deg, var(--accent-pink-light), var(--accent-blue-light))',
            borderRadius: '16px 16px 0 0',
            transition: 'width 0.2s',
          }}
        />
      </div>
    );
  }

  const bar = (
    <div
      role="slider"
      tabIndex={0}
      aria-label="播放進度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={`${Math.round(clamped)}%`}
      onKeyDown={handleKeyDown}
      ref={barRef}
      className="group relative flex-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-pink-light)]"
      style={{
        height: `${height}px`,
        borderRadius: `${height / 2}px`,
        background: 'var(--bg-surface-muted)',
        touchAction: 'none',
      }}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >
      <div
        style={{
          height: '100%',
          width: `${clamped}%`,
          borderRadius: `${height / 2}px`,
          background: 'linear-gradient(90deg, var(--accent-pink-light), var(--accent-blue-light))',
          transition: 'width 0.2s',
        }}
      />
      {/* Scrubber dot — always visible on touch devices, hover-only on desktop */}
      <div
        className="absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 coarse-pointer:opacity-100 transition-opacity"
        style={{
          left: `${clamped}%`,
          transform: 'translate(-50%, -50%)',
          width: `${height * 3}px`,
          height: `${height * 3}px`,
          borderRadius: '50%',
          background: 'var(--bg-surface)',
          border: '2px solid var(--accent-pink-light)',
        }}
      />
    </div>
  );

  if (showTimestamps) {
    return (
      <div className="flex items-center gap-2 w-full" style={{ maxWidth: variant === 'full' ? undefined : '480px' }}>
        <span
          className="flex-shrink-0 font-mono"
          style={{ fontSize: '13px', color: 'var(--text-tertiary)', minWidth: '36px', textAlign: 'right' }}
        >
          {currentTime}
        </span>
        {bar}
        <span
          className="flex-shrink-0 font-mono"
          style={{ fontSize: '13px', color: 'var(--text-tertiary)', minWidth: '36px' }}
        >
          {totalTime}
        </span>
      </div>
    );
  }

  return bar;
}
