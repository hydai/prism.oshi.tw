/**
 * Disjoint-set union ("union-find") over a fixed range of integer indexes.
 *
 * One array-backed implementation for every caller that needs connected
 * components: the Harmonizer's exact and fuzzy song/artist passes and the
 * global work review's candidate builder used to carry a private copy each.
 *
 * `find` is iterative on purpose — a recursive one overflows the stack on a
 * long parent chain, which is reachable whenever unions arrive in an order that
 * keeps attaching the current root under a fresh index.
 */
export class UnionFind {
  private readonly parent: number[];

  /** Every index in `[0, size)` starts as its own root. */
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  /** Root of `index`'s component, compressing the path walked to reach it. */
  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root]!;
    let cursor = index;
    while (this.parent[cursor] !== cursor) {
      const next = this.parent[cursor]!;
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  /** Merge the components of `left` and `right`; a no-op when already joined. */
  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.parent[rightRoot] = leftRoot;
  }
}
