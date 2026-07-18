-- Create a non-destructive global song catalog.
--
-- works is the cross-streamer composition identity. Existing songs remain
-- streamer-local review/display records and are connected through
-- song_work_links; performances are never rewritten by this migration.
--
-- The migration is intentionally idempotent and is applied directly with:
--   npx wrangler d1 execute oshi-prism-db --remote \
--     --file=migrations/0005_create_global_works.sql

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_artist TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(title, original_artist)
);

CREATE TABLE IF NOT EXISTS work_aliases (
  source_work_id TEXT PRIMARY KEY,
  canonical_work_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_original_artist TEXT NOT NULL,
  source_tags TEXT NOT NULL CHECK(json_valid(source_tags)),
  merged_by TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(source_work_id <> canonical_work_id)
);

CREATE TABLE IF NOT EXISTS song_work_links (
  song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  link_method TEXT NOT NULL CHECK(link_method IN ('migration_exact', 'import_exact', 'manual')),
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_works_title_artist ON works(title, original_artist);
CREATE INDEX IF NOT EXISTS idx_work_aliases_canonical ON work_aliases(canonical_work_id);
CREATE INDEX IF NOT EXISTS idx_song_work_links_work ON song_work_links(work_id);

-- Seed exactly one global work for each byte-for-byte title + original-artist
-- identity. The deterministic ID is based on the smallest existing song ID;
-- the UNIQUE identity constraint remains authoritative if a partial run or a
-- newer Worker already created the work.
INSERT OR IGNORE INTO works (
  id,
  title,
  original_artist,
  tags,
  created_at,
  updated_at
)
WITH ranked_songs AS (
  SELECT
    title,
    original_artist,
    tags,
    MIN(id) OVER identity AS seed_song_id,
    COALESCE(MIN(created_at) OVER identity, datetime('now')) AS first_seen_at,
    COALESCE(MAX(updated_at) OVER identity, datetime('now')) AS last_seen_at,
    ROW_NUMBER() OVER (
      PARTITION BY title, original_artist
      ORDER BY
        CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        created_at ASC,
        id ASC
    ) AS canonical_rank
  FROM songs
  WINDOW identity AS (PARTITION BY title, original_artist)
)
SELECT
  'work-' || seed_song_id,
  title,
  original_artist,
  CASE WHEN json_valid(tags) THEN tags ELSE '[]' END,
  first_seen_at,
  last_seen_at
FROM ranked_songs
WHERE canonical_rank = 1;

-- Link every current song to the exact global identity. Existing manual or
-- import links win because song_id is the primary key and this is OR IGNORE.
INSERT OR IGNORE INTO song_work_links (
  song_id,
  work_id,
  link_method,
  linked_by,
  linked_at,
  updated_at
)
SELECT
  song.id,
  work.id,
  'migration_exact',
  'migration:0005-global-works',
  COALESCE(song.created_at, datetime('now')),
  datetime('now')
FROM songs AS song
JOIN works AS work
  ON work.title = song.title
 AND work.original_artist = song.original_artist;
