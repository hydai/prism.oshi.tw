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

CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE performances (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL
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
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('work_match_reviews', 'work_match_merge_audits', 'work_match_state');" \
  '3' \
  'migration creates review, merge-audit, and revision tables idempotently'
assert_sql "$migration_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'work_match_*_revision';" \
  '12' \
  'migration creates every displayed-state revision trigger'
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
INSERT INTO songs (id, streamer_id, status)
VALUES ('song-state', 'alice', 'pending');
UPDATE songs SET status = 'approved' WHERE id = 'song-state';
INSERT INTO performances (id, song_id) VALUES ('performance-state', 'song-state');
UPDATE performances SET song_id = 'song-state' WHERE id = 'performance-state';
DELETE FROM performances WHERE id = 'performance-state';
DELETE FROM songs WHERE id = 'song-state';
SQL
assert_sql "$migration_db" \
  'SELECT revision FROM work_match_state WHERE id = 1;' \
  '12' \
  'every displayed work, link, song, and performance mutation increments the scan revision'

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
assert_sql "$migration_db" \
  'SELECT MIN(review_version) || ":" || MAX(review_version) FROM work_match_reviews;' \
  '1:1' \
  'review decisions start with a monotonic record version'

sqlite3 "$migration_db" "INSERT INTO work_match_merge_audits (
  id, candidate_key, fingerprint, catalog_revision, review_version,
  canonical_work_id, source_work_ids, note, merged_by
) VALUES (
  'merge-a', '$key_a', '$fingerprint_a', 12, 1,
  'work-a', '[\"work-b\"]', 'verified official source', 'curator@example.com'
);"
assert_sql "$migration_db" \
  "SELECT review_version || ':' || note FROM work_match_merge_audits WHERE id = 'merge-a';" \
  '1:verified official source' \
  'merge audit preserves the displayed review version and curator note'

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
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('work_match_reviews', 'work_match_merge_audits', 'work_match_state');" \
  '3' \
  'fresh schema includes global work review state'
assert_sql "$bootstrap_db" \
  "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'work_match_*_revision';" \
  '12' \
  'fresh schema includes every catalog revision trigger'
assert_sql "$bootstrap_db" \
  'PRAGMA integrity_check;' \
  'ok' \
  'fresh schema integrity'

echo '✓ work match reviews and merge audits are versioned while catalog mutations are revisioned'
