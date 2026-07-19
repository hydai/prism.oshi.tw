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

-- Repair identities recreated by an older reapplication of this migration.
-- Only migration-owned links are repointed automatically; manual/import links
-- remain curator-controlled. Once those links move, remove only unreferenced
-- duplicates that are not themselves the canonical target of another alias.
UPDATE song_work_links
SET work_id = (
      SELECT alias.canonical_work_id
      FROM works AS linked_work
      JOIN work_aliases AS alias
        ON alias.source_title = linked_work.title
       AND alias.source_original_artist = linked_work.original_artist
      JOIN works AS canonical_work
        ON canonical_work.id = alias.canonical_work_id
      WHERE linked_work.id = song_work_links.work_id
        AND linked_work.id <> alias.canonical_work_id
      ORDER BY alias.merged_at DESC, alias.source_work_id DESC
      LIMIT 1
    ),
    linked_by = 'migration:0005-global-works',
    updated_at = datetime('now')
WHERE link_method = 'migration_exact'
  AND EXISTS (
    SELECT 1
    FROM works AS linked_work
    JOIN work_aliases AS alias
      ON alias.source_title = linked_work.title
     AND alias.source_original_artist = linked_work.original_artist
    JOIN works AS canonical_work
      ON canonical_work.id = alias.canonical_work_id
    WHERE linked_work.id = song_work_links.work_id
      AND linked_work.id <> alias.canonical_work_id
  );

DELETE FROM works
WHERE NOT EXISTS (
    SELECT 1
    FROM song_work_links AS link
    WHERE link.work_id = works.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM work_aliases AS canonical_alias
    WHERE canonical_alias.canonical_work_id = works.id
  )
  AND EXISTS (
    SELECT 1
    FROM work_aliases AS retired_alias
    JOIN works AS canonical_work
      ON canonical_work.id = retired_alias.canonical_work_id
    WHERE retired_alias.source_title = works.title
      AND retired_alias.source_original_artist = works.original_artist
      AND retired_alias.canonical_work_id <> works.id
  );

-- Seed exactly one global work for each byte-for-byte title + original-artist
-- identity. The deterministic ID is based on the smallest existing song ID;
-- the UNIQUE identity constraint remains authoritative if a partial run or a
-- newer Worker already created the work. Historical aliases remain retired.
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
WHERE canonical_rank = 1
  AND NOT EXISTS (
    SELECT 1
    FROM work_aliases AS alias
    JOIN works AS canonical_work
      ON canonical_work.id = alias.canonical_work_id
    WHERE alias.source_title = ranked_songs.title
      AND alias.source_original_artist = ranked_songs.original_artist
  );

-- Link every current song to its active global identity. A retired exact
-- title/artist resolves through work_aliases before considering an active
-- exact work. Existing manual or import links still win because song_id is the
-- primary key and this is OR IGNORE.
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
  resolved_work.id,
  'migration_exact',
  'migration:0005-global-works',
  COALESCE(song.created_at, datetime('now')),
  datetime('now')
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
  );
