-- VOD export source revision and private successful-publication audit state.
--
-- The singleton revision is bumped by triggers in the same transaction as
-- every export-relevant source mutation. Keep the UPDATE OF allowlists in
-- sync with vod-export-spec.md D-016.1 and increment trigger_schema_version
-- whenever those allowlists change.

CREATE TABLE vod_export_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  trigger_schema_version INTEGER NOT NULL
    CHECK (typeof(trigger_schema_version) = 'integer' AND trigger_schema_version > 0)
);

INSERT INTO vod_export_state (id, revision, trigger_schema_version)
VALUES (1, 0, 1);

CREATE TRIGGER vod_export_streams_insert_revision
AFTER INSERT ON streams
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_streams_delete_revision
AFTER DELETE ON streams
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_streams_update_revision
AFTER UPDATE OF id, streamer_id, title, date, video_id, status ON streams
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_songs_insert_revision
AFTER INSERT ON songs
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_songs_delete_revision
AFTER DELETE ON songs
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_songs_update_revision
AFTER UPDATE OF id, streamer_id, title, original_artist, status ON songs
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_performances_insert_revision
AFTER INSERT ON performances
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_performances_delete_revision
AFTER DELETE ON performances
FOR EACH ROW
BEGIN
  UPDATE vod_export_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TRIGGER vod_export_performances_update_revision
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

-- The R2 prepared intent is authoritative until this append-only successful
-- publication record is finalized. intent_id makes reconciliation idempotent.
-- Identity-bearing fields become NULL after D-013.19's retention conditions
-- are satisfied; the remaining technical record is retained for provenance.
CREATE TABLE vod_export_publication_audits (
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

CREATE INDEX idx_vod_export_audits_published_at
  ON vod_export_publication_audits(published_at);
CREATE INDEX idx_vod_export_audits_candidate_sha256
  ON vod_export_publication_audits(candidate_sha256);
CREATE INDEX idx_vod_export_audits_identity_retention
  ON vod_export_publication_audits(identity_retained_until)
  WHERE curator_identity IS NOT NULL OR candidate_id IS NOT NULL;

-- Failed and stable no-op publication intents remain private and auditable for
-- at least 30 days after final resolution. A pending row is retained
-- indefinitely until cross-store finalization can be confirmed.
CREATE TABLE vod_export_publication_resolutions (
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

CREATE INDEX idx_vod_export_resolutions_delete_after
  ON vod_export_publication_resolutions(delete_after)
  WHERE delete_after IS NOT NULL;
