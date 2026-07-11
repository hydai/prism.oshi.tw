-- Supports bounded VOD export parent lookups without rescanning every scoped
-- performance once per stream row.
CREATE INDEX IF NOT EXISTS idx_performances_stream_id ON performances(stream_id);
