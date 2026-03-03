'use client';

import { useEffect, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import type { RecentPlay } from '../contexts/RecentlyPlayedContext';

const MAX_ENTRIES = 50;

/**
 * Renders nothing. Bridges PlayerContext → localStorage
 * by recording track changes to the correct per-streamer recently played key.
 * Lives in GlobalProviders (above per-streamer providers), so it writes
 * directly to localStorage using track.streamerSlug.
 */
export default function RecentlyPlayedTracker() {
  const { currentTrack } = usePlayer();
  const lastRecordedId = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.id === lastRecordedId.current) return;

    lastRecordedId.current = currentTrack.id;

    const key = `prism_${currentTrack.streamerSlug}_recently_played`;
    try {
      const stored = localStorage.getItem(key);
      const existing: RecentPlay[] = stored ? JSON.parse(stored) : [];
      const filtered = existing.filter(r => r.performanceId !== currentTrack.id);
      const newEntry: RecentPlay = {
        performanceId: currentTrack.id,
        songTitle: currentTrack.title,
        originalArtist: currentTrack.originalArtist,
        videoId: currentTrack.videoId,
        timestamp: currentTrack.timestamp,
        endTimestamp: currentTrack.endTimestamp,
        albumArtUrl: currentTrack.albumArtUrl,
        playedAt: Date.now(),
      };
      const updated = [newEntry, ...filtered].slice(0, MAX_ENTRIES);
      localStorage.setItem(key, JSON.stringify(updated));
    } catch {
      // localStorage unavailable — silently skip
    }
  }, [currentTrack]);

  return null;
}
