'use client';

import { memo } from 'react';
import { Disc3, ChevronDown, ChevronRight, Play, Plus, ExternalLink } from 'lucide-react';
import AddToPlaylistDropdown from './AddToPlaylistDropdown';

interface Performance {
  id: string;
  streamId?: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number | null;
  note: string;
}

interface Song {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: Performance[];
  albumArtUrl?: string;
}

interface SongCardProps {
  song: Song;
  isExpanded: boolean;
  onToggleExpand: (songId: string) => void;
  onPlay: (track: { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string }) => void;
  onAddToQueue: (track: { id: string; songId: string; title: string; originalArtist: string; videoId: string; timestamp: number; endTimestamp?: number; albumArtUrl?: string }) => void;
  onAddToPlaylistSuccess: () => void;
  unavailableVideoIds: Set<string>;
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function SongCardInner({ song, isExpanded, onToggleExpand, onPlay, onAddToQueue, onAddToPlaylistSuccess, unavailableVideoIds }: SongCardProps) {
  const sortedPerformances = isExpanded
    ? [...song.performances].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];

  return (
    <div
      data-testid="song-card"
      className="overflow-hidden transition-all"
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
        className="w-full flex items-center justify-between transition-all group hover-row"
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

      {/* Expanded Versions List */}
      {isExpanded && (
        <div
          data-testid="versions-list"
          className="space-y-0.5 px-3 pb-3"
          style={{
            borderTop: '1px solid var(--border-table)',
            paddingTop: 'var(--space-3)',
          }}
        >
          {sortedPerformances.map((perf) => (
            <div
              key={perf.id}
              data-testid="version-row"
              className="group/version hover-row grid grid-cols-[1fr_60px] lg:grid-cols-[32px_1fr_140px_60px] gap-0 items-center transition-all"
              style={{
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-3) var(--space-4)',
              }}
            >
              {/* Play button column — desktop only */}
              <div
                className="hidden lg:flex items-center justify-center"
                style={{ width: '32px', height: '32px' }}
              >
                <button
                  onClick={() => {
                    if (!unavailableVideoIds.has(perf.videoId)) {
                      onPlay({
                        id: perf.id,
                        songId: song.id,
                        title: song.title,
                        originalArtist: song.originalArtist,
                        videoId: perf.videoId,
                        timestamp: perf.timestamp,
                        endTimestamp: perf.endTimestamp ?? undefined,
                        albumArtUrl: song.albumArtUrl,
                      });
                    }
                  }}
                  disabled={unavailableVideoIds.has(perf.videoId)}
                  data-testid="play-button"
                  className={`w-8 h-8 rounded-full text-white flex items-center justify-center opacity-0 group-hover/version:opacity-100 transition-all flex-shrink-0 ${
                    unavailableVideoIds.has(perf.videoId)
                      ? 'cursor-not-allowed'
                      : 'hover:scale-110'
                  }`}
                  style={{
                    background: unavailableVideoIds.has(perf.videoId)
                      ? 'var(--text-muted)'
                      : 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
                    boxShadow: '0 2px 8px rgba(244, 114, 182, 0.3)',
                  }}
                >
                  <Play className="w-3.5 h-3.5 fill-current" style={{ marginLeft: '1px' }} />
                </button>
              </div>

              {/* Date + Note + Stream title */}
              <div className="min-w-0 pl-1 lg:pl-3 flex items-center gap-2 lg:block">
                {/* Mobile play button */}
                <button
                  onClick={() => {
                    if (!unavailableVideoIds.has(perf.videoId)) {
                      onPlay({
                        id: perf.id,
                        songId: song.id,
                        title: song.title,
                        originalArtist: song.originalArtist,
                        videoId: perf.videoId,
                        timestamp: perf.timestamp,
                        endTimestamp: perf.endTimestamp ?? undefined,
                        albumArtUrl: song.albumArtUrl,
                      });
                    }
                  }}
                  disabled={unavailableVideoIds.has(perf.videoId)}
                  data-testid="mobile-play-button"
                  className={`lg:hidden flex-shrink-0 w-11 h-11 flex items-center justify-center rounded-full ${
                    unavailableVideoIds.has(perf.videoId) ? 'cursor-not-allowed opacity-40' : ''
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
                    {perf.date}
                  </span>
                  {perf.note && (
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
                      {perf.note}
                    </span>
                  )}
                </div>
                <p
                  className="truncate mt-0.5"
                  style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}
                >
                  {perf.streamTitle}
                </p>
                </div>
              </div>

              {/* Date column desktop (extra info hidden on mobile) */}
              <div
                className="hidden lg:flex items-center min-w-0 pl-3"
                style={{ color: 'var(--text-tertiary)', fontSize: 'var(--font-size-xs)' }}
              >
              </div>

              {/* Actions + Duration */}
              <div
                className="flex items-center justify-end gap-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                <button
                  onClick={() => onAddToQueue({
                    id: perf.id,
                    songId: song.id,
                    title: song.title,
                    originalArtist: song.originalArtist,
                    videoId: perf.videoId,
                    timestamp: perf.timestamp,
                    endTimestamp: perf.endTimestamp ?? undefined,
                    albumArtUrl: song.albumArtUrl,
                  })}
                  className="opacity-0 group-hover/version:opacity-100 transition-all transform hover:scale-110"
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
                  className="opacity-0 group-hover/version:opacity-100 transition-all"
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
                      performanceId: perf.id,
                      songTitle: song.title,
                      originalArtist: song.originalArtist,
                      videoId: perf.videoId,
                      timestamp: perf.timestamp,
                    }}
                    onSuccess={onAddToPlaylistSuccess}
                  />
                </div>
                <a
                  href={`https://www.youtube.com/watch?v=${perf.videoId}&t=${perf.timestamp}s`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-0 group-hover/version:opacity-100 transition-all transform hover:scale-110"
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
                  {formatTime(perf.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SongCard = memo(SongCardInner, (prev, next) => {
  return (
    prev.song.id === next.song.id &&
    prev.isExpanded === next.isExpanded &&
    prev.song.performances.length === next.song.performances.length
  );
});

SongCard.displayName = 'SongCard';

export default SongCard;
