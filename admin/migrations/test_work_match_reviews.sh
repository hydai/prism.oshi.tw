#!/bin/sh
set -eu

migration_db="$(mktemp /tmp/prism-work-match-migration.XXXXXX.sqlite3)"
bootstrap_db="$(mktemp /tmp/prism-work-match-bootstrap.XXXXXX.sqlite3)"
trap 'rm -f "$migration_db" "$bootstrap_db"' EXIT

sqlite3 "$migration_db" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_artist TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE song_work_links (
  song_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  link_method TEXT NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
SQL

sqlite3 "$migration_db" < migrations/0006_add_work_match_reviews.sql
sqlite3 "$migration_db" < migrations/0006_add_work_match_reviews.sql

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

assert_sql "$migration_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('work_match_reviews', 'work_match_state');" \
  '2' \
  'migration creates review and revision tables idempotently'
assert_sql "$migration_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'work_match_*_revision';" \
  '6' \
  'migration creates all work and link revision triggers'
assert_sql "$migration_db" \
  'SELECT revision FROM work_match_state WHERE id = 1;' \
  '0' \
  'migration starts at a stable revision'

sqlite3 "$migration_db" <<'SQL'
INSERT INTO works (id, title, original_artist, tags)
VALUES ('work-a', 'Title', 'Artist', '[]');
UPDATE works SET tags = '["pop"]' WHERE id = 'work-a';
INSERT INTO song_work_links (song_id, work_id, link_method, linked_by)
VALUES ('song-a', 'work-a', 'manual', 'curator@example.com');
UPDATE song_work_links SET work_id = 'work-a' WHERE song_id = 'song-a';
DELETE FROM song_work_links WHERE song_id = 'song-a';
DELETE FROM works WHERE id = 'work-a';
SQL
assert_sql "$migration_db" \
  'SELECT revision FROM work_match_state WHERE id = 1;' \
  '6' \
  'every catalog identity/link mutation increments the scan revision'

key_a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
fingerprint_a='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
fingerprint_b='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
sqlite3 "$migration_db" "INSERT INTO work_match_reviews (
  candidate_key, fingerprint, work_ids, decision, note, reviewed_by
) VALUES (
  '$key_a', '$fingerprint_a', '[\"work-a\",\"work-b\"]',
  'not_duplicate', 'first identity state', 'curator@example.com'
), (
  '$key_a', '$fingerprint_b', '[\"work-a\",\"work-b\"]',
  'needs_research', 'changed identity state', 'curator@example.com'
);"
assert_sql "$migration_db" \
  'SELECT COUNT(*) FROM work_match_reviews;' \
  '2' \
  'changed fingerprints retain historical review decisions'

if sqlite3 "$migration_db" "INSERT INTO work_match_reviews (
  candidate_key, fingerprint, work_ids, decision, reviewed_by
) VALUES (
  '$key_a', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  '[]', 'merged_without_review', 'curator@example.com'
);" >/dev/null 2>&1; then
  echo 'FAIL: invalid review decision passed its database constraint' >&2
  exit 1
fi

sqlite3 "$bootstrap_db" < schema.sql
assert_sql "$bootstrap_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('work_match_reviews', 'work_match_state');" \
  '2' \
  'fresh schema includes global work review state'
assert_sql "$bootstrap_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'work_match_*_revision';" \
  '6' \
  'fresh schema includes every catalog revision trigger'
assert_sql "$bootstrap_db" \
  'PRAGMA integrity_check;' \
  'ok' \
  'fresh schema integrity'

echo '✓ work match reviews are content-addressed and catalog mutations are revisioned'
