'use client';

import { memo } from 'react';
import { Play } from 'lucide-react';

interface MobileSearchRowProps {
  song: {
    id: string;
    performanceId: string;
    title: string;
    originalArtist: string;
    videoId: string;
    timestamp: number;
    endTimestamp?: number;
    albumArtUrl?: string;
  };
  isCurrentlyPlaying: boolean;
  isUnavailable: boolean;
  onPlay: (track: { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string }) => void;
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function MobileSearchRowInner({ song, isCurrentlyPlaying, isUnavailable, onPlay }: MobileSearchRowProps) {
  return (
    <div
      data-testid="performance-row"
      className="flex items-center gap-3 transition-all cursor-default"
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        background: isCurrentlyPlaying ? 'var(--bg-accent-pink-muted)' : undefined,
      }}
    >
      <button
        onClick={() => {
          if (!isUnavailable) {
            onPlay({
              id: song.performanceId,
              songId: song.id,
              title: song.title,
              originalArtist: song.originalArtist,
              videoId: song.videoId,
              timestamp: song.timestamp,
              endTimestamp: song.endTimestamp,
              albumArtUrl: song.albumArtUrl,
            });
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

const MobileSearchRow = memo(MobileSearchRowInner, (prev, next) => {
  return (
    prev.song.performanceId === next.song.performanceId &&
    prev.isCurrentlyPlaying === next.isCurrentlyPlaying &&
    prev.isUnavailable === next.isUnavailable
  );
});

MobileSearchRow.displayName = 'MobileSearchRow';

export default MobileSearchRow;
