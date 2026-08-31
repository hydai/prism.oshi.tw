import assert from "node:assert/strict";
import { formatDuration, formatRelativeTime, formatTime, youtubeWatchUrl } from "./format";

assert.equal(formatTime(0), "0:00");
assert.equal(formatTime(5), "0:05");
assert.equal(formatTime(59), "0:59");
assert.equal(formatTime(60), "1:00");
assert.equal(formatTime(83), "1:23");
assert.equal(formatTime(600), "10:00");
assert.equal(formatTime(3671), "61:11");
// Live playback times are fractional — must floor, not leak decimals
assert.equal(formatTime(183.5), "3:03");
assert.equal(formatTime(59.9), "0:59");

assert.equal(formatDuration({ timestamp: 100, endTimestamp: 340 }), "4:00");
assert.equal(formatDuration({ timestamp: 100, endTimestamp: 103 }), "0:03");
assert.equal(formatDuration({ timestamp: 100, endTimestamp: null }), "--:--");

const NOW = 1_700_000_000_000;
assert.equal(formatRelativeTime(NOW - 30_000, NOW), "剛剛");
assert.equal(formatRelativeTime(NOW - 5 * 60_000, NOW), "5 分鐘前");
assert.equal(formatRelativeTime(NOW - 3 * 3_600_000, NOW), "3 小時前");
assert.equal(formatRelativeTime(NOW - 2 * 86_400_000, NOW), "2 天前");
assert.equal(formatRelativeTime(NOW - 21 * 86_400_000, NOW), "3 週前");

assert.equal(youtubeWatchUrl("abc123", 90), "https://www.youtube.com/watch?v=abc123&t=90s");
assert.equal(youtubeWatchUrl("abc123", 90.7), "https://www.youtube.com/watch?v=abc123&t=90s");

console.log("format tests passed");
