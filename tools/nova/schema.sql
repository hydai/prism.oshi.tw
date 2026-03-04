CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  youtube_channel_url TEXT NOT NULL,
  youtube_channel_url_normalized TEXT DEFAULT '',
  youtube_channel_id TEXT DEFAULT '',
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
