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
  getFlattenedTagCounts,
  getGroupedTagCounts,
  groupSongsByWorkId,
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
    inheritedTags: ["genre:rock"],
    tags: ["language:zh", "language:en", "genre:rock"],
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
        inheritedTags: ["genre:rock"],
        tags: ["language:zh"],
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
        inheritedTags: ["genre:rock"],
        tags: ["language:en"],
      },
    ],
  },
  {
    id: "song-b",
    title: "Alpha Song",
    originalArtist: "Alpha",
    inheritedTags: [],
    tags: [],
    performances: [
      {
        id: "perf-no-stream",
        date: "2024-06-15",
        streamTitle: "Unlisted Stream",
        videoId: "video-mid",
        timestamp: 30,
        note: "",
        inheritedTags: [],
        tags: [],
      },
    ],
  },
  {
    id: "song-c",
    title: "Gamma Song",
    originalArtist: "Zeta",
    inheritedTags: [],
    tags: [],
    performances: [],
  },
];

const streams: StreamSummary[] = [
  { id: "stream-2023", title: "Old", date: "2023-04-02", videoId: "old" },
  { id: "stream-2025", title: "Newest", date: "2025-01-10", videoId: "new" },
  { id: "stream-2024", title: "Middle", date: "2024-06-15", videoId: "mid" },
];

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
// Tag vocabulary is indexed separately from the free-text fields so that it can be
// matched as a whole term rather than as a substring.
assert.doesNotMatch(flattened[0]?.searchString ?? "", /英文歌/);
assert.ok(flattened[0]?.tagTerms.includes("英文歌"));
assert.ok(!flattened[0]?.tagTerms.includes("中文歌"));
assert.ok(flattened[0]?.tagTerms.includes("搖滾"));
assert.equal(flattened[0]?.year, 2025);
assert.equal(flattened[0]?.endTimestamp, 50);
assert.equal(flattened[1]?.streamId, undefined);
assert.equal(flattened[2]?.endTimestamp, undefined);
assert.equal("performances" in flattened[0]!, false);
assert.deepEqual(flattened[0]?.tags, ["language:en", "genre:rock"]);
assert.deepEqual(flattened[2]?.tags, ["language:zh", "genre:rock"]);

assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "BETA",
    selectedStreamId: "stream-2025",
    selectedArtist: "Zeta",
    selectedYears: new Set([2025]),
    selectedTags: new Set(),
  }).map((song) => song.performanceId),
  ["perf-new"],
);
assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "unlisted",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }).map((song) => song.performanceId),
  ["perf-no-stream"],
);
assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "",
    selectedStreamId: "missing",
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }),
  [],
);
assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["language:en", "language:zh", "genre:rock"]),
  }).map((song) => song.performanceId),
  ["perf-new", "perf-old"],
  "same-category languages are OR while genre is AND",
);
assert.deepEqual(
  filterFlattenedSongs(flattened, {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["language:zh", "genre:pop"]),
  }),
  [],
);

const workIdSongs: ArchiveSong[] = [
  {
    id: "song-shared-z",
    workId: "work-shared",
    title: "Shared Song (legacy spelling)",
    originalArtist: "Shared Artist",
    inheritedTags: ["acoustic"],
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
        inheritedTags: ["acoustic"],
        tags: [],
      },
    ],
  },
  {
    id: "song-shared-a",
    workId: " work-shared ",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    inheritedTags: ["ballad", "acoustic"],
    tags: ["ballad", "acoustic"],
    performances: [
      {
        id: "perf-shared-a",
        date: "2025-01-01",
        streamTitle: "Newer performance",
        videoId: "video-shared-a",
        timestamp: 20,
        note: "",
        inheritedTags: ["ballad", "acoustic"],
        tags: [],
      },
    ],
  },
  {
    id: "song-other-work",
    workId: "work-other",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    inheritedTags: [],
    tags: [],
    performances: [],
  },
  {
    id: "song-legacy-a",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    inheritedTags: [],
    tags: [],
    performances: [],
  },
  {
    id: "song-legacy-b",
    workId: "   ",
    title: "Shared Song",
    originalArtist: "Shared Artist",
    inheritedTags: [],
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
assert.deepEqual(sharedWork?.inheritedTags, ["acoustic", "ballad"]);
// Same ordering as inheritedTags above: both go through mergeTagIds, which falls back to
// a locale compare for unregistered legacy IDs like these.
assert.deepEqual(sharedWork?.tags, ["acoustic", "ballad"]);
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

const zeroPerformanceSong: ArchiveSong = {
  id: "song-zero-performance",
  workId: "work-zero-performance",
  title: "Pending Rendition",
  originalArtist: "Pending Artist",
  inheritedTags: ["genre:rock", "style:parody"],
  tags: ["genre:rock", "style:parody"],
  performances: [],
};
assert.deepEqual(
  filterGroupedSongs([zeroPerformanceSong], {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["genre:rock"]),
  }).map((song) => song.id),
  ["song-zero-performance"],
  "work tags match inherited tags even without an approved performance",
);
assert.deepEqual(
  filterGroupedSongs([zeroPerformanceSong], {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["style:parody"]),
  }),
  [],
  "performance-scoped tags still require an approved performance",
);
assert.deepEqual(
  filterGroupedSongs([zeroPerformanceSong], {
    search: "",
    selectedStreamId: "stream-pending",
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["genre:rock"]),
  }),
  [],
  "stream filters still require an approved performance",
);
assert.deepEqual(
  filterGroupedSongs([zeroPerformanceSong], {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set([2026]),
    selectedTags: new Set(["genre:rock"]),
  }),
  [],
  "year filters still require an approved performance",
);
assert.deepEqual(
  filterGroupedSongs([zeroPerformanceSong], {
    search: "\u6416\u6efe",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["genre:rock"]),
  }).map((song) => song.id),
  ["song-zero-performance"],
  "tag search and tag filters can match the same inherited work tag",
);
assert.deepEqual(
  filterGroupedSongs([zeroPerformanceSong], {
    search: "unrelated",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["genre:rock"]),
  }),
  [],
  "a matching tag filter does not bypass a non-matching search",
);

const balladGrouped = filterGroupedSongs(groupedByWorkId, {
  search: "",
  selectedStreamId: null,
  selectedArtist: null,
  selectedYears: new Set(),
  selectedTags: new Set(["ballad"]),
});
assert.deepEqual(balladGrouped.map((song) => song.id), ["song-shared-a"]);
assert.deepEqual(
  balladGrouped[0]?.performances.map((performance) => performance.id),
  ["perf-shared-a"],
  "local inherited tags do not leak to sibling song rows in the same work",
);
assert.deepEqual(balladGrouped[0]?.tags, ["acoustic", "ballad"]);
assert.deepEqual(
  filterGroupedSongs(groupedByWorkId, {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set([2023]),
    selectedTags: new Set(),
  }).map((song) => ({
    id: song.id,
    performanceIds: song.performances.map((performance) => performance.id),
    tags: song.tags,
  })),
  [{ id: "song-shared-a", performanceIds: ["perf-shared-z"], tags: ["acoustic"] }],
  "group tags are recomputed from the retained performances",
);
assert.deepEqual(
  filterGroupedSongs(groupedByWorkId, {
    search: "ballad",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }).map((song) => ({
    id: song.id,
    performanceIds: song.performances.map((performance) => performance.id),
  })),
  [{ id: "song-shared-a", performanceIds: ["perf-shared-a"] }],
  "local inherited tag searches keep only the originating song row",
);
assert.deepEqual(
  filterGroupedSongs(groupedByWorkId, {
    search: "ballad",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set([2023]),
    selectedTags: new Set(),
  }),
  [],
  "tag search and year filters must match the same local rendition",
);
assert.deepEqual(
  filterGroupedSongs(groupSongsByWorkId(groupedByWorkId), {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["ballad"]),
  }).map((song) => ({
    id: song.id,
    performanceIds: song.performances.map((performance) => performance.id),
  })),
  [{ id: "song-shared-a", performanceIds: ["perf-shared-a"] }],
  "grouping remains functionally idempotent with local tag provenance",
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
    selectedTags: new Set(),
  }),
  [],
);
const chineseSearchGrouped = filterGroupedSongs(grouped, {
  search: "中文歌",
  selectedStreamId: null,
  selectedArtist: null,
  selectedYears: new Set(),
  selectedTags: new Set(),
});
assert.deepEqual(chineseSearchGrouped.map((song) => song.id), ["song-a"]);
assert.deepEqual(
  chineseSearchGrouped[0]?.performances.map((performance) => performance.id),
  ["perf-old"],
  "rendition tag searches keep only performances that match the search term",
);
assert.deepEqual(chineseSearchGrouped[0]?.tags, ["language:zh", "genre:rock"]);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "中文歌",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set([2025]),
    selectedTags: new Set(),
  }),
  [],
  "search and year filters must match the same rendition",
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "中文歌",
    selectedStreamId: "stream-2025",
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }),
  [],
  "search and stream filters must match the same rendition",
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "中文歌",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set([2023]),
    selectedTags: new Set(),
  }).map((song) => ({
    id: song.id,
    performanceIds: song.performances.map((performance) => performance.id),
    tags: song.tags,
  })),
  [{
    id: "song-a",
    performanceIds: ["perf-old"],
    tags: ["language:zh", "genre:rock"],
  }],
  "matching search and year filters retain their shared rendition",
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "搖滾",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }).map((song) => ({
    id: song.id,
    performanceIds: song.performances.map((performance) => performance.id),
  })),
  [{ id: "song-a", performanceIds: ["perf-old", "perf-new"] }],
  "inherited tag searches retain every rendition that inherits the tag",
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "Gamma Song",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }).map((song) => song.id),
  ["song-c"],
  "work-level search keeps songs without performances visible",
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: "stream-2023",
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(),
  }).map((song) => song.id),
  ["song-a"],
);
const chineseGrouped = filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set(),
    selectedTags: new Set(["language:zh", "genre:rock"]),
  });
assert.deepEqual(chineseGrouped.map((song) => song.id), ["song-a"]);
assert.deepEqual(chineseGrouped[0]?.tags, ["language:zh", "genre:rock"]);
assert.deepEqual(
  chineseGrouped[0]?.performances.map((performance) => performance.id),
  ["perf-old"],
  "grouped tag filtering keeps only performances that actually match the rendition tags",
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: null,
    selectedArtist: "Zeta",
    selectedYears: new Set([2024]),
    selectedTags: new Set(),
  }),
  [],
);
assert.deepEqual(
  filterGroupedSongs(grouped, {
    search: "",
    selectedStreamId: null,
    selectedArtist: "Zeta",
    selectedYears: new Set([2025]),
    selectedTags: new Set(),
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

// Tag vocabulary must match as a whole term. Aliases like "Pop"/"English" are folded
// into the same index as titles, so substring matching turned two-letter queries into
// thousands of hits ("op" matched 86 rows before tags, 1812 after).
{
  const taggedSong: ArchiveSong = {
    id: "song-alias",
    title: "Quiet Night",
    originalArtist: "Someone",
    inheritedTags: ["genre:pop"],
    tags: ["genre:pop", "language:en"],
    performances: [
      {
        id: "perf-alias",
        streamId: "stream-2025",
        date: "2025-03-03",
        streamTitle: "Stream Gamma",
        videoId: "video-alias",
        timestamp: 5,
        endTimestamp: null,
        note: "",
        inheritedTags: ["genre:pop"],
        tags: ["language:en"],
      },
    ],
  };

  const filters = (search: string) => ({
    search,
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set<number>(),
    selectedTags: new Set<string>(),
  });

  const flat = flattenSongs([taggedSong]);

  assert.deepEqual(
    filterFlattenedSongs(flat, filters("op")).map((song) => song.id),
    [],
    "a fragment of the alias 'Pop' must not match on tags",
  );
  assert.deepEqual(
    filterFlattenedSongs(flat, filters("en")).map((song) => song.id),
    [],
    "a fragment of the alias 'English' must not match on tags",
  );
  assert.deepEqual(
    filterFlattenedSongs(flat, filters("pop")).map((song) => song.id),
    ["song-alias"],
    "the complete alias still matches",
  );
  assert.deepEqual(
    filterFlattenedSongs(flat, filters("流行")).map((song) => song.id),
    ["song-alias"],
    "the tag label still matches",
  );
  assert.deepEqual(
    filterFlattenedSongs(flat, filters("quiet")).map((song) => song.id),
    ["song-alias"],
    "ordinary title substring search is unaffected",
  );

  assert.deepEqual(
    filterGroupedSongs([taggedSong], filters("op")).map((song) => song.id),
    [],
    "grouped view also refuses alias fragments",
  );
  assert.deepEqual(
    filterGroupedSongs([taggedSong], filters("流行")).map((song) => song.id),
    ["song-alias"],
    "grouped view still matches a complete tag label",
  );
}

// A chip's number must predict what clicking it produces, in the unit the active view
// renders. Counting the raw ungrouped, unfiltered song list produced a number that
// neither view ever yields — a chip could read 6 and then show the empty state.
{
  const noFilters = {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set<number>(),
    selectedTags: new Set<string>(),
  };
  const flat = flattenSongs(songs);
  const grouped = groupSongsByWorkId(songs);

  const countFor = (
    counts: Map<string, number>,
    tag: string,
  ) => counts.get(tag) ?? 0;

  // song-a has two performances: perf-old (language:zh, 2023) and perf-new (language:en, 2025).
  const timelineCounts = getFlattenedTagCounts(flat, noFilters);
  assert.equal(
    countFor(timelineCounts, "genre:rock"),
    filterFlattenedSongs(flat, { ...noFilters, selectedTags: new Set(["genre:rock"]) }).length,
    "timeline count equals the rows the chip yields",
  );
  assert.equal(countFor(timelineCounts, "genre:rock"), 2, "genre:rock covers both renditions");

  const groupedCounts = getGroupedTagCounts(grouped, noFilters);
  assert.equal(
    countFor(groupedCounts, "genre:rock"),
    filterGroupedSongs(grouped, { ...noFilters, selectedTags: new Set(["genre:rock"]) }).length,
    "grouped count equals the cards the chip yields",
  );
  assert.equal(countFor(groupedCounts, "genre:rock"), 1, "one card carries genre:rock");

  // With a 2023 filter only perf-old survives, so language:en can no longer yield anything.
  const only2023 = { ...noFilters, selectedYears: new Set([2023]) };
  const filteredCounts = getFlattenedTagCounts(flat, only2023);
  assert.equal(
    countFor(filteredCounts, "language:en"),
    0,
    "a chip that cannot yield a row under the active filters must read zero",
  );
  assert.equal(
    countFor(filteredCounts, "language:zh"),
    1,
    "the surviving rendition is still counted",
  );
}

// A card's chips must not reorder just because a filter was applied. groupSongsByWorkId
// built the union in member order while filterGroupedSongs rebuilt it with mergeTagIds,
// so the same card silently switched chip order the moment any filter became active.
{
  const orderingSongs: ArchiveSong[] = [
    {
      id: "song-order-a",
      workId: "work-order",
      title: "Order Song",
      originalArtist: "Order Artist",
      inheritedTags: ["genre:pop"],
      tags: ["genre:pop"],
      performances: [
        {
          id: "perf-order-a",
          date: "2024-01-01",
          streamTitle: "Ordering Stream",
          videoId: "video-order-a",
          timestamp: 1,
          note: "",
          inheritedTags: ["genre:pop"],
          tags: [],
        },
      ],
    },
    {
      id: "song-order-b",
      workId: "work-order",
      title: "Order Song",
      originalArtist: "Order Artist",
      inheritedTags: [],
      tags: ["language:zh"],
      performances: [
        {
          id: "perf-order-b",
          date: "2024-01-02",
          streamTitle: "Ordering Stream",
          videoId: "video-order-b",
          timestamp: 2,
          note: "",
          inheritedTags: [],
          tags: ["language:zh"],
        },
      ],
    },
  ];

  const groupedOrdering = groupSongsByWorkId(orderingSongs);
  const filteredOrdering = filterGroupedSongs(groupedOrdering, {
    search: "",
    selectedStreamId: null,
    selectedArtist: null,
    selectedYears: new Set([2024]),
    selectedTags: new Set<string>(),
  });

  assert.deepEqual(
    groupedOrdering[0]?.tags,
    filteredOrdering[0]?.tags,
    "grouped chip order must survive applying a filter that removes no performance",
  );
  assert.deepEqual(
    groupedOrdering[0]?.tags,
    ["language:zh", "genre:pop"],
    "grouped tags use the shared category ordering",
  );
}
