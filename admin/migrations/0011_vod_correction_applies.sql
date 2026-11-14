-- Migration 0011: a record of every committed VOD correction apply
--
-- Apply against remote D1 (from admin/ directory):
--   npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0011_vod_correction_applies.sql
--
-- POST /api/nova/vods/:id/apply writes one row here in the same D1 batch as the
-- catalog changes, so a row exists exactly when its batch committed. D1 can commit
-- a batch and still reject the call; the worker then reads its row back by `token`
-- rather than reporting a landed correction as stale. The row also keeps what the
-- apply goes on to write to the Nova submission (`reviewer_note`) and to announce
-- (`summary`): when marking the submission reviewed fails (502 appliedToCatalog),
-- the approval that recovers it (PATCH .../status, without_applying) reads the
-- newest row of the submission whose `announced_at` is NULL, writes its note and
-- posts its announcement. Every feedback embed for the submission (an apply's or
-- a recovery's announcement, a rejection) first sets `announced_at` on all of its
-- open rows, so a row never announces after a later outcome; an announcement
-- posts only when it closed its own row, or when that claim itself failed (a
-- duplicate announcement is better than a lost one). An apply refused because
-- another review landed while it ran (409 status_changed) posts nothing and
-- closes its own row only, so it never takes the row a racing recovery is about
-- to announce. Append-only: a correction that was reverted and applied again gets
-- a second row.
--
-- MUST be applied BEFORE the admin worker that writes this table is deployed:
-- without it every correction apply fails. Additive and idempotent; no existing
-- rows are changed.

CREATE TABLE IF NOT EXISTS vod_correction_applies (
  token TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  reviewer_note TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  announced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vod_correction_applies_submission
  ON vod_correction_applies(submission_id);
