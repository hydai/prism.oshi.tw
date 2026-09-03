CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  youtube_channel_url TEXT NOT NULL,
  youtube_channel_url_normalized TEXT DEFAULT '',
  youtube_channel_id TEXT DEFAULT '',
  youtube_channel_verified_id TEXT,
  youtube_channel_verified_at TEXT,
  slug TEXT NOT NULL,
  brand_name TEXT DEFAULT '',
  display_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  subscriber_count TEXT DEFAULT '',
  link_youtube TEXT DEFAULT '',
  link_twitter TEXT DEFAULT '',
  link_facebook TEXT DEFAULT '',
  link_instagram TEXT DEFAULT '',
  link_twitch TEXT DEFAULT '',
  "group" TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 999,
  theme_json TEXT DEFAULT '',
  external_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewer_note TEXT DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_channel_url_normalized
  ON submissions(youtube_channel_url_normalized);
CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions(status);

-- VOD Submissions
CREATE TABLE IF NOT EXISTS vod_submissions (
  id TEXT PRIMARY KEY,
  streamer_slug TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  stream_title TEXT DEFAULT '',
  stream_date TEXT DEFAULT '',
  thumbnail_url TEXT DEFAULT '',
  submitter_note TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  submitted_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewer_note TEXT DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vod_streamer_video
  ON vod_submissions(streamer_slug, video_id);
CREATE INDEX IF NOT EXISTS idx_vod_status ON vod_submissions(status);

CREATE TABLE IF NOT EXISTS vod_songs (
  id TEXT PRIMARY KEY,
  vod_submission_id TEXT NOT NULL REFERENCES vod_submissions(id) ON DELETE CASCADE,
  song_title TEXT NOT NULL,
  original_artist TEXT DEFAULT '',
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_vod_songs_sub ON vod_songs(vod_submission_id);

-- Official YouTube verification must be all-or-nothing and must match the
-- current channel ID exactly. Existing databases receive these columns and
-- guards through migrations/0014_add_vod_export_state.sql.
CREATE TRIGGER IF NOT EXISTS vod_export_submissions_verification_insert_guard
BEFORE INSERT ON submissions
FOR EACH ROW
WHEN
  (NEW.youtube_channel_verified_id IS NULL)
    <> (NEW.youtube_channel_verified_at IS NULL)
  OR (
    NEW.youtube_channel_verified_id IS NOT NULL
    AND (
      NEW.youtube_channel_verified_id IS NOT NEW.youtube_channel_id
      OR length(trim(NEW.youtube_channel_verified_id)) = 0
      OR length(trim(NEW.youtube_channel_verified_at)) = 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid YouTube channel verification state');
END;

CREATE TRIGGER IF NOT EXISTS vod_export_submissions_verification_update_guard
BEFORE UPDATE OF
  youtube_channel_verified_id,
  youtube_channel_verified_at
ON submissions
FOR EACH ROW
WHEN
  (NEW.youtube_channel_verified_id IS NULL)
    <> (NEW.youtube_channel_verified_at IS NULL)
  OR (
    NEW.youtube_channel_verified_id IS NOT NULL
    AND (
      NEW.youtube_channel_verified_id IS NOT NEW.youtube_channel_id
      OR length(trim(NEW.youtube_channel_verified_id)) = 0
      OR length(trim(NEW.youtube_channel_verified_at)) = 0
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid YouTube channel verification state');
END;

CREATE TRIGGER IF NOT EXISTS vod_export_submissions_clear_channel_verification
AFTER UPDATE OF youtube_channel_id ON submissions
FOR EACH ROW
WHEN
  NEW.youtube_channel_id IS NOT OLD.youtube_channel_id
  AND (
    NEW.youtube_channel_verified_id IS NOT NULL
    OR NEW.youtube_channel_verified_at IS NOT NULL
  )
  AND NOT (
    NEW.youtube_channel_verified_id IS NEW.youtube_channel_id
    AND NEW.youtube_channel_verified_at IS NOT NULL
    AND length(trim(NEW.youtube_channel_verified_at)) > 0
  )
BEGIN
  UPDATE submissions
  SET
    youtube_channel_verified_id = NULL,
    youtube_channel_verified_at = NULL
  WHERE id = NEW.id;
END;

-- VOD export source revision. Fresh bootstraps start at revision zero; all
-- later export-relevant writes increment the singleton in the same transaction.
CREATE TABLE IF NOT EXISTS vod_export_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  trigger_schema_version INTEGER NOT NULL
    CHECK (typeof(trigger_schema_version) = 'integer' AND trigger_schema_version > 0)
);

INSERT OR IGNORE INTO vod_export_state (id, revision, trigger_schema_version)
VALUES (1, 0, 1);

CREATE TRIGGER IF NOT EXISTS vod_export_submissions_insert_revision
AFTER INSERT ON submissions
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_submissions_delete_revision
AFTER DELETE ON submissions
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_submissions_update_revision
AFTER UPDATE OF
  id,
  slug,
  display_name,
  youtube_channel_id,
  youtube_channel_verified_id,
  youtube_channel_verified_at,
  avatar_url,
  link_youtube,
  link_twitter,
  link_facebook,
  link_instagram,
  link_twitch,
  "group",
  enabled,
  status
ON submissions
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;
