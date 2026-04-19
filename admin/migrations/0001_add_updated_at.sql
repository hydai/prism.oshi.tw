-- Migration 0001: add updated_at to performances and streams
--
-- Apply against remote D1 (from admin/ directory):
--   npx wrangler d1 execute oshi-prism-db --remote --file=migrations/0001_add_updated_at.sql
--
-- SQLite ALTER TABLE ADD COLUMN cannot use a non-constant DEFAULT (datetime('now')),
-- so we add the column as nullable, then backfill existing rows from created_at.
-- Fresh DBs created from schema.sql already get the DEFAULT (datetime('now')).

ALTER TABLE performances ADD COLUMN updated_at TEXT;
UPDATE performances SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE streams ADD COLUMN updated_at TEXT;
UPDATE streams SET updated_at = created_at WHERE updated_at IS NULL;
