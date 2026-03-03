-- Revert 0007: restore original-case YouTube channel URLs
UPDATE submissions SET youtube_channel_url = 'https://www.youtube.com/c/%E6%B5%A0MizukiChannel' WHERE slug = 'mizuki';
UPDATE submissions SET youtube_channel_url = 'https://www.youtube.com/channel/UCCHsCWNTcGJ8Jml_oZ6nG2Q' WHERE slug = 'gabu';

-- Add normalized column for case-insensitive dedup lookups
ALTER TABLE submissions ADD COLUMN youtube_channel_url_normalized TEXT DEFAULT '';

-- Populate normalized values for existing rows
UPDATE submissions SET youtube_channel_url_normalized = LOWER(youtube_channel_url);

-- Drop old unique index on original URL, create new one on normalized
DROP INDEX IF EXISTS idx_submissions_channel_url;
CREATE UNIQUE INDEX idx_submissions_channel_url_normalized ON submissions(youtube_channel_url_normalized);
