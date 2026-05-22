-- Diagnostic: find duplicate songs (same title + artist + streamer)
-- Safe read-only query — run this first to review before cleanup.
--
-- Usage: npx wrangler d1 execute oshi-prism-db --remote --file=admin/find-duplicates.sql

SELECT s.streamer_id, s.title, s.original_artist, COUNT(*) as song_copies,
       GROUP_CONCAT(s.id) as song_ids
FROM songs s
GROUP BY s.streamer_id, LOWER(TRIM(s.title)), LOWER(TRIM(s.original_artist))
HAVING song_copies > 1
ORDER BY song_copies DESC;
