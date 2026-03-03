-- Add registry-specific fields to submissions table
-- These fields are needed by sync-registry to generate data/registry.json

ALTER TABLE submissions ADD COLUMN "group" TEXT DEFAULT '';
ALTER TABLE submissions ADD COLUMN sub_title TEXT DEFAULT 'Official Song Archive';
ALTER TABLE submissions ADD COLUMN enabled INTEGER DEFAULT 1;
ALTER TABLE submissions ADD COLUMN theme_json TEXT DEFAULT '';
