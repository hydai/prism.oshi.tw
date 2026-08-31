// query-filters.ts — domain-agnostic SQL list-filter composition shared by
// nova-db.ts (submissions, vods) and crystal-db.ts (tickets). Neutral home so
// Crystal's module does not depend on Nova's for cross-cutting logic (same
// rationale as status.ts for the small shared status helpers).

export interface StatusFilterClause {
  readonly column: string;
  readonly binds: readonly (string | number)[];
}

/**
 * Collapses the WHERE/ORDER BY composition shared by listSubmissions,
 * listVods, and listTickets: an optional list of AND-ed conditions (any of
 * which may be absent) followed by a fixed ORDER BY. Each clause's `column`
 * may itself contain more than one `?` (e.g. a multi-column LIKE search), so
 * binds are flattened in clause order to stay aligned with the emitted `?`s.
 */
export function buildStatusFilterQuery(
  base: string,
  orderBy: string,
  clauses: ReadonlyArray<StatusFilterClause | null | undefined>,
): { sql: string; binds: (string | number)[] } {
  const active = clauses.filter((clause): clause is StatusFilterClause => clause != null);
  let sql = base;
  if (active.length > 0) {
    sql += ` WHERE ${active.map((clause) => clause.column).join(' AND ')}`;
  }
  sql += ` ORDER BY ${orderBy}`;
  return { sql, binds: active.flatMap((clause) => [...clause.binds]) };
}
