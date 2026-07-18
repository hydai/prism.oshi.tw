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
  GlobalWorkSummary,
  GlobalWorkStats,
} from '../shared/types';

// --- Row → API type mappers ---

export function songFromRow(row: SongRow): Song {
  return {
    id: row.id,
    workId: row.work_id,
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

export function generateWorkId(): string {
  // Global IDs live across every streamer, so retain the full UUID instead of
  // the shorter local-entity suffixes used by songs and performances.
  return `work-${crypto.randomUUID()}`;
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

type WorkLinkMethod = 'migration_exact' | 'import_exact' | 'manual';

function prepareEnsureExactWork(
  db: D1Database,
  candidateWorkId: string,
  title: string,
  originalArtist: string,
  tagsJson = '[]',
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO works (id, title, original_artist, tags)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(title, original_artist) DO NOTHING`,
  ).bind(candidateWorkId, title, originalArtist, tagsJson);
}

function prepareLinkSongToExactWork(
  db: D1Database,
  songId: string,
  title: string,
  originalArtist: string,
  linkMethod: WorkLinkMethod,
  linkedBy: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO song_work_links (
       song_id, work_id, link_method, linked_by
     )
     SELECT ?, work.id, ?, ?
     FROM works AS work
     WHERE work.title = ? AND work.original_artist = ?`,
  ).bind(songId, linkMethod, linkedBy, title, originalArtist);
}

function prepareEnsureWorkForSongUpdate(
  db: D1Database,
  candidateWorkId: string,
  songId: string,
  title: string | undefined,
  originalArtist: string | undefined,
  tags: string[] | undefined,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO works (id, title, original_artist, tags)
     SELECT ?, COALESCE(?, song.title), COALESCE(?, song.original_artist),
            COALESCE(?, song.tags)
     FROM songs AS song
     WHERE song.id = ?
     ON CONFLICT(title, original_artist) DO NOTHING`,
  ).bind(
    candidateWorkId,
    title ?? null,
    originalArtist ?? null,
    tags === undefined ? null : JSON.stringify(tags),
    songId,
  );
}

function prepareRelinkSongToExactWork(
  db: D1Database,
  songId: string,
  linkedBy: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO song_work_links (
       song_id, work_id, link_method, linked_by
     )
     SELECT song.id, work.id, 'manual', ?
     FROM songs AS song
     JOIN works AS work
       ON work.title = song.title
      AND work.original_artist = song.original_artist
     WHERE song.id = ?
     ON CONFLICT(song_id) DO UPDATE SET
       work_id = excluded.work_id,
       link_method = excluded.link_method,
       linked_by = excluded.linked_by,
       updated_at = datetime('now')`,
  ).bind(linkedBy, songId);
}

// --- Query helpers ---

export async function listSongs(
  db: D1Database,
  streamerId: string,
  status?: string,
): Promise<Song[]> {
  const query = status
    ? db.prepare(`SELECT s.*, link.work_id
        FROM songs AS s
        LEFT JOIN song_work_links AS link ON link.song_id = s.id
        WHERE s.streamer_id = ? AND s.status = ?
        ORDER BY s.created_at DESC`).bind(streamerId, status)
    : db.prepare(`SELECT s.*, link.work_id
        FROM songs AS s
        LEFT JOIN song_work_links AS link ON link.song_id = s.id
        WHERE s.streamer_id = ?
        ORDER BY s.created_at DESC`).bind(streamerId);
  const { results } = await query.all<SongRow>();
  return results.map(songFromRow);
}

// --- Paginated song listing ---

const SORT_COLUMN_MAP: Record<string, string> = {
  title: 's.title',
  originalArtist: 's.original_artist',
  status: 's.status',
  createdAt: 's.created_at',
};

export async function listSongsPaginated(
  db: D1Database,
  streamerId: string,
  opts: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  } = {},
): Promise<{ songs: Song[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const sortCol = SORT_COLUMN_MAP[opts.sortBy ?? ''] ?? 's.created_at';
  const sortDir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = ['s.streamer_id = ?'];
  const binds: (string | number)[] = [streamerId];

  if (opts.status) {
    conditions.push('s.status = ?');
    binds.push(opts.status);
  }
  if (opts.search) {
    conditions.push('(s.title LIKE ? OR s.original_artist LIKE ?)');
    const like = `%${opts.search}%`;
    binds.push(like, like);
  }

  const where = conditions.join(' AND ');

  const countStmt = db
    .prepare(`SELECT COUNT(*) AS cnt FROM songs AS s WHERE ${where}`)
    .bind(...binds);
  const dataStmt = db
    .prepare(
      `SELECT s.*, link.work_id
       FROM songs AS s
       LEFT JOIN song_work_links AS link ON link.song_id = s.id
       WHERE ${where}
       ORDER BY ${sortCol} ${sortDir}
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, pageSize, offset);

  const [countResult, dataResult] = await db.batch([countStmt, dataStmt]);

  const total = (countResult.results[0] as { cnt: number }).cnt;
  const songs = (dataResult.results as SongRow[]).map(songFromRow);

  return { songs, total };
}

interface GlobalWorkSummaryRow {
  id: string;
  title: string;
  original_artist: string;
  tags: string;
  streamer_count: number;
  song_count: number;
  performance_count: number;
  streamer_ids: string;
  created_at: string;
  updated_at: string;
}

interface GlobalWorkStatsRow {
  total_works: number;
  shared_works: number;
  linked_songs: number;
  linked_performances: number;
  unlinked_songs: number;
}

const GLOBAL_WORK_SORT_COLUMN_MAP: Record<string, string> = {
  title: 'title',
  originalArtist: 'original_artist',
  streamerCount: 'streamer_count',
  songCount: 'song_count',
  performanceCount: 'performance_count',
  updatedAt: 'updated_at',
};

export async function listGlobalWorksPaginated(
  db: D1Database,
  opts: {
    search?: string;
    sharedOnly?: boolean;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  } = {},
): Promise<{
  works: GlobalWorkSummary[];
  total: number;
  stats: GlobalWorkStats;
  page: number;
  pageSize: number;
}> {
  const requestedPage = Number.isFinite(opts.page) ? Math.trunc(opts.page!) : 1;
  const requestedPageSize = Number.isFinite(opts.pageSize) ? Math.trunc(opts.pageSize!) : 50;
  const page = Math.max(1, requestedPage);
  const pageSize = Math.min(100, Math.max(1, requestedPageSize));
  const offset = (page - 1) * pageSize;
  const sortCol = GLOBAL_WORK_SORT_COLUMN_MAP[opts.sortBy ?? ''] ?? 'performance_count';
  const sortDir = opts.sortDir === 'asc' ? 'ASC' : 'DESC';

  const searchWhere = opts.search
    ? `WHERE instr(lower(work.title), lower(?)) > 0
       OR instr(lower(work.original_artist), lower(?)) > 0`
    : '';
  const searchBinds = opts.search
    ? [opts.search, opts.search]
    : [];
  const sharedWhere = opts.sharedOnly ? 'WHERE streamer_count > 1' : '';
  const rollupSql = `
    WITH work_rollup AS (
      SELECT
        work.id,
        work.title,
        work.original_artist,
        work.tags,
        COUNT(DISTINCT song.streamer_id) AS streamer_count,
        COUNT(DISTINCT song.id) AS song_count,
        COUNT(DISTINCT performance.id) AS performance_count,
        GROUP_CONCAT(DISTINCT song.streamer_id) AS streamer_ids,
        work.created_at,
        work.updated_at
      FROM works AS work
      JOIN song_work_links AS link ON link.work_id = work.id
      JOIN songs AS song ON song.id = link.song_id
      LEFT JOIN performances AS performance ON performance.song_id = song.id
      ${searchWhere}
      GROUP BY
        work.id, work.title, work.original_artist, work.tags,
        work.created_at, work.updated_at
    )`;

  const countStatement = db
    .prepare(`${rollupSql}
      SELECT COUNT(*) AS count FROM work_rollup ${sharedWhere}`)
    .bind(...searchBinds);
  const dataStatement = db
    .prepare(`${rollupSql}
      SELECT * FROM work_rollup
      ${sharedWhere}
      ORDER BY ${sortCol} ${sortDir}, title ASC, original_artist ASC, id ASC
      LIMIT ? OFFSET ?`)
    .bind(...searchBinds, pageSize, offset);
  const statsStatement = db.prepare(`
    WITH active_works AS (
      SELECT
        link.work_id,
        COUNT(DISTINCT song.streamer_id) AS streamer_count
      FROM song_work_links AS link
      JOIN songs AS song ON song.id = link.song_id
      GROUP BY link.work_id
    )
    SELECT
      (SELECT COUNT(*) FROM active_works) AS total_works,
      (SELECT COUNT(*) FROM active_works WHERE streamer_count > 1) AS shared_works,
      (SELECT COUNT(*) FROM song_work_links) AS linked_songs,
      (
        SELECT COUNT(*)
        FROM performances AS performance
        JOIN song_work_links AS link ON link.song_id = performance.song_id
      ) AS linked_performances,
      (
        SELECT COUNT(*)
        FROM songs AS song
        LEFT JOIN song_work_links AS link ON link.song_id = song.id
        WHERE link.song_id IS NULL
      ) AS unlinked_songs`);

  const [countResult, dataResult, statsResult] = await db.batch([
    countStatement,
    dataStatement,
    statsStatement,
  ]);
  const total = (countResult.results[0] as { count: number } | undefined)?.count ?? 0;
  const works = (dataResult.results as unknown as GlobalWorkSummaryRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    tags: JSON.parse(row.tags) as string[],
    streamerCount: row.streamer_count,
    songCount: row.song_count,
    performanceCount: row.performance_count,
    streamerIds: row.streamer_ids ? row.streamer_ids.split(',') : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const statsRow = statsResult.results[0] as GlobalWorkStatsRow | undefined;
  const stats: GlobalWorkStats = {
    totalWorks: statsRow?.total_works ?? 0,
    sharedWorks: statsRow?.shared_works ?? 0,
    linkedSongs: statsRow?.linked_songs ?? 0,
    linkedPerformances: statsRow?.linked_performances ?? 0,
    unlinkedSongs: statsRow?.unlinked_songs ?? 0,
  };

  return { works, total, stats, page, pageSize };
}

export async function getSongById(
  db: D1Database,
  id: string,
): Promise<Song | null> {
  const row = await db
    .prepare(`SELECT s.*, link.work_id
      FROM songs AS s
      LEFT JOIN song_work_links AS link ON link.song_id = s.id
      WHERE s.id = ?`)
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
  const workId = generateWorkId();
  const tagsJson = JSON.stringify(tags);
  await db.batch([
    prepareEnsureExactWork(db, workId, title, originalArtist, tagsJson),
    db.prepare(
      'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, streamerId, title, originalArtist, tagsJson, 'pending', submittedBy),
    prepareLinkSongToExactWork(db, id, title, originalArtist, 'import_exact', submittedBy),
  ]);
}

export async function updateSong(
  db: D1Database,
  id: string,
  fields: { title?: string; originalArtist?: string; tags?: string[] },
  updatedBy = 'system:song-update',
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

  const updateStatement = db
    .prepare(`UPDATE songs SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values);

  if (fields.title === undefined && fields.originalArtist === undefined) {
    await updateStatement.run();
    return;
  }

  // A title/artist edit changes the exact global identity. Create or reuse the
  // destination work, update the streamer-local song, then repoint its bridge
  // in one ordered D1 batch so the two catalog layers cannot drift apart.
  await db.batch([
    prepareEnsureWorkForSongUpdate(
      db,
      generateWorkId(),
      id,
      fields.title,
      fields.originalArtist,
      fields.tags,
    ),
    updateStatement,
    prepareRelinkSongToExactWork(db, id, updatedBy),
  ]);
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
    .prepare("UPDATE performances SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
  return result.meta.changes > 0;
}

// --- Streams ---

export async function listStreams(
  db: D1Database,
  streamerId: string,
  status?: string,
  search?: string,
): Promise<Stream[]> {
  const conditions = ['streamer_id = ?'];
  const values: string[] = [streamerId];
  if (status) {
    conditions.push('status = ?');
    values.push(status);
  }
  if (search) {
    conditions.push('(id LIKE ? OR video_id LIKE ? OR title LIKE ?)');
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern);
  }
  const query = db.prepare(`
    SELECT * FROM streams
    WHERE ${conditions.join(' AND ')}
    ORDER BY date DESC
  `).bind(...values);
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
  streamerId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM streams WHERE video_id = ? AND streamer_id = ?')
    .bind(videoId, streamerId)
    .first();
  return row !== null;
}

export async function updateStream(
  db: D1Database,
  id: string,
  fields: { title?: string; date?: string; videoId?: string; youtubeUrl?: string },
): Promise<Stream | null> {
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (fields.title !== undefined) {
    sets.push('title = ?');
    values.push(fields.title);
  }
  if (fields.date !== undefined) {
    sets.push('date = ?');
    values.push(fields.date);
  }
  if (fields.videoId !== undefined) {
    sets.push('video_id = ?');
    values.push(fields.videoId);
  }
  if (fields.youtubeUrl !== undefined) {
    sets.push('youtube_url = ?');
    values.push(fields.youtubeUrl);
  }

  if (sets.length === 0) return getStreamById(db, id);

  values.push(id);
  await db
    .prepare(`UPDATE streams SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values)
    .run();

  return getStreamById(db, id);
}

export async function updateStreamStatus(
  db: D1Database,
  id: string,
  status: string,
  reviewedBy: string,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE streams SET status = ?, reviewed_by = ?, updated_at = datetime('now') WHERE id = ?")
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

interface ExactSongIdentity {
  title: string;
  originalArtist: string;
}

interface NewExactSong extends ExactSongIdentity {
  id: string;
}

interface ExactWorkCandidate extends ExactSongIdentity {
  id: string;
}

interface ExactSongLink extends ExactSongIdentity {
  songId: string;
}

function exactSongIdentityKey(identity: ExactSongIdentity): string {
  return JSON.stringify([identity.title, identity.originalArtist]);
}

/**
 * Resolve exact title + original-artist matches before adding performances.
 * Approved/pending songs are reusable catalog entities; rejected/excluded rows
 * deliberately do not absorb a fresh submission. Duplicate identities within
 * one import share the same generated song ID.
 */
async function resolveExactSongIds(
  db: D1Database,
  streamerId: string,
  identities: ExactSongIdentity[],
  excludeSongsOnlyInStreamId?: string,
): Promise<{
  songIds: string[];
  newSongs: NewExactSong[];
  workCandidates: ExactWorkCandidate[];
  songLinks: ExactSongLink[];
}> {
  const uniqueByKey = new Map<string, ExactSongIdentity>();
  for (const identity of identities) {
    uniqueByKey.set(exactSongIdentityKey(identity), identity);
  }

  const unique = [...uniqueByKey.entries()];
  const existingByKey = new Map<string, string>();
  const LOOKUP_CHUNK_SIZE = 50;

  for (let offset = 0; offset < unique.length; offset += LOOKUP_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + LOOKUP_CHUNK_SIZE);
    const statements = chunk.map(([, identity]) => {
      let sql = `SELECT s.id
        FROM songs AS s
        WHERE s.streamer_id = ?
          AND s.title = ?
          AND s.original_artist = ?
          AND s.status IN ('approved', 'pending')`;
      const binds: string[] = [streamerId, identity.title, identity.originalArtist];

      if (excludeSongsOnlyInStreamId !== undefined) {
        sql += `
          AND EXISTS (
            SELECT 1 FROM performances AS p
            WHERE p.song_id = s.id AND p.stream_id <> ?
          )`;
        binds.push(excludeSongsOnlyInStreamId);
      }

      sql += `
        ORDER BY
          CASE s.status WHEN 'approved' THEN 0 ELSE 1 END,
          s.created_at ASC,
          s.id ASC
        LIMIT 1`;
      return db.prepare(sql).bind(...binds);
    });

    const results = await db.batch<{ id: string }>(statements);
    results.forEach((result, index) => {
      const row = result.results[0];
      if (row) existingByKey.set(chunk[index][0], row.id);
    });
  }

  const assignedByKey = new Map(existingByKey);
  const newSongs: NewExactSong[] = [];
  for (const [key, identity] of unique) {
    if (assignedByKey.has(key)) continue;
    const song: NewExactSong = { ...identity, id: generateSongId() };
    assignedByKey.set(key, song.id);
    newSongs.push(song);
  }

  const workCandidates: ExactWorkCandidate[] = unique.map(([, identity]) => ({
    ...identity,
    id: generateWorkId(),
  }));
  const songLinks: ExactSongLink[] = unique.map(([key, identity]) => ({
    ...identity,
    songId: assignedByKey.get(key)!,
  }));

  return {
    songIds: identities.map((identity) => assignedByKey.get(exactSongIdentityKey(identity))!),
    newSongs,
    workCandidates,
    songLinks,
  };
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
  const { songIds, newSongs, workCandidates, songLinks } = await resolveExactSongIds(db, streamerId, [
    { title, originalArtist },
  ]);
  const songId = songIds[0];
  const perfId = generatePerformanceId();

  const statements: D1PreparedStatement[] = workCandidates.map((work) =>
    prepareEnsureExactWork(db, work.id, work.title, work.originalArtist),
  );
  statements.push(...newSongs.map((song) =>
    db
      .prepare(
        'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(song.id, streamerId, song.title, song.originalArtist, '[]', 'pending', submittedBy),
  ));
  statements.push(...songLinks.map((link) =>
    prepareLinkSongToExactWork(
      db,
      link.songId,
      link.title,
      link.originalArtist,
      'import_exact',
      submittedBy,
    ),
  ));
  statements.push(
    db
      .prepare(
        `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(perfId, streamerId, songId, streamId, date, streamTitle, videoId, timestamp, endTimestamp, note, 'pending', submittedBy),
  );
  await db.batch(statements);

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
    .prepare(`UPDATE performances SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values)
    .run();
  return result.meta.changes > 0;
}

export async function updatePerformanceSongDetails(
  db: D1Database,
  perfId: string,
  fields: { title?: string; originalArtist?: string },
  updatedBy = 'system:performance-update',
): Promise<boolean> {
  const row = await db
    .prepare('SELECT song_id FROM performances WHERE id = ?')
    .bind(perfId)
    .first<{ song_id: string }>();
  if (!row) return false;

  await updateSong(db, row.song_id, {
    title: fields.title,
    originalArtist: fields.originalArtist,
  }, updatedBy);
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
    .prepare("UPDATE performances SET note = ?, updated_at = datetime('now') WHERE id = ?")
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
  const identities = songs.map((song) => ({
    title: song.songName,
    originalArtist: song.artist || 'Unknown',
  }));
  const { songIds, newSongs, workCandidates, songLinks } = await resolveExactSongIds(
    db,
    streamerId,
    identities,
    replace ? streamId : undefined,
  );
  const stmts: D1PreparedStatement[] = workCandidates.map((work) =>
    prepareEnsureExactWork(db, work.id, work.title, work.originalArtist),
  );

  if (replace) {
    stmts.push(
      db.prepare(
        `DELETE FROM songs WHERE id IN (
           SELECT p.song_id FROM performances p
           WHERE p.stream_id = ?
           GROUP BY p.song_id
           HAVING COUNT(*) = (
             SELECT COUNT(*) FROM performances p2 WHERE p2.song_id = p.song_id
           )
         )`,
      ).bind(streamId),
    );
    stmts.push(
      db.prepare('DELETE FROM performances WHERE stream_id = ?').bind(streamId),
    );
  }

  for (const song of newSongs) {
    stmts.push(
      db.prepare(
        'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(song.id, streamerId, song.title, song.originalArtist, '[]', 'pending', submittedBy),
    );
  }

  for (const link of songLinks) {
    stmts.push(
      prepareLinkSongToExactWork(
        db,
        link.songId,
        link.title,
        link.originalArtist,
        'import_exact',
        submittedBy,
      ),
    );
  }

  songs.forEach((song, index) => {
    const songId = songIds[index];
    const perfId = generatePerformanceId();

    stmts.push(
      db.prepare(
        `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(perfId, streamerId, songId, streamId, date, streamTitle, videoId, song.startSeconds, song.endSeconds, '', 'pending', submittedBy),
    );
  });

  await db.batch(stmts);
  return { created: songs.length };
}

// --- Import VOD submission into admin DB ---

export async function importVodToAdminDb(
  db: D1Database,
  vod: {
    streamer_slug: string;
    video_id: string;
    video_url: string;
    stream_title: string;
    stream_date: string;
  },
  vodSongs: Array<{
    song_title: string;
    original_artist: string;
    start_timestamp: number;
    end_timestamp: number | null;
  }>,
  submittedBy: string,
): Promise<{ streamId: string; created: number }> {
  const streamerId = vod.streamer_slug;

  // Reuse an existing stream only when it belongs to the submitted streamer. VOD
  // submissions are public input, so a duplicate (or cross-streamer) approval must never
  // overwrite stream metadata or delete curated performances/songs already in the admin
  // catalog. The approval call site additionally gates this import on videoIdExists, but
  // keeping the function non-destructive on its own enforces that invariant locally —
  // independent of any caller.
  const existingStream = await db
    .prepare('SELECT id, title, date FROM streams WHERE video_id = ? AND streamer_id = ?')
    .bind(vod.video_id, streamerId)
    .first<{ id: string; title: string; date: string }>();

  let streamId: string;
  // Denormalized performance metadata follows the stream it attaches to: the existing
  // stream when we reuse one, the submitted values for a freshly created stream.
  let streamTitle = vod.stream_title;
  let streamDate = vod.stream_date;

  const stmts: D1PreparedStatement[] = [];

  if (existingStream) {
    // Append the submitted songs as pending records against the existing stream; leave
    // the stream row and its already-curated performances/songs untouched.
    streamId = existingStream.id;
    streamTitle = existingStream.title;
    streamDate = existingStream.date;
  } else {
    streamId = vod.stream_date
      ? generateStreamId(vod.stream_date)
      : generateStreamIdFallback();

    // Ensure stream ID is unique
    if (await streamIdExists(db, streamId)) {
      streamId = generateStreamIdFallback();
    }

    stmts.push(
      db.prepare(
        'INSERT INTO streams (id, streamer_id, title, date, video_id, youtube_url, credit, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(streamId, streamerId, vod.stream_title, vod.stream_date, vod.video_id, vod.video_url, '{}', 'pending', submittedBy),
    );
  }

  const identities = vodSongs.map((song) => ({
    title: song.song_title,
    originalArtist: song.original_artist || 'Unknown',
  }));
  const { songIds, newSongs, workCandidates, songLinks } = await resolveExactSongIds(
    db,
    streamerId,
    identities,
  );

  for (const work of workCandidates) {
    stmts.push(prepareEnsureExactWork(db, work.id, work.title, work.originalArtist));
  }

  for (const song of newSongs) {
    stmts.push(
      db.prepare(
        'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(song.id, streamerId, song.title, song.originalArtist, '[]', 'pending', submittedBy),
    );
  }

  for (const link of songLinks) {
    stmts.push(
      prepareLinkSongToExactWork(
        db,
        link.songId,
        link.title,
        link.originalArtist,
        'import_exact',
        submittedBy,
      ),
    );
  }

  vodSongs.forEach((song, index) => {
    const songId = songIds[index];
    const perfId = generatePerformanceId();

    stmts.push(
      db.prepare(
        `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(perfId, streamerId, songId, streamId, streamDate, streamTitle, vod.video_id, song.start_timestamp, song.end_timestamp, '', 'pending', submittedBy),
    );
  });

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return { streamId, created: vodSongs.length };
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
        `UPDATE performances SET status = 'approved', updated_at = datetime('now')
         WHERE stream_id = ? AND status = 'pending'`,
      )
      .bind(streamId),
  ]);

  return {
    songs: results[0].meta.changes,
    performances: results[1].meta.changes,
  };
}

// --- Bulk unapprove all approved songs + performances for a stream ---

export async function bulkUnapproveStream(
  db: D1Database,
  streamId: string,
): Promise<{ songs: number; performances: number }> {
  const results = await db.batch([
    db
      .prepare(
        `UPDATE songs SET status = 'pending', reviewed_by = NULL, updated_at = datetime('now')
         WHERE id IN (
           SELECT p.song_id FROM performances p
           WHERE p.stream_id = ? AND p.status = 'approved'
         )
         AND status = 'approved'
         AND NOT EXISTS (
           SELECT 1 FROM performances other
           WHERE other.song_id = songs.id
             AND other.stream_id <> ?
             AND other.status = 'approved'
         )`,
      )
      .bind(streamId, streamId),
    db
      .prepare(
        `UPDATE performances SET status = 'pending', updated_at = datetime('now')
         WHERE stream_id = ? AND status = 'approved'`,
      )
      .bind(streamId),
  ]);

  return {
    songs: results[0].meta.changes,
    performances: results[1].meta.changes,
  };
}

// --- Hard-delete a stream with its performances and orphaned songs ---

export async function deleteStreamCascade(
  db: D1Database,
  streamId: string,
): Promise<{ songs: number; performances: number }> {
  // Count up front: deleting orphan songs cascades to their performances,
  // so meta.changes on the performance delete alone would under-report.
  const perfCount = await db
    .prepare('SELECT COUNT(*) AS cnt FROM performances WHERE stream_id = ?')
    .bind(streamId)
    .first<{ cnt: number }>();

  const results = await db.batch([
    // Songs whose complete performance set is in this stream
    // (their performances go too via ON DELETE CASCADE)
    db.prepare(
      `DELETE FROM songs WHERE id IN (
         SELECT p.song_id FROM performances p
         WHERE p.stream_id = ?
         GROUP BY p.song_id
         HAVING COUNT(*) = (
           SELECT COUNT(*) FROM performances p2 WHERE p2.song_id = p.song_id
         )
       )`,
    ).bind(streamId),
    // Defensive: performances whose songs also appear in other streams
    db.prepare('DELETE FROM performances WHERE stream_id = ?').bind(streamId),
    db.prepare('DELETE FROM streams WHERE id = ?').bind(streamId),
  ]);

  return {
    songs: results[0].meta.changes,
    performances: perfCount?.cnt ?? 0,
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
      "UPDATE performances SET end_timestamp = NULL, updated_at = datetime('now') WHERE stream_id = ? AND end_timestamp IS NOT NULL",
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

import type { StatusCounts, HarmonizeSongEntry, HarmonizeArtistEntry, SimilarityGroup, HarmonizeMatchType } from '../shared/types';
import { normalizeForMatching, normalizeAggressive, similarityScore } from '../shared/normalize';

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
    .prepare(`SELECT song.*, link.work_id
      FROM songs AS song
      LEFT JOIN song_work_links AS link ON link.song_id = song.id
      WHERE song.streamer_id = ?
      ORDER BY song.created_at DESC
      LIMIT 5`)
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
    .prepare(`SELECT song.*, link.work_id
      FROM songs AS song
      LEFT JOIN song_work_links AS link ON link.song_id = song.id
      WHERE song.streamer_id = ? AND song.status = 'approved'
      ORDER BY song.title`)
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
    ...(row.work_id ? { workId: row.work_id } : {}),
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

// --- Harmonizer helpers ---

interface SongWithPerfCount {
  id: string;
  title: string;
  original_artist: string;
  status: Status;
  created_at: string;
  perf_count: number;
}

export async function getSongSimilarityGroups(
  db: D1Database,
  streamerId: string,
  mode: HarmonizeMatchType,
  threshold: number,
): Promise<SimilarityGroup<HarmonizeSongEntry>[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.title, s.original_artist, s.status, s.created_at,
              (SELECT COUNT(*) FROM performances p WHERE p.song_id = s.id) AS perf_count
       FROM songs s WHERE s.streamer_id = ?`,
    )
    .bind(streamerId)
    .all<SongWithPerfCount>();

  const entries: HarmonizeSongEntry[] = results.map((r) => ({
    id: r.id,
    title: r.title,
    originalArtist: r.original_artist,
    status: r.status,
    createdAt: r.created_at,
    performanceCount: r.perf_count,
  }));

  // Pass 1: exact normalization grouping
  const exactGroups = new Map<string, HarmonizeSongEntry[]>();
  for (const entry of entries) {
    const key = normalizeForMatching(entry.title);
    const group = exactGroups.get(key);
    if (group) group.push(entry);
    else exactGroups.set(key, [entry]);
  }

  const result: SimilarityGroup<HarmonizeSongEntry>[] = [];
  const grouped = new Set<string>();

  for (const [key, items] of exactGroups) {
    if (items.length >= 2) {
      result.push({ normalizedKey: key, matchType: 'exact', items });
      for (const item of items) grouped.add(item.id);
    }
  }

  // Pass 2: fuzzy matching on ungrouped singletons (only if mode is fuzzy)
  if (mode === 'fuzzy') {
    const singletons = entries.filter((e) => !grouped.has(e.id));
    const aggressiveKeys = singletons.map((e) => ({
      entry: e,
      normalized: normalizeAggressive(e.title),
    }));

    // Union-find for merging fuzzy pairs
    const parent = new Map<number, number>();
    function find(i: number): number {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) !== i) parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    }
    function union(i: number, j: number) {
      parent.set(find(i), find(j));
    }

    for (let i = 0; i < aggressiveKeys.length; i++) {
      for (let j = i + 1; j < aggressiveKeys.length; j++) {
        const score = similarityScore(aggressiveKeys[i].normalized, aggressiveKeys[j].normalized);
        if (score >= threshold) {
          union(i, j);
        }
      }
    }

    const fuzzyGroups = new Map<number, HarmonizeSongEntry[]>();
    for (let i = 0; i < aggressiveKeys.length; i++) {
      const root = find(i);
      const group = fuzzyGroups.get(root);
      if (group) group.push(aggressiveKeys[i].entry);
      else fuzzyGroups.set(root, [aggressiveKeys[i].entry]);
    }

    for (const items of fuzzyGroups.values()) {
      if (items.length >= 2) {
        const allSame = items.every((i) => i.title === items[0].title);
        if (allSame) continue;
        const key = normalizeAggressive(items[0].title);
        result.push({ normalizedKey: key, matchType: 'fuzzy', items });
      }
    }
  }

  // Sort by group size descending
  result.sort((a, b) => b.items.length - a.items.length);
  return result;
}

export async function getArtistSimilarityGroups(
  db: D1Database,
  streamerId: string,
  mode: HarmonizeMatchType,
  threshold: number,
): Promise<SimilarityGroup<HarmonizeArtistEntry>[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.original_artist FROM songs s WHERE s.streamer_id = ?`,
    )
    .bind(streamerId)
    .all<{ id: string; original_artist: string }>();

  // Group songs by exact artist name first
  const byArtist = new Map<string, { songIds: string[] }>();
  for (const r of results) {
    const existing = byArtist.get(r.original_artist);
    if (existing) existing.songIds.push(r.id);
    else byArtist.set(r.original_artist, { songIds: [r.id] });
  }

  const entries: HarmonizeArtistEntry[] = [];
  for (const [artist, data] of byArtist) {
    entries.push({
      originalArtist: artist,
      songCount: data.songIds.length,
      songIds: data.songIds,
    });
  }

  // Pass 1: exact normalization grouping
  const exactGroups = new Map<string, HarmonizeArtistEntry[]>();
  for (const entry of entries) {
    const key = normalizeForMatching(entry.originalArtist);
    const group = exactGroups.get(key);
    if (group) group.push(entry);
    else exactGroups.set(key, [entry]);
  }

  const result: SimilarityGroup<HarmonizeArtistEntry>[] = [];
  const grouped = new Set<string>();

  for (const [key, items] of exactGroups) {
    if (items.length >= 2) {
      result.push({ normalizedKey: key, matchType: 'exact', items });
      for (const item of items) grouped.add(item.originalArtist);
    }
  }

  // Pass 2: fuzzy matching
  if (mode === 'fuzzy') {
    const singletons = entries.filter((e) => !grouped.has(e.originalArtist));
    const aggressiveKeys = singletons.map((e) => ({
      entry: e,
      normalized: normalizeAggressive(e.originalArtist),
    }));

    const parent = new Map<number, number>();
    function find(i: number): number {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) !== i) parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    }
    function union(i: number, j: number) {
      parent.set(find(i), find(j));
    }

    for (let i = 0; i < aggressiveKeys.length; i++) {
      for (let j = i + 1; j < aggressiveKeys.length; j++) {
        const score = similarityScore(aggressiveKeys[i].normalized, aggressiveKeys[j].normalized);
        if (score >= threshold) {
          union(i, j);
        }
      }
    }

    const fuzzyGroups = new Map<number, HarmonizeArtistEntry[]>();
    for (let i = 0; i < aggressiveKeys.length; i++) {
      const root = find(i);
      const group = fuzzyGroups.get(root);
      if (group) group.push(aggressiveKeys[i].entry);
      else fuzzyGroups.set(root, [aggressiveKeys[i].entry]);
    }

    for (const items of fuzzyGroups.values()) {
      if (items.length >= 2) {
        const key = normalizeAggressive(items[0].originalArtist);
        result.push({ normalizedKey: key, matchType: 'fuzzy', items });
      }
    }
  }

  result.sort((a, b) => b.items.length - a.items.length);
  return result;
}

type SongMergeErrorCode = 'invalid_request' | 'song_not_found';

export class SongMergeError extends Error {
  constructor(
    readonly code: SongMergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SongMergeError';
  }
}

interface SongMergeRow {
  id: string;
  streamer_id: string;
  title: string;
  original_artist: string;
  tags: string;
  status: Status;
  submitted_by: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export interface MergeSongsResult {
  canonicalSongId: string;
  mergedSongs: number;
  movedPerformances: number;
}

const MERGE_SOURCE_LIMIT = 50;
const MERGED_STATUS_PRIORITY: Status[] = [
  'approved',
  'pending',
  'extracted',
  'excluded',
  'rejected',
];

function parseSongTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Atomically merge explicit source song entities into one canonical song.
 * Performances are repointed, source rows are snapshotted in song_aliases,
 * and no performance rows are deleted.
 */
export async function mergeSongs(
  db: D1Database,
  streamerId: string,
  canonicalSongId: string,
  sourceSongIds: string[],
  mergedBy: string,
): Promise<MergeSongsResult> {
  const uniqueSourceIds = [...new Set(sourceSongIds)];
  if (!canonicalSongId || uniqueSourceIds.length === 0) {
    throw new SongMergeError('invalid_request', 'A canonical song and at least one source song are required');
  }
  if (uniqueSourceIds.length !== sourceSongIds.length) {
    throw new SongMergeError('invalid_request', 'Source song IDs must be unique');
  }
  if (uniqueSourceIds.includes(canonicalSongId)) {
    throw new SongMergeError('invalid_request', 'The canonical song cannot also be a source song');
  }
  if (uniqueSourceIds.length > MERGE_SOURCE_LIMIT) {
    throw new SongMergeError('invalid_request', `At most ${MERGE_SOURCE_LIMIT} source songs can be merged at once`);
  }

  const requestedIds = [canonicalSongId, ...uniqueSourceIds];
  const placeholders = requestedIds.map(() => '?').join(', ');
  const { results: rows } = await db
    .prepare(
      `SELECT id, streamer_id, title, original_artist, tags, status,
              submitted_by, reviewed_by, created_at
       FROM songs
       WHERE streamer_id = ? AND id IN (${placeholders})`,
    )
    .bind(streamerId, ...requestedIds)
    .all<SongMergeRow>();

  const rowById = new Map(rows.map((row) => [row.id, row]));
  if (rowById.size !== requestedIds.length) {
    throw new SongMergeError('song_not_found', 'One or more songs do not exist for the selected streamer');
  }

  const sourcePlaceholders = uniqueSourceIds.map(() => '?').join(', ');
  const mismatchedPerformance = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM performances
       WHERE song_id IN (${sourcePlaceholders}) AND streamer_id <> ?`,
    )
    .bind(...uniqueSourceIds, streamerId)
    .first<{ count: number }>();
  if ((mismatchedPerformance?.count ?? 0) > 0) {
    throw new SongMergeError(
      'invalid_request',
      'A source song has performances assigned to a different streamer',
    );
  }

  const canonical = rowById.get(canonicalSongId)!;
  const sources = uniqueSourceIds.map((id) => rowById.get(id)!);
  const allRows = [canonical, ...sources];
  const tags = [...new Set(allRows.flatMap((row) => parseSongTags(row.tags)))];
  const mergedStatus = MERGED_STATUS_PRIORITY.find((status) =>
    allRows.some((row) => row.status === status),
  ) ?? canonical.status;
  const reviewedBy = canonical.reviewed_by
    ?? allRows.find((row) => row.status === mergedStatus && row.reviewed_by)?.reviewed_by
    ?? null;

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE song_aliases
       SET canonical_song_id = ?
       WHERE streamer_id = ? AND canonical_song_id IN (${sourcePlaceholders})`,
    ).bind(canonicalSongId, streamerId, ...uniqueSourceIds),
  ];

  for (const source of sources) {
    statements.push(
      db.prepare(
        `INSERT INTO song_aliases (
           source_song_id, canonical_song_id, streamer_id,
           source_title, source_original_artist, source_status, source_tags,
           source_submitted_by, source_reviewed_by, source_created_at, merged_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        source.id,
        canonicalSongId,
        streamerId,
        source.title,
        source.original_artist,
        source.status,
        source.tags,
        source.submitted_by,
        source.reviewed_by,
        source.created_at,
        mergedBy,
      ),
    );
  }

  statements.push(
    db.prepare(
      `UPDATE songs
       SET tags = ?, status = ?, reviewed_by = ?, updated_at = datetime('now')
       WHERE id = ? AND streamer_id = ?`,
    ).bind(JSON.stringify(tags), mergedStatus, reviewedBy, canonicalSongId, streamerId),
  );

  const performanceUpdateIndex = statements.length;
  statements.push(
    db.prepare(
      `UPDATE performances
       SET song_id = ?, updated_at = datetime('now')
       WHERE streamer_id = ? AND song_id IN (${sourcePlaceholders})`,
    ).bind(canonicalSongId, streamerId, ...uniqueSourceIds),
  );

  const songDeleteIndex = statements.length;
  statements.push(
    db.prepare(
      `DELETE FROM songs
       WHERE streamer_id = ? AND id IN (${sourcePlaceholders})`,
    ).bind(streamerId, ...uniqueSourceIds),
  );

  const batchResults = await db.batch(statements);
  return {
    canonicalSongId,
    mergedSongs: batchResults[songDeleteIndex].meta.changes,
    movedPerformances: batchResults[performanceUpdateIndex].meta.changes,
  };
}

export async function batchUpdateSongs(
  db: D1Database,
  updates: Array<{ songId: string; title?: string; originalArtist?: string }>,
  updatedBy = 'system:harmonizer',
): Promise<number> {
  if (updates.length === 0) return 0;

  // Each identity update emits three ordered statements (ensure work, update
  // local song, relink work), so keep each D1 batch comfortably bounded.
  const CHUNK_SIZE = 25;
  let totalUpdated = 0;

  for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
    const chunk = updates.slice(i, i + CHUNK_SIZE);
    const stmts: D1PreparedStatement[] = [];
    const updateStatementIndexes: number[] = [];

    for (const u of chunk) {
      const sets: string[] = [];
      const values: (string | number)[] = [];

      if (u.title !== undefined) {
        sets.push('title = ?');
        values.push(u.title);
      }
      if (u.originalArtist !== undefined) {
        sets.push('original_artist = ?');
        values.push(u.originalArtist);
      }

      if (sets.length === 0) continue;

      sets.push("updated_at = datetime('now')");
      values.push(u.songId);

      stmts.push(
        prepareEnsureWorkForSongUpdate(
          db,
          generateWorkId(),
          u.songId,
          u.title,
          u.originalArtist,
          undefined,
        ),
      );
      updateStatementIndexes.push(stmts.length);
      stmts.push(
        db.prepare(`UPDATE songs SET ${sets.join(', ')} WHERE id = ?`).bind(...values),
        prepareRelinkSongToExactWork(db, u.songId, updatedBy),
      );
    }

    if (stmts.length > 0) {
      const results = await db.batch(stmts);
      for (const index of updateStatementIndexes) {
        totalUpdated += results[index].meta.changes;
      }
    }
  }

  return totalUpdated;
}
