import assert from "node:assert/strict";
import {
  formatSongList,
  parseTextToSongs,
  parseTimestamp,
  secondsToTimestamp,
  splitArtist,
} from "./parse";

const parsed = parseTextToSongs(`
01. 5:30 春泥 / 庾澄慶
- 12:04 ~ 13:30 星間飛行 - 中島愛
#3 1:02:03 残酷な天使のテーゼ/高橋洋子
`);

assert.equal(parsed.length, 3);
assert.deepEqual(parsed[0], {
  orderIndex: 0,
  songName: "春泥",
  artist: "庾澄慶",
  startSeconds: 330,
  endSeconds: 724,
  startTimestamp: "5:30",
  endTimestamp: "12:04",
});
assert.deepEqual(parsed[1], {
  orderIndex: 1,
  songName: "星間飛行",
  artist: "中島愛",
  startSeconds: 724,
  endSeconds: 810,
  startTimestamp: "12:04",
  endTimestamp: "13:30",
});
assert.deepEqual(parsed[2], {
  orderIndex: 2,
  songName: "残酷な天使のテーゼ",
  artist: "高橋洋子",
  startSeconds: 3723,
  endSeconds: null,
  startTimestamp: "1:02:03",
  endTimestamp: null,
});

assert.equal(parseTimestamp("1:02:03"), 3723);
assert.equal(parseTimestamp("bad input"), null);
assert.equal(secondsToTimestamp(65), "1:05");
assert.equal(secondsToTimestamp(3665), "1:01:05");
assert.deepEqual(splitArtist("Song/Artist"), ["Song", "Artist"]);

assert.equal(
  formatSongList([
    { title: "春泥", originalArtist: "庾澄慶", timestamp: 330, endTimestamp: 724 },
    { title: "星間飛行", originalArtist: "", timestamp: 724, endTimestamp: null },
  ]),
  "01. 0:05:30 ~ 0:12:04 春泥 / 庾澄慶\n02. 0:12:04 ~ --:--:-- 星間飛行",
);

console.log("✓ parse helpers");
