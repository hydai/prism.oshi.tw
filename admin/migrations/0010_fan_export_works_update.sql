-- Shared work tag edits must invalidate every linked approved streamer's
-- fan-site export, including several edits within one second. Requires 0009.
-- Apply against remote D1 (from admin/):
--   npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0010_fan_export_works_update.sql
-- Additive/idempotent; no rows are changed.
CREATE TRIGGER IF NOT EXISTS fan_export_works_update
AFTER UPDATE OF tags ON works
FOR EACH ROW WHEN OLD.tags IS NOT NEW.tags
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT DISTINCT song.streamer_id, 1
  FROM songs AS song JOIN song_work_links AS link ON link.song_id = song.id
  WHERE link.work_id = NEW.id AND song.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;
