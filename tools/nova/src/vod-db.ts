import type { VodSubmissionRow, VodSubmissionSummary, ApprovedStreamer, AdminStreamSummary, AdminStreamStatus } from './types';

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
         v.status, v.submitted_at, v.reviewed_at,
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
 * Find an approved VOD submission by streamer slug + video ID.
 * Only returns a row when status = 'approved' (curator-verified data doesn't need re-submission).
 */
export async function findApprovedVodByVideoId(
  db: D1Database,
  slug: string,
  videoId: string,
): Promise<Pick<VodSubmissionRow, 'id' | 'status' | 'submitted_at'> | null> {
  const row = await db
    .prepare("SELECT id, status, submitted_at FROM vod_submissions WHERE streamer_slug = ? AND video_id = ? AND status = 'approved'")
    .bind(slug, videoId)
    .first<Pick<VodSubmissionRow, 'id' | 'status' | 'submitted_at'>>();
  return row ?? null;
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

/**
 * Insert a new VOD submission with its songs in a single batch.
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
        `INSERT INTO vod_submissions (id, streamer_slug, video_id, video_url, stream_title, stream_date, thumbnail_url, submitter_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, data.streamer_slug, data.video_id, data.video_url, data.stream_title, data.stream_date, data.thumbnail_url, data.submitter_note),
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
