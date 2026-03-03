'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';

/**
 * Renders nothing. Bridges PlayerContext → RecentlyPlayedContext
 * by recording track changes to recently played history.
 */
export default function RecentlyPlayedTracker() {
  const { currentTrack } = usePlayer();
  const { addRecentPlay } = useRecentlyPlayed();
  const lastRecordedId = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id === lastRecordedId.current) return;

    lastRecordedId.current = currentTrack.id;
    addRecentPlay({
      performanceId: currentTrack.id,
      songTitle: currentTrack.title,
      originalArtist: currentTrack.originalArtist,
      videoId: currentTrack.videoId,
      timestamp: currentTrack.timestamp,
      endTimestamp: currentTrack.endTimestamp,
      albumArtUrl: currentTrack.albumArtUrl,
    });
  }, [currentTrack, addRecentPlay]);

  return null;
}
