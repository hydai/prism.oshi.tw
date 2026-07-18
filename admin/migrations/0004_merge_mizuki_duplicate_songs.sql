-- Merge mizuki song entities that have exactly the same title and original
-- artist. Every performance is repointed; no performance row is deleted.
--
-- Also applies the curator-reviewed correction for -ERROR: the グリリ row is
-- a cover attribution and is merged into the canonical niki song.
--
-- This migration is intentionally idempotent and is applied directly with:
--   npx wrangler d1 execute oshi-prism-db --remote \
--     --file=migrations/0004_merge_mizuki_duplicate_songs.sql

CREATE TABLE IF NOT EXISTS song_aliases (
  source_song_id TEXT PRIMARY KEY,
  canonical_song_id TEXT NOT NULL,
  streamer_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_original_artist TEXT NOT NULL,
  source_status TEXT NOT NULL CHECK(source_status IN ('pending', 'approved', 'rejected', 'excluded', 'extracted')),
  source_tags TEXT NOT NULL CHECK(json_valid(source_tags)),
  source_submitted_by TEXT,
  source_reviewed_by TEXT,
  source_created_at TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(source_song_id <> canonical_song_id)
);

CREATE INDEX IF NOT EXISTS idx_song_aliases_canonical ON song_aliases(canonical_song_id);
CREATE INDEX IF NOT EXISTS idx_song_aliases_streamer ON song_aliases(streamer_id);

-- Freeze the exact-duplicate merge map before any performance is moved. The
-- canonical choice mirrors the Admin UI: approved first, then the row already
-- carrying the most performances, then oldest/stable ID as deterministic ties.
INSERT OR IGNORE INTO song_aliases (
  source_song_id,
  canonical_song_id,
  streamer_id,
  source_title,
  source_original_artist,
  source_status,
  source_tags,
  source_submitted_by,
  source_reviewed_by,
  source_created_at,
  merged_by
)
WITH performance_counts AS (
  SELECT
    s.id,
    s.streamer_id,
    s.title,
    s.original_artist,
    s.tags,
    s.status,
    s.submitted_by,
    s.reviewed_by,
    s.created_at,
    COUNT(p.id) AS performance_count
  FROM songs AS s
  LEFT JOIN performances AS p ON p.song_id = s.id
  WHERE s.streamer_id = 'mizuki' AND s.status = 'approved'
  GROUP BY s.id
),
ranked AS (
  SELECT
    *,
    FIRST_VALUE(id) OVER (
      PARTITION BY title, original_artist
      ORDER BY
        performance_count DESC,
        created_at ASC,
        id ASC
    ) AS canonical_song_id,
    COUNT(*) OVER (PARTITION BY title, original_artist) AS group_size
  FROM performance_counts
)
SELECT
  id,
  canonical_song_id,
  streamer_id,
  title,
  original_artist,
  status,
  tags,
  submitted_by,
  reviewed_by,
  created_at,
  'migration:0004-exact-identity'
FROM ranked
WHERE group_size > 1 AND id <> canonical_song_id;

-- Curator-reviewed metadata correction: グリリ covered -ERROR; niki is the
-- original artist. Preserve the source snapshot before deleting its song row.
INSERT OR IGNORE INTO song_aliases (
  source_song_id,
  canonical_song_id,
  streamer_id,
  source_title,
  source_original_artist,
  source_status,
  source_tags,
  source_submitted_by,
  source_reviewed_by,
  source_created_at,
  merged_by
)
SELECT
  source.id,
  (
    SELECT target.id
    FROM songs AS target
    WHERE target.streamer_id = 'mizuki'
      AND target.title = '-ERROR'
      AND target.original_artist = 'niki'
      AND target.status = 'approved'
    ORDER BY
      (SELECT COUNT(*) FROM performances AS p WHERE p.song_id = target.id) DESC,
      target.created_at ASC,
      target.id ASC
    LIMIT 1
  ),
  source.streamer_id,
  source.title,
  source.original_artist,
  source.status,
  source.tags,
  source.submitted_by,
  source.reviewed_by,
  source.created_at,
  'migration:0004-reviewed-error-artist'
FROM songs AS source
WHERE source.id = 'song-1854'
  AND source.streamer_id = 'mizuki'
  AND source.title = '-ERROR'
  AND source.original_artist = 'グリリ'
  AND EXISTS (
    SELECT 1
    FROM songs AS target
    WHERE target.streamer_id = 'mizuki'
      AND target.title = '-ERROR'
      AND target.original_artist = 'niki'
      AND target.status = 'approved'
  );

UPDATE performances
SET
  song_id = (
    SELECT alias.canonical_song_id
    FROM song_aliases AS alias
    WHERE alias.source_song_id = performances.song_id
  ),
  updated_at = datetime('now')
WHERE streamer_id = 'mizuki'
  AND song_id IN (
    SELECT source_song_id FROM song_aliases WHERE streamer_id = 'mizuki'
  );

DELETE FROM songs
WHERE streamer_id = 'mizuki'
  AND id IN (
    SELECT source_song_id FROM song_aliases WHERE streamer_id = 'mizuki'
  )
  AND NOT EXISTS (
    SELECT 1 FROM performances WHERE performances.song_id = songs.id
  );

CREATE INDEX IF NOT EXISTS idx_songs_streamer_title_artist
  ON songs(streamer_id, title, original_artist);
