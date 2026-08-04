'use client';

import { ExternalLink, Heart, Play, Plus } from 'lucide-react';
import type { ArchivePerformance, ArchiveSong, ArchiveTrack } from '../types/archive';
import { formatTime } from '../lib/format';
import { getTagLabel } from '../../lib/tags';
import AddToPlaylistDropdown from './AddToPlaylistDropdown';

interface SongVersionsListProps {
  song: ArchiveSong;
  performances: ArchivePerformance[];
  onPlay: (track: ArchiveTrack) => void;
  onAddToQueue: (track: ArchiveTrack) => void;
  onAddToPlaylistSuccess: () => void;
  isLiked: (performanceId: string) => boolean;
  onToggleLike: (performance: ArchivePerformance, song: ArchiveSong) => void;
  unavailableVideoIds: Set<string>;
  streamerSlug: string;
}

export default function SongVersionsList({
  song,
  performances,
  onPlay,
  onAddToQueue,
  onAddToPlaylistSuccess,
  isLiked,
  onToggleLike,
  unavailableVideoIds,
  streamerSlug,
}: SongVersionsListProps) {
  return (
    <div
      data-testid="versions-list"
      className="space-y-0.5 px-3 pb-3"
      style={{
        borderTop: '1px solid var(--border-table)',
        paddingTop: 'var(--space-3)',
      }}
    >
      {performances.map((performance) => (
        <div
          key={performance.id}
          data-testid="version-row"
          className="group/version hover-row grid grid-cols-[1fr_60px] lg:grid-cols-[32px_1fr_140px_60px] gap-0 items-center transition-colors"
          style={{
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-3) var(--space-4)',
          }}
        >
          <div
            className="hidden lg:flex items-center justify-center"
            style={{ width: '32px', height: '32px' }}
          >
            <button
              type="button"
              aria-label={`播放 ${song.title}（${performance.date}）`}
              onClick={() => {
                if (!unavailableVideoIds.has(performance.videoId)) {
                  onPlay({
                    id: performance.id,
                    songId: song.id,
                    title: song.title,
                    originalArtist: song.originalArtist,
                    videoId: performance.videoId,
                    timestamp: performance.timestamp,
                    endTimestamp: performance.endTimestamp ?? undefined,
                    albumArtUrl: song.albumArtUrl,
                    streamerSlug,
                  });
                }
              }}
              disabled={unavailableVideoIds.has(performance.videoId)}
              data-testid="play-button"
              className={`w-8 h-8 rounded-full text-white flex items-center justify-center opacity-0 group-hover/version:opacity-100 transition-[opacity,transform] flex-shrink-0 ${
                unavailableVideoIds.has(performance.videoId)
                  ? 'cursor-not-allowed'
                  : 'hover:scale-110'
              }`}
              style={{
                background: unavailableVideoIds.has(performance.videoId)
                  ? 'var(--text-muted)'
                  : 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                boxShadow: '0 2px 8px rgba(244, 114, 182, 0.3)',
              }}
            >
              <Play className="w-3.5 h-3.5 fill-current" style={{ marginLeft: '1px' }} />
            </button>
          </div>

          <div className="min-w-0 pl-1 lg:pl-3 flex items-center gap-2 lg:block">
            <button
              type="button"
              aria-label={`播放 ${song.title}（${performance.date}）`}
              onClick={() => {
                if (!unavailableVideoIds.has(performance.videoId)) {
                  onPlay({
                    id: performance.id,
                    songId: song.id,
                    title: song.title,
                    originalArtist: song.originalArtist,
                    videoId: performance.videoId,
                    timestamp: performance.timestamp,
                    endTimestamp: performance.endTimestamp ?? undefined,
                    albumArtUrl: song.albumArtUrl,
                    streamerSlug,
                  });
                }
              }}
              disabled={unavailableVideoIds.has(performance.videoId)}
              data-testid="mobile-play-button"
              className={`lg:hidden flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full ${
                unavailableVideoIds.has(performance.videoId) ? 'cursor-not-allowed opacity-40' : ''
              }`}
              style={{
                background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                color: 'white',
              }}
            >
              <Play className="w-3.5 h-3.5 fill-current" style={{ marginLeft: '1px' }} />
            </button>
            <div className="min-w-0 flex-1 lg:flex-none">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-mono text-sm"
                  style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}
                >
                  {performance.date}
                </span>
                {performance.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-2 py-0.5"
                    style={{
                      background: 'var(--bg-accent-pink)',
                      color: 'var(--accent-pink)',
                      fontSize: 'var(--font-size-xs)',
                    }}
                  >
                    {getTagLabel(tag)}
                  </span>
                ))}
                {performance.note && (
                  <span
                    className="inline-flex items-center border border-blue-200 text-blue-500 bg-blue-50 font-medium"
                    style={{
                      background: 'var(--bg-accent-blue-muted)',
                      color: 'var(--accent-blue)',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: 'var(--font-size-xs)',
                      padding: 'var(--space-1) var(--space-3)',
                    }}
                  >
                    {performance.note}
                  </span>
                )}
              </div>
              <p
                className="truncate mt-0.5"
                style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}
              >
                {performance.streamTitle}
              </p>
            </div>
          </div>

          <div
            className="hidden lg:flex items-center min-w-0 pl-3"
            style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
          />

          <div
            className="flex items-center justify-end gap-1.5"
            style={{ color: 'var(--text-secondary)' }}
          >
            <button
              onClick={() => onToggleLike(performance, song)}
              className={`transition-[color,opacity,transform] transform hover:scale-110 ${isLiked(performance.id) ? '' : 'opacity-0 group-hover/version:opacity-100'}`}
              style={{
                background: 'var(--bg-surface)',
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-circle)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                color: isLiked(performance.id) ? 'var(--accent-pink)' : 'var(--text-secondary)',
              }}
              title={isLiked(performance.id) ? '取消喜愛' : '喜愛'}
              data-testid="like-button"
            >
              <Heart className={`w-4 h-4 ${isLiked(performance.id) ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={() => onAddToQueue({
                id: performance.id,
                songId: song.id,
                title: song.title,
                originalArtist: song.originalArtist,
                videoId: performance.videoId,
                timestamp: performance.timestamp,
                endTimestamp: performance.endTimestamp ?? undefined,
                albumArtUrl: song.albumArtUrl,
                streamerSlug,
              })}
              className="opacity-0 group-hover/version:opacity-100 transition-[opacity,transform] transform hover:scale-110"
              style={{
                background: 'var(--bg-surface)',
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-circle)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                color: 'var(--text-secondary)',
              }}
              title="加入佇列"
              data-testid="add-to-queue"
              onMouseEnter={(event) => {
                event.currentTarget.style.color = 'var(--accent-pink)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <Plus className="w-4 h-4" />
            </button>
            <div
              className="opacity-0 group-hover/version:opacity-100 transition-opacity"
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
                  performanceId: performance.id,
                  songTitle: song.title,
                  originalArtist: song.originalArtist,
                  videoId: performance.videoId,
                  timestamp: performance.timestamp,
                  streamerSlug,
                }}
                onSuccess={onAddToPlaylistSuccess}
              />
            </div>
            <a
              href={`https://www.youtube.com/watch?v=${performance.videoId}&t=${performance.timestamp}s`}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-0 group-hover/version:opacity-100 transition-[opacity,transform] transform hover:scale-110"
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
              onMouseEnter={(event) => {
                event.currentTarget.style.color = '#FF0000';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = 'var(--text-secondary)';
              }}
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
              {formatTime(performance.timestamp)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
