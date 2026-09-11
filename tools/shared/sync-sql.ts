/**
 * sync-sql.ts — SQL fragment shared by sync-status's freshness detector
 * (tools/sync-status/detect.ts) and sync-data's per-streamer export
 * (tools/sync-data/sync.ts), so the two never drift apart.
 */

/**
 * Latest visible metadata change for a song: its own row, its work link, and
 * the shared work (whose tags every linked song exports). Callers must have
 * `songs AS song`, `song_work_links AS link` and `works AS work` in scope
 * (`FROM songs AS song LEFT JOIN song_work_links AS link ON link.song_id = song.id
 * LEFT JOIN works AS work ON work.id = link.work_id`).
 */
export const LATEST_UPDATED_AT_SQL =
  `MAX(MAX(COALESCE(song.updated_at, ''), COALESCE(link.updated_at, ''), COALESCE(work.updated_at, ''))) AS max_ts`;
