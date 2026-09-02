#!/bin/sh
set -eu

fresh_db="$(mktemp /tmp/prism-merge-guards-fresh.XXXXXX.sqlite3)"
legacy_db="$(mktemp /tmp/prism-merge-guards-legacy.XXXXXX.sqlite3)"
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

# --- Fresh DB: schema.sql alone must create the guard table ---
sqlite3 "$fresh_db" < schema.sql
sqlite3 "$fresh_db" < schema.sql

assert_sql "$fresh_db" \
  "SELECT group_concat(name, ',') FROM pragma_table_info('merge_guards');" \
  'guard_token,canonical_id,actor,created_at' \
  'fresh schema creates merge_guards with the guard columns'
assert_sql "$fresh_db" \
  "SELECT name FROM pragma_table_info('merge_guards') WHERE pk = 1;" \
  'guard_token' \
  'one random guard token is the whole primary key'
assert_sql "$fresh_db" \
  "SELECT group_concat(name, ',') FROM pragma_table_info('merge_guards') WHERE \"notnull\" = 1;" \
  'canonical_id,actor,created_at' \
  'every guard column beside the primary key is NOT NULL'

# --- Legacy simulation: a production DB that predates this migration ---
# work_aliases carries migration 0006/0007's shape and, because merge guards
# used to be sentinel alias rows, could in principle hold a stranded sentinel
# from an interrupted batch alongside real merge history.
sqlite3 "$legacy_db" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE work_aliases (
  source_work_id TEXT PRIMARY KEY,
  canonical_work_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_original_artist TEXT NOT NULL,
  source_tags TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_work_aliases_canonical ON work_aliases(canonical_work_id);
CREATE INDEX idx_work_aliases_source ON work_aliases(source_title, source_original_artist);

INSERT INTO work_aliases (
  source_work_id, canonical_work_id, source_title,
  source_original_artist, source_tags, merged_by
) VALUES
  ('work-retired', 'work-canonical', 'Retired Title', 'Retired Artist', '[]', 'test-curator'),
  -- A genuine alias that merely LOOKS like a sentinel (a retired work really
  -- titled '__merge_guard__'): the sweep matches the full sentinel shape
  -- (title + artist + tags + system actor + random-id prefix) and must keep it.
  ('work-lookalike', 'work-canonical', '__merge_guard__', 'Real Artist', '["tag"]', 'test-curator'),
  ('merge-guard-source-stranded', 'merge-guard-canonical-stranded',
   '__merge_guard__', '__merge_guard__', '[]', 'system:harmonizer-merge-guard'),
  ('work-match-guard-stranded', 'work-match-guard-canonical-stranded',
   '__work_match_guard__', '__work_match_guard__', '[]', 'system:global-work-review-guard');
SQL

sqlite3 "$legacy_db" < migrations/0008_merge_guards.sql
sqlite3 "$legacy_db" < migrations/0008_merge_guards.sql

assert_sql "$legacy_db" \
  "SELECT group_concat(name, ',') FROM pragma_table_info('merge_guards');" \
  'guard_token,canonical_id,actor,created_at' \
  'migration adds merge_guards to an existing database'
assert_sql "$legacy_db" \
  "SELECT COUNT(*) FROM work_aliases WHERE source_work_id IN ('merge-guard-source-stranded', 'work-match-guard-stranded');" \
  '0' \
  'migration sweeps every stranded guard sentinel out of work_aliases'
assert_sql "$legacy_db" \
  'SELECT COUNT(*) FROM work_aliases;' \
  '2' \
  'real merge history survives the sentinel sweep'
assert_sql "$legacy_db" \
  "SELECT source_original_artist FROM work_aliases WHERE source_work_id = 'work-lookalike';" \
  'Real Artist' \
  'a genuine alias titled like a sentinel is not swept: the sweep matches the full sentinel shape'
assert_sql "$legacy_db" \
  "SELECT canonical_work_id FROM work_aliases WHERE source_work_id = 'work-retired';" \
  'work-canonical' \
  'real alias rows are untouched by the migration'
assert_sql "$legacy_db" \
  'PRAGMA integrity_check;' \
  'ok' \
  'SQLite integrity after migration'

# --- One merge batch: guard insert, guarded mutation, cleanup ---
sqlite3 "$fresh_db" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO works (id, title, original_artist, tags)
VALUES ('work-guard-canonical', 'Guard Canonical', 'Guard Artist', '[]');
SQL

# A stale expectation must authorize nothing: the guard row is never written,
# so every guarded mutation in the batch is a no-op.
sqlite3 "$fresh_db" >/dev/null <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1 FROM works
    WHERE id = 'work-guard-canonical' AND tags = '["stale"]'
  )
)
INSERT INTO merge_guards (guard_token, canonical_id, actor)
SELECT 'guard-token-stale', 'work-guard-canonical', 'system:harmonizer-merge-guard'
FROM merge_guard
WHERE valid
RETURNING 1 AS valid;

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1 FROM merge_guards
    WHERE guard_token = 'guard-token-stale'
      AND canonical_id = 'work-guard-canonical'
      AND actor = 'system:harmonizer-merge-guard'
  )
)
UPDATE works
SET tags = '["should-not-apply"]'
WHERE id = 'work-guard-canonical'
  AND (SELECT valid FROM merge_guard);

DELETE FROM merge_guards WHERE guard_token = 'guard-token-stale';
COMMIT;
SQL

assert_sql "$fresh_db" \
  "SELECT tags FROM works WHERE id = 'work-guard-canonical';" \
  '[]' \
  'a guard row that never lands authorizes no mutation'

# A current expectation authorizes the batch, and the cleanup statement
# retires the token before the transaction commits.
sqlite3 "$fresh_db" >/dev/null <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1 FROM works
    WHERE id = 'work-guard-canonical' AND tags = '[]'
  )
)
INSERT INTO merge_guards (guard_token, canonical_id, actor)
SELECT 'guard-token-valid', 'work-guard-canonical', 'system:harmonizer-merge-guard'
FROM merge_guard
WHERE valid
RETURNING 1 AS valid;

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1 FROM merge_guards
    WHERE guard_token = 'guard-token-valid'
      AND canonical_id = 'work-guard-canonical'
      AND actor = 'system:harmonizer-merge-guard'
  )
)
UPDATE works
SET tags = '["merged"]'
WHERE id = 'work-guard-canonical'
  AND (SELECT valid FROM merge_guard);

DELETE FROM merge_guards WHERE guard_token = 'guard-token-valid';
COMMIT;
SQL

assert_sql "$fresh_db" \
  "SELECT tags FROM works WHERE id = 'work-guard-canonical';" \
  '["merged"]' \
  'a current expectation authorizes its own guarded mutation'
assert_sql "$fresh_db" \
  'SELECT COUNT(*) FROM merge_guards;' \
  '0' \
  'a merge batch leaves no guard residue behind'
assert_sql "$fresh_db" \
  "SELECT COUNT(*) FROM work_aliases WHERE source_title IN ('__merge_guard__', '__work_match_guard__');" \
  '0' \
  'a merge batch writes no sentinel rows into work_aliases'
assert_sql "$fresh_db" \
  'PRAGMA integrity_check;' \
  'ok' \
  'SQLite integrity after a guarded merge batch'
assert_sql "$fresh_db" \
  'SELECT COUNT(*) FROM pragma_foreign_key_check;' \
  '0' \
  'foreign keys after a guarded merge batch'

echo '✓ merge guards live in their own table and leave neither residue nor alias sentinels'
