'use client';

import { useCallback } from 'react';
import { useCurrentTrack } from '../contexts/PlayerContext';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import type { StorageSaveResult } from './playlist-storage';

/** Like state + toggle for whatever the player is currently playing. */
export function useCurrentTrackLike() {
  const currentTrack = useCurrentTrack();
  const { isLiked, toggleLike } = useLikedSongs();
  const liked = currentTrack ? isLiked(currentTrack.performanceId) : false;
  const toggleCurrentLike = useCallback(async (): Promise<StorageSaveResult | undefined> => {
    if (!currentTrack) return undefined;
    return toggleLike(currentTrack);
  }, [currentTrack, toggleLike]);
  return { liked, toggleCurrentLike };
}
