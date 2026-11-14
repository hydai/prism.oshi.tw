-- Record whether a VOD submission corrects a video admin already has a stream for.
-- 'correction' when an admin stream of any status existed for (streamer_slug, video_id)
-- at submit time, since admin reviews such a submission as a correction of that stream;
-- 'new' otherwise. Every existing row is a new submission. Only an approved stream is
-- public, so nothing public reads this column directly: Nova's submit answer and /status
-- call a submission a correction only while its stream is approved (publicVodKind), and
-- admin's Discord embeds follow the same rule.
ALTER TABLE vod_submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'new' CHECK(kind IN ('new','correction'));

-- Record the public song list a submission was compared against at submit time, its base, so the
-- correction review can tell what the contributor changed from what changed since. A JSON array of
-- { performance_id, song_title, original_artist, start_timestamp, end_timestamp }, by start, then
-- performance id. '[]' when an admin stream existed but nothing on it was public, NULL when there
-- was no stream; every existing row is NULL. NULL against '[]' tells a pipeline stream from an
-- unknown video, so no list query selects this column: only the admin's read of one submission.
ALTER TABLE vod_submissions ADD COLUMN base_songs TEXT;

-- Record whether a revision confirmed the base: 1 when the submission came with the base_revision that
-- /vod/api/current gave, that revision still matched the public list at submit time, and a base was
-- recorded (an admin stream existed); 0 in every other case, which includes every existing row, by the
-- DEFAULT. A confirmed base is the list the contributor loaded, so the correction review can tell what they
-- changed from what changed since. Any other base is only the public list as it stood at submit time, which
-- says nothing about what they saw. Like base_songs it tells a pipeline stream from an unknown video (the
-- empty list's revision confirms the one and not the other), so no list query selects it: only the
-- admin's read of one submission.
ALTER TABLE vod_submissions ADD COLUMN base_verified INTEGER NOT NULL DEFAULT 0;
