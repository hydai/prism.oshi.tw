/**
 * Canonical streamer-slug validator for the data-sync pipeline.
 *
 * The sync tooling feeds slugs (sourced from data/registry.json) into two
 * unsafe sinks in sync-data: raw string interpolation inside D1 SQL
 * (`wrangler d1 execute --command`, which has no bind-parameter support) and
 * `path.resolve(ROOT, 'data', slug)` filesystem writes. A slug constrained to
 * lowercase alphanumerics + hyphens contains no SQL metacharacters (', ;, --,
 * whitespace) and no path metacharacters (., /), so this single allowlist closes
 * both the SQL-injection and path-traversal sinks.
 *
 * The accepted format mirrors the slug regex enforced on public submissions in
 * tools/nova/src/validate.ts (lowercase alphanumeric + hyphens, 1-50 chars) — it
 * MUST stay at least as strict so a slug Nova approves can still sync, while
 * malformed slugs that bypassed Nova (e.g. via a direct Admin DB edit) are
 * rejected here before reaching the sinks.
 */

// Hyphens allowed internally but not at the start/end; 1-50 chars total.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const SHORT_SLUG_RE = /^[a-z0-9]{1,2}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug) || SHORT_SLUG_RE.test(slug);
}

/**
 * Throw if `slug` is not a safe streamer slug. `context` (e.g. the source file
 * or command) is woven into the message so an operator can see where the bad
 * value came from.
 */
export function assertValidSlug(slug: string, context?: string): void {
  if (isValidSlug(slug)) return;
  const where = context ? ` (from ${context})` : '';
  throw new Error(
    `Invalid streamer slug${where}: ${JSON.stringify(slug)}. ` +
      `Slugs must be lowercase alphanumerics and hyphens (1-50 chars), e.g. "mizuki-prism". ` +
      `Refusing to use it in SQL/filesystem paths.`,
  );
}
