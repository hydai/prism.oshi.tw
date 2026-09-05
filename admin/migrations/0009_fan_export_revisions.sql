-- Fan-site export revisions: detect same-second edits and deletions without
-- relying on MAX(updated_at) or counts. Apply before running the new sync tools:
-- cd admin && npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0009_fan_export_revisions.sql
-- Additive/idempotent; no archive rows are changed.
CREATE TABLE IF NOT EXISTS fan_export_revisions (
  streamer_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 0)
);
INSERT OR IGNORE INTO fan_export_revisions (streamer_id, revision)
SELECT streamer_id, 1 FROM songs
UNION SELECT streamer_id, 1 FROM performances
UNION SELECT streamer_id, 1 FROM streams;

CREATE TRIGGER IF NOT EXISTS fan_export_songs_insert
AFTER INSERT ON songs
FOR EACH ROW WHEN NEW.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT NEW.streamer_id, 1 WHERE NEW.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_songs_update
AFTER UPDATE ON songs
FOR EACH ROW WHEN OLD.status = 'approved' OR NEW.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT OLD.streamer_id, 1 WHERE OLD.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT NEW.streamer_id, 1 WHERE NEW.status = 'approved' AND (OLD.status IS NOT 'approved' OR OLD.streamer_id <> NEW.streamer_id)
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_songs_delete
AFTER DELETE ON songs
FOR EACH ROW WHEN OLD.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT OLD.streamer_id, 1 WHERE OLD.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_performances_insert
AFTER INSERT ON performances
FOR EACH ROW WHEN NEW.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT NEW.streamer_id, 1 WHERE NEW.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_performances_update
AFTER UPDATE ON performances
FOR EACH ROW WHEN OLD.status = 'approved' OR NEW.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT OLD.streamer_id, 1 WHERE OLD.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT NEW.streamer_id, 1 WHERE NEW.status = 'approved' AND (OLD.status IS NOT 'approved' OR OLD.streamer_id <> NEW.streamer_id)
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_performances_delete
AFTER DELETE ON performances
FOR EACH ROW WHEN OLD.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT OLD.streamer_id, 1 WHERE OLD.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_streams_insert
AFTER INSERT ON streams
FOR EACH ROW WHEN NEW.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT NEW.streamer_id, 1 WHERE NEW.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_streams_update
AFTER UPDATE ON streams
FOR EACH ROW WHEN OLD.status = 'approved' OR NEW.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT OLD.streamer_id, 1 WHERE OLD.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT NEW.streamer_id, 1 WHERE NEW.status = 'approved' AND (OLD.status IS NOT 'approved' OR OLD.streamer_id <> NEW.streamer_id)
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_streams_delete
AFTER DELETE ON streams
FOR EACH ROW WHEN OLD.status = 'approved'
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT OLD.streamer_id, 1 WHERE OLD.status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_links_insert
AFTER INSERT ON song_work_links
FOR EACH ROW
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT DISTINCT streamer_id, 1 FROM songs WHERE id IN (NEW.song_id) AND status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_links_update
AFTER UPDATE ON song_work_links
FOR EACH ROW
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT DISTINCT streamer_id, 1 FROM songs WHERE id IN (OLD.song_id, NEW.song_id) AND status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS fan_export_links_delete
AFTER DELETE ON song_work_links
FOR EACH ROW
BEGIN
  INSERT INTO fan_export_revisions (streamer_id, revision)
  SELECT DISTINCT streamer_id, 1 FROM songs WHERE id IN (OLD.song_id) AND status = 'approved'
  ON CONFLICT(streamer_id) DO UPDATE SET revision = revision + 1;
END;
