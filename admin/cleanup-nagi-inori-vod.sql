-- Cleanup: remove the inori VOD (ODikksIsYEc, 2026-05-17 感冒歌回) that was
-- wrongly approved into nagi's archive. inori's legitimate copy
-- (stream-02c40ac6) is untouched.
-- Scoped to streamer_id = 'nagi' AND stream_id = 'stream-2026-05-17' only.
--
-- Pre-flight verified (2026-06-04): 20 orphan songs, 20 approved performances,
-- 1 excluded stream row. The matching Nova inbox row (vod-8ec08f66 in
-- oshi-prism-nova) is deleted separately — different database.
--
-- Usage: npx wrangler d1 execute oshi-prism-db --remote --file=cleanup-nagi-inori-vod.sql

-- 1. Delete nagi songs whose only performances are in the polluted stream
--    (performances.song_id has ON DELETE CASCADE, so their performances go too)
DELETE FROM songs WHERE streamer_id = 'nagi' AND id IN (
  SELECT p.song_id FROM performances p
  WHERE p.stream_id = 'stream-2026-05-17'
    AND (SELECT COUNT(*) FROM performances p2 WHERE p2.song_id = p.song_id) = 1
);

-- 2. Defensive: delete any remaining performances for the polluted stream
DELETE FROM performances WHERE streamer_id = 'nagi' AND stream_id = 'stream-2026-05-17';

-- 3. Delete the polluted stream row itself
DELETE FROM streams WHERE id = 'stream-2026-05-17' AND streamer_id = 'nagi';
