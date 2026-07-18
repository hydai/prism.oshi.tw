export interface ArchivePerformance {
  id: string;
  streamId?: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number | null;
  note: string;
}

export interface ArchiveSong {
  id: string;
  /** Cross-streamer composition identity. Older static exports may omit it. */
  workId?: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: ArchivePerformance[];
  albumArtUrl?: string;
}

export interface FlattenedSong {
  id: string;
  title: string;
  originalArtist: string;
  performanceId: string;
  streamId?: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  note: string;
  searchString: string;
  year: number;
  albumArtUrl?: string;
}

export interface StreamSummary {
  id: string;
  title: string;
  date: string;
  videoId: string;
}

export interface ArchiveTrack {
  id: string;
  songId: string;
  title: string;
  originalArtist: string;
  videoId: string;
  timestamp: number;
  endTimestamp?: number;
  albumArtUrl?: string;
  streamerSlug: string;
}

export type ArchiveViewMode = "timeline" | "grouped";
export type MobileArchiveTab = "home" | "search" | "library" | "streams";
