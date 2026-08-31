'use client';

import { memo } from 'react';
import { Play } from 'lucide-react';
import { formatTime } from '../lib/format';
import type { FlattenedSong, PerformanceRef } from '../types/archive';
import { trackFromFlattenedSong } from '../lib/archive';

interface MobileSearchRowProps {
  song: FlattenedSong;
  isCurrentlyPlaying: boolean;
  isUnavailable: boolean;
  onPlay: (track: PerformanceRef) => void;
  streamerSlug: string;
}

function MobileSearchRowInner({ song, isCurrentlyPlaying, isUnavailable, onPlay, streamerSlug }: MobileSearchRowProps) {
  return (
    <div
      data-testid="performance-row"
      className="flex items-center gap-3 transition-colors cursor-default"
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        background: isCurrentlyPlaying ? 'var(--bg-accent-pink-muted)' : undefined,
      }}
    >
      <button
        type="button"
        aria-label={`播放 ${song.title}`}
        onClick={() => {
          if (!isUnavailable) {
            onPlay(trackFromFlattenedSong(song, streamerSlug));
          }
        }}
        disabled={isUnavailable}
        className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full ${isUnavailable ? 'opacity-40 cursor-not-allowed' : ''}`}
        style={{
          background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
          color: 'white',
        }}
      >
        <Play className="w-4 h-4 fill-current" style={{ marginLeft: '2px' }} />
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="font-bold truncate"
          style={{ fontSize: '15px', fontWeight: 600, color: isCurrentlyPlaying ? 'var(--accent-pink)' : 'var(--text-primary)' }}
        >
          {song.title}
        </div>
        <div className="truncate" style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          {song.originalArtist}
        </div>
      </div>
      <span className="font-mono" style={{ fontSize: '13px', color: 'var(--text-secondary)', minWidth: '40px', textAlign: 'right' }}>
        {formatTime(song.timestamp)}
      </span>
    </div>
  );
}

const MobileSearchRow = memo(MobileSearchRowInner);

MobileSearchRow.displayName = 'MobileSearchRow';

export default MobileSearchRow;
