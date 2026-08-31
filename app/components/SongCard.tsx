'use client';

import { memo, useMemo } from 'react';
import { Disc3, ChevronDown, ChevronRight } from 'lucide-react';
import type { ArchiveSong, PerformanceRef } from '../types/archive';
import SongVersionsList from './SongVersionsList';

interface SongCardProps {
  song: ArchiveSong;
  isExpanded: boolean;
  onToggleExpand: (songId: string) => void;
  onPlay: (track: PerformanceRef) => void;
  onAddToQueue: (track: PerformanceRef) => void;
  onAddToPlaylistSuccess: () => void;
  isLiked: (performanceId: string) => boolean;
  onToggleLike: (ref: PerformanceRef) => void;
  unavailableVideoIds: Set<string>;
  streamerSlug: string;
}

function SongCardInner({ song, isExpanded, onToggleExpand, onPlay, onAddToQueue, onAddToPlaylistSuccess, isLiked, onToggleLike, unavailableVideoIds, streamerSlug }: SongCardProps) {
  const sortedPerformances = useMemo(
    () => isExpanded
      ? [...song.performances].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      : [],
    [isExpanded, song.performances]
  );

  return (
    <div
      data-testid="song-card"
      className="overflow-hidden transition-colors bg-surface-glass border border-border-token-glass rounded-radius-xl"
      style={{
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Song Header - Clickable */}
      <button
        onClick={() => onToggleExpand(song.id)}
        className="w-full flex items-center justify-between transition-colors group hover-row py-token-5 px-token-6"
      >
        <div className="flex items-start gap-4 flex-1 text-left">
          <div
            className="flex items-center justify-center flex-shrink-0 rounded-radius-lg"
            style={{
              width: '64px',
              height: '64px',
              background: 'linear-gradient(135deg, var(--bg-accent-pink-muted), var(--bg-accent-blue-muted))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          >
            <Disc3 className="w-8 h-8 text-token-secondary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="font-bold truncate text-token-lg text-token-primary"
              style={{ lineHeight: 1.3 }}
            >
              {song.title}
            </h3>
            <p
              className="truncate mt-1 text-token-sm text-token-secondary"
            >
              {song.originalArtist}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="font-bold text-token-xs text-accent-pink bg-accent-bg-pink-muted py-token-1 px-token-3 rounded-radius-pill border border-border-token-accent-pink"
              >
                {song.performances.length} 個版本
              </span>
            </div>
          </div>
        </div>
        <div
          className="ml-4 transition-colors text-token-tertiary"
        >
          {isExpanded ? (
            <ChevronDown className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
        </div>
      </button>

      {isExpanded && (
        <SongVersionsList
          song={song}
          performances={sortedPerformances}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
          onAddToPlaylistSuccess={onAddToPlaylistSuccess}
          isLiked={isLiked}
          onToggleLike={onToggleLike}
          unavailableVideoIds={unavailableVideoIds}
          streamerSlug={streamerSlug}
        />
      )}
    </div>
  );
}

const SongCard = memo(SongCardInner);

SongCard.displayName = 'SongCard';

export default SongCard;
