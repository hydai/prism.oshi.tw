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

-- Seed approved streamers so the VOD form dropdown is never empty.
-- Uses INSERT OR IGNORE to avoid overwriting curator-modified data.

INSERT OR IGNORE INTO submissions (
  id, youtube_channel_url, youtube_channel_url_normalized, youtube_channel_id,
  slug, brand_name, display_name, description,
  avatar_url, subscriber_count,
  link_youtube, link_twitter, link_facebook, link_instagram, link_twitch,
  "group", enabled, display_order, theme_json,
  status, submitted_at, reviewed_at, reviewer_note
) VALUES (
  'seed-mizuki',
  'https://www.youtube.com/c/%E6%B5%A0MizukiChannel',
  'youtube.com/c/浠mizukichannel',
  '',
  'mizuki',
  'MizukiPrism',
  '浠Mizuki',
  '歌勢Vtuber，一隻愛吃的薩摩...北極狐，牛奶和義大利麵是她最愛的食物！',
  'https://prd.resource-api.lit.link/images/creator/b2256589-be4b-4ef0-b9e5-e0d3386cbdea/2d4326f7-a395-424f-8288-cb7215ebef1c.png',
  '21.8萬',
  'https://www.youtube.com/c/%E6%B5%A0MizukiChannel',
  'https://x.com/MizukiVtuberTW',
  'https://www.facebook.com/MizukiVtuber/',
  'https://www.instagram.com/mizukivtubertw/',
  'https://www.twitch.tv/mizukimilk723',
  '子午計畫',
  1,
  1,
  '{"accentPrimary":"#EC4899","accentPrimaryDark":"#DB2777","accentPrimaryLight":"#F472B6","accentSecondary":"#3B82F6","accentSecondaryLight":"#60A5FA","bgPageStart":"#FFF0F5","bgPageMid":"#F0F8FF","bgPageEnd":"#E6E6FA","bgAccentPrimary":"#FDF2F8","bgAccentPrimaryMuted":"#FCE7F3","borderAccentPrimary":"#FBCFE8","borderAccentSecondary":"#BFDBFE"}',
  'approved',
  datetime('now'),
  datetime('now'),
  'Seeded from registry.json'
);

INSERT OR IGNORE INTO submissions (
  id, youtube_channel_url, youtube_channel_url_normalized, youtube_channel_id,
  slug, brand_name, display_name, description,
  avatar_url, subscriber_count,
  link_youtube, link_twitter, link_facebook, link_instagram, link_twitch,
  "group", enabled, display_order, theme_json,
  status, submitted_at, reviewed_at, reviewer_note
) VALUES (
  'seed-gabu',
  'https://www.youtube.com/channel/UCCHsCWNTcGJ8Jml_oZ6nG2Q',
  'youtube.com/channel/ucchscwntcgj8jml_oz6ng2q',
  '',
  'gabu',
  'GabuPrism',
  'Gabu ch. 加百利 珈咘',
  'Gabu💙左邊日本人右邊台灣人的假的日本人！',
  'https://yt3.ggpht.com/EiXx2rZ6H0vP5277BDSgfPbLCfT24tpVpjR75SnlHuCcwmE_REEDYozWjtN6jr_F5IyF_32G6W4=s240-c-k-c0x00ffffff-no-rj',
  '7.88萬',
  'https://www.youtube.com/channel/UCCHsCWNTcGJ8Jml_oZ6nG2Q',
  'https://x.com/gabu_vt',
  '',
  '',
  '',
  '個人勢',
  1,
  2,
  '{"accentPrimary":"#4A6999","accentPrimaryDark":"#3B598A","accentPrimaryLight":"#6B8AB8","accentSecondary":"#E5C558","accentSecondaryLight":"#F0D87C","bgPageStart":"#F5F6F8","bgPageMid":"#EEF1F7","bgPageEnd":"#E8ECF5","bgAccentPrimary":"#EDF1F7","bgAccentPrimaryMuted":"#DDE4F0","borderAccentPrimary":"#C5D0E3","borderAccentSecondary":"#F0D87C"}',
  'approved',
  datetime('now'),
  datetime('now'),
  'Seeded from registry.json'
);
