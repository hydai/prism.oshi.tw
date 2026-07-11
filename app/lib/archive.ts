import type {
  ArchivePerformance,
  ArchiveSong,
  ArchiveTrack,
  FlattenedSong,
  StreamSummary,
} from "../types/archive";

interface ArchiveFilters {
  search: string;
  selectedStreamId: string | null;
  selectedArtist: string | null;
  selectedYears: Set<number>;
}

export function mergeAlbumArt(
  songs: ArchiveSong[],
  albumArtBySongId: Map<string, string>,
): ArchiveSong[] {
  return songs.map((song) => ({
    ...song,
    albumArtUrl: albumArtBySongId.get(song.id),
  }));
}

export function sortStreamsByNewest(streams: StreamSummary[]): StreamSummary[] {
  return streams
    .map((stream) => ({ stream, sortTime: new Date(stream.date).getTime() }))
    .sort((a, b) => b.sortTime - a.sortTime)
    .map(({ stream }) => stream);
}

export function getAllArtists(songs: ArchiveSong[]): string[] {
  const artists = new Set<string>();
  songs.forEach((song) => artists.add(song.originalArtist));
  return Array.from(artists).sort((a, b) => a.localeCompare(b, "zh-TW"));
}

export function getAvailableYears(streams: StreamSummary[]): number[] {
  const years = new Set<number>();
  streams.forEach((stream) => years.add(new Date(stream.date).getFullYear()));
  return Array.from(years).sort((a, b) => b - a);
}

export function filterStreamsByYears(
  streams: StreamSummary[],
  selectedYears: Set<number>,
): StreamSummary[] {
  if (selectedYears.size === 0) return streams;
  return streams.filter((stream) => selectedYears.has(new Date(stream.date).getFullYear()));
}

export function flattenSongs(songs: ArchiveSong[]): FlattenedSong[] {
  const result: Array<FlattenedSong & { sortTime: number }> = [];
  songs.forEach((song) => {
    song.performances.forEach((performance) => {
      const performanceDate = new Date(performance.date);
      result.push({
        id: song.id,
        title: song.title,
        originalArtist: song.originalArtist,
        albumArtUrl: song.albumArtUrl,
        performanceId: performance.id,
        streamId: performance.streamId,
        date: performance.date,
        streamTitle: performance.streamTitle,
        videoId: performance.videoId,
        timestamp: performance.timestamp,
        endTimestamp: performance.endTimestamp ?? undefined,
        note: performance.note,
        searchString: `${song.title} ${song.originalArtist} ${performance.streamTitle}`.toLowerCase(),
        year: performanceDate.getFullYear(),
        sortTime: performanceDate.getTime(),
      });
    });
  });
  return result
    .sort((a, b) => b.sortTime - a.sortTime)
    .map(({ sortTime: _sortTime, ...song }) => song);
}

export function filterFlattenedSongs(
  songs: FlattenedSong[],
  filters: ArchiveFilters,
): FlattenedSong[] {
  const lowerTerm = filters.search.toLowerCase();
  return songs.filter((song) => {
    const matchesSearch = !lowerTerm || song.searchString.includes(lowerTerm);
    const matchesStream = filters.selectedStreamId ? song.streamId === filters.selectedStreamId : true;
    const matchesArtist = filters.selectedArtist ? song.originalArtist === filters.selectedArtist : true;
    const matchesYear = filters.selectedYears.size > 0 ? filters.selectedYears.has(song.year) : true;
    return matchesSearch && matchesStream && matchesArtist && matchesYear;
  });
}

export function sortGroupedSongs(songs: ArchiveSong[]): ArchiveSong[] {
  return [...songs].sort((a, b) => a.title.localeCompare(b.title, "zh-TW"));
}

export function filterGroupedSongs(
  songs: ArchiveSong[],
  filters: ArchiveFilters,
): ArchiveSong[] {
  const lowerTerm = filters.search.toLowerCase();
  return songs.filter((song) => {
    const matchesSearch = !lowerTerm || `${song.title} ${song.originalArtist}`.toLowerCase().includes(lowerTerm);
    const matchesStream = filters.selectedStreamId
      ? song.performances.some((performance) => performance.streamId === filters.selectedStreamId)
      : true;
    const matchesArtist = filters.selectedArtist ? song.originalArtist === filters.selectedArtist : true;
    const matchesYear = filters.selectedYears.size > 0
      ? song.performances.some((performance) => filters.selectedYears.has(new Date(performance.date).getFullYear()))
      : true;
    return matchesSearch && matchesStream && matchesArtist && matchesYear;
  });
}

export function trackFromFlattenedSong(song: FlattenedSong, streamerSlug: string): ArchiveTrack {
  return {
    id: song.performanceId,
    songId: song.id,
    title: song.title,
    originalArtist: song.originalArtist,
    videoId: song.videoId,
    timestamp: song.timestamp,
    endTimestamp: song.endTimestamp,
    albumArtUrl: song.albumArtUrl,
    streamerSlug,
  };
}

export function trackFromPerformance(
  song: ArchiveSong,
  performance: ArchivePerformance,
  streamerSlug: string,
): ArchiveTrack {
  return {
    id: performance.id,
    songId: song.id,
    title: song.title,
    originalArtist: song.originalArtist,
    videoId: performance.videoId,
    timestamp: performance.timestamp,
    endTimestamp: performance.endTimestamp ?? undefined,
    albumArtUrl: song.albumArtUrl,
    streamerSlug,
  };
}

function latestPerformance(song: ArchiveSong): ArchivePerformance | null {
  if (song.performances.length === 0) return null;
  return [...song.performances].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )[0];
}

// Tracks that should play after clicking index `clickedIndex` in a flattened
// list (timeline view / mobile search). Pass -1 to build the full list (play all).
export function followingTracksFromFlattened(
  songs: FlattenedSong[],
  clickedIndex: number,
  streamerSlug: string,
  unavailableVideoIds: Set<string>,
): ArchiveTrack[] {
  return songs
    .slice(clickedIndex + 1)
    .filter((song) => !unavailableVideoIds.has(song.videoId))
    .map((song) => trackFromFlattenedSong(song, streamerSlug));
}

// Tracks that should play after clicking song `clickedSongIndex` in the grouped
// view: each following song contributes its latest performance, skipping songs
// whose latest performance is unavailable. Pass -1 to build the full list.
export function followingTracksFromGrouped(
  songs: ArchiveSong[],
  clickedSongIndex: number,
  streamerSlug: string,
  unavailableVideoIds: Set<string>,
): ArchiveTrack[] {
  return songs.slice(clickedSongIndex + 1).flatMap((song) => {
    const latest = latestPerformance(song);
    if (!latest || unavailableVideoIds.has(latest.videoId)) return [];
    return [trackFromPerformance(song, latest, streamerSlug)];
  });
}
