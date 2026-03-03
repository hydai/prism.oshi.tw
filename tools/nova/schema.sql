CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  youtube_channel_url TEXT NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_channel_url
  ON submissions(youtube_channel_url);
CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON submissions(status);
