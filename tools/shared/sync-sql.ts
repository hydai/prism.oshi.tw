/**
 * sync-sql.ts — SQL fragment shared by sync-status's freshness detector
 * (tools/sync-status/detect.ts) and sync-data's per-streamer export
 * (tools/sync-data/sync.ts), so the two never drift apart.
 */

/**
 * Computes a song's latest change: the later of its own `updated_at` and its
 * work link's (song_work_links) — a cross-streamer work-link edit (e.g. a
 * merge) can change a song's identity without touching the song row itself,
 * so the link's timestamp must be considered too. Expects `song` and `link`
 * aliases in scope (`FROM songs AS song LEFT JOIN song_work_links AS link ON
 * link.song_id = song.id`).
 */
export const LATEST_UPDATED_AT_SQL =
  `MAX(CASE WHEN link.updated_at IS NULL THEN song.updated_at WHEN song.updated_at IS NULL OR link.updated_at > song.updated_at THEN link.updated_at ELSE song.updated_at END) AS max_ts`;
