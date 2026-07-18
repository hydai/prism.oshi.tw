#!/bin/sh
set -eu

tmp_db="$(mktemp /tmp/prism-global-works.XXXXXX.sqlite3)"
trap 'rm -f "$tmp_db"' EXIT

sqlite3 "$tmp_db" <<'SQL'
PRAGMA foreign_keys = ON;

CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  original_artist TEXT NOT NULL,
  tags TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE performances (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE
);

INSERT INTO songs VALUES
  ('song-a', 'alice', 'Shared Song', 'Original Artist', '["pop"]', 'approved', '2026-01-01', '2026-01-02'),
  ('song-b', 'bob',   'Shared Song', 'Original Artist', '[]',      'approved', '2026-01-03', '2026-01-04'),
  ('song-c', 'alice', 'Shared Song', 'Other Artist',    '[]',      'approved', '2026-01-05', '2026-01-06'),
  ('song-d', 'alice', 'Shared Song', 'Original Artist', '[]',      'pending',  '2026-01-07', '2026-01-08'),
  ('song-e', 'carol', 'Solo Song',   'Solo Artist',     'invalid', 'rejected', '2026-01-09', '2026-01-10');

INSERT INTO performances VALUES
  ('perf-a', 'song-a'),
  ('perf-b', 'song-b'),
  ('perf-c', 'song-c'),
  ('perf-d', 'song-d');
SQL

before_songs="$(sqlite3 "$tmp_db" 'SELECT COUNT(*) FROM songs;')"
before_performances="$(sqlite3 "$tmp_db" 'SELECT COUNT(*) FROM performances;')"

sqlite3 "$tmp_db" < migrations/0005_create_global_works.sql
sqlite3 "$tmp_db" < migrations/0005_create_global_works.sql

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

assert_sql 'SELECT COUNT(*) FROM songs;' "$before_songs" 'song rows are preserved'
assert_sql 'SELECT COUNT(*) FROM performances;' "$before_performances" 'performance rows are preserved'
assert_sql 'SELECT COUNT(*) FROM works;' '3' 'one work per exact title and artist'
assert_sql 'SELECT COUNT(*) FROM song_work_links;' '5' 'every song is linked'
assert_sql 'SELECT COUNT(*) FROM songs s LEFT JOIN song_work_links l ON l.song_id = s.id WHERE l.song_id IS NULL;' '0' 'no unlinked song'
assert_sql "SELECT COUNT(DISTINCT work_id) FROM song_work_links WHERE song_id IN ('song-a', 'song-b', 'song-d');" '1' 'cross-streamer and local duplicates share one work'
assert_sql "SELECT COUNT(DISTINCT work_id) FROM song_work_links WHERE song_id IN ('song-a', 'song-c');" '2' 'same title with different artists stays separate'
assert_sql "SELECT id FROM works WHERE title = 'Shared Song' AND original_artist = 'Original Artist';" 'work-song-a' 'deterministic seed work ID'
assert_sql "SELECT tags FROM works WHERE id = 'work-song-a';" '["pop"]' 'approved canonical tags seed the work'
assert_sql "SELECT tags FROM works WHERE id = 'work-song-e';" '[]' 'invalid legacy tags fall back to an empty JSON array'
assert_sql 'SELECT COUNT(*) FROM work_aliases;' '0' 'migration does not invent aliases'
assert_sql "WITH work_rollup AS (
  SELECT l.work_id,
         COUNT(DISTINCT s.streamer_id) AS streamer_count,
         COUNT(DISTINCT s.id) AS song_count,
         COUNT(DISTINCT p.id) AS performance_count
  FROM song_work_links l
  JOIN songs s ON s.id = l.song_id
  LEFT JOIN performances p ON p.song_id = s.id
  GROUP BY l.work_id
)
SELECT streamer_count || '|' || song_count || '|' || performance_count
FROM work_rollup
WHERE work_id = 'work-song-a';" '2|3|3' 'global rollup counts streamers, local songs, and performances independently'
assert_sql 'PRAGMA integrity_check;' 'ok' 'SQLite integrity'
assert_sql 'SELECT COUNT(*) FROM pragma_foreign_key_check;' '0' 'foreign keys'

sqlite3 "$tmp_db" "PRAGMA foreign_keys = ON; DELETE FROM songs WHERE id = 'song-d';"
assert_sql "SELECT COUNT(*) FROM song_work_links WHERE song_id = 'song-d';" '0' 'song deletion cascades only its link'
assert_sql "SELECT COUNT(*) FROM works WHERE id = 'work-song-a';" '1' 'global work survives a local song deletion'

# Exercise the same ordered SQL shape used by a title/original-artist edit:
# ensure the destination work, update the local song, then upsert its bridge.
sqlite3 "$tmp_db" <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
INSERT INTO works (id, title, original_artist, tags)
SELECT 'work-edited', COALESCE('Edited Shared Song', song.title),
       COALESCE(NULL, song.original_artist), COALESCE(NULL, song.tags)
FROM songs AS song
WHERE song.id = 'song-b'
ON CONFLICT(title, original_artist) DO NOTHING;

UPDATE songs
SET title = 'Edited Shared Song', updated_at = datetime('now')
WHERE id = 'song-b';

INSERT INTO song_work_links (song_id, work_id, link_method, linked_by)
SELECT song.id, work.id, 'manual', 'test-curator'
FROM songs AS song
JOIN works AS work
  ON work.title = song.title
 AND work.original_artist = song.original_artist
WHERE song.id = 'song-b'
ON CONFLICT(song_id) DO UPDATE SET
  work_id = excluded.work_id,
  link_method = excluded.link_method,
  linked_by = excluded.linked_by,
  updated_at = datetime('now');
COMMIT;
SQL

assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-b';" 'work-edited' 'identity edit repoints the local song to its new global work'
assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-a';" 'work-song-a' 'identity edit does not affect another streamer'
assert_sql "SELECT linked_by FROM song_work_links WHERE song_id = 'song-b';" 'test-curator' 'manual relink is auditable'
assert_sql 'SELECT COUNT(*) FROM pragma_foreign_key_check;' '0' 'foreign keys after identity relink'

echo '✓ global works migration is idempotent and preserves all songs and performances'
