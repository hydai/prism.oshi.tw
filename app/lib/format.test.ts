import assert from "node:assert/strict";
import { formatTime } from "./format";

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

console.log("format tests passed");
