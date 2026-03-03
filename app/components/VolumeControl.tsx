'use client';

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

  return (
    <div className="flex items-center" style={{ gap: '8px' }}>
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
