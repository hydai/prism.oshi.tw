'use client';

import { memo } from 'react';
import { Play, Disc3, Plus, Heart } from 'lucide-react';
import AlbumArt from './AlbumArt';
import AddToPlaylistDropdown from './AddToPlaylistDropdown';
import YouTubeWatchLink from './YouTubeWatchLink';
import type { FlattenedSong, PerformanceRef } from '../types/archive';
import { trackFromFlattenedSong } from '../lib/archive';
import { formatTime } from '../lib/format';

interface TimelineRowProps {
  song: FlattenedSong;
  index: number;
  isCurrentlyPlaying: boolean;
  isUnavailable: boolean;
  isLiked: boolean;
  onToggleLike: (ref: PerformanceRef) => void;
  onPlay: (track: PerformanceRef) => void;
  onAddToQueue: (track: PerformanceRef) => void;
  onAddToPlaylistSuccess: () => void;
  streamerSlug: string;
}

function TimelineRowInner({ song, index, isCurrentlyPlaying, isUnavailable, isLiked, onToggleLike, onPlay, onAddToQueue, onAddToPlaylistSuccess, streamerSlug }: TimelineRowProps) {
  return (
    <div
      data-testid="performance-row"
      className="group hover-row grid grid-cols-[32px_40px_1fr_60px] lg:grid-cols-[32px_40px_2fr_2fr_100px_60px] gap-0 items-center transition-colors cursor-default rounded-radius-lg py-token-3 px-token-4"
      style={{
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
            className="lg:hidden animate-spin text-accent-pink [animation-duration:3s]"
            style={{
              width: '18px',
              height: '18px',
            }}
          />
        ) : (
          <Play
            className="lg:hidden text-token-tertiary"
            style={{
              width: '14px',
              height: '14px',
              fill: 'currentColor',
            }}
          />
        )}
        {/* Desktop: number that fades on hover, replaced by play button */}
        <span
          className="hidden lg:block group-hover:opacity-0 transition-opacity font-mono text-sm select-none text-token-tertiary"
        >
          {index + 1}
        </span>
        <button
          type="button"
          aria-label={`播放 ${song.title}`}
          onClick={() => {
            if (!isUnavailable) {
              onPlay(trackFromFlattenedSong(song, streamerSlug));
            }
          }}
          disabled={isUnavailable}
          data-testid="play-button"
          className={`hidden lg:flex absolute inset-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-[color,opacity,transform] ${
            isUnavailable
              ? 'cursor-not-allowed text-token-muted'
              : 'transform hover:scale-110 text-accent-pink'
          }`}
        >
          <Play className="w-4 h-4 fill-current" />
        </button>
      </div>

      {/* Album art column */}
      <div className="flex items-center justify-center">
        <AlbumArt
          alt={`${song.title} - ${song.originalArtist}`}
          size={32}
        />
      </div>

      {/* Title column */}
      <button
        type="button"
        className="min-w-0 cursor-pointer text-left lg:pl-3 disabled:cursor-not-allowed"
        disabled={isUnavailable}
        data-testid="song-title-button"
        onClick={() => {
          onPlay(trackFromFlattenedSong(song, streamerSlug));
        }}
      >
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className={`font-bold truncate ${isCurrentlyPlaying ? 'text-accent-pink-dark' : 'text-token-primary'}`}
              style={{
                fontSize: '15px',
              }}
            >
              {song.title}
            </div>
            {song.note && (
              <span
                className="inline-flex items-center border font-medium flex-shrink-0 bg-accent-bg-blue-muted text-accent-blue border-border-token-accent-blue rounded-radius-pill text-token-xs py-token-1 px-token-3"
              >
                {song.note}
              </span>
            )}
          </div>
          <div
            className="truncate text-token-secondary"
            style={{
              fontSize: '13px',
            }}
          >
            {song.originalArtist}
          </div>
        </div>
      </button>

      {/* Stream title column (desktop only) */}
      <div
        className="hidden lg:flex items-center min-w-0 pl-3 text-token-secondary text-token-sm"
      >
        <span className="truncate">{song.streamTitle}</span>
      </div>

      {/* Date column (desktop only) */}
      <div
        className="hidden lg:flex items-center pl-3 font-mono text-token-secondary text-token-sm"
      >
        {song.date}
      </div>

      {/* Duration / Actions column */}
      <div
        className="flex items-center justify-end gap-1.5 text-token-secondary"
      >
        <button
          onClick={() => onToggleLike(trackFromFlattenedSong(song, streamerSlug))}
          className={`transition-[color,opacity,transform] transform hover:scale-110 bg-surface p-token-2 rounded-radius-circle ${isLiked ? 'text-accent-pink' : 'text-token-secondary lg:opacity-0 lg:group-hover:opacity-100'}`}
          style={{
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          }}
          title={isLiked ? '取消喜愛' : '喜愛'}
          data-testid="like-button"
        >
          <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
        </button>
        <button
          onClick={() => onAddToQueue(trackFromFlattenedSong(song, streamerSlug))}
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-[opacity,transform,color] transform hover:scale-110 text-token-secondary hover:text-accent-pink bg-surface p-token-2 rounded-radius-circle"
          style={{
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          }}
          title="加入佇列"
          data-testid="add-to-queue"
        >
          <Plus className="w-4 h-4" />
        </button>
        <div
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity bg-surface p-token-2 rounded-radius-circle text-token-secondary"
          style={{
            boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          }}
        >
          <AddToPlaylistDropdown
            version={trackFromFlattenedSong(song, streamerSlug)}
            onSuccess={onAddToPlaylistSuccess}
          />
        </div>
        <YouTubeWatchLink
          videoId={song.videoId}
          timestamp={song.timestamp}
          revealClassName="lg:opacity-0 lg:group-hover:opacity-100"
        />
        <span
          className="font-mono text-right text-token-sm text-token-secondary"
          style={{
            minWidth: '40px',
          }}
        >
          {formatTime(song.timestamp)}
        </span>
      </div>
    </div>
  );
}

const TimelineRow = memo(TimelineRowInner);

TimelineRow.displayName = 'TimelineRow';

export default TimelineRow;
export type { FlattenedSong };
