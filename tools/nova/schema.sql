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

-- VOD export source revision. The initial seeds above are bootstrap baseline
-- data, so fresh databases deliberately begin at revision zero.
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
