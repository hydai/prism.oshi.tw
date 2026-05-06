'use client';

import { useEffect, useRef } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';

interface VolumeControlProps {
  size?: 'compact' | 'full';
}

export default function VolumeControl({ size = 'compact' }: VolumeControlProps) {
  const { volume, isMuted, setVolume, toggleMute } = usePlayer();

  const sliderWidth = size === 'compact' ? '80px' : '120px';
  const iconSize = size === 'compact' ? 18 : 22;

  const displayVolume = isMuted ? 0 : volume;

  const VolumeIcon = isMuted || volume === 0
    ? VolumeX
    : volume < 50
      ? Volume1
      : Volume2;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef(volume);
  const setVolumeRef = useRef(setVolume);
  const lastWheelTimeRef = useRef(0);

  // Sync refs during render so the DOM wheel listener always sees the latest
  // committed values; useEffect-based sync would lag by one paint.
  volumeRef.current = volume;
  setVolumeRef.current = setVolume;

  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      // Pass through modifier-wheel gestures (Ctrl/Cmd+wheel = browser zoom)
      // so the user's intentional modified input still works over this control.
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheelTimeRef.current < 100) return;
      if (e.deltaY === 0) return;
      lastWheelTimeRef.current = now;
      const step = e.deltaY < 0 ? 5 : -5;
      setVolumeRef.current(volumeRef.current + step);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={wrapperRef} data-testid="volume-control" className="flex items-center" style={{ gap: '8px' }}>
      <button
        onClick={toggleMute}
        className="transition-colors flex-shrink-0"
        aria-label={isMuted ? 'Unmute' : 'Mute'}
        style={{ color: 'var(--text-tertiary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
      >
        <VolumeIcon style={{ width: `${iconSize}px`, height: `${iconSize}px` }} />
      </button>
      <div className="flex items-center" style={{ width: sliderWidth }}>
        <input
          type="range"
          min="0"
          max="100"
          value={displayVolume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-full"
          aria-label="Volume slider"
          style={{
            height: '4px',
            borderRadius: 'var(--radius-pill)',
            appearance: 'none',
            WebkitAppearance: 'none',
            background: `linear-gradient(90deg, var(--accent-pink-light) ${displayVolume}%, var(--bg-surface-muted) ${displayVolume}%)`,
            outline: 'none',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}
