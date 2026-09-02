/**
 * Candidate pairing for the Harmonizer's fuzzy passes.
 *
 * The naive pass scored all n(n-1)/2 pairs with `similarityScore`, i.e. a full
 * Levenshtein matrix per pair. This module keeps the exact same pairs — the
 * survivors are scored with the same function and the same `>= threshold`
 * test — but skips pairs that provably cannot reach the threshold, using two
 * lower bounds on the edit distance. Nothing here touches D1, so the bounds are
 * unit-testable against the pass they replace.
 */
import { similarityScore } from './normalize';
import type { UnionFind } from './union-find';

/** Scoring hook; production always uses `similarityScore`. Tests inject a counter. */
export type SimilarityScorer = (left: string, right: string) => number;

interface Candidate {
  /** Position in the caller's `normalizedKeys`, which is what gets unioned. */
  index: number;
  key: string;
  /** UTF-16 code-unit length — the unit `levenshteinDistance` itself counts. */
  length: number;
  histogram: Map<number, number>;
}

/**
 * Upper bound on `similarityScore(a, b)` implied by a lower bound on `lev(a, b)`.
 *
 * Deliberately mirrors `similarityScore`'s own arithmetic (`1 - distance/maxLen`,
 * and 1 when both keys are empty). IEEE-754 division and subtraction are
 * monotonic, so `levLowerBound <= lev` guarantees `bound >= similarityScore(a, b)`
 * exactly — no epsilon slop to reason about. A pair whose bound is already below
 * the threshold therefore can never pass `score >= threshold`.
 */
function scoreUpperBound(levLowerBound: number, maxLen: number): number {
  if (maxLen === 0) return 1;
  return 1 - levLowerBound / maxLen;
}

/**
 * Count of each UTF-16 code unit in `key`. `levenshteinDistance` indexes with
 * `.length` and `a[i - 1]`, i.e. it edits code units (a surrogate pair counts as
 * two), so the histogram must count the same units for the bound below to hold.
 */
function histogramOf(key: string): Map<number, number> {
  const histogram = new Map<number, number>();
  for (let i = 0; i < key.length; i += 1) {
    const unit = key.charCodeAt(i);
    histogram.set(unit, (histogram.get(unit) ?? 0) + 1);
  }
  return histogram;
}

/** L1 distance between two code-unit histograms. */
function histogramL1(left: Map<number, number>, right: Map<number, number>): number {
  let total = 0;
  for (const [unit, count] of left) {
    total += Math.abs(count - (right.get(unit) ?? 0));
  }
  for (const [unit, count] of right) {
    if (!left.has(unit)) total += count;
  }
  return total;
}

/**
 * Union every pair of `normalizedKeys` whose `similarityScore` reaches
 * `threshold`, into `groups` (indexed by position in `normalizedKeys`).
 *
 * Identical by construction to scoring every pair: only pairs proven unable to
 * reach the threshold are skipped.
 */
export function unionSimilarKeys(
  normalizedKeys: readonly string[],
  threshold: number,
  groups: UnionFind,
  score: SimilarityScorer = similarityScore,
): void {
  const candidates: Candidate[] = normalizedKeys.map((key, index) => ({
    index,
    key,
    length: key.length,
    histogram: histogramOf(key),
  }));
  // Ascending length, so the inner loop's key is always the longer of the pair
  // (`maxLen`) and the length bound below is monotone in `j`.
  candidates.sort((left, right) => left.length - right.length);

  for (let i = 0; i < candidates.length; i += 1) {
    const left = candidates[i]!;
    for (let j = i + 1; j < candidates.length; j += 1) {
      const right = candidates[j]!;
      const maxLen = right.length;

      // Bound (a) — length. `similarityScore(a, b) = 1 - lev(a, b)/maxLen`, so a
      // pair reaches threshold t only if lev <= (1 - t) * maxLen. A single edit
      // changes the length by at most one, hence lev >= |len a - len b|. With
      // len_i <= len_j (the sort above) and maxLen = len_j, the pair is
      // admissible only while
      //     len_j - len_i <= (1 - t) * len_j   <=>   t * len_j <= len_i
      //                                        <=>   len_j <= len_i / t.
      // len_j is non-decreasing as j advances, so once this fails it fails for
      // every later j: break, don't continue.
      if (scoreUpperBound(right.length - left.length, maxLen) < threshold) break;

      // Bound (b) — character histogram. A substitution moves one unit from one
      // bucket to another, changing the L1 distance between the two histograms
      // by at most 2; an insertion or deletion changes it by exactly 1. So
      // L1 <= 2 * lev, i.e. lev >= ceil(L1 / 2). Unlike (a) this is not monotone
      // in j, so a failure only skips this one pair.
      const distanceFloor = Math.ceil(histogramL1(left.histogram, right.histogram) / 2);
      if (scoreUpperBound(distanceFloor, maxLen) < threshold) continue;

      if (score(left.key, right.key) >= threshold) groups.union(left.index, right.index);
    }
  }
}
