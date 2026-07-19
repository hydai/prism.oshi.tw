-- Prism Admin Staging Database Schema
-- Cloudflare D1 (SQLite-based)
-- Multi-streamer: all tables include streamer_id for data isolation

-- Global song identities shared by every streamer. A work represents the
-- underlying composition; streamer-local display and review state stay on
-- songs so existing fan pages and moderation flows remain isolated.
CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_artist TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(title, original_artist)
);

-- Historical mapping for merged global works. Like song_aliases, source
-- values are retained without a foreign key to the deleted source row.
CREATE TABLE IF NOT EXISTS work_aliases (
  source_work_id TEXT PRIMARY KEY,
  canonical_work_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_original_artist TEXT NOT NULL,
  source_tags TEXT NOT NULL CHECK(json_valid(source_tags)),
  merged_by TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(source_work_id <> canonical_work_id)
);

-- Songs staging table
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL DEFAULT 'mizuki',
  title TEXT NOT NULL,
  original_artist TEXT NOT NULL,
  tags TEXT DEFAULT '[]',  -- JSON array of strings
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'excluded', 'extracted')),
  submitted_by TEXT,
  reviewed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Historical mapping for merged song entities. Source row fields are retained
-- so a curator can audit or reverse a merge from a database backup without
-- sacrificing any performance rows.
CREATE TABLE IF NOT EXISTS song_aliases (
  source_song_id TEXT PRIMARY KEY,
  canonical_song_id TEXT NOT NULL,
  streamer_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_original_artist TEXT NOT NULL,
  source_status TEXT NOT NULL CHECK(source_status IN ('pending', 'approved', 'rejected', 'excluded', 'extracted')),
  source_tags TEXT NOT NULL CHECK(json_valid(source_tags)),
  source_submitted_by TEXT,
  source_reviewed_by TEXT,
  source_created_at TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  merged_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(source_song_id <> canonical_song_id)
);

-- Non-destructive many-to-one bridge from streamer-local songs to a global
-- work. Keeping this as a separate table avoids rebuilding songs (and its
-- performance foreign keys) when rolling the global catalog out to D1.
CREATE TABLE IF NOT EXISTS song_work_links (
  song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE RESTRICT,
  link_method TEXT NOT NULL CHECK(link_method IN ('migration_exact', 'import_exact', 'manual')),
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Curator decisions for content-addressed global-work duplicate candidates.
-- Keeping the fingerprint in the primary key preserves prior decisions when a
-- later title/artist edit creates a new reviewable candidate state.
CREATE TABLE IF NOT EXISTS work_match_reviews (
  candidate_key TEXT NOT NULL CHECK (
    length(candidate_key) = 64
    AND candidate_key NOT GLOB '*[^0-9a-f]*'
  ),
  fingerprint TEXT NOT NULL CHECK (
    length(fingerprint) = 64
    AND fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  work_ids TEXT NOT NULL CHECK (json_valid(work_ids)),
  decision TEXT NOT NULL CHECK (
    decision IN ('not_duplicate', 'needs_research')
  ),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  reviewed_by TEXT NOT NULL CHECK (length(reviewed_by) > 0),
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_key, fingerprint)
);

-- Monotonic revision used to bind a review/merge to the exact global catalog
-- snapshot scanned by the Worker.
CREATE TABLE IF NOT EXISTS work_match_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  )
);

INSERT OR IGNORE INTO work_match_state (id, revision) VALUES (1, 0);

-- Performances (linked to songs)
CREATE TABLE IF NOT EXISTS performances (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL DEFAULT 'mizuki',
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  stream_id TEXT NOT NULL,
  date TEXT NOT NULL,
  stream_title TEXT NOT NULL,
  video_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  end_timestamp INTEGER,
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'excluded', 'extracted')),
  submitted_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Streams staging table
CREATE TABLE IF NOT EXISTS streams (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL DEFAULT 'mizuki',
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  video_id TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  credit TEXT DEFAULT '{}',  -- JSON object {author, authorUrl, commentUrl}
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'excluded', 'extracted')),
  submitted_by TEXT,
  reviewed_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(streamer_id, video_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_streamer ON songs(streamer_id);
CREATE INDEX IF NOT EXISTS idx_songs_streamer_status ON songs(streamer_id, status);
CREATE INDEX IF NOT EXISTS idx_songs_streamer_title_artist ON songs(streamer_id, title, original_artist);
CREATE INDEX IF NOT EXISTS idx_works_title_artist ON works(title, original_artist);
CREATE INDEX IF NOT EXISTS idx_work_aliases_canonical ON work_aliases(canonical_work_id);
CREATE INDEX IF NOT EXISTS idx_song_aliases_canonical ON song_aliases(canonical_song_id);
CREATE INDEX IF NOT EXISTS idx_song_aliases_streamer ON song_aliases(streamer_id);
CREATE INDEX IF NOT EXISTS idx_song_work_links_work ON song_work_links(work_id);
CREATE INDEX IF NOT EXISTS idx_work_match_reviews_decision
  ON work_match_reviews(decision, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_performances_song_id ON performances(song_id);
CREATE INDEX IF NOT EXISTS idx_performances_stream_id ON performances(stream_id);
CREATE INDEX IF NOT EXISTS idx_performances_status ON performances(status);
CREATE INDEX IF NOT EXISTS idx_performances_streamer ON performances(streamer_id);
CREATE INDEX IF NOT EXISTS idx_performances_streamer_status ON performances(streamer_id, status);
CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status);
CREATE INDEX IF NOT EXISTS idx_streams_video_id ON streams(video_id);
CREATE INDEX IF NOT EXISTS idx_streams_streamer ON streams(streamer_id);
CREATE INDEX IF NOT EXISTS idx_streams_streamer_status ON streams(streamer_id, status);

CREATE TRIGGER IF NOT EXISTS work_match_works_insert_revision
AFTER INSERT ON works
FOR EACH ROW
BEGIN
  UPDATE work_match_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS work_match_works_delete_revision
AFTER DELETE ON works
FOR EACH ROW
BEGIN
  UPDATE work_match_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS work_match_works_update_revision
AFTER UPDATE OF id, title, original_artist, tags ON works
FOR EACH ROW
BEGIN
  UPDATE work_match_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS work_match_links_insert_revision
AFTER INSERT ON song_work_links
FOR EACH ROW
BEGIN
  UPDATE work_match_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS work_match_links_delete_revision
AFTER DELETE ON song_work_links
FOR EACH ROW
BEGIN
  UPDATE work_match_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS work_match_links_update_revision
AFTER UPDATE OF song_id, work_id ON song_work_links
FOR EACH ROW
BEGIN
  UPDATE work_match_state SET revision = revision + 1 WHERE id = 1;
END;

-- VOD export source revision. Fresh bootstraps start at revision zero; all
-- later export-relevant writes increment the singleton in the same transaction.
CREATE TABLE IF NOT EXISTS vod_export_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  trigger_schema_version INTEGER NOT NULL
    CHECK (typeof(trigger_schema_version) = 'integer' AND trigger_schema_version > 0)
);

INSERT OR IGNORE INTO vod_export_state (id, revision, trigger_schema_version)
VALUES (1, 0, 1);

CREATE TRIGGER IF NOT EXISTS vod_export_streams_insert_revision
AFTER INSERT ON streams
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_streams_delete_revision
AFTER DELETE ON streams
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_streams_update_revision
AFTER UPDATE OF id, streamer_id, title, date, video_id, status ON streams
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_songs_insert_revision
AFTER INSERT ON songs
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_songs_delete_revision
AFTER DELETE ON songs
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_songs_update_revision
AFTER UPDATE OF id, streamer_id, title, original_artist, status ON songs
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_performances_insert_revision
AFTER INSERT ON performances
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_performances_delete_revision
AFTER DELETE ON performances
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS vod_export_performances_update_revision
AFTER UPDATE OF
  id,
  streamer_id,
  song_id,
  stream_id,
  timestamp,
  end_timestamp,
  status
ON performances
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

-- Private append-only publication audit. Identity-bearing values are cleared
-- only after the retention conditions in vod-export-spec.md are satisfied.
CREATE TABLE IF NOT EXISTS vod_export_publication_audits (
  intent_id TEXT PRIMARY KEY CHECK (length(intent_id) > 0),
  candidate_id TEXT CHECK (candidate_id IS NULL OR length(candidate_id) > 0),
  curator_identity TEXT CHECK (
    curator_identity IS NULL OR length(curator_identity) > 0
  ),
  schema_version TEXT NOT NULL CHECK (length(schema_version) > 0),
  candidate_sha256 TEXT NOT NULL CHECK (
    length(candidate_sha256) = 64
    AND candidate_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  previous_sha256 TEXT CHECK (
    previous_sha256 IS NULL
    OR (
      length(previous_sha256) = 64
      AND previous_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  ),
  snapshot_url TEXT NOT NULL CHECK (length(snapshot_url) > 0),
  previous_snapshot_url TEXT CHECK (
    previous_snapshot_url IS NULL OR length(previous_snapshot_url) > 0
  ),
  streamer_count INTEGER NOT NULL CHECK (
    typeof(streamer_count) = 'integer' AND streamer_count >= 0
  ),
  vod_count INTEGER NOT NULL CHECK (
    typeof(vod_count) = 'integer' AND vod_count >= 0
  ),
  performance_count INTEGER NOT NULL CHECK (
    typeof(performance_count) = 'integer' AND performance_count >= 0
  ),
  warning_count INTEGER NOT NULL CHECK (
    typeof(warning_count) = 'integer' AND warning_count >= 0
  ),
  source_db_id TEXT NOT NULL CHECK (length(source_db_id) > 0),
  source_db_revision TEXT NOT NULL CHECK (
    length(source_db_revision) > 0
    AND source_db_revision NOT GLOB '*[^0-9]*'
  ),
  source_nova_db_id TEXT NOT NULL CHECK (length(source_nova_db_id) > 0),
  source_nova_revision TEXT NOT NULL CHECK (
    length(source_nova_revision) > 0
    AND source_nova_revision NOT GLOB '*[^0-9]*'
  ),
  exporter_build_id TEXT NOT NULL CHECK (length(exporter_build_id) > 0),
  published_at TEXT NOT NULL CHECK (length(published_at) > 0),
  identity_retained_until TEXT NOT NULL CHECK (length(identity_retained_until) > 0),
  identity_removed_at TEXT CHECK (
    identity_removed_at IS NULL OR length(identity_removed_at) > 0
  ),
  snapshot_unreferenced_at TEXT CHECK (
    snapshot_unreferenced_at IS NULL OR length(snapshot_unreferenced_at) > 0
  ),
  CHECK (
    (
      candidate_id IS NOT NULL
      AND curator_identity IS NOT NULL
      AND identity_removed_at IS NULL
    )
    OR (
      candidate_id IS NULL
      AND curator_identity IS NULL
      AND identity_removed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_vod_export_audits_published_at
  ON vod_export_publication_audits(published_at);
CREATE INDEX IF NOT EXISTS idx_vod_export_audits_candidate_sha256
  ON vod_export_publication_audits(candidate_sha256);
CREATE INDEX IF NOT EXISTS idx_vod_export_audits_identity_retention
  ON vod_export_publication_audits(identity_retained_until)
  WHERE curator_identity IS NOT NULL OR candidate_id IS NOT NULL;

-- Failed and stable no-op publication intents remain private and auditable for
-- at least 30 days after final resolution. A pending row is retained
-- indefinitely until cross-store finalization can be confirmed.
CREATE TABLE IF NOT EXISTS vod_export_publication_resolutions (
  intent_id TEXT PRIMARY KEY CHECK (length(intent_id) > 0),
  candidate_id TEXT NOT NULL CHECK (length(candidate_id) > 0),
  curator_identity TEXT NOT NULL CHECK (length(curator_identity) > 0),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('no_op', 'pre_commit_failed', 'conflict', 'manual_release')
  ),
  resolution_code TEXT NOT NULL CHECK (length(resolution_code) > 0),
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  recorded_at TEXT NOT NULL CHECK (length(recorded_at) > 0),
  finalized_at TEXT,
  delete_after TEXT,
  CHECK (
    (finalized_at IS NULL AND delete_after IS NULL)
    OR (finalized_at IS NOT NULL AND delete_after IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_vod_export_resolutions_delete_after
  ON vod_export_publication_resolutions(delete_after)
  WHERE delete_after IS NOT NULL;
