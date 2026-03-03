-- Fix seeded URLs to match normalized form (lowercase path) used by the check API.
UPDATE submissions SET youtube_channel_url = 'https://www.youtube.com/c/%e6%b5%a0mizukichannel' WHERE slug = 'mizuki';
UPDATE submissions SET youtube_channel_url = 'https://www.youtube.com/channel/ucchscwntcgj8jml_oz6ng2q' WHERE slug = 'gabu';
