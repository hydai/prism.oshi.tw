'use client';

import { useQueue } from '../contexts/PlayerContext';
import { formatDuration } from '../lib/format';

export default function UpNextSection() {
  const queue = useQueue();

  if (queue.length === 0) return null;

  const visibleItems = queue.slice(0, 5);

  return (
    <div
      data-testid="up-next-section"
      style={{ width: '100%', maxWidth: '500px' }}
    >
      <h3
        style={{
          fontSize: '13px',
          fontWeight: 700,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: '12px',
        }}
      >
        Up Next
      </h3>

      <div className="flex flex-col" style={{ gap: '8px' }}>
        {visibleItems.map((track, i) => (
          <div
            key={track.queueEntryId}
            className="flex items-center"
            style={{
              borderRadius: '12px',
              background: 'var(--bg-surface-glass)',
              backdropFilter: 'blur(8px)',
              padding: '12px 16px',
              gap: '12px',
            }}
          >
            {/* Track number */}
            <span
              style={{
                width: '32px',
                flexShrink: 0,
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--text-tertiary)',
                textAlign: 'center',
              }}
            >
              {i + 2}
            </span>

            {/* Title + Artist */}
            <div className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
              <div
                className="truncate"
                style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}
              >
                {track.songTitle}
              </div>
              <div
                className="truncate"
                style={{ fontSize: '13px', color: 'var(--text-secondary)' }}
              >
                {track.originalArtist}
              </div>
            </div>

            {/* Duration */}
            <span
              style={{
                width: '60px',
                flexShrink: 0,
                textAlign: 'right',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
              }}
            >
              {formatDuration(track)}
            </span>
          </div>
        ))}
      </div>

      {queue.length > 5 && (
        <div
          style={{
            textAlign: 'center',
            marginTop: '8px',
            fontSize: '13px',
            color: 'var(--text-tertiary)',
          }}
        >
          +{queue.length - 5} more
        </div>
      )}
    </div>
  );
}
