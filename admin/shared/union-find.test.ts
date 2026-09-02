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

function testEveryIndexStartsAsItsOwnRoot(): void {
  const groups = new UnionFind(5);
  for (let index = 0; index < 5; index += 1) {
    equal(groups.find(index), index, 'a fresh index is its own root');
  }
  equal(
    JSON.stringify(componentsOf(groups, 5)),
    JSON.stringify([[0], [1], [2], [3], [4]]),
    'a fresh UnionFind is all singletons',
  );
}

function testUnionJoinsAndIsTransitive(): void {
  const groups = new UnionFind(6);
  groups.union(0, 1);
  equal(groups.find(0), groups.find(1), 'union joins two indexes');
  assert(groups.find(0) !== groups.find(2), 'unrelated indexes stay apart');

  groups.union(1, 2);
  equal(groups.find(0), groups.find(2), 'membership is transitive across unions');

  groups.union(4, 5);
  equal(
    JSON.stringify(componentsOf(groups, 6)),
    JSON.stringify([[0, 1, 2], [3], [4, 5]]),
    'disjoint components stay disjoint',
  );

  groups.union(2, 5);
  equal(
    JSON.stringify(componentsOf(groups, 6)),
    JSON.stringify([[0, 1, 2, 4, 5], [3]]),
    'joining two components merges every member',
  );
}

function testUnionIsIdempotentAndSelfUnionIsANoop(): void {
  const groups = new UnionFind(4);
  groups.union(0, 1);
  const afterFirstUnion = JSON.stringify(componentsOf(groups, 4));

  groups.union(0, 1);
  groups.union(1, 0);
  groups.union(2, 2);
  equal(
    JSON.stringify(componentsOf(groups, 4)),
    afterFirstUnion,
    'repeating a union (in either direction) and self-union change nothing',
  );
}

function testFindIsIterativeAndCompressesLongChains(): void {
  // `union(i, i - 1)` attaches the previous root under the new index, so the
  // parent chain is `size - 1` deep before anything walks it. A recursive
  // `find` blows the stack here; the iterative one must not.
  const size = 100_000;
  const groups = new UnionFind(size);
  for (let index = 1; index < size; index += 1) groups.union(index, index - 1);

  const root = groups.find(0);
  equal(groups.find(size - 1), root, 'the whole chain is one component');
  equal(groups.find(0), root, 'find is stable after path compression');
  equal(componentsOf(groups, size).length, 1, 'the chain collapses to a single component');
}

function main(): void {
  testEveryIndexStartsAsItsOwnRoot();
  testUnionJoinsAndIsTransitive();
  testUnionIsIdempotentAndSelfUnionIsANoop();
  testFindIsIterativeAndCompressesLongChains();
  console.log('✓ union-find joins, stays transitive, and survives deep parent chains');
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
