import type {
  Song,
  SongRow,
  Performance,
  PerformanceRow,
  Stream,
  StreamRow,
  StreamCredit,
  StampPerformance,
  StreamWithPending,
  StreamDetail,
  StampStats,
  Status,
} from '../shared/types';

// --- Row → API type mappers ---

export function songFromRow(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    tags: JSON.parse(row.tags),
    status: row.status,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function performanceFromRow(row: PerformanceRow): Performance {
  return {
    id: row.id,
    songId: row.song_id,
    streamId: row.stream_id,
    date: row.date,
    streamTitle: row.stream_title,
    videoId: row.video_id,
    timestamp: row.timestamp,
    endTimestamp: row.end_timestamp,
    note: row.note,
    status: row.status,
    submittedBy: row.submitted_by,
    createdAt: row.created_at,
  };
}

export function streamFromRow(row: StreamRow): Stream {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    videoId: row.video_id,
    youtubeUrl: row.youtube_url,
    credit: JSON.parse(row.credit) as StreamCredit,
    status: row.status,
    submittedBy: row.submitted_by,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
  };
}

// --- ID generation ---

export function generateSongId(): string {
  return `song-${crypto.randomUUID().slice(0, 8)}`;
}

export function generatePerformanceId(): string {
  return `p-${crypto.randomUUID().slice(0, 8)}`;
}

export function generateStreamId(date: string): string {
  return `stream-${date}`;
}

export function generateStreamIdFallback(): string {
  return `stream-${crypto.randomUUID().slice(0, 8)}`;
}

// --- Query helpers ---

export async function listSongs(
  db: D1Database,
  streamerId: string,
  status?: string,
): Promise<Song[]> {
  const query = status
    ? db.prepare('SELECT * FROM songs WHERE streamer_id = ? AND status = ? ORDER BY created_at DESC').bind(streamerId, status)
    : db.prepare('SELECT * FROM songs WHERE streamer_id = ? ORDER BY created_at DESC').bind(streamerId);
  const { results } = await query.all<SongRow>();
  return results.map(songFromRow);
}

export async function getSongById(
  db: D1Database,
  id: string,
): Promise<Song | null> {
  const row = await db
    .prepare('SELECT * FROM songs WHERE id = ?')
    .bind(id)
    .first<SongRow>();
  if (!row) return null;

  const song = songFromRow(row);
  const { results: perfRows } = await db
    .prepare('SELECT * FROM performances WHERE song_id = ? ORDER BY date DESC')
    .bind(id)
    .all<PerformanceRow>();
  song.performances = perfRows.map(performanceFromRow);
  return song;
}

export async function insertSong(
  db: D1Database,
  streamerId: string,
  id: string,
  title: string,
  originalArtist: string,
  tags: string[],
  submittedBy: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, streamerId, title, originalArtist, JSON.stringify(tags), 'pending', submittedBy)
    .run();
}

export async function updateSong(
  db: D1Database,
  id: string,
  fields: { title?: string; originalArtist?: string; tags?: string[] },
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (fields.title !== undefined) {
    sets.push('title = ?');
    values.push(fields.title);
  }
  if (fields.originalArtist !== undefined) {
    sets.push('original_artist = ?');
    values.push(fields.originalArtist);
  }
  if (fields.tags !== undefined) {
    sets.push('tags = ?');
    values.push(JSON.stringify(fields.tags));
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  await db
    .prepare(`UPDATE songs SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function updateSongStatus(
  db: D1Database,
  id: string,
  status: string,
  reviewedBy: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE songs SET status = ?, reviewed_by = ?, updated_at = datetime('now') WHERE id = ?",
    )
    .bind(status, reviewedBy, id)
    .run();
  return result.meta.changes > 0;
}

// --- Performances ---

export async function listPerformances(
  db: D1Database,
  streamerId: string,
  songId?: string,
  status?: string,
): Promise<Performance[]> {
  let sql = 'SELECT * FROM performances WHERE streamer_id = ?';
  const binds: string[] = [streamerId];

  if (songId) {
    sql += ' AND song_id = ?';
    binds.push(songId);
  }
  if (status) {
    sql += ' AND status = ?';
    binds.push(status);
  }
  sql += ' ORDER BY date DESC';

  const stmt = db.prepare(sql).bind(...binds);
  const { results } = await stmt.all<PerformanceRow>();
  return results.map(performanceFromRow);
}

export async function insertPerformance(
  db: D1Database,
  streamerId: string,
  id: string,
  songId: string,
  streamId: string,
  date: string,
  streamTitle: string,
  videoId: string,
  timestamp: number,
  endTimestamp: number | null,
  note: string,
  submittedBy: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, streamerId, songId, streamId, date, streamTitle, videoId, timestamp, endTimestamp, note, 'pending', submittedBy)
    .run();
}

export async function getPerformanceStatus(
  db: D1Database,
  id: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT status FROM performances WHERE id = ?')
    .bind(id)
    .first<{ status: string }>();
  return row?.status ?? null;
}

export async function updatePerformanceStatus(
  db: D1Database,
  id: string,
  status: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE performances SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();
  return result.meta.changes > 0;
}

// --- Streams ---

export async function listStreams(
  db: D1Database,
  streamerId: string,
  status?: string,
): Promise<Stream[]> {
  const query = status
    ? db.prepare('SELECT * FROM streams WHERE streamer_id = ? AND status = ? ORDER BY date DESC').bind(streamerId, status)
    : db.prepare('SELECT * FROM streams WHERE streamer_id = ? ORDER BY date DESC').bind(streamerId);
  const { results } = await query.all<StreamRow>();
  return results.map(streamFromRow);
}

export async function getStreamById(
  db: D1Database,
  id: string,
): Promise<Stream | null> {
  const row = await db
    .prepare('SELECT * FROM streams WHERE id = ?')
    .bind(id)
    .first<StreamRow>();
  return row ? streamFromRow(row) : null;
}

export async function insertStream(
  db: D1Database,
  streamerId: string,
  id: string,
  title: string,
  date: string,
  videoId: string,
  youtubeUrl: string,
  credit: string,
  submittedBy: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO streams (id, streamer_id, title, date, video_id, youtube_url, credit, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, streamerId, title, date, videoId, youtubeUrl, credit, 'pending', submittedBy)
    .run();
}

export async function streamIdExists(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM streams WHERE id = ?')
    .bind(id)
    .first();
  return row !== null;
}

export async function videoIdExists(
  db: D1Database,
  videoId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM streams WHERE video_id = ?')
    .bind(videoId)
    .first();
  return row !== null;
}

export async function updateStreamStatus(
  db: D1Database,
  id: string,
  status: string,
  reviewedBy: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE streams SET status = ?, reviewed_by = ? WHERE id = ?")
    .bind(status, reviewedBy, id)
    .run();
  return result.meta.changes > 0;
}

// --- Stamp editor helpers ---

interface StampPerformanceRow {
  id: string;
  song_id: string;
  title: string;
  original_artist: string;
  timestamp: number;
  end_timestamp: number | null;
  note: string;
  status: Status;
}

function stampPerformanceFromRow(row: StampPerformanceRow): StampPerformance {
  return {
    id: row.id,
    songId: row.song_id,
    title: row.title,
    originalArtist: row.original_artist,
    timestamp: row.timestamp,
    endTimestamp: row.end_timestamp,
    note: row.note,
    status: row.status,
  };
}

export async function listPerformancesForStream(
  db: D1Database,
  streamId: string,
): Promise<StampPerformance[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.song_id, s.title, s.original_artist, p.timestamp, p.end_timestamp, p.note, p.status
       FROM performances p
       JOIN songs s ON s.id = p.song_id
       WHERE p.stream_id = ?
       ORDER BY p.timestamp ASC`,
    )
    .bind(streamId)
    .all<StampPerformanceRow>();
  return results.map(stampPerformanceFromRow);
}

export async function createSongAndPerformance(
  db: D1Database,
  streamerId: string,
  streamId: string,
  date: string,
  streamTitle: string,
  videoId: string,
  title: string,
  originalArtist: string,
  timestamp: number,
  endTimestamp: number | null,
  note: string,
  submittedBy: string,
): Promise<{ songId: string; performanceId: string }> {
  const songId = generateSongId();
  const perfId = generatePerformanceId();

  await db.batch([
    db
      .prepare(
        'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(songId, streamerId, title, originalArtist, '[]', 'pending', submittedBy),
    db
      .prepare(
        `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(perfId, streamerId, songId, streamId, date, streamTitle, videoId, timestamp, endTimestamp, note, 'pending', submittedBy),
  ]);

  return { songId, performanceId: perfId };
}

export async function updatePerformanceTimestamps(
  db: D1Database,
  id: string,
  fields: { timestamp?: number; endTimestamp?: number | null },
): Promise<boolean> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  if (fields.timestamp !== undefined) {
    sets.push('timestamp = ?');
    values.push(fields.timestamp);
  }
  if (fields.endTimestamp !== undefined) {
    sets.push('end_timestamp = ?');
    values.push(fields.endTimestamp);
  }

  if (sets.length === 0) return false;
  values.push(id);

  const result = await db
    .prepare(`UPDATE performances SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return result.meta.changes > 0;
}

export async function updatePerformanceSongDetails(
  db: D1Database,
  perfId: string,
  fields: { title?: string; originalArtist?: string },
): Promise<boolean> {
  const row = await db
    .prepare('SELECT song_id FROM performances WHERE id = ?')
    .bind(perfId)
    .first<{ song_id: string }>();
  if (!row) return false;

  await updateSong(db, row.song_id, {
    title: fields.title,
    originalArtist: fields.originalArtist,
  });
  return true;
}

export async function deletePerformanceAndOrphanSong(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT song_id FROM performances WHERE id = ?')
    .bind(id)
    .first<{ song_id: string }>();
  if (!row) return false;

  await db.prepare('DELETE FROM performances WHERE id = ?').bind(id).run();

  const countRow = await db
    .prepare('SELECT COUNT(*) as cnt FROM performances WHERE song_id = ?')
    .bind(row.song_id)
    .first<{ cnt: number }>();

  if (countRow && countRow.cnt === 0) {
    await db.prepare('DELETE FROM songs WHERE id = ?').bind(row.song_id).run();
  }

  return true;
}

// --- Stream detail (stream + performances in one call) ---

export async function getStreamDetail(
  db: D1Database,
  streamId: string,
): Promise<StreamDetail | null> {
  const stream = await getStreamById(db, streamId);
  if (!stream) return null;

  const performances = await listPerformancesForStream(db, streamId);
  return { ...stream, performances };
}

// --- Update performance note ---

export async function updatePerformanceNote(
  db: D1Database,
  perfId: string,
  note: string,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE performances SET note = ? WHERE id = ?')
    .bind(note, perfId)
    .run();
  return result.meta.changes > 0;
}

// --- Paste import: bulk create performances ---

export async function bulkCreatePerformances(
  db: D1Database,
  streamerId: string,
  streamId: string,
  date: string,
  streamTitle: string,
  videoId: string,
  songs: Array<{
    songName: string;
    artist: string;
    startSeconds: number;
    endSeconds: number | null;
  }>,
  submittedBy: string,
  replace: boolean,
): Promise<{ created: number }> {
  const stmts: D1PreparedStatement[] = [];

  if (replace) {
    stmts.push(
      db.prepare(
        `DELETE FROM songs WHERE id IN (
           SELECT p.song_id FROM performances p
           WHERE p.stream_id = ?
           AND (SELECT COUNT(*) FROM performances p2 WHERE p2.song_id = p.song_id) = 1
         )`,
      ).bind(streamId),
    );
    stmts.push(
      db.prepare('DELETE FROM performances WHERE stream_id = ?').bind(streamId),
    );
  }

  for (const song of songs) {
    const songId = generateSongId();
    const perfId = generatePerformanceId();

    stmts.push(
      db.prepare(
        'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(songId, streamerId, song.songName, song.artist || 'Unknown', '[]', 'pending', submittedBy),
    );
    stmts.push(
      db.prepare(
        `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(perfId, streamerId, songId, streamId, date, streamTitle, videoId, song.startSeconds, song.endSeconds, '', 'pending', submittedBy),
    );
  }

  await db.batch(stmts);
  return { created: songs.length };
}

// --- Bulk approve all pending songs + performances for a stream ---

export async function bulkApproveStream(
  db: D1Database,
  streamId: string,
  reviewedBy: string,
): Promise<{ songs: number; performances: number }> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE songs SET status = 'approved', reviewed_by = ?, updated_at = datetime('now')
         WHERE id IN (
           SELECT p.song_id FROM performances p
           WHERE p.stream_id = ? AND p.status = 'pending'
         ) AND status = 'pending'`,
      )
      .bind(reviewedBy, streamId),
    db
      .prepare(
        `UPDATE performances SET status = 'approved'
         WHERE stream_id = ? AND status = 'pending'`,
      )
      .bind(streamId),
  ]);

  return {
    songs: results[0].meta.changes,
    performances: results[1].meta.changes,
  };
}

// --- Stamp: streams with pending counts ---

interface StreamWithPendingRow extends StreamRow {
  pending_count: number;
}

export async function listStreamsWithPendingCounts(
  db: D1Database,
  streamerId: string,
): Promise<StreamWithPending[]> {
  const { results } = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM performances p
         WHERE p.stream_id = s.id AND p.end_timestamp IS NULL) AS pending_count
       FROM streams s WHERE s.streamer_id = ? ORDER BY s.date DESC`,
    )
    .bind(streamerId)
    .all<StreamWithPendingRow>();
  return results.map((row) => ({
    ...streamFromRow(row),
    pendingCount: row.pending_count,
  }));
}

// --- Stamp: stats ---

export async function getStampStats(db: D1Database, streamerId: string): Promise<StampStats> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN end_timestamp IS NOT NULL THEN 1 ELSE 0 END) AS filled
       FROM performances WHERE streamer_id = ?`,
    )
    .bind(streamerId)
    .first<{ total: number; filled: number }>();
  const total = row?.total ?? 0;
  const filled = row?.filled ?? 0;
  return { total, filled, remaining: total - filled };
}

// --- Stamp: clear all end timestamps ---

export async function clearAllEndTimestamps(
  db: D1Database,
  streamId: string,
): Promise<number> {
  const result = await db
    .prepare(
      'UPDATE performances SET end_timestamp = NULL WHERE stream_id = ? AND end_timestamp IS NOT NULL',
    )
    .bind(streamId)
    .run();
  return result.meta.changes;
}

// --- Stamp: get performance with song details (for iTunes fetch) ---

export interface PerformanceWithSong {
  id: string;
  title: string;
  originalArtist: string;
  timestamp: number;
  endTimestamp: number | null;
}

export async function getPerformanceWithSong(
  db: D1Database,
  perfId: string,
): Promise<PerformanceWithSong | null> {
  const row = await db
    .prepare(
      `SELECT p.id, s.title, s.original_artist, p.timestamp, p.end_timestamp
       FROM performances p
       JOIN songs s ON s.id = p.song_id
       WHERE p.id = ?`,
    )
    .bind(perfId)
    .first<{
      id: string;
      title: string;
      original_artist: string;
      timestamp: number;
      end_timestamp: number | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    timestamp: row.timestamp,
    endTimestamp: row.end_timestamp,
  };
}

// --- Stats ---

import type { StatusCounts } from '../shared/types';

async function countByStatus(
  db: D1Database,
  table: string,
  streamerId: string,
): Promise<StatusCounts> {
  const { results } = await db
    .prepare(`SELECT status, COUNT(*) as count FROM ${table} WHERE streamer_id = ? GROUP BY status`)
    .bind(streamerId)
    .all<{ status: string; count: number }>();

  const counts: StatusCounts = { pending: 0, approved: 0, rejected: 0, excluded: 0, extracted: 0 };
  for (const row of results) {
    if (row.status in counts) {
      counts[row.status as keyof StatusCounts] = row.count;
    }
  }
  return counts;
}

export async function getDashboardStats(db: D1Database, streamerId: string) {
  const [songs, streams, performances] = await Promise.all([
    countByStatus(db, 'songs', streamerId),
    countByStatus(db, 'streams', streamerId),
    countByStatus(db, 'performances', streamerId),
  ]);

  const { results: recentSongRows } = await db
    .prepare("SELECT * FROM songs WHERE streamer_id = ? ORDER BY created_at DESC LIMIT 5")
    .bind(streamerId)
    .all<SongRow>();
  const { results: recentStreamRows } = await db
    .prepare("SELECT * FROM streams WHERE streamer_id = ? ORDER BY created_at DESC LIMIT 5")
    .bind(streamerId)
    .all<StreamRow>();

  const recentSubmissions = [
    ...recentSongRows.map(songFromRow),
    ...recentStreamRows.map(streamFromRow),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  return { songs, streams, performances, recentSubmissions };
}

// --- Export helpers (fan-site format) ---

export async function exportSongs(db: D1Database, streamerId: string) {
  const { results: songRows } = await db
    .prepare("SELECT * FROM songs WHERE streamer_id = ? AND status = 'approved' ORDER BY title")
    .bind(streamerId)
    .all<SongRow>();
  const { results: perfRows } = await db
    .prepare("SELECT * FROM performances WHERE streamer_id = ? AND status = 'approved' ORDER BY date")
    .bind(streamerId)
    .all<PerformanceRow>();

  const perfsBySong = new Map<string, PerformanceRow[]>();
  for (const p of perfRows) {
    const list = perfsBySong.get(p.song_id) || [];
    list.push(p);
    perfsBySong.set(p.song_id, list);
  }

  return songRows.map((row) => ({
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    tags: JSON.parse(row.tags) as string[],
    performances: (perfsBySong.get(row.id) || []).map((p) => ({
      id: p.id,
      streamId: p.stream_id,
      date: p.date,
      streamTitle: p.stream_title,
      videoId: p.video_id,
      timestamp: p.timestamp,
      endTimestamp: p.end_timestamp,
      note: p.note,
    })),
  }));
}

export async function exportStreams(db: D1Database, streamerId: string) {
  const { results: rows } = await db
    .prepare("SELECT * FROM streams WHERE streamer_id = ? AND status = 'approved' ORDER BY date DESC")
    .bind(streamerId)
    .all<StreamRow>();

  return rows.map((row) => {
    const credit = JSON.parse(row.credit);
    const stream: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      date: row.date,
      videoId: row.video_id,
      youtubeUrl: row.youtube_url,
    };
    if (credit && Object.keys(credit).length > 0) {
      stream.credit = credit;
    }
    return stream;
  });
}
