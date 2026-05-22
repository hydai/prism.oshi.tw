import assert from "node:assert/strict";
import {
  filterFlattenedSongs,
  filterGroupedSongs,
  filterStreamsByYears,
  flattenSongs,
  getAllArtists,
  getAvailableYears,
  mergeAlbumArt,
  sortGroupedSongs,
  sortStreamsByNewest,
  trackFromFlattenedSong,
  trackFromPerformance,
} from "./archive";
import type { ArchiveSong, StreamSummary } from "../types/archive";

const songs: ArchiveSong[] = [
  {
    id: "song-a",
    title: "Beta Song",
    originalArtist: "Zeta",
    tags: ["rock"],
    albumArtUrl: "old-art",
    performances: [
      {
        id: "perf-old",
        streamId: "stream-2023",
        date: "2023-04-02",
        streamTitle: "Stream Alpha",
        videoId: "video-old",
        timestamp: 10,
        endTimestamp: null,
        note: "",
      },
      {
        id: "perf-new",
        streamId: "stream-2025",
        date: "2025-01-10",
        streamTitle: "Stream Beta",
        videoId: "video-new",
        timestamp: 20,
        endTimestamp: 50,
        note: "encore",
      },
    ],
  },
  {
    id: "song-b",
    title: "Alpha Song",
    originalArtist: "Alpha",
    tags: [],
    performances: [
      {
        id: "perf-no-stream",
        date: "2024-06-15",
        streamTitle: "Unlisted Stream",
        videoId: "video-mid",
        timestamp: 30,
        note: "",
      },
    ],
  },
  {
    id: "song-c",
    title: "Gamma Song",
    originalArtist: "Zeta",
    tags: [],
    performances: [],
  },
];

const streams: StreamSummary[] = [
  { id: "stream-2023", title: "Old", date: "2023-04-02", videoId: "old" },
  { id: "stream-2025", title: "Newest", date: "2025-01-10", videoId: "new" },
  { id: "stream-2024", title: "Middle", date: "2024-06-15", videoId: "mid" },
];

const merged = mergeAlbumArt(songs, new Map([["song-a", "new-art"]]));
assert.equal(merged[0]?.albumArtUrl, "new-art");
assert.equal(merged[1]?.albumArtUrl, undefined);
assert.equal(songs[0]?.albumArtUrl, "old-art");

assert.deepEqual(sortStreamsByNewest(streams).map((stream) => stream.id), [
  "stream-2025",
  "stream-2024",
  "stream-2023",
]);
assert.deepEqual(streams.map((stream) => stream.id), [
  "stream-2023",
  "stream-2025",
  "stream-2024",
]);
assert.deepEqual(getAvailableYears(streams), [2025, 2024, 2023]);
assert.equal(filterStreamsByYears(streams, new Set()), streams);
assert.deepEqual(
  filterStreamsByYears(streams, new Set([2024])).map((stream) => stream.id),
  ["stream-2024"],
);

assert.deepEqual(getAllArtists(songs), ["Alpha", "Zeta"]);

const flattened = flattenSongs(songs);
assert.deepEqual(flattened.map((song) => song.performanceId), [
  "perf-new",
  "perf-no-stream",
  "perf-old",
]);
assert.equal(flattened[0]?.searchString, "beta song zeta stream beta");
assert.equal(flattened[0]?.year, 2025);
assert.equal(flattened[0]?.endTimestamp, 50);
assert.equal(flattened[1]?.streamId, undefined);
assert.equal(flattened[2]?.endTimestamp, undefined);
assert.equal("performances" in flattened[0]!, false);
assert.equal("tags" in flattened[0]!, false);

assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "BETA",
    selectedStreamId: "stream-2025",
    selectedArtist: "Zeta",
    selectedYears: new Set([2025]),
  }).map((song) => song.performanceId),
  ["perf-new"],
);
assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "unlisted",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
  }).map((song) => song.performanceId),
  ["perf-no-stream"],
);
assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "",
    selectedStreamId: "missing",
    selectedArtist: null,
    selectedYears: new Set(),
  }),
  [],
);

const grouped = sortGroupedSongs(songs);
assert.deepEqual(grouped.map((song) => song.id), ["song-b", "song-a", "song-c"]);
assert.deepEqual(songs.map((song) => song.id), ["song-a", "song-b", "song-c"]);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "stream",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
  }),
  [],
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: "stream-2023",
    selectedArtist: null,
    selectedYears: new Set(),
  }).map((song) => song.id),
  ["song-a"],
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: null,
    selectedArtist: "Zeta",
    selectedYears: new Set([2024]),
  }),
  [],
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: null,
    selectedArtist: "Zeta",
    selectedYears: new Set([2025]),
  }).map((song) => song.id),
  ["song-a"],
);

assert.deepEqual(trackFromFlattenedSong(flattened[0]!, "mizuki"), {
  id: "perf-new",
  songId: "song-a",
  title: "Beta Song",
  originalArtist: "Zeta",
  videoId: "video-new",
  timestamp: 20,
  endTimestamp: 50,
  albumArtUrl: "old-art",
  streamerSlug: "mizuki",
});
assert.deepEqual(trackFromPerformance(songs[0]!, songs[0]!.performances[0]!, "mizuki"), {
  id: "perf-old",
  songId: "song-a",
  title: "Beta Song",
  originalArtist: "Zeta",
  videoId: "video-old",
  timestamp: 10,
  endTimestamp: undefined,
  albumArtUrl: "old-art",
  streamerSlug: "mizuki",
});

console.log("✓ archive helpers");
