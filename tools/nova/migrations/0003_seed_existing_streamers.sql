-- Seed existing streamers (mizuki, gabu) into Nova DB with their current registry.json data.
-- Uses INSERT OR IGNORE so re-running is safe (idempotent by youtube_channel_url unique index).

INSERT OR IGNORE INTO submissions (
  id, youtube_channel_url, slug, brand_name, display_name, description,
  avatar_url, subscriber_count,
  link_youtube, link_twitter, link_facebook, link_instagram, link_twitch,
  "group", sub_title, enabled, theme_json,
  status, submitted_at, reviewed_at, reviewer_note
) VALUES (
  'seed-mizuki',
  'https://www.youtube.com/c/%E6%B5%A0MizukiChannel',
  'mizuki',
  'MizukiPrism',
  '浠Mizuki',
  '歌勢Vtuber，一隻愛吃的薩摩...北極狐，牛奶和義大利麵是她最愛的食物！',
  'https://static.wixstatic.com/media/d616b2_503e3c62a3544b73a1b2d6080ebff9af~mv2.png/v1/fill/w_160,h_156,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/d616b2_503e3c62a3544b73a1b2d6080ebff9af~mv2.png',
  '21.8萬',
  'https://www.youtube.com/c/%E6%B5%A0MizukiChannel',
  'https://x.com/MizukiVtuberTW',
  'https://www.facebook.com/MizukiVtuber/',
  'https://www.instagram.com/mizukivtubertw/',
  'https://www.twitch.tv/mizukimilk723',
  '子午計畫',
  'Official Song Archive',
  1,
  '{"accentPrimary":"#EC4899","accentPrimaryDark":"#DB2777","accentPrimaryLight":"#F472B6","accentSecondary":"#3B82F6","accentSecondaryLight":"#60A5FA","bgPageStart":"#FFF0F5","bgPageMid":"#F0F8FF","bgPageEnd":"#E6E6FA","bgAccentPrimary":"#FDF2F8","bgAccentPrimaryMuted":"#FCE7F3","borderAccentPrimary":"#FBCFE8","borderAccentSecondary":"#BFDBFE"}',
  'approved',
  datetime('now'),
  datetime('now'),
  'Seeded from existing registry.json'
);

INSERT OR IGNORE INTO submissions (
  id, youtube_channel_url, slug, brand_name, display_name, description,
  avatar_url, subscriber_count,
  link_youtube, link_twitter, link_facebook, link_instagram, link_twitch,
  "group", sub_title, enabled, theme_json,
  status, submitted_at, reviewed_at, reviewer_note
) VALUES (
  'seed-gabu',
  'https://www.youtube.com/channel/UCCHsCWNTcGJ8Jml_oZ6nG2Q',
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
  'Official Song Archive',
  1,
  '{"accentPrimary":"#4A6999","accentPrimaryDark":"#3B598A","accentPrimaryLight":"#6B8AB8","accentSecondary":"#E5C558","accentSecondaryLight":"#F0D87C","bgPageStart":"#F5F6F8","bgPageMid":"#EEF1F7","bgPageEnd":"#E8ECF5","bgAccentPrimary":"#EDF1F7","bgAccentPrimaryMuted":"#DDE4F0","borderAccentPrimary":"#C5D0E3","borderAccentSecondary":"#F0D87C"}',
  'approved',
  datetime('now'),
  datetime('now'),
  'Seeded from existing registry.json'
);
