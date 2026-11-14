import type { VodSubmissionSummary, VodSubmissionKind, ApprovedStreamer, AdminStreamSummary, AdminStreamStatus, PublicStreamSong } from './types';

/**
 * Generate a VOD submission ID: vod-XXXXXXXX (8 random hex chars).
 */
export function generateVodId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `vod-${hex}`;
}

/**
 * Generate a VOD song ID: vsong-XXXXXXXX (8 random hex chars).
 */
export function generateVodSongId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `vsong-${hex}`;
}

/**
 * List approved + enabled streamers with a non-empty slug.
 */
export async function listApprovedStreamers(db: D1Database): Promise<ApprovedStreamer[]> {
  const { results } = await db
    .prepare(
      `SELECT slug, display_name, avatar_url FROM submissions
       WHERE status = 'approved' AND enabled = 1 AND slug != ''
       ORDER BY display_order ASC, display_name ASC`,
    )
    .all<ApprovedStreamer>();
  return results ?? [];
}

/**
 * List all VOD submissions with song counts for the public status page.
 */
export async function listAllVodSubmissions(db: D1Database): Promise<VodSubmissionSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT
         v.id, v.streamer_slug, v.video_id, v.stream_title, v.stream_date,
         v.status, v.submitted_at, v.reviewed_at, v.reviewer_note, v.kind,
         COUNT(s.id) AS song_count
       FROM vod_submissions v
       LEFT JOIN vod_songs s ON s.vod_submission_id = v.id
       GROUP BY v.id
       ORDER BY
         v.streamer_slug ASC,
         CASE v.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'rejected' THEN 2 END,
         v.submitted_at DESC`,
    )
    .all<VodSubmissionSummary>();
  return results ?? [];
}

/**
 * Count existing VOD submissions for a streamer + video ID, plus the latest status.
 * Used by the check endpoint to provide informational messages.
 */
export async function countVodsByVideoId(
  db: D1Database,
  slug: string,
  videoId: string,
): Promise<{ count: number; hasApproved: boolean; pendingCount: number; rejectedCount: number; latestStatus: string | null }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count,
              SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
              SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
              (SELECT status FROM vod_submissions WHERE streamer_slug = ? AND video_id = ? ORDER BY submitted_at DESC LIMIT 1) as latest_status
       FROM vod_submissions WHERE streamer_slug = ? AND video_id = ?`,
    )
    .bind(slug, videoId, slug, videoId)
    .first<{ count: number; approved_count: number; pending_count: number; rejected_count: number; latest_status: string | null }>();
  return {
    count: row?.count ?? 0,
    hasApproved: (row?.approved_count ?? 0) > 0,
    pendingCount: row?.pending_count ?? 0,
    rejectedCount: row?.rejected_count ?? 0,
    latestStatus: row?.latest_status ?? null,
  };
}

// A submission's base as the correction review reads it: these five fields of each row, in the list's order.
function baseSongsJson(base: readonly PublicStreamSong[] | null): string | null {
  if (base === null) return null;
  return JSON.stringify(base.map((row) => ({
    performance_id: row.performance_id,
    song_title: row.song_title,
    original_artist: row.original_artist,
    start_timestamp: row.start_timestamp,
    end_timestamp: row.end_timestamp,
  })));
}

/**
 * The revision of a streamer's public song list for a video: a SHA-256 digest, in lowercase hex, of the streamer
 * slug, the video id and exactly the rows a submission stores as its base (listPublicStreamSongs' result, in its
 * order, every field baseSongsJson keeps). GET /vod/api/current gives it with an archived VOD's list, and POST
 * /vod/api/submit refuses a submission whose base_revision no longer matches, so equal revisions mean the base it
 * stores is the list the form loaded.
 * The input is the JSON of [slug, videoId, rows], each row an array in this order: performance_id, song_title,
 * original_artist, start_timestamp, end_timestamp. Arrays fix the order and JSON escapes every string, so two
 * inputs serialize alike only when every field of every row matches.
 */
export async function publicListRevision(slug: string, videoId: string, rows: readonly PublicStreamSong[]): Promise<string> {
  const input = JSON.stringify([
    slug,
    videoId,
    rows.map((row) => [row.performance_id, row.song_title, row.original_artist, row.start_timestamp, row.end_timestamp]),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Insert a new VOD submission with its songs in a single batch. `base_songs` is the public list the
 * submission was compared against (migration 0015): empty when the admin stream shows nothing, null
 * when there is no stream. `baseVerified` is whether a base_revision confirmed that list as the one the
 * contributor loaded. No Nova query reads either back.
 */
export async function insertVodSubmission(
  db: D1Database,
  id: string,
  data: {
    streamer_slug: string;
    video_id: string;
    video_url: string;
    stream_title: string;
    stream_date: string;
    thumbnail_url: string;
    submitter_note: string;
    kind: VodSubmissionKind;
    base_songs: readonly PublicStreamSong[] | null;
    baseVerified: boolean;
  },
  songs: Array<{
    id: string;
    song_title: string;
    original_artist: string;
    start_timestamp: number;
    end_timestamp: number | null;
    sort_order: number;
  }>,
): Promise<void> {
  const stmts: D1PreparedStatement[] = [];

  stmts.push(
    db
      .prepare(
        `INSERT INTO vod_submissions (id, streamer_slug, video_id, video_url, stream_title, stream_date, thumbnail_url, submitter_note, kind, base_songs, base_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, data.streamer_slug, data.video_id, data.video_url, data.stream_title, data.stream_date, data.thumbnail_url, data.submitter_note,
        data.kind, baseSongsJson(data.base_songs), data.baseVerified ? 1 : 0,
      ),
  );

  for (const song of songs) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO vod_songs (id, vod_submission_id, song_title, original_artist, start_timestamp, end_timestamp, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(song.id, id, song.song_title, song.original_artist, song.start_timestamp, song.end_timestamp, song.sort_order),
    );
  }

  await db.batch(stmts);
}

/**
 * List streams from admin DB with status in (approved, extracted, pending) for the status page.
 * Joins with performances to get song count per stream.
 */
export async function listAdminStreams(adminDb: D1Database): Promise<AdminStreamSummary[]> {
  const { results } = await adminDb
    .prepare(
      `SELECT
         s.id, s.streamer_id, s.video_id, s.title, s.date,
         s.status, s.created_at,
         COUNT(p.id) AS song_count
       FROM streams s
       LEFT JOIN performances p ON p.stream_id = s.id AND p.streamer_id = s.streamer_id
       WHERE s.status = 'approved'
       GROUP BY s.id
       ORDER BY s.streamer_id ASC, s.date DESC`,
    )
    .all<AdminStreamSummary>();
  // Defensive: filter again in application code in case D1 returns unexpected rows
  return (results ?? []).filter((s) => s.status === 'approved');
}

/**
 * Check if a stream exists in the admin DB for a given streamer + video ID.
 * Returns status if found, null otherwise.
 */
export async function checkAdminStreamExists(
  adminDb: D1Database,
  slug: string,
  videoId: string,
): Promise<{ status: AdminStreamStatus } | null> {
  const row = await adminDb
    .prepare('SELECT status FROM streams WHERE streamer_id = ? AND video_id = ?')
    .bind(slug, videoId)
    .first<{ status: AdminStreamStatus }>();
  return row ?? null;
}

/**
 * The kind the public may see of a submission, given its stored kind and the status of the admin stream for its
 * (streamer, video) now, or null for none. A submission is stored as a correction whenever that stream existed at
 * submit time, whatever its status, since admin reviews it as a correction of the stream; but only an approved stream
 * is public. Until the stream is approved, a stored correction reads as new, exactly like a submission for a video
 * admin has never seen. Every public reading of `kind` (the submit answer, /status) goes through here.
 */
export function publicVodKind(kind: VodSubmissionKind, streamStatus: AdminStreamStatus | null): VodSubmissionKind {
  return kind === 'correction' && streamStatus === 'approved' ? 'correction' : 'new';
}

/**
 * The public song list of a stream, in time order (then performance id): what the site shows for an
 * archived VOD, so the stream, the performance and the song must all be approved. Each row names its
 * performance, which a submission's base records.
 * Performances join on stream_id alone: adding streamer_id makes SQLite, without planner
 * statistics, walk the streamer's whole approved catalog instead of idx_performances_stream_id.
 */
export async function listPublicStreamSongs(adminDb: D1Database, slug: string, videoId: string): Promise<PublicStreamSong[]> {
  const { results } = await adminDb
    .prepare(
      `SELECT
         p.id AS performance_id,
         song.title AS song_title,
         song.original_artist AS original_artist,
         p.timestamp AS start_timestamp,
         p.end_timestamp AS end_timestamp
       FROM streams s
       JOIN performances p ON p.stream_id = s.id
       JOIN songs song ON song.id = p.song_id
       WHERE s.streamer_id = ? AND s.video_id = ?
         AND s.status = 'approved' AND p.status = 'approved' AND song.status = 'approved'
       ORDER BY p.timestamp, p.id`,
    )
    .bind(slug, videoId)
    .all<PublicStreamSong>();
  return results ?? [];
}
