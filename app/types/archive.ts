import type { Performance, Song } from "../../lib/types";

export type ArchivePerformance = Performance & { streamTitle: string; date: string; note: string; inheritedTags: string[]; tags: string[] };
export type ArchiveSong = Omit<Song, "performances"> & { inheritedTags: string[]; tags: string[]; performances: ArchivePerformance[] };

export interface FlattenedSong {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performanceId: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
  searchString: string;
  // Tag labels/aliases are matched as whole terms, so they are kept out of searchString.
  tagTerms: string[];
  year: number;
}

export interface StreamSummary {
  id: string;
  title: string;
  date: string;
  videoId: string;
}

/**
 * The one in-memory currency for "a performance to play, like or save".
 * Field names match the persisted formats (liked songs, recent plays,
 * playlists, export files) so no disk migration is ever needed.
 */
export interface PerformanceRef {
  performanceId: string;
  /** May be a legacy placeholder equal to performanceId (entries saved before songId was stored); never use it for lookups without a performanceId fallback. */
  songId: string;
  songTitle: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  streamerSlug: string;
}

export type ArchiveViewMode = "timeline" | "grouped";
export type MobileArchiveTab = "home" | "search" | "library" | "streams";
