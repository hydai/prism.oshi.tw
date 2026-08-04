'use client';

import { memo, useMemo } from 'react';
import { Disc3, ChevronDown, ChevronRight } from 'lucide-react';
import SongVersionsList from './SongVersionsList';
import { getTagLabel } from '../../lib/tags';
import { areSongCardPropsEqual, visibleSongCardTags, type SongCardProps } from '../lib/song-card';

function SongCardInner({ song, isExpanded, onToggleExpand, onPlay, onAddToQueue, onAddToPlaylistSuccess, isLiked, onToggleLike, unavailableVideoIds, streamerSlug, selectedTags }: SongCardProps) {
  const sortedPerformances = useMemo(
    () => isExpanded
      ? [...song.performances].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      : [],
    [isExpanded, song.performances]
  );
  const visibleTags = useMemo(
    () => visibleSongCardTags(song.tags, selectedTags),
    [song.tags, selectedTags],
  );

  return (
    <div
      data-testid="song-card"
      className="overflow-hidden transition-colors"
      style={{
        background: 'var(--bg-surface-glass)',
        border: '1px solid var(--border-glass)',
        borderRadius: 'var(--radius-xl)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Song Header - Clickable */}
      <button
        onClick={() => onToggleExpand(song.id)}
        className="w-full flex items-center justify-between transition-colors group hover-row"
        style={{
          padding: 'var(--space-5) var(--space-6)',
        }}
      >
        <div className="flex items-start gap-4 flex-1 text-left">
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, var(--bg-accent-pink-muted), var(--bg-accent-blue-muted))',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
          >
            <Disc3 className="w-8 h-8" style={{ color: 'var(--text-secondary)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h3
              className="font-bold truncate"
              style={{ fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)', lineHeight: 1.3 }}
            >
              {song.title}
            </h3>
            <p
              className="truncate mt-1"
              style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}
            >
              {song.originalArtist}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="font-bold"
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--accent-pink)',
                  background: 'var(--bg-accent-pink-muted)',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid var(--border-accent-pink)',
                }}
              >
                {song.performances.length} 個版本
              </span>
              {visibleTags.shown.map((tag) => (
                <span
                  key={tag}
                  className="font-medium"
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-surface-muted)',
                    padding: 'var(--space-1) var(--space-2)',
                    borderRadius: 'var(--radius-pill)',
                  }}
                >
                  {getTagLabel(tag)}
                </span>
              ))}
              {visibleTags.hidden > 0 && (
                <span
                  className="font-medium"
                  title={song.tags.map(getTagLabel).join('、')}
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-tertiary)',
                    padding: 'var(--space-1) var(--space-2)',
                  }}
                >
                  +{visibleTags.hidden}
                </span>
              )}
            </div>
          </div>
        </div>
        <div
          className="ml-4 transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
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

const SongCard = memo(SongCardInner, areSongCardPropsEqual);

SongCard.displayName = 'SongCard';

export default SongCard;
