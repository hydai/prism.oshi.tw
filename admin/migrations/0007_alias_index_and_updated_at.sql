-- Migration 0007: work_aliases composite lookup index + updated_at backfill
--
-- Apply against remote D1 (from admin/ directory):
--   npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0007_alias_index_and_updated_at.sql
--
-- Every exact-title/artist alias lookup (db.ts) filters work_aliases on
-- source_title + source_original_artist. idx_work_aliases_canonical does not
-- serve that predicate, so those lookups were a full table scan; this index
-- fixes that. It is read-path-transparent and safe to deploy in either order
-- relative to the application code.
--
-- Migration 0001 backfilled performances/streams.updated_at from created_at,
-- but rows inserted before every INSERT explicitly set updated_at (the
-- migrated production tables have no column DEFAULT — SQLite's ALTER TABLE
-- ADD COLUMN cannot carry a non-constant one) could still land NULL, which
-- tools/sync-status's MAX(updated_at) staleness check silently ignores.
-- Re-running the same backfill here is a no-op once every INSERT sets
-- updated_at explicitly, but closes that gap for any row that slipped through
-- before this fix shipped.

CREATE INDEX IF NOT EXISTS idx_work_aliases_source ON work_aliases(source_title, source_original_artist);

UPDATE performances SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;
UPDATE streams SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;
