import type { Performance, Song } from "../../lib/types";

export type ArchivePerformance = Performance & { streamTitle: string; date: string; note: string };
export type ArchiveSong = Omit<Song, "performances"> & { performances: ArchivePerformance[] };

export interface FlattenedSong {
  id: string;
  /** Composition identity copied from the song; absent on legacy exports. Grouping only — never a lookup key. */
  workId?: string;
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
 *
 * Identity is `performanceId` alone. `songId`/`workId` are advisory grouping
 * metadata; title, artist, video and timestamps are a snapshot that only
 * matters when the loaded catalog cannot resolve the performance
 * (app/lib/saved-refs.ts, docs/saved-playback-identity.md).
 */
export interface PerformanceRef {
  performanceId: string;
  /** The song id the UI held when the ref was built: in the grouped view the work group's canonical member; on entries saved before songId was stored a placeholder equal to performanceId. Never use it for lookups. */
  songId: string;
  /** Composition identity from the catalog; absent on entries saved before it was stored. Never a lookup key. */
  workId?: string;
  songTitle: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  streamerSlug: string;
}

export type ArchiveViewMode = "timeline" | "grouped";
export type MobileArchiveTab = "home" | "search" | "library" | "streams";
