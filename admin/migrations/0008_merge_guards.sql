-- Migration 0008: dedicated merge_guards table + work_aliases sentinel sweep
--
-- Apply against remote D1 (from admin/ directory):
--   npx wrangler@latest d1 execute oshi-prism-db --remote --file=migrations/0008_merge_guards.sql
--
-- D1 exposes atomic batches but no interactive transaction callback, so both
-- merge paths (song merge in db.ts, global work merge in work-review.ts) write
-- a short-lived guard row that only lands when every reviewed expectation
-- still holds, gate each business mutation on that row, and delete it as the
-- last mutating statement of the batch. That row used to be a sentinel work_aliases
-- entry titled '__merge_guard__' / '__work_match_guard__' — control state
-- hidden inside domain data, needing two random ids because the alias natural
-- key is a (source, canonical) pair. It now lives in its own table, keyed by
-- one random token.
--
-- MUST be applied BEFORE the code that writes to merge_guards is deployed:
-- without this table every merge fails.
--
-- The sentinel sweep is defensive and idempotent. A committed batch always
-- deleted its own sentinel, so this normally deletes nothing — but it makes
-- work_aliases pure domain data even if a sentinel was ever stranded, and no
-- reader has to know the titles existed. It matches the COMPLETE shape the two
-- old writers produced (sentinel title AND artist AND '[]' tags AND the system
-- actor AND the random-id prefix), so a genuine alias that merely happens to be
-- titled '__merge_guard__' is never touched.

CREATE TABLE IF NOT EXISTS merge_guards (
  guard_token TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DELETE FROM work_aliases
WHERE (
    source_title = '__merge_guard__'
    AND source_original_artist = '__merge_guard__'
    AND source_tags = '[]'
    AND merged_by = 'system:harmonizer-merge-guard'
    AND source_work_id LIKE 'merge-guard-source-%'
    AND canonical_work_id LIKE 'merge-guard-canonical-%'
  ) OR (
    source_title = '__work_match_guard__'
    AND source_original_artist = '__work_match_guard__'
    AND source_tags = '[]'
    AND merged_by = 'system:global-work-review-guard'
    AND source_work_id LIKE 'work-match-guard-%'
  );
