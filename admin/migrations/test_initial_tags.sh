#!/bin/sh
set -eu

tmp_db="$(mktemp /tmp/prism-initial-tags.XXXXXX.sqlite3)"
trap 'rm -f "$tmp_db" "$tmp_db.retry.sql"' EXIT

sqlite3 "$tmp_db" <<'SQL'
CREATE TABLE works (
  id TEXT PRIMARY KEY,
  tags TEXT NOT NULL CHECK(json_valid(tags)),
  updated_at TEXT NOT NULL
);
-- Mirrors admin/schema.sql: songs.tags is nullable and carries no json_valid
-- CHECK, so the migration must tolerate NULL and malformed rows.
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  tags TEXT DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE TABLE performances (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE song_work_links (
  song_id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL
);

INSERT INTO works VALUES
  ('work-e523479a-a4d4-4bfb-b95b-0fad153ae996', '["legacy:work","language:zh"]', '2000-01-01'),
  ('work-song-2072', '[]', '2000-01-01'),
  ('work-leaked', '["language:ko","legacy:work-leak"]', '2000-01-01'),
  ('work-noperf', '["language:ko","legacy:work-noperf"]', '2000-01-01'),
  ('unrelated-work', '["legacy:untouched"]', '2000-01-01');
INSERT INTO songs VALUES
  ('song-2072', '["language:ja","style:parody","legacy:song"]', '2000-01-01'),
  ('song-work-leak', '[]', '2000-01-01'),
  ('song-noperf', '["language:ja","style:duet","legacy:song-noperf"]', '2000-01-01'),
  ('song-bad-json', 'not json at all', '2000-01-01'),
  ('song-null-tags', NULL, '2000-01-01'),
  ('unrelated-song', '["legacy:untouched"]', '2000-01-01');
INSERT INTO performances VALUES
  ('p2072-1', 'song-2072', '2000-01-01'),
  ('p-legacy-copy', 'song-2072', '2000-01-01'),
  ('p-work-leak', 'song-work-leak', '2000-01-01'),
  ('p-bad-json', 'song-bad-json', '2000-01-01'),
  ('p-null-tags', 'song-null-tags', '2000-01-01'),
  ('p-unrelated', 'unrelated-song', '2000-01-01');
INSERT INTO song_work_links VALUES
  ('song-2072', 'work-song-2072'),
  ('song-work-leak', 'work-leaked'),
  ('song-noperf', 'work-noperf');
SQL

sqlite3 "$tmp_db" < migrations/0007_add_performance_tags.sql

# An interrupted rollout is retried by skipping the one-shot ALTER and re-running
# the remainder, so everything below it must be re-runnable.
sed '/^ALTER TABLE performances$/,/^  ADD COLUMN tags .*;$/d' \
  migrations/0007_add_performance_tags.sql > "$tmp_db.retry.sql"
if grep -q '^ *ADD COLUMN' "$tmp_db.retry.sql"; then
  echo 'FAIL: could not strip the ALTER statement for the retry check' >&2
  exit 1
fi
sqlite3 "$tmp_db" < "$tmp_db.retry.sql"

sqlite3 "$tmp_db" < migrations/0008_seed_initial_tags.sql
sqlite3 "$tmp_db" < migrations/0008_seed_initial_tags.sql

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

# This work has no linked song, so its language:zh has no performance to move to
# and is kept rather than deleted; TagPicker surfaces it for the curator to clear.
assert_sql "SELECT tags FROM works WHERE id = 'work-e523479a-a4d4-4bfb-b95b-0fad153ae996';" '["genre:pop","language:zh","legacy:work"]' 'work tags merge without duplicates'
assert_sql "SELECT tags FROM songs WHERE id = 'song-2072';" '["legacy:song"]' 'rendition tags are removed from the legacy song layer'
assert_sql "SELECT tags FROM performances WHERE id = 'p2072-1';" '["language:en","language:ja","style:parody"]' 'generated bilingual tags merge onto the concrete performance'
assert_sql "SELECT tags FROM performances WHERE id = 'p-legacy-copy';" '["language:ja","style:parody"]' 'existing song rendition tags are copied to every linked performance'
assert_sql "SELECT tags FROM performances WHERE id = 'p-work-leak';" '["language:ko"]' 'leaked global rendition tags move down to linked performances'
assert_sql "SELECT tags FROM works WHERE id = 'work-leaked';" '["legacy:work-leak"]' 'leaked global rendition tags are removed from the work'
assert_sql "SELECT tags FROM works WHERE id = 'unrelated-work';" '["legacy:untouched"]' 'unrelated work remains unchanged'
assert_sql "SELECT tags FROM songs WHERE id = 'unrelated-song';" '["legacy:untouched"]' 'unrelated song remains unchanged'
assert_sql "SELECT tags FROM performances WHERE id = 'p-unrelated';" '[]' 'unrelated performance remains untagged'

# A song with no performance row has nowhere to move its rendition tags to, so
# stripping them would destroy them outright.
assert_sql "SELECT tags FROM songs WHERE id = 'song-noperf';" '["language:ja","style:duet","legacy:song-noperf"]' 'rendition tags survive on a song with no performance to receive them'
assert_sql "SELECT tags FROM works WHERE id = 'work-noperf';" '["language:ko","legacy:work-noperf"]' 'rendition tags survive on a work with no performance to receive them'

# songs.tags is nullable and unchecked in production; neither shape may abort the run.
assert_sql "SELECT tags FROM songs WHERE id = 'song-bad-json';" 'not json at all' 'malformed song tags are left untouched'
assert_sql "SELECT tags FROM performances WHERE id = 'p-bad-json';" '[]' 'a performance under malformed song tags stays untagged'
assert_sql "SELECT COALESCE(tags, 'NULL') FROM songs WHERE id = 'song-null-tags';" 'NULL' 'null song tags are left untouched'
assert_sql "SELECT tags FROM performances WHERE id = 'p-null-tags';" '[]' 'a performance under null song tags stays untagged'
assert_sql "SELECT COUNT(*) FROM sqlite_master WHERE name = '_performance_tag_ids_0007';" '0' 'scope migration staging table is removed'
assert_sql "SELECT COUNT(*) FROM sqlite_master WHERE name = '_tag_catalog_seed_0008';" '0' 'catalog staging table is removed'
assert_sql 'SELECT COUNT(*) FROM works WHERE NOT json_valid(tags);' '0' 'work tags remain valid JSON'
assert_sql "SELECT COUNT(*) FROM songs WHERE NOT json_valid(tags) AND id <> 'song-bad-json';" '0' 'song tags remain valid JSON'
assert_sql 'SELECT COUNT(*) FROM performances WHERE NOT json_valid(tags);' '0' 'performance tags remain valid JSON'
assert_sql 'PRAGMA integrity_check;' 'ok' 'SQLite integrity'
