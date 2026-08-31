'use client';

import { ExternalLink } from 'lucide-react';
import { youtubeWatchUrl } from '../lib/format';

/** Circular icon link opening the performance inside its VOD on YouTube. */
export default function YouTubeWatchLink({ videoId, timestamp, revealClassName = '' }: {
  videoId: string;
  timestamp: number;
  revealClassName?: string;
}) {
  return (
    <a
      href={youtubeWatchUrl(videoId, timestamp)}
      target="_blank"
      rel="noopener noreferrer"
      className={`${revealClassName} transition-[opacity,transform] transform hover:scale-110 text-token-secondary hover:text-[#FF0000]`.trim()}
      style={{
        background: 'var(--bg-surface)',
        padding: 'var(--space-2)',
        borderRadius: 'var(--radius-circle)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        display: 'flex',
        alignItems: 'center',
      }}
      title="在 YouTube 開啟"
    >
      <ExternalLink className="w-4 h-4" />
    </a>
  );
}
