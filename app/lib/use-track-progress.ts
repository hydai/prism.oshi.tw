'use client';

import { useCallback } from 'react';
import { usePlayer, usePlaybackTime } from '../contexts/PlayerContext';

/** Progress (0–100) of the current track and a percentage-based seek. */
export function useTrackProgress() {
  const { currentTrack, seekTo } = usePlayer();
  const { trackCurrentTime, trackDuration } = usePlaybackTime();
  const hasKnownDuration = trackDuration != null && trackDuration > 0;
  const progress = hasKnownDuration
    ? Math.min(100, Math.max(0, (trackCurrentTime / trackDuration) * 100))
    : 0;
  const handleSeek = useCallback((percentage: number) => {
    if (!hasKnownDuration || !currentTrack) return;
    seekTo(currentTrack.timestamp + trackDuration * percentage);
  }, [hasKnownDuration, currentTrack, seekTo, trackDuration]);
  const knownDuration = hasKnownDuration ? trackDuration : null;
  return { hasKnownDuration, progress, handleSeek, knownDuration };
}
