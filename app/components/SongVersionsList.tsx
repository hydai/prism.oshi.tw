'use client';

import { Heart, Play, Plus } from 'lucide-react';
import type { ArchivePerformance, ArchiveSong, PerformanceRef } from '../types/archive';
import { trackFromPerformance } from '../lib/archive';
import { formatTime } from '../lib/format';
import AddToPlaylistDropdown from './AddToPlaylistDropdown';
import YouTubeWatchLink from './YouTubeWatchLink';

interface SongVersionsListProps {
  song: ArchiveSong;
  performances: ArchivePerformance[];
  onPlay: (track: PerformanceRef) => void;
  onAddToQueue: (track: PerformanceRef) => void;
  onAddToPlaylistSuccess: () => void;
  isLiked: (performanceId: string) => boolean;
  onToggleLike: (ref: PerformanceRef) => void;
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
      className="space-y-0.5 px-3 pb-3 border-t border-t-border-token-table pt-token-3"
    >
      {performances.map((performance) => (
        <div
          key={performance.id}
          data-testid="version-row"
          className="group/version hover-row grid grid-cols-[1fr_60px] lg:grid-cols-[32px_1fr_140px_60px] gap-0 items-center transition-colors rounded-radius-lg py-token-3 px-token-4"
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
                  onPlay(trackFromPerformance(song, performance, streamerSlug));
                }
              }}
              disabled={unavailableVideoIds.has(performance.videoId)}
              data-testid="play-button"
              className={`w-8 h-8 rounded-full text-white flex items-center justify-center opacity-0 group-hover/version:opacity-100 transition-[opacity,transform] flex-shrink-0 ${
                unavailableVideoIds.has(performance.videoId)
                  ? 'cursor-not-allowed'
                  : 'hover:scale-110 bg-accent-gradient'
              }`}
              style={{
                background: unavailableVideoIds.has(performance.videoId)
                  ? 'var(--text-muted)'
                  : undefined,
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
                  onPlay(trackFromPerformance(song, performance, streamerSlug));
                }
              }}
              disabled={unavailableVideoIds.has(performance.videoId)}
              data-testid="mobile-play-button"
              className={`lg:hidden flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-accent-gradient ${
                unavailableVideoIds.has(performance.videoId) ? 'cursor-not-allowed opacity-40' : ''
              }`}
              style={{
                color: 'white',
              }}
            >
              <Play className="w-3.5 h-3.5 fill-current" style={{ marginLeft: '1px' }} />
            </button>
            <div className="min-w-0 flex-1 lg:flex-none">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-mono text-token-secondary text-token-sm"
                >
                  {performance.date}
                </span>
                {performance.note && (
                  <span
                    className="inline-flex items-center border font-medium bg-accent-bg-blue-muted text-accent-blue border-border-token-accent-blue rounded-radius-pill text-token-xs py-token-1 px-token-3"
                  >
                    {performance.note}
                  </span>
                )}
              </div>
              <p
                className="truncate mt-0.5 text-token-sm text-token-secondary"
              >
                {performance.streamTitle}
              </p>
            </div>
          </div>

          <div
            className="hidden lg:flex items-center min-w-0 pl-3 text-token-tertiary text-token-xs"
          />

          <div
            className="flex items-center justify-end gap-1.5 text-token-secondary"
          >
            <button
              onClick={() => onToggleLike(trackFromPerformance(song, performance, streamerSlug))}
              className={`transition-[color,opacity,transform] transform hover:scale-110 bg-surface p-token-2 rounded-radius-circle ${isLiked(performance.id) ? 'text-accent-pink' : 'text-token-secondary opacity-0 group-hover/version:opacity-100'}`}
              style={{
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              }}
              title={isLiked(performance.id) ? '取消喜愛' : '喜愛'}
              data-testid="like-button"
            >
              <Heart className={`w-4 h-4 ${isLiked(performance.id) ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={() => onAddToQueue(trackFromPerformance(song, performance, streamerSlug))}
              className="opacity-0 group-hover/version:opacity-100 transition-[opacity,transform,color] transform hover:scale-110 text-token-secondary hover:text-accent-pink bg-surface p-token-2 rounded-radius-circle"
              style={{
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              }}
              title="加入佇列"
              data-testid="add-to-queue"
            >
              <Plus className="w-4 h-4" />
            </button>
            <div
              className="opacity-0 group-hover/version:opacity-100 transition-opacity bg-surface p-token-2 rounded-radius-circle text-token-secondary"
              style={{
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              }}
            >
              <AddToPlaylistDropdown
                version={trackFromPerformance(song, performance, streamerSlug)}
                onSuccess={onAddToPlaylistSuccess}
              />
            </div>
            <YouTubeWatchLink
              videoId={performance.videoId}
              timestamp={performance.timestamp}
              revealClassName="opacity-0 group-hover/version:opacity-100"
            />
            <span
              className="font-mono text-right text-token-sm text-token-secondary"
              style={{
                minWidth: '40px',
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
