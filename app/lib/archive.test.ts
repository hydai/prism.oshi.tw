import assert from "node:assert/strict";
import {
  filterFlattenedSongs,
  filterGroupedSongs,
  filterStreamsByYears,
  flattenSongs,
  followingTracksFromFlattened,
  followingTracksFromGrouped,
  getAllArtists,
  getAvailableYears,
  groupSongsByWorkId,
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

const workIdSongs: ArchiveSong[] = [
  {
    id: "song-shared-z",
    workId: "work-shared",
    title: "Shared Song (legacy spelling)",
    originalArtist: "Shared Artist",
    tags: ["acoustic"],
    albumArtUrl: "shared-art",
    performances: [
      {
        id: "perf-shared-z",
        date: "2023-01-01",
        streamTitle: "Older performance",
        videoId: "video-shared-z",
        timestamp: 10,
        note: "",
      },
    ],
  },
  {
    id: "song-shared-a",
    workId: " work-shared ",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    tags: ["ballad", "acoustic"],
    performances: [
      {
        id: "perf-shared-a",
        date: "2025-01-01",
        streamTitle: "Newer performance",
        videoId: "video-shared-a",
        timestamp: 20,
        note: "",
      },
    ],
  },
  {
    id: "song-other-work",
    workId: "work-other",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    tags: [],
    performances: [],
  },
  {
    id: "song-legacy-a",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    tags: [],
    performances: [],
  },
  {
    id: "song-legacy-b",
    workId: "   ",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    tags: [],
    performances: [],
  },
];
const workIdSongsBeforeGrouping = structuredClone(workIdSongs);
const groupedByWorkId = groupSongsByWorkId(workIdSongs);
const sharedWork = groupedByWorkId.find((song) => song.workId === "work-shared");
assert.equal(groupedByWorkId.length, 4);
assert.equal(sharedWork?.id, "song-shared-a");
assert.equal(sharedWork?.title, "Shared Song");
assert.equal(sharedWork?.albumArtUrl, "shared-art");
assert.deepEqual(sharedWork?.tags, ["ballad", "acoustic"]);
assert.deepEqual(
  sharedWork?.performances.map((performance) => performance.id),
  ["perf-shared-a", "perf-shared-z"],
);
assert.equal(
  groupedByWorkId.filter((song) => song.title === "Shared Song").length,
  4,
);
assert.deepEqual(groupSongsByWorkId(groupedByWorkId), groupedByWorkId);
assert.deepEqual(workIdSongs, workIdSongsBeforeGrouping);

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

// followingTracksFromFlattened: 點擊處之後、依清單順序、排除 unavailable
assert.deepEqual(
  followingTracksFromFlattened(flattened, 0, "mizuki", new Set()).map((t) => t.id),
  ["perf-no-stream", "perf-old"],
);
assert.deepEqual(
  followingTracksFromFlattened(flattened, -1, "mizuki", new Set()).map((t) => t.id),
  ["perf-new", "perf-no-stream", "perf-old"],
);
assert.deepEqual(
  followingTracksFromFlattened(flattened, 0, "mizuki", new Set(["video-old"])).map((t) => t.id),
  ["perf-no-stream"],
);
assert.deepEqual(
  followingTracksFromFlattened(flattened, flattened.length - 1, "mizuki", new Set()),
  [],
);
assert.equal(
  followingTracksFromFlattened(flattened, 0, "mizuki", new Set())[0]?.streamerSlug,
  "mizuki",
);

// followingTracksFromGrouped: 後續每首取最新演出；無演出的歌跳過；
// 最新演出 unavailable → 整首排除（不 fallback 舊版本，與播放全部一致）
assert.deepEqual(
  followingTracksFromGrouped(grouped, 0, "mizuki", new Set()).map((t) => t.id),
  ["perf-new"],
);
assert.deepEqual(
  followingTracksFromGrouped(grouped, -1, "mizuki", new Set()).map((t) => t.id),
  ["perf-no-stream", "perf-new"],
);
assert.deepEqual(followingTracksFromGrouped(grouped, 0, "mizuki", new Set(["video-new"])), []);
assert.deepEqual(
  followingTracksFromGrouped(grouped, grouped.length - 1, "mizuki", new Set()),
  [],
);
// 不可變動輸入陣列（內部 sort 必須複製）
assert.deepEqual(grouped.map((song) => song.id), ["song-b", "song-a", "song-c"]);

console.log("✓ archive helpers");
