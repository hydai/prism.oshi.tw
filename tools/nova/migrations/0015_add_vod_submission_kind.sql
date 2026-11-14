-- Record whether a VOD submission corrects a video that is already archived.
-- 'correction' when an approved admin stream existed for (streamer_slug, video_id)
-- at submit time, 'new' otherwise. Every existing row is a new submission.
ALTER TABLE vod_submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'new' CHECK(kind IN ('new','correction'));
