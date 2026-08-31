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
      className={`flex items-center gap-3 transition-colors cursor-default rounded-radius-lg ${isCurrentlyPlaying ? 'bg-accent-bg-pink-muted' : ''}`}
      style={{
        padding: '12px 16px',
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
        className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-accent-gradient ${isUnavailable ? 'opacity-40 cursor-not-allowed' : ''}`}
        style={{
          color: 'white',
        }}
      >
        <Play className="w-4 h-4 fill-current" style={{ marginLeft: '2px' }} />
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={`font-bold truncate ${isCurrentlyPlaying ? 'text-accent-pink' : 'text-token-primary'}`}
          style={{ fontSize: '15px', fontWeight: 600 }}
        >
          {song.title}
        </div>
        <div className="truncate text-token-secondary" style={{ fontSize: '13px' }}>
          {song.originalArtist}
        </div>
      </div>
      <span className="font-mono text-token-secondary" style={{ fontSize: '13px', minWidth: '40px', textAlign: 'right' }}>
        {formatTime(song.timestamp)}
      </span>
    </div>
  );
}

const MobileSearchRow = memo(MobileSearchRowInner);

MobileSearchRow.displayName = 'MobileSearchRow';

export default MobileSearchRow;
