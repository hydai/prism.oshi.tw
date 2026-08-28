'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';

/**
 * Renders nothing. Bridges PlayerContext → RecentlyPlayedContext
 * by recording track changes via the context hook.
 */
export default function RecentlyPlayedTracker() {
  const { currentTrack } = usePlayer();
  const { addRecentPlay } = useRecentlyPlayed();
  const lastRecordedId = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.performanceId === lastRecordedId.current) return;

    lastRecordedId.current = currentTrack.performanceId;

    addRecentPlay(currentTrack);
  }, [currentTrack, addRecentPlay]);

  return null;
}
