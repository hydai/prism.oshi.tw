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
  /** Currently active tag filter, so the matched chips are shown first. */
  selectedTags?: ReadonlySet<string>;
}

export const SONG_CARD_TAG_LIMIT = 3;

// Chips the collapsed card shows. Tags the user is currently filtering by come first, so a
// card in a filtered list always displays the evidence of why it matched; the rest keep
// their catalog ordering. `hidden` is returned so truncation is never silent.
export function visibleSongCardTags(
  tags: readonly string[],
  selectedTags: ReadonlySet<string> | undefined,
  limit: number = SONG_CARD_TAG_LIMIT,
): { shown: string[]; hidden: number } {
  const ordered = selectedTags && selectedTags.size > 0
    ? [
        ...tags.filter((tag) => selectedTags.has(tag)),
        ...tags.filter((tag) => !selectedTags.has(tag)),
      ]
    : [...tags];
  return { shown: ordered.slice(0, limit), hidden: Math.max(0, ordered.length - limit) };
}

export function areSongCardPropsEqual(prev: SongCardProps, next: SongCardProps): boolean {
  return (
    prev.song.id === next.song.id &&
    // Selected tags reorder the visible chips, so the card must re-render when they change.
    prev.selectedTags === next.selectedTags &&
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
