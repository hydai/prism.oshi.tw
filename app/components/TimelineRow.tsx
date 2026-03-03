'use client';

import { memo } from 'react';
import { Play, Disc3, Plus, ExternalLink } from 'lucide-react';
import AlbumArt from './AlbumArt';
import AddToPlaylistDropdown from './AddToPlaylistDropdown';

interface FlattenedSong {
  id: string;
  performanceId: string;
  title: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  note: string;
  streamTitle: string;
  date: string;
  albumArtUrl?: string;
  tags: string[];
  performances: unknown[];
  streamId?: string;
  searchString: string;
  year?: number;
}

interface TimelineRowProps {
  song: FlattenedSong;
  index: number;
  isCurrentlyPlaying: boolean;
  isUnavailable: boolean;
  onPlay: (track: { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string }) => void;
  onAddToQueue: (track: { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string }) => void;
  onAddToPlaylistSuccess: () => void;
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function TimelineRowInner({ song, index, isCurrentlyPlaying, isUnavailable, onPlay, onAddToQueue, onAddToPlaylistSuccess }: TimelineRowProps) {
  const track = {
    id: song.performanceId,
    songId: song.id,
    title: song.title,
    originalArtist: song.originalArtist,
    videoId: song.videoId,
    timestamp: song.timestamp,
    endTimestamp: song.endTimestamp,
    albumArtUrl: song.albumArtUrl,
  };

  return (
    <div
      data-testid="performance-row"
      className="group hover-row grid grid-cols-[32px_40px_1fr_60px] lg:grid-cols-[32px_40px_2fr_2fr_100px_60px] gap-0 items-center transition-all cursor-default"
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3) var(--space-4)',
        background: isCurrentlyPlaying
          ? '#FCE7F320'
          : undefined,
      }}
    >
      {/* # column: row number / play button */}
      <div
        className="flex items-center justify-center relative"
        style={{ width: '32px', height: '32px' }}
      >
        {/* Mobile: play icon or spinning disc when playing */}
        {isCurrentlyPlaying ? (
          <Disc3
            className="lg:hidden animate-spin"
            style={{
              width: '18px',
              height: '18px',
              color: 'var(--accent-pink)',
              animationDuration: '3s',
            }}
          />
        ) : (
          <Play
            className="lg:hidden"
            style={{
              width: '14px',
              height: '14px',
              color: 'var(--text-tertiary)',
              fill: 'currentColor',
            }}
          />
        )}
        {/* Desktop: number that fades on hover, replaced by play button */}
        <span
          className="hidden lg:block group-hover:opacity-0 transition-opacity font-mono text-sm select-none"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {index + 1}
        </span>
        <button
          onClick={() => {
            if (!isUnavailable) {
              onPlay(track);
            }
          }}
          disabled={isUnavailable}
          data-testid="play-button"
          className={`hidden lg:flex absolute inset-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-all ${
            isUnavailable
              ? 'cursor-not-allowed'
              : 'transform hover:scale-110'
          }`}
          style={{
            color: isUnavailable
              ? 'var(--text-muted)'
              : 'var(--accent-pink)',
          }}
        >
          <Play className="w-4 h-4 fill-current" />
        </button>
      </div>

      {/* Album art column */}
      <div className="flex items-center justify-center">
        <AlbumArt
          src={song.albumArtUrl}
          alt={`${song.title} - ${song.originalArtist}`}
          size={32}
        />
      </div>

      {/* Title column */}
      <div
        className="min-w-0 lg:pl-3 cursor-pointer"
        onClick={() => {
          if (!isUnavailable) {
            onPlay(track);
          }
        }}
      >
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="font-bold truncate"
              style={{
                fontSize: '15px',
                color: isCurrentlyPlaying ? 'var(--accent-pink-dark)' : 'var(--text-primary)',
              }}
            >
              {song.title}
            </div>
            {song.note && (
              <span
                className="inline-flex items-center border font-medium flex-shrink-0"
                style={{
                  background: 'var(--bg-accent-blue-muted)',
                  color: 'var(--accent-blue)',
                  borderColor: 'var(--border-accent-blue)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--font-size-xs)',
                  padding: 'var(--space-1) var(--space-3)',
                }}
              >
                {song.note}
              </span>
            )}
          </div>
          <div
            className="truncate"
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary)',
            }}
          >
            {song.originalArtist}
          </div>
        </div>
      </div>

      {/* Stream title column (desktop only) */}
      <div
        className="hidden lg:flex items-center min-w-0 pl-3"
        style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}
      >
        <span className="truncate">{song.streamTitle}</span>
      </div>

      {/* Date column (desktop only) */}
      <div
        className="hidden lg:flex items-center pl-3 font-mono"
        style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}
      >
        {song.date}
      </div>

      {/* Duration / Actions column */}
      <div
        className="flex items-center justify-end gap-1.5"
        style={{ color: 'var(--text-secondary)' }}
      >
        <button
          onClick={() => onAddToQueue(track)}
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-all transform hover:scale-110"
          style={{
            background: 'var(--bg-surface)',
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-circle)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            color: 'var(--text-secondary)',
          }}
          title="加入佇列"
          data-testid="add-to-queue"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-pink)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
        >
          <Plus className="w-4 h-4" />
        </button>
        <div
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-all"
          style={{
            background: 'var(--bg-surface)',
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-circle)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            color: 'var(--text-secondary)',
          }}
        >
          <AddToPlaylistDropdown
            version={{
              performanceId: song.performanceId,
              songTitle: song.title,
              originalArtist: song.originalArtist,
              videoId: song.videoId,
              timestamp: song.timestamp,
            }}
            onSuccess={onAddToPlaylistSuccess}
          />
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${song.videoId}&t=${song.timestamp}s`}
          target="_blank"
          rel="noopener noreferrer"
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-all transform hover:scale-110"
          style={{
            background: 'var(--bg-surface)',
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-circle)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            color: 'var(--text-secondary)',
            display: 'flex',
            alignItems: 'center',
          }}
          title="在 YouTube 開啟"
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#FF0000'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <span
          className="font-mono text-right"
          style={{
            minWidth: '40px',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
          }}
        >
          {formatTime(song.timestamp)}
        </span>
      </div>
    </div>
  );
}

const TimelineRow = memo(TimelineRowInner, (prev, next) => {
  return (
    prev.song.performanceId === next.song.performanceId &&
    prev.index === next.index &&
    prev.isCurrentlyPlaying === next.isCurrentlyPlaying &&
    prev.isUnavailable === next.isUnavailable
  );
});

TimelineRow.displayName = 'TimelineRow';

export default TimelineRow;
export type { FlattenedSong };
