import type { VodSubmissionRow, ApprovedStreamer } from './types';

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
 * Find an existing VOD submission by streamer slug + video ID (dedup check).
 */
export async function findVodByVideoId(
  db: D1Database,
  slug: string,
  videoId: string,
): Promise<Pick<VodSubmissionRow, 'id' | 'status' | 'submitted_at'> | null> {
  const row = await db
    .prepare('SELECT id, status, submitted_at FROM vod_submissions WHERE streamer_slug = ? AND video_id = ?')
    .bind(slug, videoId)
    .first<Pick<VodSubmissionRow, 'id' | 'status' | 'submitted_at'>>();
  return row ?? null;
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
 * Reset a rejected VOD submission back to pending with new data + songs.
 */
export async function resetRejectedVod(
  db: D1Database,
  id: string,
  data: {
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
        `UPDATE vod_submissions SET
          video_url = ?, stream_title = ?, stream_date = ?, thumbnail_url = ?, submitter_note = ?,
          status = 'pending', submitted_at = datetime('now'), reviewed_at = NULL, reviewer_note = ''
         WHERE id = ? AND status = 'rejected'`,
      )
      .bind(data.video_url, data.stream_title, data.stream_date, data.thumbnail_url, data.submitter_note, id),
  );

  // Delete old songs and insert new ones
  stmts.push(db.prepare('DELETE FROM vod_songs WHERE vod_submission_id = ?').bind(id));

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
