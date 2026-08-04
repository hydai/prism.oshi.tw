#!/bin/sh
set -eu

tmp_db="$(mktemp /tmp/prism-initial-tags.XXXXXX.sqlite3)"
trap 'rm -f "$tmp_db"' EXIT

sqlite3 "$tmp_db" <<'SQL'
CREATE TABLE works (
  id TEXT PRIMARY KEY,
  tags TEXT NOT NULL CHECK(json_valid(tags)),
  updated_at TEXT NOT NULL
);
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  tags TEXT NOT NULL CHECK(json_valid(tags)),
  updated_at TEXT NOT NULL
);

INSERT INTO works VALUES
  ('work-e523479a-a4d4-4bfb-b95b-0fad153ae996', '["legacy:work"]', '2000-01-01'),
  ('unrelated-work', '["legacy:untouched"]', '2000-01-01');
INSERT INTO songs VALUES
  ('song-00335630', '["style:parody"]', '2000-01-01'),
  ('unrelated-song', '["legacy:untouched"]', '2000-01-01');
SQL

sqlite3 "$tmp_db" < migrations/0007_seed_initial_tags.sql
sqlite3 "$tmp_db" < migrations/0007_seed_initial_tags.sql

assert_sql() {
  sql="$1"
  expected="$2"
  label="$3"
  actual="$(sqlite3 "$tmp_db" "$sql")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
}

assert_sql "SELECT tags FROM works WHERE id = 'work-e523479a-a4d4-4bfb-b95b-0fad153ae996';" '["genre:pop","legacy:work"]' 'work tags merge without duplicates'
assert_sql "SELECT tags FROM songs WHERE id = 'song-00335630';" '["language:ja","style:parody"]' 'song tags merge without removing curator tags'
assert_sql "SELECT tags FROM works WHERE id = 'unrelated-work';" '["legacy:untouched"]' 'unrelated work remains unchanged'
assert_sql "SELECT tags FROM songs WHERE id = 'unrelated-song';" '["legacy:untouched"]' 'unrelated song remains unchanged'
assert_sql "SELECT COUNT(*) FROM sqlite_master WHERE name = '_tag_catalog_seed_0007';" '0' 'staging table is removed'
assert_sql 'SELECT COUNT(*) FROM works WHERE NOT json_valid(tags);' '0' 'work tags remain valid JSON'
assert_sql 'SELECT COUNT(*) FROM songs WHERE NOT json_valid(tags);' '0' 'song tags remain valid JSON'
assert_sql 'PRAGMA integrity_check;' 'ok' 'SQLite integrity'
