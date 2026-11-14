import { matchCorrection, summarizeCorrection } from './vod-correction';
import type { CorrectionMatch, CorrectionPair } from './vod-correction';

declare const process: { exitCode?: number };

/** Key-sorted JSON, so two objects compare equal whatever order their keys were built in. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  });
}

/**
 * The slice of `node:assert/strict` these tests use. `shared/` is type-checked
 * without Node's types (admin/tsconfig.json), so the real module cannot be
 * imported here; the sibling suites declare their own helpers for the same reason.
 */
const assert = {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? 'expected a truthy value');
  },
  equal<T>(actual: T, expected: T, message?: string): void {
    if (!Object.is(actual, expected)) {
      throw new Error(`${message ?? 'values differ'}: expected ${String(expected)}, got ${String(actual)}`);
    }
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    const actualJson = canonicalJson(actual);
    const expectedJson = canonicalJson(expected);
    if (actualJson !== expectedJson) {
      throw new Error(`${message ?? 'values differ'}: expected ${expectedJson}, got ${actualJson}`);
    }
  },
};

/** `pairs[index]`, or a readable failure instead of an `undefined` dereference. */
function pairAt(match: CorrectionMatch, index: number): CorrectionPair {
  const pair = match.pairs[index];
  if (!pair) throw new Error(`expected a pair at index ${index}, the match has ${match.pairs.length}`);
  return pair;
}

function indexPairs(match: CorrectionMatch): number[][] {
  return match.pairs.map((p) => [p.currentIndex, p.proposedIndex]);
}

const row = (title: string, originalArtist: string, timestamp: number, endTimestamp: number | null) => ({ title, originalArtist, timestamp, endTimestamp });
const ICHII_CURRENT = [
  row('Late Night Drive', 'Unknown', 882, 1026), row('私奔到月球', '五月天', 1394, 1621),
  row('A Tender Moon Tempo', 'ヴィヴィ(八木海莉)', 1901, 2187), row('Moon Halo', 'Unknown', 2248, 2448),
  row('月の向こうの世界', 'Unknown', 2714, 2933), row('Fly Me To The Moon', 'Frank Sinatra', 3514, 3663),
  row('Moon River', 'Unknown', 5377, 5545),
];
const ICHII_PROPOSED = [
  row('Late Niqht Drive', 'Unknown', 881, 1024), row('私奔到月球', '五月天', 1394, 1617),
  row('Moon Halo', 'Unknown', 2247, 2445), row('月の向こうの世界', 'Unknown', 2714, 2945),
  row('Fly Me To The Moon', 'Frank Sinatra', 3512, 3658), row('Moon River', 'Unknown', 5368, 5472),
];

function testIchiiPairsSixAndDropsOne(): void {
  const m = matchCorrection(ICHII_CURRENT, ICHII_PROPOSED);
  assert.deepEqual(indexPairs(m), [[0, 0], [1, 1], [3, 2], [4, 3], [5, 4], [6, 5]]);
  assert.deepEqual(m.unpairedCurrent, [2]);
  assert.deepEqual(m.unpairedProposed, []);
}

function testIchiiChangeFlags(): void {
  const m = matchCorrection(ICHII_CURRENT, ICHII_PROPOSED);
  assert.deepEqual(pairAt(m, 0).changes, { start: true, end: true, title: true, artist: false });
  assert.deepEqual(pairAt(m, 1).changes, { start: false, end: true, title: false, artist: false });
  const moonRiver = pairAt(m, 5).score;
  assert.ok(moonRiver > 0.91 && moonRiver < 0.92, 'Moon River: 95 s of a 104 s interval');
}

function testOneCurrentTwoProposed(): void {
  // A tie on score and title goes to the lower proposed index.
  const split = matchCorrection([row('A', 'X', 100, 400)], [row('A', 'X', 100, 250), row('A', 'X', 250, 400)]);
  assert.deepEqual(indexPairs(split), [[0, 0]]);
  assert.deepEqual(split.unpairedProposed, [1]);
}

function testSameSongTwiceInOneStream(): void {
  const twice = matchCorrection([row('A', 'X', 100, 200), row('A', 'X', 1000, 1100)], [row('A', 'X', 105, 200), row('A', 'X', 1000, 1090)]);
  assert.deepEqual(indexPairs(twice), [[0, 0], [1, 1]]);
}

function testOpenEndUsesNextStart(): void {
  const open = matchCorrection([row('A', 'X', 100, null), row('B', 'X', 400, 500)], [row('A', 'X', 100, 390), row('B', 'X', 400, 500)]);
  assert.equal(pairAt(open, 0).score, 1);
  assert.equal(pairAt(open, 0).changes.end, true);
}

function testLastOpenEndUses240(): void {
  assert.equal(matchCorrection([row('A', 'X', 100, null)], [row('A', 'X', 100, 300)]).pairs.length, 1);
}

function testBelowThresholdStaysUnpaired(): void {
  // 40 s overlap of a 100 s interval.
  const far = matchCorrection([row('A', 'X', 0, 100)], [row('A', 'X', 60, 200)]);
  assert.deepEqual([far.pairs.length, far.unpairedCurrent, far.unpairedProposed], [0, [0], [0]]);
}

function testEmptyArtistCountsAsUnknown(): void {
  assert.equal(pairAt(matchCorrection([row('A', 'Unknown', 0, 100)], [row('A', '', 0, 100)]), 0).changes.artist, false);
}

function testNormalizedTitleIsNotAChange(): void {
  assert.equal(pairAt(matchCorrection([row('Moon River', 'X', 0, 100)], [row('moon  river', 'X', 0, 100)]), 0).changes.title, false);
}

const setTimes = (id: string) => ({ op: 'setTimes' as const, performanceId: id, timestamp: 1 });

function testSummarize(): void {
  assert.equal(summarizeCorrection(['a', 'b', 'c', 'd', 'e', 'f'].map(setTimes), { time: 0, title: 1, add: 0, delete: 1 }), '套用 6 項（時間 6）；略過 2 項（歌名 1、刪除 1）');
  assert.equal(summarizeCorrection([
    setTimes('a'), setTimes('b'), { op: 'renameSong', songId: 's', title: 'T' },
    { op: 'relinkToSong', performanceId: 'c', songId: 's2' }, { op: 'relinkToNewSong', performanceId: 'd', title: 'N', originalArtist: 'X' },
    { op: 'addPerformance', title: 'Z', originalArtist: 'X', timestamp: 1, endTimestamp: 2 }, { op: 'deletePerformance', performanceId: 'e' },
  ], { time: 0, title: 0, add: 0, delete: 0 }), '套用 7 項（時間 2、改名 1、改連結 2、新增 1、刪除 1）');
}

// Everything below is an addition to the plan's list. Each pins a rule the plan states
// (matching constraints, copy table) that none of the assertions above would notice losing.

function testTitleSimilarityBreaksScoreTies(): void {
  // Both proposed rows overlap the current row by their whole interval (score 1).
  // Only the title tells them apart, and it outranks the lower proposed index.
  const m = matchCorrection(
    [row('Moon River', 'X', 100, 300)],
    [row('Moon Rivor', 'X', 100, 200), row('Moon River', 'X', 200, 300)],
  );
  assert.deepEqual(indexPairs(m), [[0, 1]]);
  assert.deepEqual(m.unpairedProposed, [0]);
}

function testTwoCurrentOneProposed(): void {
  // The mirror of testOneCurrentTwoProposed: the contributor merged two rows into one.
  const merged = matchCorrection([row('A', 'X', 100, 250), row('A', 'X', 250, 400)], [row('A', 'X', 100, 400)]);
  assert.deepEqual(indexPairs(merged), [[0, 0]]);
  assert.deepEqual(merged.unpairedCurrent, [1]);
}

function testHighestScoreIsPairedFirst(): void {
  // The one proposed row overlaps current 0 by half (0.5) and current 1 fully (1).
  // The better pair wins even though the other row has the lower index.
  const m = matchCorrection([row('A', 'X', 0, 100), row('A', 'X', 50, 150)], [row('A', 'X', 50, 150)]);
  assert.deepEqual(indexPairs(m), [[1, 0]]);
  assert.deepEqual(m.unpairedCurrent, [0]);
}

function testHalfOverlapIsEnough(): void {
  // The threshold is >=, not >: 50 s of a 100 s interval pairs.
  const half = matchCorrection([row('A', 'X', 0, 100)], [row('A', 'X', 50, 150)]);
  assert.equal(half.pairs.length, 1);
  assert.equal(pairAt(half, 0).score, 0.5);
}

function testNonPositiveIntervalNeverPairs(): void {
  // Nova's parser does not check end > start. Such a row scores 0 against everything,
  // so it stays an add (proposed) or a delete (current) instead of pairing.
  const inverted = matchCorrection([row('A', 'X', 100, 300)], [row('A', 'X', 200, 100)]);
  assert.deepEqual([inverted.pairs.length, inverted.unpairedCurrent, inverted.unpairedProposed], [0, [0], [0]]);
  const empty = matchCorrection([row('A', 'X', 100, 300)], [row('A', 'X', 200, 200)]);
  assert.deepEqual([empty.pairs.length, empty.unpairedCurrent, empty.unpairedProposed], [0, [0], [0]]);
}

function testOpenEndSpansToTheNextStart(): void {
  // testOpenEndUsesNextStart cannot tell the next row's start from start + 240: an open end of
  // 340 scores the same against 390 as 400 does. Here the proposed row starts 300 s in, past that
  // default, so it only pairs when A's open end runs on to B's start at 1000.
  const m = matchCorrection(
    [row('A', 'X', 100, null), row('B', 'X', 1000, 1100)],
    [row('A', 'X', 400, 900), row('B', 'X', 1000, 1100)],
  );
  assert.deepEqual(indexPairs(m), [[0, 0], [1, 1]]);
}

function testNullEndsAreNotAChange(): void {
  // The flag compares stored values and null is a value. A is open on both sides, so its end is
  // unchanged even though the open end now resolves to 390 instead of 400: B moved, A did not.
  // (null against 390 is a change, see testOpenEndUsesNextStart.)
  const m = matchCorrection(
    [row('A', 'X', 100, null), row('B', 'X', 400, 500)],
    [row('A', 'X', 100, null), row('B', 'X', 390, 500)],
  );
  assert.deepEqual(indexPairs(m), [[0, 0], [1, 1]]);
  assert.deepEqual(pairAt(m, 0).changes, { start: false, end: false, title: false, artist: false });
  assert.deepEqual(pairAt(m, 1).changes, { start: true, end: false, title: false, artist: false });
}

function testArtistFlagUsesUnknownOnBothSides(): void {
  const artistChanged = (current: string, proposed: string): boolean =>
    pairAt(matchCorrection([row('A', current, 0, 100)], [row('A', proposed, 0, 100)]), 0).changes.artist;
  assert.equal(artistChanged('', 'Unknown'), false);
  assert.equal(artistChanged('', ''), false);
  assert.equal(artistChanged('X', 'Y'), true);
  assert.equal(artistChanged('Unknown', 'X'), true);
}

function testSummarizeSkippedPartsInOrder(): void {
  assert.equal(
    summarizeCorrection([setTimes('a')], { time: 1, title: 1, add: 1, delete: 1 }),
    '套用 1 項（時間 1）；略過 4 項（時間 1、歌名 1、新增 1、刪除 1）',
  );
}

function main(): void {
  testIchiiPairsSixAndDropsOne();
  testIchiiChangeFlags();
  testOneCurrentTwoProposed();
  testSameSongTwiceInOneStream();
  testOpenEndUsesNextStart();
  testLastOpenEndUses240();
  testBelowThresholdStaysUnpaired();
  testEmptyArtistCountsAsUnknown();
  testNormalizedTitleIsNotAChange();
  testSummarize();
  testTitleSimilarityBreaksScoreTies();
  testTwoCurrentOneProposed();
  testHighestScoreIsPairedFirst();
  testHalfOverlapIsEnough();
  testNonPositiveIntervalNeverPairs();
  testOpenEndSpansToTheNextStart();
  testNullEndsAreNotAChange();
  testArtistFlagUsesUnknownOnBothSides();
  testSummarizeSkippedPartsInOrder();
  console.log('✓ the correction matcher pairs by time overlap, flags only real changes, and summarizes what was applied');
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
