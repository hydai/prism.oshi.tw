'use client';

import { useCallback } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { useLikedSongs } from '../contexts/LikedSongsContext';

/** Like state + toggle for whatever the player is currently playing. */
export function useCurrentTrackLike() {
  const { currentTrack } = usePlayer();
  const { isLiked, toggleLike } = useLikedSongs();
  const liked = currentTrack ? isLiked(currentTrack.performanceId) : false;
  const toggleCurrentLike = useCallback(() => {
    if (currentTrack) toggleLike(currentTrack);
  }, [currentTrack, toggleLike]);
  return { liked, toggleCurrentLike };
}
