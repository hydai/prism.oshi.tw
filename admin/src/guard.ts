/**
 * Merge guards.
 *
 * D1 exposes atomic batches but no interactive transaction callback, so a
 * multi-statement merge cannot re-read the catalog and decide mid-flight.
 * Instead the first statement of the batch writes one short-lived token row
 * into `merge_guards`, and only if the caller's validity CTE — every reviewed
 * expectation the merge was confirmed against — still holds. Every business
 * mutation then selects that token, and the last mutating statement of the
 * batch deletes it, so a stale batch is entirely no-op and a committed one
 * leaves no guard residue.
 *
 * The validity CTE stays with each merge path (song merges and global work
 * merges check different state); this module owns only the token's shape,
 * its lookup, and the bind order they share.
 */

/** A caller-supplied `WITH ... merge_guard(valid) AS (...)` clause and its bindings. */
export interface MergeGuardValidityCte {
  /**
   * SQL text for the whole leading WITH clause, ending in the
   * `merge_guard(valid) AS (...)` definition the INSERT selects from.
   */
  sql: string;
  /** Bindings for the placeholders in `sql`, in textual order. */
  bindings: unknown[];
}

/** Identifies one merge's guard row. */
export interface MergeGuardIdentity {
  /** One random token per merge; the primary key of the guard row. */
  guardToken: string;
  /** The real canonical entity id this merge collapses onto. */
  canonicalId: string;
  /** The system actor of the merge path that owns this guard. */
  actor: string;
}

export interface MergeGuardInsert extends MergeGuardIdentity {
  validityCte: MergeGuardValidityCte;
}

/**
 * First statement of a merge batch: writes the guard row when the caller's
 * validity CTE holds, and returns `valid` so the batch result can be checked.
 */
export function prepareMergeGuardInsert(
  db: D1Database,
  { guardToken, canonicalId, actor, validityCte }: MergeGuardInsert,
): D1PreparedStatement {
  return db.prepare(
    `${validityCte.sql}
     INSERT INTO merge_guards (guard_token, canonical_id, actor)
     SELECT ?, ?, ?
     FROM merge_guard
     WHERE valid
     RETURNING 1 AS valid`,
  ).bind(...validityCte.bindings, guardToken, canonicalId, actor);
}

/**
 * Wraps one business mutation in the guard lookup. The mutation itself must
 * reference `(SELECT valid FROM merge_guard)` (or select `FROM merge_guard
 * WHERE valid`) so it applies to nothing when the guard row is absent.
 */
export function guardedStatement(
  db: D1Database,
  { guardToken, canonicalId, actor }: MergeGuardIdentity,
  sql: string,
  bindings: unknown[] = [],
): D1PreparedStatement {
  return db.prepare(
    `WITH merge_guard(valid) AS (
       SELECT EXISTS (
         SELECT 1
         FROM merge_guards
         WHERE guard_token = ?
           AND canonical_id = ?
           AND actor = ?
       )
     )
     ${sql}`,
  ).bind(guardToken, canonicalId, actor, ...bindings);
}

/** Last mutating statement of a merge batch: retires the token before it commits. */
export function prepareMergeGuardCleanup(
  db: D1Database,
  guardToken: string,
): D1PreparedStatement {
  return db.prepare('DELETE FROM merge_guards WHERE guard_token = ?').bind(guardToken);
}
