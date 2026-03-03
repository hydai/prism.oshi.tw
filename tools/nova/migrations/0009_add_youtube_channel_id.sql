ALTER TABLE submissions ADD COLUMN youtube_channel_id TEXT DEFAULT '';
UPDATE submissions SET youtube_channel_id = 'UCjv4bfP_67WLuPheS-Z8Ekg' WHERE slug = 'mizuki';
UPDATE submissions SET youtube_channel_id = 'UCCHsCWNTcGJ8Jml_oZ6nG2Q' WHERE slug = 'gabu';
