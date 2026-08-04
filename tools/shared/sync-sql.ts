/**
 * sync-sql.ts — SQL fragment shared by sync-status's freshness detector
 * (tools/sync-status/detect.ts) and sync-data's per-streamer export
 * (tools/sync-data/sync.ts), so the two never drift apart.
 */

/** Latest visible metadata change, including the shared work's tags.
 * Callers must join songs AS song, song_work_links AS link, and works AS work.
 */
export const LATEST_UPDATED_AT_SQL =
  `MAX(MAX(COALESCE(song.updated_at, ''), COALESCE(link.updated_at, ''), COALESCE(work.updated_at, ''))) AS max_ts`;
