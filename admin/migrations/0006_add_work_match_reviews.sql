-- Persist curator decisions for high-confidence global-work duplicate
-- candidates. Candidate fingerprints are content-addressed, so an identity
-- edit creates a fresh pending review while retaining the historical decision.

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

CREATE INDEX IF NOT EXISTS idx_work_match_reviews_decision
  ON work_match_reviews(decision, reviewed_at);

-- A single catalog revision closes the race between scanning candidates and
-- applying a decision. Global work/link mutations increment it automatically;
-- an atomic merge or review fails closed if any catalog mutation landed after
-- the server's transaction-consistent scan.
CREATE TABLE IF NOT EXISTS work_match_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(revision) = 'integer' AND revision >= 0
  )
);

INSERT OR IGNORE INTO work_match_state (id, revision) VALUES (1, 0);

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
