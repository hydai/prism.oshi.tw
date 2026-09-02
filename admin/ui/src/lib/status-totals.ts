/**
 * Helpers for the review pages' lists. Each page loads its table once,
 * unfiltered, then derives the visible rows and the hero totals from that one
 * array — so the filters below are the client-side twins of the list
 * endpoints' optional WHERE clauses (see admin/src/query-filters.ts).
 */

export function countByStatus<T extends { status: string }>(items: T[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

export function replaceById<T extends { id: string }>(items: T[], updated: T): T[] {
  return items.map((item) => (item.id === updated.id ? updated : item));
}

export function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

/** `WHERE column = ?` — an empty filter is the absent clause, matching every row. */
export function matchesFilter(value: string | null | undefined, filter: string): boolean {
  return filter === '' || value === filter;
}

/**
 * `WHERE (a LIKE ? OR b LIKE ? ...)` with a `%term%` pattern — an empty search
 * matches every row. Folding both sides reproduces SQLite's ASCII-insensitive
 * LIKE (and extends it to accented letters, which SQLite's LIKE does not fold);
 * `%` and `_` are matched literally here rather than as wildcards.
 */
export function matchesSearch(
  fields: ReadonlyArray<string | null | undefined>,
  search: string,
): boolean {
  if (search === '') return true;
  const needle = search.toLowerCase();
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}
