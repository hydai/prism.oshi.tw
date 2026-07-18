#!/bin/sh
set -eu

ADMIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/prism-song-merge.XXXXXX")
DB_PATH="$TMP_DIR/test.sqlite3"
trap 'rm -rf "$TMP_DIR"' EXIT

sqlite3 "$DB_PATH" ".read $ADMIN_DIR/schema.sql"
sqlite3 "$DB_PATH" <<'SQL'
INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by, created_at)
VALUES
  ('song-a', 'mizuki', 'Exact Song', 'Artist', '["canonical"]', 'approved', 'seed', '2026-01-01 00:00:00'),
  ('song-b', 'mizuki', 'Exact Song', 'Artist', '["canonical"]', 'approved', 'seed', '2026-01-02 00:00:00'),
  ('song-error', 'mizuki', '-ERROR', 'niki', '[]', 'approved', 'seed', '2026-01-01 00:00:00'),
  ('song-1854', 'mizuki', '-ERROR', 'グリリ', '[]', 'approved', 'seed', '2026-01-02 00:00:00'),
  ('song-collision-a', 'mizuki', 'Collision', 'Artist A', '[]', 'approved', 'seed', '2026-01-01 00:00:00'),
  ('song-collision-b', 'mizuki', 'Collision', 'Artist B', '[]', 'approved', 'seed', '2026-01-02 00:00:00');

INSERT INTO performances (
  id, streamer_id, song_id, stream_id, date, stream_title, video_id,
  timestamp, end_timestamp, status, submitted_by
)
VALUES
  ('p-a-1', 'mizuki', 'song-a', 'stream-repeat', '2026-01-01', 'Repeat Stream', 'video-a', 10, 20, 'approved', 'seed'),
  ('p-a-2', 'mizuki', 'song-a', 'stream-repeat', '2026-01-01', 'Repeat Stream', 'video-a', 30, 40, 'approved', 'seed'),
  ('p-b-1', 'mizuki', 'song-b', 'stream-b', '2026-01-02', 'Other Stream', 'video-b', 50, 60, 'approved', 'seed'),
  ('p-error-1', 'mizuki', 'song-error', 'stream-error-a', '2026-01-03', 'Error A', 'video-c', 70, 80, 'approved', 'seed'),
  ('p-error-2', 'mizuki', 'song-1854', 'stream-error-b', '2026-01-04', 'Error B', 'video-d', 90, 100, 'approved', 'seed');
SQL

sqlite3 "$DB_PATH" ".read $ADMIN_DIR/migrations/0004_merge_mizuki_duplicate_songs.sql"
sqlite3 "$DB_PATH" ".read $ADMIN_DIR/migrations/0004_merge_mizuki_duplicate_songs.sql"

assert_sql() {
  query=$1
  expected=$2
  label=$3
  actual=$(sqlite3 "$DB_PATH" "$query")
  if [ "$actual" != "$expected" ]; then
    echo "$label: expected '$expected', got '$actual'" >&2
    exit 1
  fi
}

assert_sql "SELECT COUNT(*) FROM songs WHERE streamer_id = 'mizuki';" "4" "merged song count"
assert_sql "SELECT COUNT(*) FROM performances WHERE streamer_id = 'mizuki';" "5" "performance count is preserved"
assert_sql "SELECT COUNT(*) FROM performances WHERE song_id = 'song-a';" "3" "exact duplicate performances move to canonical"
assert_sql "SELECT COUNT(*) FROM performances WHERE song_id = 'song-error';" "2" "reviewed -ERROR artist correction merges"
assert_sql "SELECT COUNT(*) FROM performances WHERE song_id = 'song-a' AND stream_id = 'stream-repeat';" "2" "same-stream repeats are preserved"
assert_sql "SELECT COUNT(*) FROM songs WHERE title = 'Collision';" "2" "same title with different artists is not auto-merged"
assert_sql "SELECT COUNT(*) FROM song_aliases;" "2" "one alias snapshot per deleted song"
assert_sql "SELECT canonical_song_id FROM song_aliases WHERE source_song_id = 'song-b';" "song-a" "exact duplicate alias"
assert_sql "SELECT canonical_song_id FROM song_aliases WHERE source_song_id = 'song-1854';" "song-error" "reviewed -ERROR alias"
assert_sql "PRAGMA integrity_check;" "ok" "SQLite integrity"
assert_sql "SELECT COUNT(*) FROM pragma_foreign_key_check;" "0" "foreign keys"

echo "✓ mizuki song merge migration is idempotent and preserves every performance"
