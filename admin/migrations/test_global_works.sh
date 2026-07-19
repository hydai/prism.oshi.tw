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
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE performances (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE
);

INSERT INTO songs VALUES
  ('song-a', 'alice', 'Shared Song', 'Original Artist', '["pop"]', 'approved', NULL, '2026-01-01', '2026-01-02'),
  ('song-b', 'bob',   'Shared Song', 'Original Artist', '[]',      'approved', NULL, '2026-01-03', '2026-01-04'),
  ('song-c', 'alice', 'Shared Song', 'Other Artist',    '[]',      'approved', NULL, '2026-01-05', '2026-01-06'),
  ('song-d', 'alice', 'Shared Song', 'Original Artist', '[]',      'pending',  NULL, '2026-01-07', '2026-01-08'),
  ('song-e', 'carol', 'Solo Song',   'Solo Artist',     'invalid', 'rejected', NULL, '2026-01-09', '2026-01-10');

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

# Once a work identity is retired, exact imports and identity edits must resolve
# its historical title/artist through work_aliases instead of recreating it.
sqlite3 "$tmp_db" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO works (id, title, original_artist, tags)
VALUES ('work-retired', 'Retired Title', 'Retired Artist', '[]');
INSERT INTO work_aliases (
  source_work_id, canonical_work_id, source_title,
  source_original_artist, source_tags, merged_by
)
VALUES (
  'work-retired', 'work-song-a', 'Retired Title',
  'Retired Artist', '[]', 'test-curator'
);
DELETE FROM works WHERE id = 'work-retired';

BEGIN;
INSERT INTO works (id, title, original_artist, tags)
SELECT 'work-import-candidate', 'Retired Title', 'Retired Artist', '[]'
WHERE NOT EXISTS (
  SELECT 1
  FROM work_aliases AS alias
  JOIN works AS canonical_work
    ON canonical_work.id = alias.canonical_work_id
  WHERE alias.source_title = 'Retired Title'
    AND alias.source_original_artist = 'Retired Artist'
)
ON CONFLICT(title, original_artist) DO NOTHING;

INSERT INTO songs (
  id, streamer_id, title, original_artist, tags, status,
  created_at, updated_at
)
VALUES (
  'song-retired-import', 'dave', 'Retired Title', 'Retired Artist',
  '[]', 'pending', datetime('now'), datetime('now')
);

INSERT OR IGNORE INTO song_work_links (
  song_id, work_id, link_method, linked_by
)
SELECT 'song-retired-import', resolved.work_id, 'import_exact', 'test-import'
FROM (
  SELECT alias.canonical_work_id AS work_id, 0 AS resolution_order
  FROM work_aliases AS alias
  JOIN works AS canonical_work
    ON canonical_work.id = alias.canonical_work_id
  WHERE alias.source_title = 'Retired Title'
    AND alias.source_original_artist = 'Retired Artist'

  UNION ALL

  SELECT work.id AS work_id, 1 AS resolution_order
  FROM works AS work
  WHERE work.title = 'Retired Title'
    AND work.original_artist = 'Retired Artist'

  ORDER BY resolution_order
  LIMIT 1
) AS resolved;
COMMIT;
SQL

assert_sql "SELECT COUNT(*) FROM works WHERE title = 'Retired Title' AND original_artist = 'Retired Artist';" '0' 'exact import does not recreate a retired identity'
assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-retired-import';" 'work-song-a' 'exact import resolves a retired identity to canonical work'

# Reapplying the global-work migration after a merge must not seed the retired
# title/artist again. An unlinked legacy song must resolve through the alias.
sqlite3 "$tmp_db" "PRAGMA foreign_keys = ON; DELETE FROM song_work_links WHERE song_id = 'song-retired-import';"
sqlite3 "$tmp_db" < migrations/0005_create_global_works.sql
assert_sql "SELECT COUNT(*) FROM works WHERE title = 'Retired Title' AND original_artist = 'Retired Artist';" '0' 'migration reseed excludes retired identities'
assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-retired-import';" 'work-song-a' 'migration reseed resolves retired identities to canonical work'

# Repair the exact shape an older migration reapplication could have left:
# a recreated work plus a migration-owned bridge to that duplicate.
sqlite3 "$tmp_db" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO works (id, title, original_artist, tags)
VALUES ('work-reseeded-retired', 'Retired Title', 'Retired Artist', '[]');
UPDATE song_work_links
SET work_id = 'work-reseeded-retired',
    link_method = 'migration_exact',
    linked_by = 'migration:0005-global-works',
    updated_at = datetime('now')
WHERE song_id = 'song-retired-import';
SQL
sqlite3 "$tmp_db" < migrations/0005_create_global_works.sql
assert_sql "SELECT COUNT(*) FROM works WHERE id = 'work-reseeded-retired';" '0' 'migration removes an orphaned reseeded work'
assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-retired-import';" 'work-song-a' 'migration repairs a legacy reseeded bridge'

sqlite3 "$tmp_db" <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
INSERT INTO works (id, title, original_artist, tags)
SELECT 'work-edit-candidate', identity.title,
       identity.original_artist, identity.tags
FROM (
  SELECT COALESCE('Retired Title', song.title) AS title,
         COALESCE('Retired Artist', song.original_artist) AS original_artist,
         COALESCE(NULL, song.tags) AS tags
  FROM songs AS song
  WHERE song.id = 'song-c'
) AS identity
WHERE NOT EXISTS (
  SELECT 1
  FROM work_aliases AS alias
  JOIN works AS canonical_work
    ON canonical_work.id = alias.canonical_work_id
  WHERE alias.source_title = identity.title
    AND alias.source_original_artist = identity.original_artist
)
ON CONFLICT(title, original_artist) DO NOTHING;

UPDATE songs
SET title = 'Retired Title', original_artist = 'Retired Artist',
    updated_at = datetime('now')
WHERE id = 'song-c';

INSERT INTO song_work_links (song_id, work_id, link_method, linked_by)
SELECT song.id, resolved_work.id, 'manual', 'test-curator'
FROM songs AS song
JOIN works AS resolved_work
  ON resolved_work.id = COALESCE(
    (
      SELECT alias.canonical_work_id
      FROM work_aliases AS alias
      JOIN works AS canonical_work
        ON canonical_work.id = alias.canonical_work_id
      WHERE alias.source_title = song.title
        AND alias.source_original_artist = song.original_artist
      ORDER BY alias.merged_at DESC, alias.source_work_id DESC
      LIMIT 1
    ),
    (
      SELECT work.id
      FROM works AS work
      WHERE work.title = song.title
        AND work.original_artist = song.original_artist
      LIMIT 1
    )
  )
WHERE song.id = 'song-c'
ON CONFLICT(song_id) DO UPDATE SET
  work_id = excluded.work_id,
  link_method = excluded.link_method,
  linked_by = excluded.linked_by,
  updated_at = datetime('now');
COMMIT;
SQL

assert_sql "SELECT COUNT(*) FROM works WHERE title = 'Retired Title' AND original_artist = 'Retired Artist';" '0' 'identity edit does not recreate a retired identity'
assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-c';" 'work-song-a' 'identity edit resolves a retired identity to canonical work'
assert_sql 'PRAGMA integrity_check;' 'ok' 'SQLite integrity after retired identity resolution'
assert_sql 'SELECT COUNT(*) FROM pragma_foreign_key_check;' '0' 'foreign keys after retired identity resolution'

# Exercise the transaction-local guard shape used by Harmonizer merges. Stale
# reviewed song or work metadata must leave every guarded mutation as a no-op;
# a current reviewed state must keep authorizing later statements even after
# the bridge itself changes.
sqlite3 "$tmp_db" <<'SQL'
PRAGMA foreign_keys = ON;
INSERT INTO works (id, title, original_artist, tags)
VALUES ('work-guard-source', 'Guard Source', 'Guard Artist', '[]');
INSERT INTO songs (
  id, streamer_id, title, original_artist, tags, status,
  reviewed_by, created_at, updated_at
)
VALUES (
  'song-guard-source', 'alice', 'Guard Source', 'Guard Artist',
  '[]', 'approved', 'guard-reviewer', datetime('now'), datetime('now')
);
INSERT INTO song_work_links (song_id, work_id, link_method, linked_by)
VALUES ('song-guard-source', 'work-guard-source', 'manual', 'test-curator');
SQL

# The links and global work tags are still current, but the reviewed local tags
# no longer match. No canonical update or source deletion may be authorized.
sqlite3 "$tmp_db" >/dev/null <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
WITH expected_links(song_id, work_id) AS (
  SELECT key, value
  FROM json_each('{"song-a":"work-song-a","song-guard-source":"work-guard-source"}')
),
expected_song_state(
  song_id, title, original_artist, tags, status, reviewed_by
) AS (
  SELECT key,
         json_extract(value, '$.title'),
         json_extract(value, '$.originalArtist'),
         json_extract(value, '$.tags'),
         json_extract(value, '$.status'),
         json_extract(value, '$.reviewedBy')
  FROM json_each('{"song-a":{"title":"Shared Song","originalArtist":"Original Artist","tags":"[\"pop\"]","status":"approved","reviewedBy":null},"song-guard-source":{"title":"Guard Source","originalArtist":"Guard Artist","tags":"[\"stale\"]","status":"approved","reviewedBy":"guard-reviewer"}}')
),
expected_work_state(work_id, tags) AS (
  SELECT key, value
  FROM json_each('{"work-song-a":"[\"pop\"]","work-guard-source":"[]"}')
),
merge_guard(valid) AS (
  SELECT COUNT(*) = (SELECT COUNT(*) FROM expected_links)
     AND (
       SELECT COUNT(*)
       FROM expected_work_state AS expected_work
       JOIN works AS guarded_state
         ON guarded_state.id = expected_work.work_id
        AND guarded_state.tags = expected_work.tags
     ) = (SELECT COUNT(*) FROM expected_work_state)
  FROM expected_links AS expected
  JOIN expected_song_state AS expected_song
    ON expected_song.song_id = expected.song_id
  JOIN songs AS guarded_song
    ON guarded_song.id = expected.song_id
   AND guarded_song.streamer_id = 'alice'
   AND guarded_song.title = expected_song.title
   AND guarded_song.original_artist = expected_song.original_artist
   AND guarded_song.tags = expected_song.tags
   AND guarded_song.status = expected_song.status
   AND guarded_song.reviewed_by IS expected_song.reviewed_by
  JOIN song_work_links AS guarded_link
    ON guarded_link.song_id = expected.song_id
   AND guarded_link.work_id = expected.work_id
  JOIN works AS guarded_work
    ON guarded_work.id = expected.work_id
)
INSERT INTO work_aliases (
  source_work_id, canonical_work_id, source_title,
  source_original_artist, source_tags, merged_by
)
SELECT 'merge-guard-stale-song-source', 'merge-guard-stale-song-canonical',
       '__merge_guard__', '__merge_guard__', '[]',
       'system:harmonizer-merge-guard'
FROM merge_guard
WHERE valid
RETURNING 1 AS valid;

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1
    FROM work_aliases
    WHERE source_work_id = 'merge-guard-stale-song-source'
      AND canonical_work_id = 'merge-guard-stale-song-canonical'
      AND merged_by = 'system:harmonizer-merge-guard'
  )
)
UPDATE songs
SET tags = '["should-not-apply"]'
WHERE id = 'song-a'
  AND (SELECT valid FROM merge_guard);

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1
    FROM work_aliases
    WHERE source_work_id = 'merge-guard-stale-song-source'
      AND canonical_work_id = 'merge-guard-stale-song-canonical'
      AND merged_by = 'system:harmonizer-merge-guard'
  )
)
DELETE FROM songs
WHERE id = 'song-guard-source'
  AND (SELECT valid FROM merge_guard);

DELETE FROM work_aliases
WHERE source_work_id = 'merge-guard-stale-song-source'
  AND canonical_work_id = 'merge-guard-stale-song-canonical'
  AND merged_by = 'system:harmonizer-merge-guard';
COMMIT;
SQL

assert_sql "SELECT tags FROM songs WHERE id = 'song-a';" '["pop"]' 'stale song metadata blocks canonical overwrite'
assert_sql "SELECT COUNT(*) FROM songs WHERE id = 'song-guard-source';" '1' 'stale song metadata blocks source deletion'

sqlite3 "$tmp_db" >/dev/null <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
WITH expected_links(song_id, work_id) AS (
  SELECT key, value
  FROM json_each('{"song-a":"work-song-a","song-guard-source":"work-guard-source"}')
),
expected_song_state(
  song_id, title, original_artist, tags, status, reviewed_by
) AS (
  SELECT key,
         json_extract(value, '$.title'),
         json_extract(value, '$.originalArtist'),
         json_extract(value, '$.tags'),
         json_extract(value, '$.status'),
         json_extract(value, '$.reviewedBy')
  FROM json_each('{"song-a":{"title":"Shared Song","originalArtist":"Original Artist","tags":"[\"pop\"]","status":"approved","reviewedBy":null},"song-guard-source":{"title":"Guard Source","originalArtist":"Guard Artist","tags":"[]","status":"approved","reviewedBy":"guard-reviewer"}}')
),
expected_work_state(work_id, tags) AS (
  SELECT key, value
  FROM json_each('{"work-song-a":"[\"stale\"]","work-guard-source":"[]"}')
),
merge_guard(valid) AS (
  SELECT COUNT(*) = (SELECT COUNT(*) FROM expected_links)
     AND (
       SELECT COUNT(*)
       FROM expected_work_state AS expected_work
       JOIN works AS guarded_state
         ON guarded_state.id = expected_work.work_id
        AND guarded_state.tags = expected_work.tags
     ) = (SELECT COUNT(*) FROM expected_work_state)
  FROM expected_links AS expected
  JOIN expected_song_state AS expected_song
    ON expected_song.song_id = expected.song_id
  JOIN songs AS guarded_song
    ON guarded_song.id = expected.song_id
   AND guarded_song.streamer_id = 'alice'
   AND guarded_song.title = expected_song.title
   AND guarded_song.original_artist = expected_song.original_artist
   AND guarded_song.tags = expected_song.tags
   AND guarded_song.status = expected_song.status
   AND guarded_song.reviewed_by IS expected_song.reviewed_by
  JOIN song_work_links AS guarded_link
    ON guarded_link.song_id = expected.song_id
   AND guarded_link.work_id = expected.work_id
  JOIN works AS guarded_work
    ON guarded_work.id = expected.work_id
)
INSERT INTO work_aliases (
  source_work_id, canonical_work_id, source_title,
  source_original_artist, source_tags, merged_by
)
SELECT 'merge-guard-stale-source', 'merge-guard-stale-canonical',
       '__merge_guard__', '__merge_guard__', '[]',
       'system:harmonizer-merge-guard'
FROM merge_guard
WHERE valid
RETURNING 1 AS valid;

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1
    FROM work_aliases
    WHERE source_work_id = 'merge-guard-stale-source'
      AND canonical_work_id = 'merge-guard-stale-canonical'
      AND merged_by = 'system:harmonizer-merge-guard'
  )
)
UPDATE song_work_links
SET work_id = 'work-song-a'
WHERE work_id = 'work-guard-source'
  AND (SELECT valid FROM merge_guard);

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1
    FROM work_aliases
    WHERE source_work_id = 'merge-guard-stale-source'
      AND canonical_work_id = 'merge-guard-stale-canonical'
      AND merged_by = 'system:harmonizer-merge-guard'
  )
)
DELETE FROM works
WHERE id = 'work-guard-source'
  AND (SELECT valid FROM merge_guard);

DELETE FROM work_aliases
WHERE source_work_id = 'merge-guard-stale-source'
  AND canonical_work_id = 'merge-guard-stale-canonical'
  AND merged_by = 'system:harmonizer-merge-guard';
COMMIT;
SQL

assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-guard-source';" 'work-guard-source' 'stale work metadata blocks bridge mutation'
assert_sql "SELECT COUNT(*) FROM works WHERE id = 'work-guard-source';" '1' 'stale work metadata blocks work deletion'

sqlite3 "$tmp_db" >/dev/null <<'SQL'
PRAGMA foreign_keys = ON;
BEGIN;
WITH expected_links(song_id, work_id) AS (
  SELECT key, value
  FROM json_each('{"song-a":"work-song-a","song-guard-source":"work-guard-source"}')
),
expected_song_state(
  song_id, title, original_artist, tags, status, reviewed_by
) AS (
  SELECT key,
         json_extract(value, '$.title'),
         json_extract(value, '$.originalArtist'),
         json_extract(value, '$.tags'),
         json_extract(value, '$.status'),
         json_extract(value, '$.reviewedBy')
  FROM json_each('{"song-a":{"title":"Shared Song","originalArtist":"Original Artist","tags":"[\"pop\"]","status":"approved","reviewedBy":null},"song-guard-source":{"title":"Guard Source","originalArtist":"Guard Artist","tags":"[]","status":"approved","reviewedBy":"guard-reviewer"}}')
),
expected_work_state(work_id, tags) AS (
  SELECT key, value
  FROM json_each('{"work-song-a":"[\"pop\"]","work-guard-source":"[]"}')
),
merge_guard(valid) AS (
  SELECT COUNT(*) = (SELECT COUNT(*) FROM expected_links)
     AND (
       SELECT COUNT(*)
       FROM expected_work_state AS expected_work
       JOIN works AS guarded_state
         ON guarded_state.id = expected_work.work_id
        AND guarded_state.tags = expected_work.tags
     ) = (SELECT COUNT(*) FROM expected_work_state)
  FROM expected_links AS expected
  JOIN expected_song_state AS expected_song
    ON expected_song.song_id = expected.song_id
  JOIN songs AS guarded_song
    ON guarded_song.id = expected.song_id
   AND guarded_song.streamer_id = 'alice'
   AND guarded_song.title = expected_song.title
   AND guarded_song.original_artist = expected_song.original_artist
   AND guarded_song.tags = expected_song.tags
   AND guarded_song.status = expected_song.status
   AND guarded_song.reviewed_by IS expected_song.reviewed_by
  JOIN song_work_links AS guarded_link
    ON guarded_link.song_id = expected.song_id
   AND guarded_link.work_id = expected.work_id
  JOIN works AS guarded_work
    ON guarded_work.id = expected.work_id
)
INSERT INTO work_aliases (
  source_work_id, canonical_work_id, source_title,
  source_original_artist, source_tags, merged_by
)
SELECT 'merge-guard-valid-source', 'merge-guard-valid-canonical',
       '__merge_guard__', '__merge_guard__', '[]',
       'system:harmonizer-merge-guard'
FROM merge_guard
WHERE valid
RETURNING 1 AS valid;

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1
    FROM work_aliases
    WHERE source_work_id = 'merge-guard-valid-source'
      AND canonical_work_id = 'merge-guard-valid-canonical'
      AND merged_by = 'system:harmonizer-merge-guard'
  )
)
UPDATE song_work_links
SET work_id = 'work-song-a'
WHERE work_id = 'work-guard-source'
  AND (SELECT valid FROM merge_guard);

WITH merge_guard(valid) AS (
  SELECT EXISTS (
    SELECT 1
    FROM work_aliases
    WHERE source_work_id = 'merge-guard-valid-source'
      AND canonical_work_id = 'merge-guard-valid-canonical'
      AND merged_by = 'system:harmonizer-merge-guard'
  )
)
DELETE FROM works
WHERE id = 'work-guard-source'
  AND (SELECT valid FROM merge_guard);

DELETE FROM work_aliases
WHERE source_work_id = 'merge-guard-valid-source'
  AND canonical_work_id = 'merge-guard-valid-canonical'
  AND merged_by = 'system:harmonizer-merge-guard';
COMMIT;
SQL

assert_sql "SELECT work_id FROM song_work_links WHERE song_id = 'song-guard-source';" 'work-song-a' 'valid transaction guard survives its own bridge mutation'
assert_sql "SELECT COUNT(*) FROM works WHERE id = 'work-guard-source';" '0' 'valid transaction guard authorizes source work deletion'
assert_sql "SELECT COUNT(*) FROM work_aliases WHERE merged_by = 'system:harmonizer-merge-guard';" '0' 'transaction guard leaves no persistent alias row'
assert_sql 'PRAGMA integrity_check;' 'ok' 'SQLite integrity after transaction guard'
assert_sql 'SELECT COUNT(*) FROM pragma_foreign_key_check;' '0' 'foreign keys after transaction guard'

echo '✓ global works migration is idempotent and preserves all songs and performances'
