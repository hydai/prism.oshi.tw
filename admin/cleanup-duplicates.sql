-- Cleanup: deduplicate songs and performances created by repeated imports.
-- Scoped to streamer_id = 'seki' only.
-- Uses created_at consistently to pick the canonical (oldest) song.
--
-- Usage: npx wrangler d1 execute oshi-prism-db --remote --file=admin/cleanup-duplicates.sql

-- 1. Reassign performances from duplicate songs to canonical song (oldest created_at per title+artist)
UPDATE performances SET song_id = (
  SELECT s2.id FROM songs s2
  WHERE s2.streamer_id = 'seki'
    AND LOWER(TRIM(s2.title)) = LOWER(TRIM((SELECT title FROM songs WHERE id = performances.song_id)))
    AND LOWER(TRIM(s2.original_artist)) = LOWER(TRIM((SELECT original_artist FROM songs WHERE id = performances.song_id)))
  ORDER BY s2.created_at ASC
  LIMIT 1
)
WHERE song_id IN (SELECT id FROM songs WHERE streamer_id = 'seki')
  AND song_id != (
    SELECT s3.id FROM songs s3
    WHERE s3.streamer_id = 'seki'
      AND LOWER(TRIM(s3.title)) = LOWER(TRIM((SELECT title FROM songs WHERE id = performances.song_id)))
      AND LOWER(TRIM(s3.original_artist)) = LOWER(TRIM((SELECT original_artist FROM songs WHERE id = performances.song_id)))
    ORDER BY s3.created_at ASC
    LIMIT 1
  );

-- 2. Delete duplicate performances (same song + same stream, keep oldest) — seki only
DELETE FROM performances WHERE id IN (
  SELECT p.id FROM performances p
  JOIN songs s ON s.id = p.song_id
  WHERE s.streamer_id = 'seki'
    AND p.id NOT IN (
      SELECT id FROM (
        SELECT p2.id, ROW_NUMBER() OVER (
          PARTITION BY p2.song_id, p2.stream_id ORDER BY p2.created_at ASC
        ) as rn
        FROM performances p2
        JOIN songs s2 ON s2.id = p2.song_id
        WHERE s2.streamer_id = 'seki'
      ) WHERE rn = 1
    )
);

-- 3. Delete orphaned seki songs (no performances left)
DELETE FROM songs WHERE streamer_id = 'seki' AND id NOT IN (
  SELECT DISTINCT song_id FROM performances
);
