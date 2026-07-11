-- Persist official YouTube channel verification and the NOVA side of the VOD
-- export source-revision vector. Existing IDs deliberately remain unverified.

ALTER TABLE submissions ADD COLUMN youtube_channel_verified_id TEXT;
ALTER TABLE submissions ADD COLUMN youtube_channel_verified_at TEXT;

-- Verification is all-or-nothing and must match the current channel ID
-- exactly. A channel ID change clears the old verification state; the Admin
-- verification flow can repopulate it only after a successful channels.list.
CREATE TRIGGER vod_export_submissions_verification_insert_guard
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

CREATE TRIGGER vod_export_submissions_verification_update_guard
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

CREATE TRIGGER vod_export_submissions_clear_channel_verification
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

CREATE TABLE vod_export_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  trigger_schema_version INTEGER NOT NULL
    CHECK (typeof(trigger_schema_version) = 'integer' AND trigger_schema_version > 0)
);

INSERT INTO vod_export_state (id, revision, trigger_schema_version)
VALUES (1, 0, 1);

CREATE TRIGGER vod_export_submissions_insert_revision
AFTER INSERT ON submissions
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_submissions_delete_revision
AFTER DELETE ON submissions
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_submissions_update_revision
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
