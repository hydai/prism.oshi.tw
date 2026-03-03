-- Set mizuki first, all others default to 999
UPDATE submissions SET display_order = 0 WHERE slug = 'mizuki';
UPDATE submissions SET display_order = 999 WHERE slug != 'mizuki';
