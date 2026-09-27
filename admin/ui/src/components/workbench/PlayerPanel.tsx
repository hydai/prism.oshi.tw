import type { RefObject } from 'react';
import { YouTubePlayer, type YouTubePlayerHandle } from '../YouTubePlayer';

/**
 * The workbench's positioning host for the player (spec §5 `PlayerPanel`), shared by Stamp Editor
 * and Stream Detail. `YouTubePlayer` already renders its own 16:9 frame (aspect-video,
 * overflow-hidden, rounded corners, black background) — this wrapper doesn't repeat any of that; it
 * only gives the panel a `relative` box other elements (a caption, a loading state) can anchor to.
 */
export function PlayerPanel({
  playerRef,
  videoId,
}: {
  playerRef: RefObject<YouTubePlayerHandle | null>;
  videoId: string | undefined;
}) {
  return (
    <div className="relative shrink-0">
      <YouTubePlayer ref={playerRef} videoId={videoId} />
    </div>
  );
}
