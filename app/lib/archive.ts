import type {
  ArchivePerformance,
  ArchiveSong,
  ArchiveTrack,
  FlattenedSong,
  StreamSummary,
} from "../types/archive";
import {
  filterTagIdsByScope,
  matchesTagSelection,
  mergeTagIds,
  matchesTagSearchTerm,
  tagSearchTermList,
} from "../../lib/tags";

export interface ArchiveFilters {
  search: string;
  selectedStreamId: string | null;
  selectedArtist: string | null;
  selectedYears: Set<number>;
  selectedTags: Set<string>;
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

function tagUniverse(rows: Array<{ tags: string[] }>): Set<string> {
  const universe = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) universe.add(tag);
  }
  return universe;
}

// A chip's number has to predict its own click, in the unit the active view renders.
// Counting the raw ungrouped, unfiltered song list produced a number neither view ever
// yields, so a chip could promise rows and then show the empty state.
export function getFlattenedTagCounts(
  songs: FlattenedSong[],
  filters: ArchiveFilters,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tagUniverse(songs)) {
    const selectedTags = new Set(filters.selectedTags);
    selectedTags.add(tag);
    counts.set(tag, filterFlattenedSongs(songs, { ...filters, selectedTags }).length);
  }
  return counts;
}

export function getGroupedTagCounts(
  songs: ArchiveSong[],
  filters: ArchiveFilters,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tagUniverse(songs)) {
    const selectedTags = new Set(filters.selectedTags);
    selectedTags.add(tag);
    counts.set(tag, filterGroupedSongs(songs, { ...filters, selectedTags }).length);
  }
  return counts;
}

export function filterStreamsByYears(
  streams: StreamSummary[],
  selectedYears: Set<number>,
): StreamSummary[] {
  if (selectedYears.size === 0) return streams;
  return streams.filter((stream) => selectedYears.has(new Date(stream.date).getFullYear()));
}

function effectivePerformanceTags(performance: ArchivePerformance): string[] {
  return mergeTagIds(performance.inheritedTags, performance.tags);
}

export function flattenSongs(songs: ArchiveSong[]): FlattenedSong[] {
  const result: Array<FlattenedSong & { sortTime: number }> = [];
  songs.forEach((song) => {
    song.performances.forEach((performance) => {
      const performanceDate = new Date(performance.date);
      const tags = effectivePerformanceTags(performance);
      result.push({
        id: song.id,
        title: song.title,
        originalArtist: song.originalArtist,
        tags,
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
        tagTerms: tagSearchTermList(tags),
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
    const matchesSearch = !lowerTerm
      || song.searchString.includes(lowerTerm)
      || song.tagTerms.includes(lowerTerm);
    const matchesStream = filters.selectedStreamId ? song.streamId === filters.selectedStreamId : true;
    const matchesArtist = filters.selectedArtist ? song.originalArtist === filters.selectedArtist : true;
    const matchesYear = filters.selectedYears.size > 0 ? filters.selectedYears.has(song.year) : true;
    const matchesTags = matchesTagSelection(song.tags, filters.selectedTags);
    return matchesSearch && matchesStream && matchesArtist && matchesYear && matchesTags;
  });
}

export function groupSongsByWorkId(songs: ArchiveSong[]): ArchiveSong[] {
  const groups = new Map<string, ArchiveSong[]>();

  songs.forEach((song, index) => {
    const workId = song.workId?.trim();
    // Missing work IDs are legacy data. Keep every legacy song independent
    // instead of falling back to mutable title/artist text.
    const groupKey = workId ? `work:${workId}` : `legacy:${index}`;
    const group = groups.get(groupKey);
    if (group) {
      group.push(song);
    } else {
      groups.set(groupKey, [song]);
    }
  });

  return Array.from(groups.values(), (members) => {
    const orderedMembers = [...members].sort((a, b) => a.id.localeCompare(b.id));
    const canonical = orderedMembers[0];
    const workId = canonical.workId?.trim();
    const albumArtUrl = orderedMembers.find((song) => song.albumArtUrl)?.albumArtUrl;

    return {
      ...canonical,
      ...(workId ? { workId } : {}),
      inheritedTags: mergeTagIds(orderedMembers.flatMap((song) => song.inheritedTags)),
      // Same ordering as filterGroupedSongs rebuilds below, so a card's chips do not
      // reorder the moment a filter becomes active.
      tags: mergeTagIds(orderedMembers.flatMap((song) => song.tags)),
      performances: orderedMembers.flatMap((song) => song.performances),
      albumArtUrl,
    };
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
  return songs.flatMap((song) => {
    const matchesArtist = filters.selectedArtist ? song.originalArtist === filters.selectedArtist : true;
    if (!matchesArtist) return [];

    const workSearchString = `${song.title} ${song.originalArtist}`.toLowerCase();
    const matchesWorkSearch = !lowerTerm || workSearchString.includes(lowerTerm);

    const hasPerformanceFilters = filters.selectedStreamId !== null
      || filters.selectedYears.size > 0
      || filters.selectedTags.size > 0;
    const needsPerformanceSearch = Boolean(lowerTerm) && !matchesWorkSearch;
    if (!hasPerformanceFilters && !needsPerformanceSearch) return [song];

    if (song.performances.length === 0) {
      const matchesSearch = workSearchString.includes(lowerTerm)
        || matchesTagSearchTerm(song.inheritedTags, lowerTerm);
      const matchesStream = filters.selectedStreamId === null;
      const matchesYear = filters.selectedYears.size === 0;
      const selectedWorkTags = filterTagIdsByScope(filters.selectedTags, "work");
      const matchesTags = selectedWorkTags.length === filters.selectedTags.size
        && matchesTagSelection(song.inheritedTags, selectedWorkTags);
      return matchesSearch && matchesStream && matchesYear && matchesTags ? [song] : [];
    }

    const performances = song.performances.filter((performance) => {
      const effectiveTags = effectivePerformanceTags(performance);
      const matchesSearch = matchesWorkSearch
        || matchesTagSearchTerm(effectiveTags, lowerTerm);
      const matchesStream = filters.selectedStreamId
        ? performance.streamId === filters.selectedStreamId
        : true;
      const matchesYear = filters.selectedYears.size > 0
        ? filters.selectedYears.has(new Date(performance.date).getFullYear())
        : true;
      const matchesTags = matchesTagSelection(effectiveTags, filters.selectedTags);
      return matchesSearch && matchesStream && matchesYear && matchesTags;
    });
    return performances.length > 0
      ? [{
          ...song,
          inheritedTags: mergeTagIds(
            performances.flatMap((performance) => performance.inheritedTags),
          ),
          tags: mergeTagIds(performances.flatMap(effectivePerformanceTags)),
          performances,
        }]
      : [];
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
