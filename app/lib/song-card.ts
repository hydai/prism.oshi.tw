import type { ArchivePerformance, ArchiveSong, ArchiveTrack } from '../types/archive';

export interface SongCardProps {
  song: ArchiveSong;
  isExpanded: boolean;
  onToggleExpand: (songId: string) => void;
  onPlay: (track: ArchiveTrack) => void;
  onAddToQueue: (track: ArchiveTrack) => void;
  onAddToPlaylistSuccess: () => void;
  isLiked: (performanceId: string) => boolean;
  onToggleLike: (perf: ArchivePerformance, song: ArchiveSong) => void;
  unavailableVideoIds: Set<string>;
  streamerSlug: string;
}

export function areSongCardPropsEqual(prev: SongCardProps, next: SongCardProps): boolean {
  return (
    prev.song.id === next.song.id &&
    prev.isExpanded === next.isExpanded &&
    prev.song.performances === next.song.performances &&
    prev.song.tags.join('\u0000') === next.song.tags.join('\u0000') &&
    // Both have change-only identities: isLiked is useCallback'd on the liked
    // set, unavailableVideoIds is replaced only when a video errors. Without
    // these an already-rendered card kept stale hearts/disabled states.
    prev.isLiked === next.isLiked &&
    prev.unavailableVideoIds === next.unavailableVideoIds
  );
}
