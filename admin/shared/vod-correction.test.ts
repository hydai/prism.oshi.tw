import { matchCorrection, summarizeCorrection } from './vod-correction';
import type { CorrectionMatch, CorrectionPair } from './vod-correction';
import { matchCorrectionWithBase, untouchedBaseRows } from './vod-correction';
import type { CorrectionBaseRow, CorrectionCurrentRow, CorrectionProposedRow, MatchableRow } from './vod-correction';

declare const process: { exitCode?: number };
import { baseCounterparts } from './vod-correction';

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
  // A tie on score and title goes to the lower proposed index. (Retitled, so time overlap decides, not the title.)
  const split = matchCorrection([row('A', 'X', 100, 400)], [row('B', 'X', 100, 250), row('B', 'X', 250, 400)]);
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
  // Retitled, so the pair rests on the overlap that the open end gives.
  assert.equal(matchCorrection([row('A', 'X', 100, null)], [row('A (Live)', 'X', 100, 300)]).pairs.length, 1);
}

function testASameTitleBelowTheThresholdPairsByTitle(): void {
  // 40 s overlap of a 100 s interval: under MATCH_MIN_SCORE, but the title is the same. The score is still the overlap.
  const far = matchCorrection([row('A', 'X', 0, 100)], [row('A', 'X', 60, 200)]);
  assert.deepEqual([indexPairs(far), far.unpairedCurrent, far.unpairedProposed], [[[0, 0]], [], []]);
  assert.equal(pairAt(far, 0).score, 0.4, 'the score of a same-title pair is its overlap');
}

function testADifferentTitleBelowTheThresholdStaysUnpaired(): void {
  const far = matchCorrection([row('B', 'X', 0, 100)], [row('A', 'X', 60, 200)]);
  assert.deepEqual([far.pairs.length, far.unpairedCurrent, far.unpairedProposed], [0, [0], [0]]);
}

// --- Title first (decision 3b): the same title pairs by the nearest start, then time overlap pairs the rest ---

function testAShiftedListPairsEachRowWithItsOwn(): void {
  // Finding #1, mizuki 2KXxImjlmM0 shifted 30 s, ends and all. Prefect lies inside My Favorite Things, so by time each
  // submitted row overlaps the other's live row fully, and the time match alone swapped them.
  const current = [row('My Favorite Things', 'Julie Andrews', 1070, 1896), row('Prefect', 'Ed Sheeran', 1514, 1744)];
  const proposed = [row('My Favorite Things', 'Julie Andrews', 1100, 1926), row('Prefect', 'Ed Sheeran', 1544, 1774)];
  assert.deepEqual(indexPairs(matchCorrection(current, proposed)), [[0, 0], [1, 1]]);
}

function testAWholeRowMovedFarPairsWithItsOwnRow(): void {
  // abei G_xhunghbho: 紅色高跟鞋 moved 180 s, end and all. 22 s of overlap is far under half; the title is the same.
  const moved = matchCorrection([row('紅色高跟鞋', '蔡健雅', 3550, 3752)], [row('紅色高跟鞋', '蔡健雅', 3730, 3932)]);
  assert.deepEqual([indexPairs(moved), moved.unpairedCurrent, moved.unpairedProposed], [[[0, 0]], [], []]);
}

function testASongSungTwicePairsByNearestStart(): void {
  const current = [row('L', 'X', 4438, 4694), row('L', 'X', 5640, 5896)];
  assert.deepEqual(indexPairs(matchCorrection(current, [row('L', 'X', 4468, 4724), row('L', 'X', 5670, 5926)])), [[0, 0], [1, 1]]);
  const later = matchCorrection(current, [row('L', 'X', 5670, 5926)]);
  assert.deepEqual([indexPairs(later), later.unpairedCurrent], [[[1, 0]], [0]], 'one row, nearer the later performance');
}

function testAMissedEncoreStaysAnAdd(): void {
  const encore = matchCorrection([row('L', 'X', 100, 200)], [row('L', 'X', 100, 200), row('L', 'X', 1000, 1100)]);
  assert.deepEqual([indexPairs(encore), encore.unpairedCurrent, encore.unpairedProposed], [[[0, 0]], [], [1]]);
}

function testSameTitleDifferentSongsPairByArtist(): void {
  // mizuki Rn6CD_k03gI: two songs called Treasure, 296 s apart, the whole list shifted 150 s. 陳忻玥's starts 146 s from
  // Bruno Mars's live row and 150 s from its own: by the nearest start alone the two would trade times.
  const current = [row('Treasure', '陳忻玥', 6501, 6797), row('Treasure', 'Bruno Mars', 6797, 7000)];
  const proposed = [row('Treasure', '陳忻玥', 6651, 6947), row('Treasure', 'Bruno Mars', 6947, 7150)];
  assert.deepEqual(indexPairs(matchCorrection(current, proposed)), [[0, 0], [1, 1]]);
}

function testAnArtistFixStillPairsWithItsOwnRow(): void {
  // The contributor names Bruno Mars on both rows, unmoved. The same artist at the same start is taken first, so the
  // row they fixed keeps its own performance instead of trading with Bruno Mars's.
  const current = [row('Treasure', '陳忻玥', 6501, 6797), row('Treasure', 'Bruno Mars', 6797, 7000)];
  const proposed = [row('Treasure', 'Bruno Mars', 6501, 6797), row('Treasure', 'Bruno Mars', 6797, 7000)];
  const m = matchCorrection(current, proposed);
  assert.deepEqual(indexPairs(m), [[0, 0], [1, 1]]);
  assert.deepEqual(pairAt(m, 0).changes, { start: false, end: false, title: false, artist: true }, 'the fix is an artist change on its own row');
}

function testASameTitleTieGoesToTheSameArtistThenToTheRowOnTheSite(): void {
  // Live rows of the submitted title: the same artist decides first, then the nearer start, then the row the site shows
  // (a row that does not say counts as shown), then the lower index.
  const submittedAt100 = [row('A', 'X', 100, 200)];
  assert.deepEqual(indexPairs(matchCorrection([row('A', 'Other', 100, 200), row('A', 'X', 300, 400)], submittedAt100)), [[1, 0]],
    'the same artist, though another starts nearer');
  assert.deepEqual(indexPairs(matchCorrection([row('A', 'X', 90, 200), row('A', 'X', 105, 200)], submittedAt100)), [[1, 0]],
    'then the nearer start');
  assert.deepEqual(indexPairs(matchCorrection([row('A', 'Unknown', 90, 200), row('A', 'X', 95, 200)], [row('A', '', 100, 200)])), [[0, 0]],
    'a blank artist reads as Unknown');
  const hidden = live('pH', row('A', 'X', 90, 200), 'pending');
  assert.deepEqual(indexPairs(matchCorrection([hidden, live('pS', row('A', 'X', 110, 200))], submittedAt100)), [[1, 0]],
    'then the row on the site');
  assert.deepEqual(indexPairs(matchCorrection([hidden, row('A', 'X', 110, 200)], submittedAt100)), [[1, 0]],
    'a row that does not say counts as on the site');
  assert.deepEqual(indexPairs(matchCorrection([row('A', 'X', 90, 200), row('A', 'X', 110, 200)], submittedAt100)), [[0, 0]],
    'then the lower current index');
  const twoSubmitted = matchCorrection([row('A', 'X', 100, 200)], [row('A', 'X', 90, 200), row('A', 'X', 110, 200)]);
  assert.deepEqual([indexPairs(twoSubmitted), twoSubmitted.unpairedProposed], [[[0, 0]], [1]], 'and the lower proposed index');
}

function testAnOverlapTieGoesToTheRowOnTheSite(): void {
  // No live row has the submitted title, and both overlap it fully with titles alike far from it: the row the site
  // shows comes before the lower index.
  const hidden = live('pH', row('B', 'X', 100, 200), 'pending');
  const shown = live('pS', row('C', 'X', 100, 200));
  assert.deepEqual(indexPairs(matchCorrection([hidden, shown], [row('A', 'X', 100, 200)])), [[1, 0]]);
  assert.deepEqual(indexPairs(matchCorrection([row('B', 'X', 100, 200), row('C', 'X', 100, 200)], [row('A', 'X', 100, 200)])), [[0, 0]],
    'rows that do not say count as shown: the lower index');
}

// --- A repeat: an add that duplicates a row the stream keeps, or an earlier add ---

import { repeatedRows } from './vod-correction';

/** `repeatedRows` over the pairs `matchCorrection` makes. */
const repeatsOf = (current: MatchableRow[], proposed: MatchableRow[]) =>
  repeatedRows(current, proposed, matchCorrection(current, proposed).pairs);
const ofCurrent = (index: number) => ({ side: 'current', index });
const ofProposed = (index: number) => ({ side: 'proposed', index });

function testAnAddOverlappingAKeptRowOfItsTitleIsARepeat(): void {
  // The list pasted under itself, the second B moved 10 s: the matcher pairs each title once and the copies stay adds,
  // each of them a repeat of the row the stream keeps.
  const current = [row('A', 'X', 100, 200), row('B', 'X', 300, 400)];
  const proposed = [row('A', 'X', 100, 200), row('A', 'X', 100, 200), row('B', 'X', 300, 400), row('B', 'X', 310, 400)];
  const m = matchCorrection(current, proposed);
  assert.deepEqual([indexPairs(m), m.unpairedProposed], [[[0, 0], [1, 2]], [1, 3]], 'the fixture');
  assert.deepEqual(repeatedRows(current, proposed, m.pairs), [null, ofCurrent(0), null, ofCurrent(1)]);
}

function testARepeatNeedsTheTitleAndHalfAnOverlap(): void {
  const current = [row('A', 'X', 100, 200)];
  const kept = row('A', 'X', 100, 200);
  // A song sung again later, with no overlap, is an encore, not a repeat.
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 5000, 5100)]), [null, null], 'an encore');
  // The overlap is a share of the shorter interval, and half of it is enough, as for the matcher.
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 150, 250)]), [null, ofCurrent(0)], '50 s of 100 s');
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 160, 260)]), [null, null], '40 s of 100 s is under it');
  // The title is read as the matcher reads it, and nothing but the title: another artist is the same song here.
  assert.deepEqual(repeatsOf(current, [kept, row(' a ', 'X', 100, 200)]), [null, ofCurrent(0)], 'case and spacing');
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'Y', 100, 200)]), [null, ofCurrent(0)], 'the artist plays no part');
  assert.deepEqual(repeatsOf(current, [kept, row('B', 'X', 100, 200)]), [null, null], 'another title');
}

function testARepeatReadsIntervalsAsTheMatcherDoes(): void {
  const current = [row('A', 'X', 100, 200)];
  const kept = row('A', 'X', 100, 200);
  // A row with no end lasts until the next row of its own list starts: 170 to 175 lies inside the kept row, where a
  // reading of 240 s (170 to 410) would overlap it by 30 s of 100, and so be no repeat.
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 170, null), row('Z', 'X', 175, 300)]), [null, ofCurrent(0), null], 'until the next start');
  // The last row lasts 240 s: from 150 that is 150 to 390, 50 s of the 100 s, and from 170 it is 30 s.
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 150, null)]), [null, ofCurrent(0)], 'the last row, from 150');
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 170, null)]), [null, null], 'the last row, from 170');
  // An empty or inverted interval scores 0 against everything: such a row repeats nothing, and is repeated by nothing.
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 150, 150)]), [null, null], 'an empty one');
  assert.deepEqual(repeatsOf(current, [kept, row('A', 'X', 120, 100)]), [null, null], 'an inverted one');
  assert.deepEqual(repeatsOf([], [row('A', 'X', 100, 100), row('A', 'X', 100, 200)]), [null, null], 'nothing repeats an empty one');
}

function testARepeatNamesTheKeptRowFirstThenTheBestOverlap(): void {
  // Two kept rows of the title, 190 to 290 the better overlap for 150 to 250 (60 s of 100, against 50).
  const stream = [row('A', 'X', 100, 200), row('A', 'X', 190, 290)];
  const twice = [row('A', 'X', 100, 200), row('A', 'X', 150, 250), row('A', 'X', 190, 290)];
  const m = matchCorrection(stream, twice);
  assert.deepEqual([indexPairs(m), m.unpairedProposed], [[[0, 0], [1, 2]], [1]], 'the fixture');
  assert.deepEqual(repeatedRows(stream, twice, m.pairs), [null, ofCurrent(1), null], 'the higher score');

  // A kept row and an earlier add both qualify: the kept row is named, whatever the scores.
  const current = [row('A', 'X', 100, 200)];
  const thrice = [row('A', 'X', 100, 200), row('A', 'X', 100, 200), row('A', 'X', 100, 200)];
  assert.deepEqual(repeatsOf(current, thrice), [null, ofCurrent(0), ofCurrent(0)], 'a kept row before an earlier add');

  // With nothing kept to repeat, an earlier add is, the best overlap and then the lower index, and never a later one.
  const adds = [row('X', 'X', 100, 200), row('X', 'X', 150, 250), row('X', 'X', 190, 290)];
  assert.deepEqual(repeatedRows([], adds, []), [null, ofProposed(0), ofProposed(1)], 'earlier adds');
  const alike = [row('X', 'X', 100, 200), row('X', 'X', 100, 200), row('X', 'X', 100, 200)];
  assert.deepEqual(repeatedRows([], alike, []), [null, ofProposed(0), ofProposed(0)], 'equal scores: the lower index');
}

function testOnlyAKeptRowIsRepeatedAndOnlyAnAddRepeats(): void {
  const current = [row('A', 'X', 100, 200)];
  const copies = [row('A', 'X', 100, 200), row('A', 'X', 100, 200)];
  // A row nothing is paired with is a delete candidate, not one the stream keeps: only the earlier add is repeated.
  assert.deepEqual(repeatedRows(current, copies, []), [null, ofProposed(0)], 'an unpaired current row');
  // Paired with the second copy, it is kept, and the first copy, an add now, repeats it. The paired copy repeats nothing.
  assert.deepEqual(repeatedRows(current, copies, [{ currentIndex: 0, proposedIndex: 1 }]), [ofCurrent(0), null], 'paired');
  assert.deepEqual(repeatedRows(current, copies, [{ currentIndex: 0, proposedIndex: 0 }]), [null, ofCurrent(0)], 'the first copy paired');
  // A paired row is no earlier add either: paired by hand with a row of another title, it leaves its copy no repeat.
  assert.deepEqual(repeatedRows([row('B', 'X', 100, 200)], copies, [{ currentIndex: 0, proposedIndex: 0 }]), [null, null], 'no earlier add');
}

function testRepeatedRowsIgnoresPairsThatPointAtNoRow(): void {
  const current = [row('A', 'X', 100, 200)];
  const copies = [row('A', 'X', 100, 200), row('A', 'X', 100, 200)];
  const dangling = [{ currentIndex: 5, proposedIndex: 0 }, { currentIndex: 0, proposedIndex: 9 }, { currentIndex: -1, proposedIndex: 1 }];
  // Not one of them pairs anything: the live row is unpaired, the copies are both adds.
  assert.deepEqual(repeatedRows(current, copies, dangling), [null, ofProposed(0)]);
  assert.deepEqual(repeatedRows([], [], dangling), []);
}

function testEmptyArtistCountsAsUnknown(): void {
  assert.equal(pairAt(matchCorrection([row('A', 'Unknown', 0, 100)], [row('A', '', 0, 100)]), 0).changes.artist, false);
}

function testNormalizedTitleIsNotAChange(): void {
  assert.equal(pairAt(matchCorrection([row('Moon River', 'X', 0, 100)], [row('moon  river', 'X', 0, 100)]), 0).changes.title, false);
}

// --- The base: the public list the contributor compared against ---

/** A live row: `performanceId` on the site unless `status` says otherwise. */
const live = (performanceId: string, fields: MatchableRow, status: CorrectionCurrentRow['status'] = 'approved'): CorrectionCurrentRow => ({
  ...fields, performanceId, songId: `song-${performanceId}`, status, songStatus: 'approved', onSite: status === 'approved', songPerformanceCount: 1,
});
const baseRow = (performanceId: string, fields: MatchableRow): CorrectionBaseRow => ({ ...fields, performanceId });

/**
 * The rows of a submission given in the order it was submitted, as the review holds them: each with the flags the
 * route works out in that order (an end filled from the next row's start, and which row that is), then by start.
 */
function submitted(...rows: MatchableRow[]): CorrectionProposedRow[] {
  const inOrder = rows.map((fields, index): CorrectionProposedRow => {
    const next = rows[index + 1];
    return {
      ...fields,
      id: `v${index + 1}`,
      endFilled: fields.endTimestamp !== null && fields.endTimestamp === next?.timestamp,
      nextSubmittedId: next ? `v${index + 2}` : null,
      existingSong: null,
    };
  });
  return inOrder.sort((left, right) => left.timestamp - right.timestamp);
}

/** Each pair as [performance id, proposed row id]. */
function pairIds(match: CorrectionMatch, current: readonly CorrectionCurrentRow[], proposed: readonly CorrectionProposedRow[]): string[][] {
  return match.pairs.map((pair) => [current[pair.currentIndex]?.performanceId ?? '?', proposed[pair.proposedIndex]?.id ?? '?']);
}

const untouchedIds = (proposed: readonly CorrectionProposedRow[], base: readonly CorrectionBaseRow[] | null) =>
  untouchedBaseRows(proposed, base).map((found) => found?.performanceId ?? null);

function testAnUntouchedRowPairsByIdFirst(): void {
  // Finding #2, the large move: curator X applied a fix that moved Song A to 1000–1100 after contributor Y loaded the
  // list, so Y's Song A, left as it was, overlaps nothing live now. It is still the same performance: it pairs by id.
  const base = [baseRow('p1', row('Song A', 'Artist', 100, 200)), baseRow('p2', row('Song B', 'Artist', 300, 400))];
  const current = [live('p2', row('Song B', 'Artist', 300, 400)), live('p1', row('Song A', 'Artist', 1000, 1100))];
  const proposed = submitted(row('Song A', 'Artist', 100, 200), row('Song B', 'Artist', 310, 400));
  const m = matchCorrectionWithBase(current, proposed, base);
  assert.deepEqual(pairIds(m, current, proposed), [['p2', 'v2'], ['p1', 'v1']], 'both by id: Song A untouched, Song B the base row it changed');
  assert.deepEqual([m.unpairedCurrent, m.unpairedProposed], [[], []]);
  assert.deepEqual(pairAt(m, 1).changes, { start: true, end: true, title: false, artist: false }, "the pair's flags are still its two rows'");
  const byTitle = matchCorrection(current, proposed);
  assert.deepEqual(pairIds(byTitle, current, proposed), [['p2', 'v2'], ['p1', 'v1']], 'with no base, the titles pair them as well');
}

function testAnUntouchedRowWhosePerformanceIsGonePairsWithNothing(): void {
  // Song A's performance was deleted after the submission, and p9 took its place. The untouched row does not go on to
  // the title and time match: it stays unpaired, and p9 with it.
  const base = [baseRow('p1', row('Song A', 'Artist', 100, 200))];
  const current = [live('p9', row('Song A2', 'Artist', 100, 200))];
  const proposed = submitted(row('Song A', 'Artist', 100, 200), row('Song B', 'Artist', 300, 400));
  const m = matchCorrectionWithBase(current, proposed, base);
  assert.deepEqual([m.pairs.length, m.unpairedCurrent, m.unpairedProposed], [0, [0], [0, 1]]);
}

function testAChangedRowPairsWithThePerformanceItsBaseNames(): void {
  // Finding #4, ichii 2McYAUOwFZI. The contributor saw 雨愛 at 6346 (p1, on the site) and moved it. A second 雨愛, p2
  // at 6341, is still pending, so the contributor never saw it. The changed row stands for p1 (baseCounterparts) and
  // pairs with it by id, however near p2 starts.
  const base = [baseRow('p1', row('雨愛', '楊丞琳', 6346, 6627))];
  const current = [live('p2', row('雨愛', '楊丞琳', 6341, 6642), 'pending'), live('p1', row('雨愛', '楊丞琳', 6346, 6627))];
  const nearerP2 = submitted(row('雨愛', '楊丞琳', 6340, 6621));
  const based = matchCorrectionWithBase(current, nearerP2, base);
  assert.deepEqual([pairIds(based, current, nearerP2), based.unpairedCurrent], [[['p1', 'v1']], [0]], 'with the base, the row it stands for');
  // The review's rerun at 6356 starts nearer p1 (10 s against 15): p1 with the base, and by the nearest start without.
  const rerun = submitted(row('雨愛', '楊丞琳', 6356, 6637));
  assert.deepEqual(pairIds(matchCorrectionWithBase(current, rerun, base), current, rerun), [['p1', 'v1']]);
  assert.deepEqual(pairIds(matchCorrectionWithBase(current, rerun, null), current, rerun), [['p1', 'v1']], 'and with no base');
}

function testAChangedRowWhoseBaseRowIsGoneStaysAnAdd(): void {
  // The contributor moved Song A (p1). Since then another correction replaced p1 by p9, the same song at 110. The
  // changed row stands for p1, which is gone: like an untouched row whose performance is gone, it pairs with nothing.
  const base = [baseRow('p1', row('Song A', 'Artist', 100, 200))];
  const current = [live('p9', row('Song A', 'Artist', 110, 200))];
  const proposed = submitted(row('Song A', 'Artist', 105, 200));
  const m = matchCorrectionWithBase(current, proposed, base);
  assert.deepEqual([m.pairs.length, m.unpairedCurrent, m.unpairedProposed], [0, [0], [0]]);
  assert.deepEqual(pairIds(matchCorrectionWithBase(current, proposed, null), current, proposed), [['p9', 'v1']], 'with no base, by its title');
}

import { matchKeys, yieldedEnd } from './vod-correction';

function testTheMovedPastItsEndTable(): void {
  // The Shared definitions' table: the end each submitted row keeps against the live row of its title, read with the
  // live rows' keys. Rows are given in the order submitted (`submitted` fills endFilled and the next row from it).
  const endOf = (liveRows: MatchableRow[], submittedRows: MatchableRow[], title: string): number | null => {
    const proposed = submitted(...submittedRows);
    const reference = liveRows.find((candidate) => candidate.title === title);
    if (!reference) throw new Error(`no live ${title}`);
    return yieldedEnd(proposed, proposed.findIndex((candidate) => candidate.title === title), reference, matchKeys(liveRows));
  };
  const ab = [row('A', 'X', 100, 200), row('B', 'X', 300, 400)];
  assert.equal(endOf(ab, [row('A', 'X', 105, 300), row('B', 'X', 300, null)], 'A'), 200, 'a start-only nudge: the live end');
  assert.equal(endOf(ab, [row('A', 'X', 160, 360), row('B', 'X', 360, null)], 'A'), 200, 'a start-only shift of 60 s: the live end');
  assert.equal(endOf(ab, [row('A', 'X', 250, 300), row('B', 'X', 300, null)], 'A'), 300,
    'moved past its end: its 100 s, capped at the next start');
  assert.equal(endOf(ab, [row('A', 'X', 250, 280), row('B', 'X', 300, null)], 'A'), 280, 'a typed end stays');
  assert.equal(endOf([row('A', 'X', 100, 200), row('B', 'X', 400, 500)], [row('A', 'X', 200, 400), row('B', 'X', 400, null)], 'A'), 300,
    'moved to its old end exactly: at the start is past it too');
  assert.equal(endOf([row('C', 'X', 500, 600), row('D', 'X', 1300, 1500)], [row('C', 'X', 1000, 1300), row('D', 'X', 1300, null)], 'C'), 1100,
    '#14: its 100 s, short of the next start');
  assert.equal(endOf([row('A', 'X', 100, 200), row('B', 'X', 200, 300)], [row('A', 'X', 105, 200), row('B', 'X', 200, 300)], 'A'), 200,
    'a start fix back to back: the end the parsers filled is the live one');
  assert.equal(endOf([row('Z', 'X', 900, 1000)], [row('Z', 'X', 1050, null)], 'Z'), 1150, 'the last row, with no end, moved past its end');
  assert.equal(endOf([row('A', 'X', 100, null), row('B', 'X', 300, 400)], [row('A', 'X', 250, 300), row('B', 'X', 300, null)], 'A'), null,
    'a live row with no end gives none');
  assert.equal(endOf(ab, [row('A', 'X', 250, 150), row('B', 'X', 150, null)], 'A'), 350,
    'a backlog row whose next submitted row starts before it: no cap');
  // Moved back to before an unmoved row it used to follow, its end filled from that row's start: given back, the live
  // end would run across that row, so the row keeps its length, cut at that row's start.
  const abcd = [...ab, row('C', 'X', 500, 600), row('D', 'X', 700, 800)];
  assert.equal(endOf(abcd, [row('A', 'X', 100, 200), row('C', 'X', 250, 300), row('B', 'X', 300, 400), row('D', 'X', 700, 800)], 'C'), 300,
    'moved back across B, left where it was: cut at its start');
  const typo = [row('A', 'X', 60, 280), row('B', 'X', 560, 800), row('E', 'X', 820, 1050), row('F', 'X', 1100, 1300), row('C', 'X', 3900, 4140)];
  assert.equal(endOf(typo, [row('A', 'X', 60, 280), row('C', 'X', 300, 560), row('B', 'X', 560, 800), row('E', 'X', 820, 1050), row('F', 'X', 1100, 1300)], 'C'), 540,
    'an hour typo fixed, 1:05:00 back to 0:05:00: its 240 s, short of the next start');
  // Two rows swapped onto each other's starts: X1 starts where Y1 did, so it reads as unmoved (another song placed at a
  // reference start counts as one), and Y1, moved back before it, keeps its 100 s. Swapped off those starts, the next
  // row moved too, and the end the parsers filled stands.
  const swapped = [row('X1', 'X', 100, 200), row('Y1', 'X', 300, 400)];
  assert.equal(endOf(swapped, [row('Y1', 'X', 100, 300), row('X1', 'X', 300, null)], 'Y1'), 200,
    "two rows swapped onto each other's starts: Y1 keeps its 100 s");
  assert.equal(endOf(swapped, [row('Y1', 'X', 100, 310), row('X1', 'X', 310, null)], 'Y1'), 310,
    'two rows swapped, the next one off any reference start: it moved too, so the end the parsers filled stands');
}

function testARenamedNextRowIsNoMove(): void {
  // Copilot r16: First 100–300 overlaps Snog B 200–400, and a start-only paste fixes only Snog B's title, so the
  // parsers end First at Song B's start. Song B starts where a reference row starts: a title or artist edit is no
  // move, so First's derived end gives way to the reference end, whose overlap is the reference's own.
  const archived = [row('First', 'A', 100, 300), row('Snog B', 'B', 200, 400)];
  const [first] = archived;
  if (!first) throw new Error('no First');
  const renamed = submitted(row('First', 'A', 100, 200), row('Song B', 'B', 200, null));
  assert.equal(yieldedEnd(renamed, 0, first, matchKeys(archived)), 300, 'a next row renamed at its start: the reference end comes back');
  const reartisted = submitted(row('First', 'A', 100, 200), row('Snog B', 'B2', 200, null));
  assert.equal(yieldedEnd(reartisted, 0, first, matchKeys(archived)), 300, 'so does one with another artist');
  assert.equal(yieldedEnd(renamed, 0, first, matchKeys([first])), 200, 'the control: no reference row starts at 200, so Song B moved there');
  const base = archived.map((fields, index) => baseRow(`p${index + 1}`, fields));
  assert.deepEqual(untouchedIds(renamed, base), ['p1', null], 'First repeats its base row; Song B changed its title');
}

function testAMovedBackRowReadsARenamedNextRowAsUnmoved(): void {
  // The moved-back rule reads the next row as the yield rule does. C, typed an hour late at 1:05:00, moved back to
  // 0:05:00 before B, whose title was fixed at its own start: B did not move, so C keeps its 240 s, short of B's start.
  const typo = [row('A', 'X', 60, 280), row('B', 'X', 560, 800), row('E', 'X', 820, 1050), row('F', 'X', 1100, 1300), row('C', 'X', 3900, 4140)];
  const c = typo[4];
  if (!c) throw new Error('no C');
  const fixed = submitted(row('A', 'X', 60, 280), row('C', 'X', 300, 560), row('B (Live)', 'X', 560, 800), row('E', 'X', 820, 1050), row('F', 'X', 1100, 1300));
  assert.equal(yieldedEnd(fixed, fixed.findIndex((candidate) => candidate.title === 'C'), c, matchKeys(typo)), 540,
    'moved back before a row renamed at its start: its 240 s, short of that start');
}

function testWithNoBaseThePairingIsByTitleThenTime(): void {
  const current = ICHII_CURRENT.map((fields, index) => live(`p${index + 1}`, fields));
  const proposed = submitted(...ICHII_PROPOSED);
  assert.deepEqual(matchCorrectionWithBase(current, proposed, null), matchCorrection(current, proposed));
  assert.deepEqual(matchCorrectionWithBase(current, proposed, []), matchCorrection(current, proposed), 'an empty base repeats nothing');
}

function testUntouchedIsTheSameRowWithTheSameEnd(): void {
  const base = [baseRow('p1', row('Song A', 'Artist', 100, 150)), baseRow('p2', row('Song B', '', 200, 260))];
  // Its end, or one the parsers filled that gives way to the base end (Shared definitions' yield rule).
  assert.deepEqual(untouchedIds(submitted(row('Song A', 'Artist', 100, 150), row('Song B', 'Unknown', 200, 260)), base), ['p1', 'p2'],
    'the same title, artist (blank = Unknown) and start, and the same end');
  assert.deepEqual(untouchedIds(submitted(row(' Song A ', 'Artist ', 100, 200), row('Song B', 'Unknown', 200, null)), base), ['p1', 'p2'],
    "trimmed; and the ends the parsers filled (the next row's start, the last row's none) are the base's");
  assert.deepEqual(untouchedIds(submitted(row('Song A', 'Artist', 100, 170), row('Song B', 'Unknown', 200, 260)), base), [null, 'p2'],
    "an end the contributor typed is theirs, even one between the base's and the next start");
  assert.deepEqual(untouchedIds(submitted(row('song a', 'Artist', 100, 150), row('Song B', 'Someone', 200, 260)), base), [null, null],
    'a title differing in case, or another artist, is another row');
  assert.deepEqual(untouchedIds(submitted(row('Song A', 'Artist', 101, 150)), base), [null], 'so is another start');
  assert.deepEqual(untouchedIds(submitted(row('Song A', 'Artist', 100, 150)), null), [null], 'with no base, no row is untouched');
}

function testAFilledEndThatWouldOverlapAMovedRowIsTheContributors(): void {
  // The boundary moved to 170: First's end is the parser's fill, but it does not give way to the base's 200, which
  // passes Second's new start. First changed, so it is not untouched.
  const base = [baseRow('p1', row('First', 'A', 100, 200)), baseRow('p2', row('Second', 'B', 200, 300))];
  assert.deepEqual(untouchedIds(submitted(row('First', 'A', 100, 170), row('Second', 'B', 170, 300)), base), [null, null]);
  // Moved to 230, the base's 200 comes back (no overlap): First is untouched.
  assert.deepEqual(untouchedIds(submitted(row('First', 'A', 100, 230), row('Second', 'B', 230, 300)), base), ['p1', null]);
  // Before a next row that still matches, the base end comes back even where it overlaps: that overlap is the base's.
  const overlapping = [baseRow('p1', row('First', 'A', 100, 300)), baseRow('p2', row('Second', 'B', 200, 400))];
  assert.deepEqual(untouchedIds(submitted(row('First', 'A', 100, 200), row('Second', 'B', 200, null)), overlapping), ['p1', 'p2']);
  // A base row with no end always comes back.
  const endless = [baseRow('p1', row('First', 'A', 100, null)), baseRow('p2', row('Second', 'B', 300, 400))];
  assert.deepEqual(untouchedIds(submitted(row('First', 'A', 100, 150), row('Second', 'B', 150, null)), endless), ['p1', null]);
}

function testEachBaseRowIsRepeatedOnce(): void {
  // Two base rows match alike: each untouched row takes its own, a row ending exactly at one before a filled one.
  const twins = [baseRow('p1', row('Same', 'X', 100, 150)), baseRow('p2', row('Same', 'X', 100, 180))];
  assert.deepEqual(untouchedIds(submitted(row('Same', 'X', 100, null), row('Same', 'X', 100, 150)), twins), ['p2', 'p1']);
  assert.deepEqual(untouchedIds(submitted(row('Same', 'X', 100, null), row('Same', 'X', 100, null), row('Same', 'X', 100, null)), twins),
    ['p1', 'p2', null], 'a third row finds none left');
}

const counterpartIds = (proposed: readonly CorrectionProposedRow[], base: readonly CorrectionBaseRow[] | null) =>
  baseCounterparts(proposed, base).map((found) => found?.performanceId ?? null);

function testACounterpartIsTheRowRepeatedElseMatchedByTime(): void {
  // Each submitted row stands for the base row it repeats, else for the one the title and time match pairs it with
  // over the base.
  const base = [
    baseRow('p1', row('Song A', 'Artist', 100, 200)),
    baseRow('p2', row('Song B', 'Artist', 300, 400)),
    baseRow('p3', row('Song C', 'Artist', 500, 600)),
  ];
  const proposed = submitted(row('Song A', 'Artist', 100, 200), row('Song B!', 'Artist', 310, 400), row('Song D', 'Artist', 700, 800));
  assert.deepEqual(counterpartIds(proposed, base), ['p1', 'p2', null], 'repeated, matched by time, and matched with none');
  assert.deepEqual(counterpartIds(proposed, null), [null, null, null], 'with no base, no row stands for one');
  assert.deepEqual(counterpartIds(proposed, []), [null, null, null]);
}

function testACounterpartIsMatchedOverTheBaseByStart(): void {
  // Song X at 150–250 overlaps both base rows by half, under the same title: the earlier row by start is its
  // counterpart, whatever order the base comes in.
  const base = [baseRow('p1', row('Song X', 'Artist', 100, 200)), baseRow('p2', row('Song X', 'Artist', 200, 300))];
  const proposed = submitted(row('Song X', 'Artist', 150, 250));
  assert.deepEqual(counterpartIds(proposed, base), ['p1']);
  assert.deepEqual(counterpartIds(proposed, [...base].reverse()), ['p1'], 'the base given in reverse');
}

function testARepeatedRowKeepsItsCounterpart(): void {
  // 'song a' (a fix of only the case, so no repeat) and Song A (a repeat) overlap p1 alike and read as one title: by
  // time alone, the lower index, 'song a', would take p1. The repeat is fixed first.
  const base = [baseRow('p1', row('Song A', 'Artist', 100, 200))];
  const proposed = submitted(row('song a', 'Artist', 100, 200), row('Song A', 'Artist', 100, 200));
  assert.deepEqual(proposed.map((proposedRow) => proposedRow.id), ['v1', 'v2'], 'the fixture: the case fix comes first');
  assert.deepEqual(counterpartIds(proposed, base), [null, 'p1']);
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
  // Both proposed rows overlap the current row by their whole interval (score 1), and neither has its title, so the
  // time match pairs one. Only the closer title tells them apart, and it outranks the lower proposed index.
  const m = matchCorrection(
    [row('Moon River', 'X', 100, 300)],
    [row('Noon Rivor', 'X', 100, 200), row('Moon Rivor', 'X', 200, 300)],
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
  // The one proposed row, under another title, overlaps current 0 by half (0.5) and current 1 fully (1).
  // The better pair wins even though the other row has the lower index.
  const m = matchCorrection([row('A', 'X', 0, 100), row('A', 'X', 50, 150)], [row('B', 'X', 50, 150)]);
  assert.deepEqual(indexPairs(m), [[1, 0]]);
  assert.deepEqual(m.unpairedCurrent, [0]);
}

function testHalfOverlapIsEnough(): void {
  // The threshold is >=, not >: 50 s of a 100 s interval pairs rows of different titles.
  const half = matchCorrection([row('A', 'X', 0, 100)], [row('B', 'X', 50, 150)]);
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
  // default, and is retitled, so it only pairs when A's open end runs on to B's start at 1000.
  const m = matchCorrection(
    [row('A', 'X', 100, null), row('B', 'X', 1000, 1100)],
    [row('A (Live)', 'X', 400, 900), row('B', 'X', 1000, 1100)],
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
  testAShiftedListPairsEachRowWithItsOwn();
  testAWholeRowMovedFarPairsWithItsOwnRow();
  testASongSungTwicePairsByNearestStart();
  testAMissedEncoreStaysAnAdd();
  testASameTitleBelowTheThresholdPairsByTitle();
  testADifferentTitleBelowTheThresholdStaysUnpaired();
  testSameTitleDifferentSongsPairByArtist();
  testAnArtistFixStillPairsWithItsOwnRow();
  testASameTitleTieGoesToTheSameArtistThenToTheRowOnTheSite();
  testAnOverlapTieGoesToTheRowOnTheSite();
  testAnAddOverlappingAKeptRowOfItsTitleIsARepeat();
  testARepeatNeedsTheTitleAndHalfAnOverlap();
  testARepeatReadsIntervalsAsTheMatcherDoes();
  testARepeatNamesTheKeptRowFirstThenTheBestOverlap();
  testOnlyAKeptRowIsRepeatedAndOnlyAnAddRepeats();
  testRepeatedRowsIgnoresPairsThatPointAtNoRow();
  testAChangedRowPairsWithThePerformanceItsBaseNames();
  testAChangedRowWhoseBaseRowIsGoneStaysAnAdd();
  testTheMovedPastItsEndTable();
  testARenamedNextRowIsNoMove();
  testAMovedBackRowReadsARenamedNextRowAsUnmoved();
  testAnUntouchedRowPairsByIdFirst();
  testAnUntouchedRowWhosePerformanceIsGonePairsWithNothing();
  testWithNoBaseThePairingIsByTitleThenTime();
  testUntouchedIsTheSameRowWithTheSameEnd();
  testAFilledEndThatWouldOverlapAMovedRowIsTheContributors();
  testEachBaseRowIsRepeatedOnce();
  testACounterpartIsTheRowRepeatedElseMatchedByTime();
  testACounterpartIsMatchedOverTheBaseByStart();
  testARepeatedRowKeepsItsCounterpart();
  testIchiiPairsSixAndDropsOne();
  testIchiiChangeFlags();
  testOneCurrentTwoProposed();
  testSameSongTwiceInOneStream();
  testOpenEndUsesNextStart();
  testLastOpenEndUses240();
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
