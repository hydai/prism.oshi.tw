-- Allow multiple VOD submissions per (streamer_slug, video_id).
-- Previously a UNIQUE index blocked duplicates at the DB level;
-- now the application only blocks when an approved row exists.
DROP INDEX IF EXISTS idx_vod_streamer_video;
CREATE INDEX IF NOT EXISTS idx_vod_streamer_video ON vod_submissions(streamer_slug, video_id);
