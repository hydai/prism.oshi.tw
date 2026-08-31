'use client';

import { useRef, useCallback } from 'react';

interface ProgressBarProps {
  progress: number;
  onSeek: (percentage: number) => void;
  disabled?: boolean;
  height?: number;
  showTimestamps?: boolean;
  currentTime?: string;
  totalTime?: string;
  variant?: 'mini' | 'full';
}

export default function ProgressBar({
  progress,
  onSeek,
  disabled = false,
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
        tabIndex={disabled ? -1 : 0}
        aria-label="播放進度"
        aria-disabled={disabled || undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-valuetext={disabled ? '歌曲時長不明，無法調整進度' : `${Math.round(clamped)}%`}
        onKeyDown={disabled ? undefined : handleKeyDown}
        ref={barRef}
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-pink-light)] bg-surface-muted"
        style={{
          height: `${height}px`,
          borderRadius: '16px 16px 0 0',
          overflow: 'hidden',
          touchAction: 'none',
        }}
        onClick={disabled ? undefined : handleClick}
        onTouchStart={disabled ? undefined : handleTouchStart}
        onTouchMove={disabled ? undefined : handleTouchMove}
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
      tabIndex={disabled ? -1 : 0}
      aria-label="播放進度"
      aria-disabled={disabled || undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={disabled ? '歌曲時長不明，無法調整進度' : `${Math.round(clamped)}%`}
      onKeyDown={disabled ? undefined : handleKeyDown}
      ref={barRef}
      className={`group relative flex-1 ${disabled ? 'cursor-default' : 'cursor-pointer'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-pink-light)] bg-surface-muted`}
      style={{
        height: `${height}px`,
        borderRadius: `${height / 2}px`,
        touchAction: 'none',
      }}
      onClick={disabled ? undefined : handleClick}
      onTouchStart={disabled ? undefined : handleTouchStart}
      onTouchMove={disabled ? undefined : handleTouchMove}
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
        className="absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 coarse-pointer:opacity-100 transition-opacity bg-surface"
        style={{
          left: `${clamped}%`,
          transform: 'translate(-50%, -50%)',
          width: `${height * 3}px`,
          height: `${height * 3}px`,
          borderRadius: '50%',
          border: '2px solid var(--accent-pink-light)',
        }}
      />
    </div>
  );

  if (showTimestamps) {
    return (
      <div className="flex items-center gap-2 w-full" style={{ maxWidth: variant === 'full' ? undefined : '480px' }}>
        <span
          className="flex-shrink-0 font-mono text-token-tertiary"
          style={{ fontSize: '13px', minWidth: '36px', textAlign: 'right' }}
        >
          {currentTime}
        </span>
        {bar}
        <span
          className="flex-shrink-0 font-mono text-token-tertiary"
          style={{ fontSize: '13px', minWidth: '36px' }}
        >
          {totalTime}
        </span>
      </div>
    );
  }

  return bar;
}
