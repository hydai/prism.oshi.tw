-- Add ordering field for controlling VTuber display order on the index page
ALTER TABLE submissions ADD COLUMN display_order INTEGER DEFAULT 0;
