#!/bin/sh
set -eu

fresh_db="$(mktemp /tmp/prism-alias-index-fresh.XXXXXX.sqlite3)"
legacy_db="$(mktemp /tmp/prism-alias-index-legacy.XXXXXX.sqlite3)"
trap 'rm -f "$fresh_db" "$legacy_db"' EXIT

assert_sql() {
  database="$1"
  sql="$2"
  expected="$3"
  label="$4"
  actual="$(sqlite3 "$database" "$sql")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
}

assert_plan_uses_index() {
  database="$1"
  index_name="$2"
  label="$3"
  plan="$(sqlite3 "$database" "EXPLAIN QUERY PLAN SELECT 1 FROM work_aliases AS alias WHERE alias.source_title = 'Retired Title' AND alias.source_original_artist = 'Retired Artist';")"
  if ! printf '%s\n' "$plan" | grep -q "$index_name"; then
    echo "FAIL: $label (plan: $plan)" >&2
    exit 1
  fi
}

# --- Fresh DB: schema.sql alone must create the alias source-lookup index ---
sqlite3 "$fresh_db" < schema.sql
sqlite3 "$fresh_db" < schema.sql

assert_sql "$fresh_db" \
  "SELECT group_concat(name, ',') FROM pragma_index_info('idx_work_aliases_source');" \
  'source_title,source_original_artist' \
  'fresh schema indexes work_aliases on (source_title, source_original_artist)'
assert_plan_uses_index "$fresh_db" 'idx_work_aliases_source' \
  'fresh schema plans the alias source/artist lookup through the new index'

# --- Legacy simulation: a production DB that predates this migration ---
# performances/streams mirror the migrated (no column DEFAULT) shape left by
# migration 0001: updated_at is nullable with no DEFAULT, and some existing
# rows were never backfilled. work_aliases carries migration 0006's canonical
# index but not this migration's source-lookup index.
sqlite3 "$legacy_db" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE performances (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE streams (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE work_aliases (
  source_work_id TEXT PRIMARY KEY,
  canonical_work_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_original_artist TEXT NOT NULL,
  source_tags TEXT NOT NULL,
  merged_by TEXT NOT NULL
);
CREATE INDEX idx_work_aliases_canonical ON work_aliases(canonical_work_id);

INSERT INTO performances (id, created_at, updated_at) VALUES
  ('perf-never-backfilled', '2026-01-01', NULL),
  ('perf-already-backfilled', '2026-01-02', '2026-01-09');

INSERT INTO streams (id, created_at, updated_at) VALUES
  ('stream-never-backfilled', '2026-02-01', NULL),
  ('stream-already-backfilled', '2026-02-02', '2026-02-09');

INSERT INTO work_aliases (
  source_work_id, canonical_work_id, source_title,
  source_original_artist, source_tags, merged_by
) VALUES (
  'work-retired', 'work-canonical', 'Retired Title',
  'Retired Artist', '[]', 'test-curator'
);
SQL

sqlite3 "$legacy_db" < migrations/0007_alias_index_and_updated_at.sql
sqlite3 "$legacy_db" < migrations/0007_alias_index_and_updated_at.sql

assert_sql "$legacy_db" \
  "SELECT group_concat(name, ',') FROM pragma_index_info('idx_work_aliases_source');" \
  'source_title,source_original_artist' \
  'migration adds the alias source-lookup index to an existing database'
assert_plan_uses_index "$legacy_db" 'idx_work_aliases_source' \
  'migrated database plans the alias source/artist lookup through the new index'

assert_sql "$legacy_db" \
  "SELECT updated_at FROM performances WHERE id = 'perf-never-backfilled';" \
  '2026-01-01' \
  'migration backfills a NULL performance updated_at from created_at'
assert_sql "$legacy_db" \
  "SELECT updated_at FROM performances WHERE id = 'perf-already-backfilled';" \
  '2026-01-09' \
  'migration does not clobber an already-backfilled performance updated_at'
assert_sql "$legacy_db" \
  "SELECT updated_at FROM streams WHERE id = 'stream-never-backfilled';" \
  '2026-02-01' \
  'migration backfills a NULL stream updated_at from created_at'
assert_sql "$legacy_db" \
  "SELECT updated_at FROM streams WHERE id = 'stream-already-backfilled';" \
  '2026-02-09' \
  'migration does not clobber an already-backfilled stream updated_at'

assert_sql "$legacy_db" \
  'SELECT COUNT(*) FROM performances WHERE updated_at IS NULL;' \
  '0' \
  'no performance rows remain unbackfilled'
assert_sql "$legacy_db" \
  'SELECT COUNT(*) FROM streams WHERE updated_at IS NULL;' \
  '0' \
  'no stream rows remain unbackfilled'
assert_sql "$legacy_db" \
  'PRAGMA integrity_check;' \
  'ok' \
  'SQLite integrity after migration'

echo '✓ work_aliases source-lookup index exists and performances/streams updated_at is fully backfilled'
