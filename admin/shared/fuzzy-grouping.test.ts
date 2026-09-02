import { unionSimilarKeys } from './fuzzy-grouping';
import { similarityScore } from './normalize';
import { UnionFind } from './union-find';

declare const process: { exitCode?: number };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// A 41-character key and the same key with its last five characters deleted:
// lev 5 over maxLen 41 scores 0.878, so the pair is admissible at 0.85 even
// though the lengths differ by five. Any hardcoded "lengths within ±2" bucket
// would have silently dropped it.
const LONG_KEY = 'summer festival live band arrangement ver';
const LONG_KEY_TRIMMED = LONG_KEY.slice(0, 36);

/**
 * Crafted normalized keys (the fuzzy pass runs on `normalizeAggressive` output,
 * so these stand in for it directly). Every group of lines below exists to
 * stress one property of the pruning bounds.
 */
const FIXTURE: readonly string[] = [
  // 0-3: near-misses at lev 1 / maxLen 11 = 0.909. Index 2 differs from index 0
  // in its FIRST character, which is exactly the pair a first-character bucket
  // would lose: one substitution is admissible whenever (1 - t) * maxLen >= 1.
  'hello world',
  'hello worle',
  'jello world',
  'hello word',
  // 4-7: identical character histograms, different order. The histogram bound
  // is 0 for these, so they must be scored, never assumed similar (0.333).
  'abc',
  'cba',
  'listen',
  'silent',
  // 8-9: exact duplicates (score 1).
  'night sky',
  'night sky',
  // 10-11: two empty keys — similarityScore's maxLen === 0 branch returns 1.
  '',
  '',
  // 12-13: length delta 5, still 0.878.
  LONG_KEY,
  LONG_KEY_TRIMMED,
  // 14-16: 0.833 (grouped only below that threshold) and a disjoint-alphabet
  // control of the same length that the histogram bound can prune.
  'abcdefghij',
  'abcdefghijkl',
  'klmnopqrst',
  // 17: a one-character key, far from everything.
  'x',
  // 18-20: 0.957 and 0.667 — the second only groups at the lower threshold.
  'never gonna give you up',
  'never gonna give you op',
  'never gonna let you down',
  // 21-23: 0.9 and a same-length histogram-disjoint control.
  'aaaaaaaaaa',
  'aaaaaaaaab',
  'bbbbbbbbbb',
  // 24-25: 0.76 across a length delta of 6.
  'the quick brown fox',
  'the quick brown fox jumps',
  // 26-27: 0.5, below every threshold under test except the lowest.
  'idol',
  'idle',
  // 28-29: 0.941.
  'renai circulation',
  'renai circuration',
  // 30-31: a transposition scoring 0.846 — just under 0.85, so the pair proves
  // the pruning never *adds* a group either.
  'crazy for you',
  'crazy for yuo',
];

type Scorer = (a: string, b: string) => number;

function countingScorer(): { score: Scorer; calls: () => number } {
  let calls = 0;
  return {
    score: (a, b) => {
      calls += 1;
      return similarityScore(a, b);
    },
    calls: () => calls,
  };
}

/** Components as sorted index lists, sorted by their smallest member. */
function componentsOf(groups: UnionFind, size: number): number[][] {
  const byRoot = new Map<number, number[]>();
  for (let index = 0; index < size; index += 1) {
    const root = groups.find(index);
    const component = byRoot.get(root);
    if (component) component.push(index);
    else byRoot.set(root, [index]);
  }
  return [...byRoot.values()]
    .map((component) => [...component].sort((left, right) => left - right))
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
}

/**
 * Oracle: the full pairwise pass `unionSimilarKeys` replaces, ported verbatim
 * from `admin/src/db.ts` at 299df82 (the identical fuzzy blocks at db.ts:1935-1953
 * and db.ts:2035-2052). The only edit is routing `similarityScore` through the
 * injected scorer so its calls can be counted.
 */
function oracleUnion(keys: readonly string[], threshold: number, scoreWith: Scorer): number[][] {
  const parent = new Map<number, number>();
  function find(i: number): number {
    if (!parent.has(i)) parent.set(i, i);
    if (parent.get(i) !== i) parent.set(i, find(parent.get(i)!));
    return parent.get(i)!;
  }
  function union(i: number, j: number) {
    parent.set(find(i), find(j));
  }

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const score = scoreWith(keys[i]!, keys[j]!);
      if (score >= threshold) {
        union(i, j);
      }
    }
  }

  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < keys.length; i++) {
    const root = find(i);
    const component = byRoot.get(root);
    if (component) component.push(i);
    else byRoot.set(root, [i]);
  }
  return [...byRoot.values()]
    .map((component) => [...component].sort((left, right) => left - right))
    .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
}

function prunedUnion(keys: readonly string[], threshold: number, scoreWith: Scorer): number[][] {
  const groups = new UnionFind(keys.length);
  unionSimilarKeys(keys, threshold, groups, scoreWith);
  return componentsOf(groups, keys.length);
}

function testFixtureKeepsItsDocumentedShape(): void {
  equal(LONG_KEY.length, 41, 'the long key is 41 characters');
  equal(LONG_KEY_TRIMMED.length, 36, 'the trimmed long key is 36 characters');
  equal(round4(similarityScore(FIXTURE[0]!, FIXTURE[2]!)), 0.9091, 'a differing first character still scores 0.909');
  equal(round4(similarityScore(FIXTURE[4]!, FIXTURE[5]!)), 0.3333, 'same-histogram anagrams score 0.333');
  equal(round4(similarityScore(FIXTURE[12]!, FIXTURE[13]!)), 0.878, 'a length delta of 5 still scores 0.878');
  equal(round4(similarityScore(FIXTURE[10]!, FIXTURE[11]!)), 1, 'two empty keys score 1');
  equal(round4(similarityScore(FIXTURE[30]!, FIXTURE[31]!)), 0.8462, 'the transposition lands just under 0.85');
  equal(round4(similarityScore(FIXTURE[14]!, FIXTURE[15]!)), 0.8333, 'the length-delta-2 pair lands just under 0.85');
}

function testGroupingMatchesTheFullPairwiseOracle(): void {
  // NaN is what `parseFloat(c.req.query('threshold'))` yields for a junk query
  // param, and 0/1 are the degenerate ends of the range.
  const thresholds = [1, 0.95, 0.85, 0.84, 0.8, 0.6, 0.5, 0.3, 0, Number.NaN];

  for (const threshold of thresholds) {
    const oracleCounter = countingScorer();
    const prunedCounter = countingScorer();
    const expected = oracleUnion(FIXTURE, threshold, oracleCounter.score);
    const actual = prunedUnion(FIXTURE, threshold, prunedCounter.score);

    equal(
      JSON.stringify(actual),
      JSON.stringify(expected),
      `bound-pruned grouping matches the full pairwise pass at threshold ${String(threshold)}`,
    );
    assert(
      prunedCounter.calls() <= oracleCounter.calls(),
      `pruning never scores more pairs than the oracle at threshold ${String(threshold)}`,
    );
  }
}

function testPruningSkipsWorkTheOracleDid(): void {
  for (const threshold of [0.85, 0.6]) {
    const oracleCounter = countingScorer();
    const prunedCounter = countingScorer();
    oracleUnion(FIXTURE, threshold, oracleCounter.score);
    prunedUnion(FIXTURE, threshold, prunedCounter.score);

    equal(
      oracleCounter.calls(),
      (FIXTURE.length * (FIXTURE.length - 1)) / 2,
      'the oracle scores every pair',
    );
    assert(
      prunedCounter.calls() < oracleCounter.calls(),
      `pruning evaluates strictly fewer distances at threshold ${String(threshold)}`
      + ` (pruned ${String(prunedCounter.calls())}, oracle ${String(oracleCounter.calls())})`,
    );
    console.log(
      `  threshold ${String(threshold)}: ${String(prunedCounter.calls())} scored pairs vs ${String(oracleCounter.calls())} full-pairwise`,
    );
  }
}

function testTheInterestingPairsSurvivePruning(): void {
  const groups = new UnionFind(FIXTURE.length);
  unionSimilarKeys(FIXTURE, 0.85, groups);

  equal(groups.find(0), groups.find(2), 'a differing first character does not hide a 0.909 pair');
  equal(groups.find(0), groups.find(1), 'same-first-character near misses still group');
  equal(groups.find(0), groups.find(3), 'a one-character deletion still groups');
  equal(groups.find(12), groups.find(13), 'a length delta of 5 still groups at 0.85');
  equal(groups.find(8), groups.find(9), 'exact duplicates group');
  equal(groups.find(10), groups.find(11), 'two empty keys group');
  assert(groups.find(4) !== groups.find(5), 'same-histogram anagrams are scored, not merged');
  assert(groups.find(6) !== groups.find(7), 'listen/silent are scored, not merged');
  assert(groups.find(30) !== groups.find(31), 'a 0.846 pair stays apart at 0.85');
  assert(groups.find(14) !== groups.find(15), 'a 0.833 pair stays apart at 0.85');
  assert(groups.find(21) !== groups.find(23), 'histogram-disjoint keys of equal length stay apart');
}

function main(): void {
  testFixtureKeepsItsDocumentedShape();
  testGroupingMatchesTheFullPairwiseOracle();
  testPruningSkipsWorkTheOracleDid();
  testTheInterestingPairsSurvivePruning();
  console.log('✓ bound-pruned fuzzy grouping is recall-identical to the full pairwise pass, and cheaper');
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
