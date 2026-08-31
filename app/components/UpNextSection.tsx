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
        className="text-token-tertiary"
        style={{
          fontSize: '13px',
          fontWeight: 700,
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
            className="flex items-center bg-surface-glass"
            style={{
              borderRadius: '12px',
              backdropFilter: 'blur(8px)',
              padding: '12px 16px',
              gap: '12px',
            }}
          >
            {/* Track number */}
            <span
              className="text-token-tertiary"
              style={{
                width: '32px',
                flexShrink: 0,
                fontSize: '14px',
                fontWeight: 500,
                textAlign: 'center',
              }}
            >
              {i + 2}
            </span>

            {/* Title + Artist */}
            <div className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
              <div
                className="truncate text-token-primary"
                style={{ fontSize: '15px', fontWeight: 700 }}
              >
                {track.songTitle}
              </div>
              <div
                className="truncate text-token-secondary"
                style={{ fontSize: '13px' }}
              >
                {track.originalArtist}
              </div>
            </div>

            {/* Duration */}
            <span
              className="text-token-secondary"
              style={{
                width: '60px',
                flexShrink: 0,
                textAlign: 'right',
                fontSize: '13px',
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
          className="text-token-tertiary"
          style={{
            textAlign: 'center',
            marginTop: '8px',
            fontSize: '13px',
          }}
        >
          +{queue.length - 5} more
        </div>
      )}
    </div>
  );
}
