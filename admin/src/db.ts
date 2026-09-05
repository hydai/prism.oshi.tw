import { HARMONIZE_MERGE_SOURCE_LIMIT } from '../shared/types';
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
  HarmonizeWorkMergeConfirmation,
} from '../shared/types';
import {
  guardedStatement,
  prepareMergeGuardCleanup,
  prepareMergeGuardInsert,
} from './guard';
import type { MergeGuardValidityCte } from './guard';

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
    streamerId: row.streamer_id,
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

// Every generated id keeps the whole UUID. The old eight-hex-character suffix
// was a 32-bit id space: by the birthday bound ~1.18 * sqrt(2^32) ≈ 77k ids
// sharing a prefix reach even odds of a duplicate, and these ids are primary
// keys inserted with no uniqueness retry. Existing short ids stay valid —
// nothing reads an id's shape.

export function generateSongId(): string {
  return `song-${crypto.randomUUID()}`;
}

export function generateWorkId(): string {
  return `work-${crypto.randomUUID()}`;
}

export function generatePerformanceId(): string {
  return `p-${crypto.randomUUID()}`;
}

/** Primary stream id: date-derived so one broadcast maps to one row. */
export function generateStreamId(date: string): string {
  return `stream-${date}`;
}

/** Used only when a stream arrives without a usable date. */
export function generateStreamIdFallback(): string {
  return `stream-${crypto.randomUUID()}`;
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
     SELECT ?, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM work_aliases AS alias
       JOIN works AS canonical_work
         ON canonical_work.id = alias.canonical_work_id
       WHERE alias.source_title = ?
         AND alias.source_original_artist = ?
     )
     ON CONFLICT(title, original_artist) DO NOTHING`,
  ).bind(candidateWorkId, title, originalArtist, tagsJson, title, originalArtist);
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
     SELECT ?, resolved.work_id, ?, ?
     FROM (
       SELECT alias.canonical_work_id AS work_id, 0 AS resolution_order
       FROM work_aliases AS alias
       JOIN works AS canonical_work
         ON canonical_work.id = alias.canonical_work_id
       WHERE alias.source_title = ?
         AND alias.source_original_artist = ?

       UNION ALL

       SELECT work.id AS work_id, 1 AS resolution_order
       FROM works AS work
       WHERE work.title = ? AND work.original_artist = ?

       ORDER BY resolution_order
       LIMIT 1
     ) AS resolved`,
  ).bind(songId, linkMethod, linkedBy, title, originalArtist, title, originalArtist);
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
     SELECT ?, identity.title, identity.original_artist, identity.tags
     FROM (
       SELECT COALESCE(?, song.title) AS title,
              COALESCE(?, song.original_artist) AS original_artist,
              COALESCE(?, song.tags) AS tags
       FROM songs AS song
       WHERE song.id = ?
     ) AS identity
     WHERE NOT EXISTS (
       SELECT 1
       FROM work_aliases AS alias
       JOIN works AS canonical_work
         ON canonical_work.id = alias.canonical_work_id
       WHERE alias.source_title = identity.title
         AND alias.source_original_artist = identity.original_artist
     )
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
     SELECT song.id, resolved_work.id, 'manual', ?
     FROM songs AS song
     JOIN works AS resolved_work
       ON resolved_work.id = COALESCE(
         (
           SELECT alias.canonical_work_id
           FROM work_aliases AS alias
           JOIN works AS canonical_work
             ON canonical_work.id = alias.canonical_work_id
           WHERE alias.source_title = song.title
             AND alias.source_original_artist = song.original_artist
           ORDER BY alias.merged_at DESC, alias.source_work_id DESC
           LIMIT 1
         ),
         (
           SELECT work.id
           FROM works AS work
           WHERE work.title = song.title
             AND work.original_artist = song.original_artist
           LIMIT 1
         )
       )
     WHERE song.id = ?
     ON CONFLICT(song_id) DO UPDATE SET
       work_id = excluded.work_id,
       link_method = excluded.link_method,
       linked_by = excluded.linked_by,
       updated_at = datetime('now')`,
  ).bind(linkedBy, songId);
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

// Non-authoritative, bounded derived cache: one entry per live D1 binding.
// The SQL below validates its revision INSIDE the same batch as the page. A
// cold isolate or changed catalog simply recomputes; correctness needs no hit.
const globalWorkStatsCache = new WeakMap<D1Database, { revision: number; stats: GlobalWorkStats }>();

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
    // Counting/filtering work identities needs no performance rows. In
    // particular, do not multiply songs by performances just to COUNT works.
    .prepare(`WITH work_rollup AS (
      SELECT work.id, COUNT(DISTINCT song.streamer_id) AS streamer_count
      FROM works AS work
      JOIN song_work_links AS link ON link.work_id = work.id
      JOIN songs AS song ON song.id = link.song_id
      ${searchWhere}
      GROUP BY work.id
    )
      SELECT COUNT(*) AS count FROM work_rollup ${sharedWhere}`)
    .bind(...searchBinds);
  const dataStatement = db
    .prepare(`${rollupSql}
      SELECT * FROM work_rollup
      ${sharedWhere}
      ORDER BY ${sortCol} ${sortDir}, title ASC, original_artist ASC, id ASC
      LIMIT ? OFFSET ?`)
    .bind(...searchBinds, pageSize, offset);
  const cachedStats = globalWorkStatsCache.get(db);
  const statsStatement = db.prepare(`
    WITH active_works AS (
      SELECT
        link.work_id,
        COUNT(DISTINCT song.streamer_id) AS streamer_count
      FROM song_work_links AS link
      JOIN songs AS song ON song.id = link.song_id
      GROUP BY link.work_id
    )
    SELECT revision,
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
      ) AS unlinked_songs
    FROM (SELECT COALESCE((SELECT revision FROM work_match_state WHERE id = 1), -1) AS revision)
    WHERE revision <> ?`).bind(cachedStats?.revision ?? -1);

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
    streamerIds: row.streamer_ids ? row.streamer_ids.split(',').sort() : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const statsRow = statsResult.results[0] as (GlobalWorkStatsRow & { revision: number }) | undefined;
  if (statsRow?.revision === -1) throw new Error('Global work statistics revision is missing');
  if (!statsRow && !cachedStats) throw new Error('Global work statistics revision is missing');
  const stats: GlobalWorkStats = statsRow ? {
    totalWorks: statsRow?.total_works ?? 0,
    sharedWorks: statsRow?.shared_works ?? 0,
    linkedSongs: statsRow?.linked_songs ?? 0,
    linkedPerformances: statsRow?.linked_performances ?? 0,
    unlinkedSongs: statsRow?.unlinked_songs ?? 0,
  } : cachedStats!.stats;
  if (statsRow && Number.isSafeInteger(statsRow.revision)) {
    globalWorkStatsCache.set(db, { revision: statsRow.revision, stats });
  }

  return { works, total, stats, page, pageSize };
}

/** Tenant check for routes that attach data to an existing song by id. */
export async function songBelongsToStreamer(
  db: D1Database,
  id: string,
  streamerId: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM songs WHERE id = ? AND streamer_id = ?')
    .bind(id, streamerId)
    .first<{ id: string }>();
  return row !== null;
}

export async function getSongById(
  db: D1Database,
  id: string,
): Promise<Song | null> {
  const [songResult, perfResult] = await db.batch([
    db.prepare(`SELECT s.*, link.work_id
      FROM songs AS s
      LEFT JOIN song_work_links AS link ON link.song_id = s.id
      WHERE s.id = ?`).bind(id),
    db.prepare('SELECT * FROM performances WHERE song_id = ? ORDER BY date DESC').bind(id),
  ]);

  const row = songResult.results[0] as SongRow | undefined;
  if (!row) return null;

  const song = songFromRow(row);
  song.performances = (perfResult.results as PerformanceRow[]).map(performanceFromRow);
  return song;
}

// Standalone inserts keep their positional contract. Bulk catalog imports use
// the set-based, transactional identity resolution in prepareCatalogWrites.
function prepareSongInsert(
  db: D1Database,
  streamerId: string,
  songId: string,
  title: string,
  originalArtist: string,
  tags: string[],
  submittedBy: string,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(songId, streamerId, title, originalArtist, JSON.stringify(tags), 'pending', submittedBy);
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
  await db.batch([
    prepareEnsureExactWork(db, workId, title, originalArtist, JSON.stringify(tags)),
    prepareSongInsert(db, streamerId, id, title, originalArtist, tags, submittedBy),
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
  status: Status,
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

export interface PerformanceInsert {
  readonly id: string;
  readonly streamId: string;
  readonly date: string;
  readonly streamTitle: string;
  readonly videoId: string;
  readonly timestamp: number;
  readonly endTimestamp: number | null;
  readonly note: string;
}

function preparePerformanceInsert(
  db: D1Database,
  streamerId: string,
  songId: string,
  performance: PerformanceInsert,
  submittedBy: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      performance.id,
      streamerId,
      songId,
      performance.streamId,
      performance.date,
      performance.streamTitle,
      performance.videoId,
      performance.timestamp,
      performance.endTimestamp,
      performance.note,
      'pending',
      submittedBy,
    );
}

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

export interface PerformanceCreateInput extends PerformanceInsert {
  readonly streamerId: string;
  readonly songId: string;
  readonly submittedBy: string;
}

export async function insertPerformance(db: D1Database, input: PerformanceCreateInput): Promise<void> {
  await preparePerformanceInsert(db, input.streamerId, input.songId, input, input.submittedBy).run();
}

export async function insertPerformances(
  db: D1Database,
  streamerId: string,
  songId: string,
  performances: readonly PerformanceInsert[],
  submittedBy: string,
): Promise<void> {
  if (performances.length === 0) return;
  await db.batch(performances.map((performance) =>
    preparePerformanceInsert(db, streamerId, songId, performance, submittedBy),
  ));
}

export async function getPerformanceStatus(
  db: D1Database,
  id: string,
): Promise<Status | null> {
  const row = await db
    .prepare('SELECT status FROM performances WHERE id = ?')
    .bind(id)
    .first<{ status: Status }>();
  return row?.status ?? null;
}

// Current clip bounds — the timestamps route merges one-sided edits with these
// so the end-after-start invariant holds against the STORED counterpart too.
export async function getPerformanceTimestamps(
  db: D1Database,
  id: string,
): Promise<{ timestamp: number; endTimestamp: number | null } | null> {
  const row = await db
    .prepare('SELECT timestamp, end_timestamp FROM performances WHERE id = ?')
    .bind(id)
    .first<{ timestamp: number; end_timestamp: number | null }>();
  return row ? { timestamp: row.timestamp, endTimestamp: row.end_timestamp } : null;
}

export async function updatePerformanceStatus(
  db: D1Database,
  id: string,
  status: Status,
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
  streamerId: string,
): Promise<Stream | null> {
  const row = await db
    .prepare('SELECT * FROM streams WHERE id = ? AND streamer_id = ?')
    .bind(id, streamerId)
    .first<StreamRow>();
  return row ? streamFromRow(row) : null;
}

export interface StreamInsert {
  readonly streamerId: string;
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly videoId: string;
  readonly youtubeUrl: string;
  readonly credit: string;
  readonly submittedBy: string;
}

// The single home of the streams INSERT literal (updated_at is set in SQL so migrated
// tables without a column DEFAULT never receive NULL). insertStream (one row) and
// insertStreams (many rows, in one db.batch) both build on this prepared core.
function prepareStreamInsert(db: D1Database, input: StreamInsert): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO streams (id, streamer_id, title, date, video_id, youtube_url, credit, status, submitted_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      input.id,
      input.streamerId,
      input.title,
      input.date,
      input.videoId,
      input.youtubeUrl,
      input.credit,
      'pending',
      input.submittedBy,
    );
}

export async function insertStream(db: D1Database, input: StreamInsert): Promise<void> {
  await prepareStreamInsert(db, input).run();
}

export async function insertStreams(db: D1Database, streams: readonly StreamInsert[]): Promise<void> {
  if (streams.length === 0) return;
  await db.batch(streams.map((stream) => prepareStreamInsert(db, stream)));
}

// One preflight D1 round trip for an import-streams request of any size: which of the
// candidate video ids are already imported for this streamer, and which of the
// candidate (deterministic, date-based) stream ids already exist and would collide.
export async function findExistingStreamImportKeys(
  db: D1Database,
  streamerId: string,
  videoIds: readonly string[],
  candidateStreamIds: readonly string[],
): Promise<{ existingVideoIds: Set<string>; existingStreamIds: Set<string> }> {
  if (videoIds.length === 0) {
    return { existingVideoIds: new Set(), existingStreamIds: new Set() };
  }

  const [videoResult, idResult] = await db.batch<{ video_id?: string; id?: string }>([
    db.prepare(
      'SELECT video_id FROM streams WHERE streamer_id = ? AND video_id IN (SELECT value FROM json_each(?))',
    ).bind(streamerId, JSON.stringify(videoIds)),
    db.prepare(
      'SELECT id FROM streams WHERE id IN (SELECT value FROM json_each(?))',
    ).bind(JSON.stringify(candidateStreamIds)),
  ]);

  return {
    existingVideoIds: new Set(
      videoResult.results.map((row) => row.video_id).filter((videoId): videoId is string => !!videoId),
    ),
    existingStreamIds: new Set(
      idResult.results.map((row) => row.id).filter((streamId): streamId is string => !!streamId),
    ),
  };
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
  streamerId: string,
  fields: { title?: string; date?: string; videoId?: string; youtubeUrl?: string },
): Promise<Stream | null> {
  const streamSets: string[] = [];
  const streamValues: string[] = [];
  // performances carry copies of title/date/video_id (schema.sql: performances.
  // stream_title/date/video_id) and the fan-site export reads those copies, so
  // they must change in the same transaction as the stream row.
  const perfSets: string[] = [];
  const perfValues: string[] = [];

  if (fields.title !== undefined) {
    streamSets.push('title = ?');
    streamValues.push(fields.title);
    perfSets.push('stream_title = ?');
    perfValues.push(fields.title);
  }
  if (fields.date !== undefined) {
    streamSets.push('date = ?');
    streamValues.push(fields.date);
    perfSets.push('date = ?');
    perfValues.push(fields.date);
  }
  if (fields.videoId !== undefined) {
    streamSets.push('video_id = ?');
    streamValues.push(fields.videoId);
    perfSets.push('video_id = ?');
    perfValues.push(fields.videoId);
  }
  if (fields.youtubeUrl !== undefined) {
    streamSets.push('youtube_url = ?');
    streamValues.push(fields.youtubeUrl);
  }

  if (streamSets.length === 0) return getStreamById(db, id, streamerId);

  const statements = [
    db
      .prepare(`UPDATE streams SET ${streamSets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND streamer_id = ?`)
      .bind(...streamValues, id, streamerId),
  ];
  if (perfSets.length > 0) {
    // Scoped by streamer_id as well: a performance that points at this stream but
    // belongs to another streamer is a data-integrity anomaly for the drift report,
    // never a write target of this streamer's edit.
    statements.push(
      db
        .prepare(`UPDATE performances SET ${perfSets.join(', ')}, updated_at = datetime('now') WHERE stream_id = ? AND streamer_id = ?`)
        .bind(...perfValues, id, streamerId),
    );
  }
  await db.batch(statements);

  return getStreamById(db, id, streamerId);
}

export async function updateStreamStatus(
  db: D1Database,
  id: string,
  status: Status,
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

export interface CatalogSongInput {
  readonly title: string;
  readonly originalArtist: string;
  readonly timestamp: number;
  readonly endTimestamp: number | null;
  readonly note: string;
}

export interface CatalogWriteInput {
  readonly streamerId: string;
  readonly streamId: string;
  readonly date: string;
  readonly streamTitle: string;
  readonly videoId: string;
  readonly songs: readonly CatalogSongInput[];
  readonly submittedBy: string;
  readonly excludeSongsOnlyInStreamId?: string;
}

/**
 * Resolve identities INSIDE the caller's write transaction. The same four
 * set-based statements handle one song or a whole import; no pre-read IDs can
 * become stale between lookup and insert. Existing curated duplicates remain
 * legal, and approved/oldest/id still chooses the canonical local song.
 */
function prepareCatalogWrites(
  db: D1Database,
  input: CatalogWriteInput,
): { statements: D1PreparedStatement[] } {
  const identities = new Map<string, { songId: string; workId: string }>();
  const rows = input.songs.map((song) => {
    const originalArtist = song.originalArtist || 'Unknown';
    const key = JSON.stringify([song.title, originalArtist]);
    let identity = identities.get(key);
    if (!identity) {
      identity = { songId: generateSongId(), workId: generateWorkId() };
      identities.set(key, identity);
    }
    return {
      ...song, ...identity, originalArtist,
      performanceId: generatePerformanceId(),
      streamerId: input.streamerId, streamId: input.streamId,
      date: input.date, streamTitle: input.streamTitle, videoId: input.videoId,
      submittedBy: input.submittedBy,
      excludeStreamId: input.excludeSongsOnlyInStreamId ?? null,
    };
  });
  if (rows.length === 0) return { statements: [] };
  const payload = JSON.stringify(rows);
  const entries = `WITH entries AS (
    SELECT
      value ->> '$.songId' AS song_id, value ->> '$.workId' AS work_id,
      value ->> '$.title' AS title, value ->> '$.originalArtist' AS original_artist,
      value ->> '$.streamerId' AS streamer_id, value ->> '$.submittedBy' AS submitted_by,
      value ->> '$.excludeStreamId' AS exclude_stream_id,
      value ->> '$.performanceId' AS performance_id, value ->> '$.streamId' AS stream_id,
      value ->> '$.date' AS date, value ->> '$.streamTitle' AS stream_title,
      value ->> '$.videoId' AS video_id, value ->> '$.timestamp' AS timestamp,
      value ->> '$.endTimestamp' AS end_timestamp, value ->> '$.note' AS note
    FROM json_each(?)
  ), identities AS (
    SELECT DISTINCT song_id, work_id, title, original_artist, streamer_id, submitted_by, exclude_stream_id
    FROM entries
  )`;
  const matchingSong = `SELECT s.id FROM songs AS s
    WHERE s.streamer_id = item.streamer_id
      AND s.title = item.title AND s.original_artist = item.original_artist
      AND s.status IN ('approved', 'pending')
      AND (item.exclude_stream_id IS NULL OR s.id = item.song_id OR EXISTS (
        SELECT 1 FROM performances AS p WHERE p.song_id = s.id AND p.stream_id <> item.exclude_stream_id
      ))
    ORDER BY CASE s.status WHEN 'approved' THEN 0 ELSE 1 END, s.created_at ASC, s.id ASC
    LIMIT 1`;
  const resolved = `${entries}, resolved AS (
    SELECT item.*, (${matchingSong}) AS resolved_song_id FROM identities AS item
  )`;
  const statements = [
    db.prepare(`${entries}
      INSERT INTO works (id, title, original_artist, tags)
      SELECT work_id, title, original_artist, '[]' FROM identities AS item
      WHERE NOT EXISTS (
        SELECT 1 FROM work_aliases AS alias JOIN works AS canonical_work
          ON canonical_work.id = alias.canonical_work_id
        WHERE alias.source_title = item.title AND alias.source_original_artist = item.original_artist
      )
      ON CONFLICT(title, original_artist) DO NOTHING`).bind(payload),
    db.prepare(`${entries}
      INSERT INTO songs (id, streamer_id, title, original_artist, tags, status, submitted_by)
      SELECT song_id, streamer_id, title, original_artist, '[]', 'pending', submitted_by
      FROM identities AS item WHERE NOT EXISTS (${matchingSong})`).bind(payload),
    db.prepare(`${resolved}
      INSERT OR IGNORE INTO song_work_links (song_id, work_id, link_method, linked_by)
      SELECT resolved_song_id, (
        SELECT work_id FROM (
          SELECT alias.canonical_work_id AS work_id, 0 AS resolution_order
          FROM work_aliases AS alias JOIN works AS canonical_work
            ON canonical_work.id = alias.canonical_work_id
          WHERE alias.source_title = item.title AND alias.source_original_artist = item.original_artist
          UNION ALL
          SELECT work.id AS work_id, 1 AS resolution_order FROM works AS work
          WHERE work.title = item.title AND work.original_artist = item.original_artist
          ORDER BY resolution_order LIMIT 1
        )
      ), 'import_exact', submitted_by FROM resolved AS item`).bind(payload),
    db.prepare(`${resolved}
      INSERT INTO performances (id, streamer_id, song_id, stream_id, date, stream_title, video_id,
        timestamp, end_timestamp, note, status, submitted_by, updated_at)
      SELECT entry.performance_id, entry.streamer_id, resolved.resolved_song_id, entry.stream_id,
        entry.date, entry.stream_title, entry.video_id, entry.timestamp, entry.end_timestamp,
        entry.note, 'pending', entry.submitted_by, datetime('now')
      FROM entries AS entry JOIN resolved ON resolved.song_id = entry.song_id
      RETURNING id, song_id`).bind(payload),
  ];
  return { statements };
}

export interface CreateSongAndPerformanceInput {
  readonly streamerId: string;
  readonly streamId: string;
  readonly date: string;
  readonly streamTitle: string;
  readonly videoId: string;
  readonly title: string;
  readonly originalArtist: string;
  readonly timestamp: number;
  readonly endTimestamp: number | null;
  readonly note: string;
  readonly submittedBy: string;
}

export async function createSongAndPerformance(
  db: D1Database,
  input: CreateSongAndPerformanceInput,
): Promise<{ songId: string; performanceId: string }> {
  const catalog = prepareCatalogWrites(db, {
    streamerId: input.streamerId,
    streamId: input.streamId,
    date: input.date,
    streamTitle: input.streamTitle,
    videoId: input.videoId,
    songs: [{
      title: input.title,
      originalArtist: input.originalArtist,
      timestamp: input.timestamp,
      endTimestamp: input.endTimestamp,
      note: input.note,
    }],
    submittedBy: input.submittedBy,
  });
  const results = await db.batch<{ id: string; song_id: string }>(catalog.statements);
  const inserted = results.at(-1)?.results[0];
  if (!inserted) throw new Error('Catalog insert did not return a performance');
  return { songId: inserted.song_id, performanceId: inserted.id };
}

// The end-after-start invariant is enforced INSIDE the UPDATE's WHERE, merging
// each incoming field with the stored counterpart — two overlapping one-sided
// edits can both pass a read-before-write check, so the write itself must be
// the gate. Returns false when the row is missing OR the merged pair would be
// inverted (callers that pre-read can tell the two apart with a re-read).
export async function updatePerformanceTimestamps(
  db: D1Database,
  id: string,
  fields: { timestamp?: number; endTimestamp?: number | null },
): Promise<boolean> {
  const hasTimestamp = fields.timestamp !== undefined;
  const hasEnd = fields.endTimestamp !== undefined;
  if (!hasTimestamp && !hasEnd) return false;

  const timestampFlag = hasTimestamp ? 1 : 0;
  const timestampValue = fields.timestamp ?? null;
  const endFlag = hasEnd ? 1 : 0;
  const endValue = fields.endTimestamp ?? null;

  const result = await db
    .prepare(
      `UPDATE performances SET
         timestamp = CASE WHEN ? THEN ? ELSE timestamp END,
         end_timestamp = CASE WHEN ? THEN ? ELSE end_timestamp END,
         updated_at = datetime('now')
       WHERE id = ?
         AND (
           (CASE WHEN ? THEN ? ELSE end_timestamp END) IS NULL
           OR (CASE WHEN ? THEN ? ELSE end_timestamp END) > (CASE WHEN ? THEN ? ELSE timestamp END)
         )`,
    )
    .bind(
      timestampFlag, timestampValue,
      endFlag, endValue,
      id,
      endFlag, endValue,
      endFlag, endValue,
      timestampFlag, timestampValue,
    )
    .run();
  return result.meta.changes > 0;
}

// fetch-duration fills an EMPTY end with `start + duration`. The read that
// produced the duration happened before a slow network call, so the database
// computes the end from the start that is current at write time — a start
// edit landing in between can neither invert the range nor leave a clip of
// the wrong length — and only fills a still-empty end. Returns the stored
// end, or null when nothing was written (row missing, or the end was no
// longer empty). durationSec must be positive.
export async function fillPerformanceDuration(
  db: D1Database,
  id: string,
  durationSec: number,
): Promise<number | null> {
  const result = await db
    .prepare(
      `UPDATE performances SET end_timestamp = timestamp + ?, updated_at = datetime('now')
       WHERE id = ? AND end_timestamp IS NULL
       RETURNING end_timestamp`,
    )
    .bind(durationSec, id)
    .run<{ end_timestamp: number }>();
  return result.results[0]?.end_timestamp ?? null;
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

  // One batch: the performance delete and the orphan-song delete commit together, so
  // there is no round trip — and no partial-failure window — between them. The second
  // statement's NOT EXISTS guard evaluates after the first statement's delete has
  // already applied within the same batch, so it correctly sees zero remaining
  // performances only when this was the song's last one.
  await db.batch([
    db.prepare('DELETE FROM performances WHERE id = ?').bind(id),
    db
      .prepare('DELETE FROM songs WHERE id = ? AND NOT EXISTS (SELECT 1 FROM performances WHERE song_id = ?)')
      .bind(row.song_id, row.song_id),
  ]);

  return true;
}

// --- Stream detail (stream + performances in one call) ---

export async function getStreamDetail(
  db: D1Database,
  streamId: string,
  streamerId: string,
): Promise<StreamDetail | null> {
  const stream = await getStreamById(db, streamId, streamerId);
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

// --- Paste import / extract import: create performances for a stream ---

export interface StreamPerformancesInput {
  readonly streamerId: string;
  readonly streamId: string;
  readonly date: string;
  readonly streamTitle: string;
  readonly videoId: string;
  readonly songs: ReadonlyArray<{
    songName: string;
    artist: string;
    startSeconds: number;
    endSeconds: number | null;
  }>;
  readonly submittedBy: string;
}

async function writeStreamPerformances(
  db: D1Database,
  input: StreamPerformancesInput,
  own: D1PreparedStatement[],
  excludeSongsOnlyInStreamId?: string,
): Promise<{ created: number }> {
  const catalog = prepareCatalogWrites(db, {
    streamerId: input.streamerId,
    streamId: input.streamId,
    date: input.date,
    streamTitle: input.streamTitle,
    videoId: input.videoId,
    songs: input.songs.map((song) => ({
      title: song.songName,
      originalArtist: song.artist || 'Unknown',
      timestamp: song.startSeconds,
      endTimestamp: song.endSeconds,
      note: '',
    })),
    submittedBy: input.submittedBy,
    excludeSongsOnlyInStreamId,
  });

  const statements = [...own, ...catalog.statements];
  if (statements.length > 0) await db.batch(statements);
  return { created: input.songs.length };
}

// Additive only — never deletes. The old `bulkCreatePerformances(..., replace: false)`
// call shape made "don't delete anything" just a boolean default; a caller could not
// see, from the call site alone, that this path never emits a DELETE.
export async function appendStreamPerformances(
  db: D1Database,
  input: StreamPerformancesInput,
): Promise<{ created: number }> {
  return writeStreamPerformances(db, input, []);
}

// Destructive: replaces every existing performance (and any song orphaned by that
// removal) for the stream before writing the submitted songs. Carries the old
// `replace: true` branch's two DELETE statements verbatim. The orphan-song delete must
// run before the performances delete — it identifies orphans by counting this stream's
// current performances, which the second delete then removes.
export async function replaceStreamPerformances(
  db: D1Database,
  input: StreamPerformancesInput,
): Promise<{ created: number }> {
  const own: D1PreparedStatement[] = [
    db.prepare(
      `DELETE FROM songs WHERE id IN (
         SELECT p.song_id FROM performances p
         WHERE p.stream_id = ?
         GROUP BY p.song_id
         HAVING COUNT(*) = (
           SELECT COUNT(*) FROM performances p2 WHERE p2.song_id = p.song_id
         )
       )`,
    ).bind(input.streamId),
    db.prepare('DELETE FROM performances WHERE stream_id = ?').bind(input.streamId),
  ];
  return writeStreamPerformances(db, input, own, input.streamId);
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

  // Own leading statement: a freshly created stream's insert leads the shared catalog
  // pipeline below. Reusing an existing stream leaves the stream row untouched, so
  // there is no leading statement on that path.
  const own: D1PreparedStatement[] = [];

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

    own.push(
      prepareStreamInsert(db, {
        id: streamId,
        streamerId,
        title: vod.stream_title,
        date: vod.stream_date,
        videoId: vod.video_id,
        youtubeUrl: vod.video_url,
        credit: '{}',
        submittedBy,
      }),
    );
  }

  const catalog = prepareCatalogWrites(db, {
    streamerId,
    streamId,
    date: streamDate,
    streamTitle,
    videoId: vod.video_id,
    songs: vodSongs.map((song) => ({
      title: song.song_title,
      originalArtist: song.original_artist || 'Unknown',
      timestamp: song.start_timestamp,
      endTimestamp: song.end_timestamp,
      note: '',
    })),
    submittedBy,
  });

  const stmts = [...own, ...catalog.statements];
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
  const results = await db.batch([
    // Count first: deleting orphan songs cascades to their performances, so
    // meta.changes on the performance delete alone would under-report. D1
    // executes a batch in order and in one transaction.
    db
      .prepare('SELECT COUNT(*) AS cnt FROM performances WHERE stream_id = ?')
      .bind(streamId),
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
  const perfCount = results[0].results[0] as { cnt: number } | undefined;

  return {
    songs: results[1].meta.changes,
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
import { normalizeForMatching, normalizeAggressive } from '../shared/normalize';
import { unionSimilarKeys } from '../shared/fuzzy-grouping';
import { UnionFind } from '../shared/union-find';

interface StatusCountRow {
  status: Status;
  count: number;
}

function prepareStatusCount(
  db: D1Database,
  table: 'songs' | 'streams' | 'performances',
  streamerId: string,
): D1PreparedStatement {
  return db
    .prepare(`SELECT status, COUNT(*) as count FROM ${table} WHERE streamer_id = ? GROUP BY status`)
    .bind(streamerId);
}

function statusCountsFromRows(rows: StatusCountRow[]): StatusCounts {
  const counts: StatusCounts = { pending: 0, approved: 0, rejected: 0, excluded: 0, extracted: 0 };
  for (const row of rows) {
    // The schema's CHECK constraint is what makes StatusCountRow.status a
    // Status; the membership test stays as the belt for a row that predates it.
    if (row.status in counts) {
      counts[row.status] = row.count;
    }
  }
  return counts;
}

export async function getDashboardStats(db: D1Database, streamerId: string) {
  const [
    songCountResult,
    streamCountResult,
    performanceCountResult,
    recentSongResult,
    recentStreamResult,
  ] = await db.batch([
    prepareStatusCount(db, 'songs', streamerId),
    prepareStatusCount(db, 'streams', streamerId),
    prepareStatusCount(db, 'performances', streamerId),
    db
      .prepare(`SELECT song.*, link.work_id
        FROM songs AS song
        LEFT JOIN song_work_links AS link ON link.song_id = song.id
        WHERE song.streamer_id = ?
        ORDER BY song.created_at DESC
        LIMIT 5`)
      .bind(streamerId),
    db
      .prepare("SELECT * FROM streams WHERE streamer_id = ? ORDER BY created_at DESC LIMIT 5")
      .bind(streamerId),
  ]);
  const songs = statusCountsFromRows(songCountResult.results as StatusCountRow[]);
  const streams = statusCountsFromRows(streamCountResult.results as StatusCountRow[]);
  const performances = statusCountsFromRows(performanceCountResult.results as StatusCountRow[]);
  const recentSongRows = recentSongResult.results as SongRow[];
  const recentStreamRows = recentStreamResult.results as StreamRow[];

  const recentSubmissions = [
    ...recentSongRows.map(songFromRow),
    ...recentStreamRows.map(streamFromRow),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  return { songs, streams, performances, recentSubmissions };
}

// --- Export helpers (fan-site format) ---

/**
 * One performance as `GET /api/export/songs` puts it on the wire.
 *
 * `date` and `streamTitle` are here BY DESIGN even though the fan site's stored
 * shape (`lib/types.ts` `Performance`) omits them — that file says so in as many
 * words, because the site joins each performance to its stream at load time and
 * `tools/sync-data` writes the slimmer form straight from D1, never through this
 * endpoint. This is the legacy compatibility export: it has no in-repo caller,
 * so its only consumers are outside this repository and neither field may be
 * dropped without that being a deliberate breaking change. The type exists to
 * make the difference from `lib/types.ts` a documented decision instead of a
 * shape that drifted.
 */
export interface ExportedPerformance {
  id: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
}

/**
 * One song as `GET /api/export/songs` puts it on the wire — `lib/types.ts`
 * `Song` with the export-only performance shape above. `workId` is omitted
 * entirely (not `null`) for a song with no linked work, so the exported JSON
 * matches what the fan site's optional `workId` expects.
 */
export interface ExportedSong {
  id: string;
  workId?: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: ExportedPerformance[];
}

export async function exportSongs(db: D1Database, streamerId: string): Promise<ExportedSong[]> {
  const [songResult, performanceResult] = await db.batch([
    db
      .prepare(`SELECT song.*, link.work_id
        FROM songs AS song
        LEFT JOIN song_work_links AS link ON link.song_id = song.id
        WHERE song.streamer_id = ? AND song.status = 'approved'
        ORDER BY song.title`)
      .bind(streamerId),
    db
      .prepare("SELECT * FROM performances WHERE streamer_id = ? AND status = 'approved' ORDER BY date")
      .bind(streamerId),
  ]);
  const songRows = songResult.results as SongRow[];
  const perfRows = performanceResult.results as PerformanceRow[];

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
  work_id: string | null;
  title: string;
  original_artist: string;
  status: Status;
  created_at: string;
  perf_count: number;
}

/**
 * Scan one streamer's songs for merge candidates. The catalog revision is read
 * in the same batch as the songs, so the caller can bind a later merge to the
 * exact snapshot the curator reviewed.
 */
export async function getSongSimilarityGroups(
  db: D1Database,
  streamerId: string,
  mode: HarmonizeMatchType,
  threshold: number,
): Promise<{ groups: SimilarityGroup<HarmonizeSongEntry>[]; revision: number }> {
  const [stateResult, songResult] = await db.batch([
    db.prepare('SELECT revision FROM work_match_state WHERE id = 1'),
    db.prepare(
      `SELECT s.id, link.work_id, s.title, s.original_artist, s.status, s.created_at,
              (SELECT COUNT(*) FROM performances p WHERE p.song_id = s.id) AS perf_count
       FROM songs s
       LEFT JOIN song_work_links AS link ON link.song_id = s.id
       WHERE s.streamer_id = ?`,
    ).bind(streamerId),
  ]);

  const state = stateResult.results[0] as { revision?: number | string } | undefined;
  const revision = Number(state?.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Global work review state is missing or invalid; apply migration 0006');
  }
  const results = songResult.results as unknown as SongWithPerfCount[];

  const entries: HarmonizeSongEntry[] = results.map((r) => ({
    id: r.id,
    workId: r.work_id,
    title: r.title,
    originalArtist: r.original_artist,
    status: r.status,
    createdAt: r.created_at,
    performanceCount: r.perf_count,
  }));

  // Pass 1: build connected components from either authoritative work IDs or
  // conservative title normalization. This keeps same-work local duplicates
  // discoverable even when their display text has drifted significantly.
  const exactComponents = new UnionFind(entries.length);

  const firstByTitle = new Map<string, number>();
  const firstByWork = new Map<string, number>();
  entries.forEach((entry, index) => {
    const titleKey = normalizeForMatching(entry.title);
    const titleMatch = firstByTitle.get(titleKey);
    if (titleMatch === undefined) firstByTitle.set(titleKey, index);
    else exactComponents.union(index, titleMatch);

    if (entry.workId) {
      const workMatch = firstByWork.get(entry.workId);
      if (workMatch === undefined) firstByWork.set(entry.workId, index);
      else exactComponents.union(index, workMatch);
    }
  });

  const exactGroups = new Map<number, HarmonizeSongEntry[]>();
  entries.forEach((entry, index) => {
    const root = exactComponents.find(index);
    const group = exactGroups.get(root);
    if (group) group.push(entry);
    else exactGroups.set(root, [entry]);
  });

  const result: SimilarityGroup<HarmonizeSongEntry>[] = [];
  const grouped = new Set<string>();

  for (const items of exactGroups.values()) {
    if (items.length >= 2) {
      const workIds = new Set(items.map((item) => item.workId).filter((id): id is string => id !== null));
      const allShareWork = workIds.size === 1 && items.every((item) => item.workId !== null);
      const sharedWorkId = allShareWork ? [...workIds][0] : null;
      result.push({
        normalizedKey: sharedWorkId ? `work:${sharedWorkId}` : normalizeForMatching(items[0].title),
        matchType: sharedWorkId ? 'work_id' : 'exact',
        items,
      });
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

    const fuzzyComponents = new UnionFind(aggressiveKeys.length);
    unionSimilarKeys(aggressiveKeys.map((k) => k.normalized), threshold, fuzzyComponents);

    const fuzzyGroups = new Map<number, HarmonizeSongEntry[]>();
    for (let i = 0; i < aggressiveKeys.length; i++) {
      const root = fuzzyComponents.find(i);
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
  return { groups: result, revision };
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

    const fuzzyComponents = new UnionFind(aggressiveKeys.length);
    unionSimilarKeys(aggressiveKeys.map((k) => k.normalized), threshold, fuzzyComponents);

    const fuzzyGroups = new Map<number, HarmonizeArtistEntry[]>();
    for (let i = 0; i < aggressiveKeys.length; i++) {
      const root = fuzzyComponents.find(i);
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

type SongMergeErrorCode =
  | 'invalid_request'
  | 'song_not_found'
  | 'work_not_linked'
  | 'work_merge_required'
  | 'work_merge_stale';

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
  work_id: string | null;
  work_title: string | null;
  work_original_artist: string | null;
  work_tags: string | null;
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
  canonicalWorkId: string;
  mergedSongs: number;
  movedPerformances: number;
  mergedWorks: number;
  relinkedSongs: number;
  /** Catalog revision this merge left behind; bind the next merge to it. */
  revision: number;
}

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

const SONG_MERGE_GUARD_ACTOR = 'system:harmonizer-merge-guard';

// Everything a song merge was reviewed against, re-checked inside the batch
// (see guard.ts for how the token is written, consulted, and retired): the
// catalog revision the Harmonizer scan displayed, every selected song's
// reviewed metadata and work link and, for a cross-work merge, every affected
// work's reviewed tags.
function songMergeGuardValidityCte(
  expectedLinksJson: string,
  expectedSongStateJson: string,
  expectedWorkStateJson: string,
  revision: number,
  streamerId: string,
): MergeGuardValidityCte {
  return {
    bindings: [
      expectedLinksJson,
      expectedSongStateJson,
      expectedWorkStateJson,
      revision,
      streamerId,
    ],
    sql: `WITH expected_links(song_id, work_id) AS (
       SELECT key, value
       FROM json_each(?)
     ),
     expected_song_state(
       song_id, title, original_artist, tags, status, reviewed_by
     ) AS (
       SELECT key,
              json_extract(value, '$.title'),
              json_extract(value, '$.originalArtist'),
              json_extract(value, '$.tags'),
              json_extract(value, '$.status'),
              json_extract(value, '$.reviewedBy')
       FROM json_each(?)
     ),
     expected_work_state(work_id, tags) AS (
       SELECT key, value
       FROM json_each(?)
     ),
     merge_guard(valid) AS (
       SELECT (SELECT revision FROM work_match_state WHERE id = 1) = ?
          AND COUNT(*) = (SELECT COUNT(*) FROM expected_links)
          AND (
            SELECT COUNT(*)
            FROM expected_work_state AS expected_work
            JOIN works AS guarded_state
              ON guarded_state.id = expected_work.work_id
             AND guarded_state.tags = expected_work.tags
          ) = (SELECT COUNT(*) FROM expected_work_state)
       FROM expected_links AS expected
       JOIN expected_song_state AS expected_song
         ON expected_song.song_id = expected.song_id
       JOIN songs AS guarded_song
         ON guarded_song.id = expected.song_id
        AND guarded_song.streamer_id = ?
        AND guarded_song.title = expected_song.title
        AND guarded_song.original_artist = expected_song.original_artist
        AND guarded_song.tags = expected_song.tags
        AND guarded_song.status = expected_song.status
        AND guarded_song.reviewed_by IS expected_song.reviewed_by
       JOIN song_work_links AS guarded_link
         ON guarded_link.song_id = expected.song_id
        AND guarded_link.work_id = expected.work_id
       JOIN works AS guarded_work
         ON guarded_work.id = expected.work_id
     )`,
  };
}

export interface MergeSongsInput {
  readonly db: D1Database;
  readonly streamerId: string;
  readonly canonicalSongId: string;
  readonly sourceSongIds: readonly string[];
  readonly mergedBy: string;
  readonly revision: number;
  readonly workMergeConfirmation?: HarmonizeWorkMergeConfirmation;
}

/**
 * Atomically merge explicit source song entities into one canonical song.
 * Performances are repointed, source rows are snapshotted in song_aliases,
 * and no performance rows are deleted. When explicitly authorized, distinct
 * global works are also snapshotted, flattened, and repointed site-wide.
 *
 * `revision` is the `work_match_state` revision the Harmonizer scan that
 * produced this request displayed; any catalog write since then fails the
 * merge closed with `work_merge_stale`.
 */
export async function mergeSongs({
  db,
  streamerId,
  canonicalSongId,
  sourceSongIds,
  mergedBy,
  revision,
  workMergeConfirmation,
}: MergeSongsInput): Promise<MergeSongsResult> {
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
  if (uniqueSourceIds.length > HARMONIZE_MERGE_SOURCE_LIMIT) {
    throw new SongMergeError(
      'invalid_request',
      `At most ${HARMONIZE_MERGE_SOURCE_LIMIT} source songs can be merged at once`,
    );
  }

  const requestedIds = [canonicalSongId, ...uniqueSourceIds];
  const placeholders = requestedIds.map(() => '?').join(', ');
  const { results: rows } = await db
    .prepare(
      `SELECT song.id, song.streamer_id, link.work_id,
              work.title AS work_title,
              work.original_artist AS work_original_artist,
              work.tags AS work_tags,
              song.title, song.original_artist, song.tags, song.status,
              song.submitted_by, song.reviewed_by, song.created_at
       FROM songs AS song
       LEFT JOIN song_work_links AS link ON link.song_id = song.id
       LEFT JOIN works AS work ON work.id = link.work_id
       WHERE song.streamer_id = ? AND song.id IN (${placeholders})`,
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
  const unlinked = allRows.find((row) => (
    row.work_id === null
    || row.work_title === null
    || row.work_original_artist === null
    || row.work_tags === null
  ));
  if (unlinked) {
    throw new SongMergeError(
      'work_not_linked',
      `Song ${unlinked.id} is not linked to an active global work`,
    );
  }

  const canonicalWorkId = canonical.work_id!;
  const sourceWorks = new Map<string, SongMergeRow>();
  for (const source of sources) {
    if (source.work_id !== canonicalWorkId) sourceWorks.set(source.work_id!, source);
  }
  const sourceWorkIds = [...sourceWorks.keys()];
  if (sourceWorkIds.length > 0 && workMergeConfirmation === undefined) {
    throw new SongMergeError(
      'work_merge_required',
      `This merge spans ${sourceWorkIds.length + 1} global works and requires explicit confirmation`,
    );
  }
  if (workMergeConfirmation !== undefined) {
    const confirmedSourceWorkIds = [...new Set(workMergeConfirmation.sourceWorkIds)];
    const confirmationMatches = (
      sourceWorkIds.length > 0
      && workMergeConfirmation.canonicalWorkId === canonicalWorkId
      && confirmedSourceWorkIds.length === workMergeConfirmation.sourceWorkIds.length
      && confirmedSourceWorkIds.length === sourceWorkIds.length
      && confirmedSourceWorkIds.every((workId) => sourceWorks.has(workId))
    );
    if (!confirmationMatches) {
      throw new SongMergeError(
        'work_merge_stale',
        'Selected song or global work data changed after review; scan again before merging',
      );
    }
  }

  const tags = [...new Set(allRows.flatMap((row) => parseSongTags(row.tags)))];
  const mergedStatus = MERGED_STATUS_PRIORITY.find((status) =>
    allRows.some((row) => row.status === status),
  ) ?? canonical.status;
  const reviewedBy = canonical.reviewed_by
    ?? allRows.find((row) => row.status === mergedStatus && row.reviewed_by)?.reviewed_by
    ?? null;

  const expectedLinksJson = JSON.stringify(Object.fromEntries(
    allRows.map((row) => [row.id, row.work_id!]),
  ));
  const expectedSongStateJson = JSON.stringify(Object.fromEntries(
    allRows.map((row) => [row.id, {
      title: row.title,
      originalArtist: row.original_artist,
      tags: row.tags,
      status: row.status,
      reviewedBy: row.reviewed_by,
    }]),
  ));
  const expectedWorkStateJson = sourceWorkIds.length === 0
    ? '{}'
    : JSON.stringify(Object.fromEntries([
      [canonicalWorkId, canonical.work_tags!],
      ...[...sourceWorks.entries()].map(([workId, row]) => [workId, row.work_tags!]),
    ]));
  const guard = {
    guardToken: crypto.randomUUID(),
    canonicalId: canonicalSongId,
    actor: SONG_MERGE_GUARD_ACTOR,
  };
  const guarded = (sql: string, bindings: unknown[] = []): D1PreparedStatement => (
    guardedStatement(db, guard, sql, bindings)
  );
  const statements: D1PreparedStatement[] = [
    prepareMergeGuardInsert(db, {
      ...guard,
      validityCte: songMergeGuardValidityCte(
        expectedLinksJson,
        expectedSongStateJson,
        expectedWorkStateJson,
        revision,
        streamerId,
      ),
    }),
    guarded(
      `UPDATE song_aliases
       SET canonical_song_id = ?
       WHERE streamer_id = ?
         AND canonical_song_id IN (${sourcePlaceholders})
         AND (SELECT valid FROM merge_guard)`,
      [canonicalSongId, streamerId, ...uniqueSourceIds],
    ),
  ];

  statements.push(
    guarded(
      `INSERT INTO song_aliases (
         source_song_id, canonical_song_id, streamer_id,
         source_title, source_original_artist, source_status, source_tags,
         source_submitted_by, source_reviewed_by, source_created_at, merged_by
       )
       SELECT source.id, ?, source.streamer_id,
              source.title, source.original_artist, source.status, source.tags,
              source.submitted_by, source.reviewed_by, source.created_at, ?
       FROM songs AS source
       WHERE source.streamer_id = ?
         AND source.id IN (${sourcePlaceholders})
         AND (SELECT valid FROM merge_guard)`,
      [canonicalSongId, mergedBy, streamerId, ...uniqueSourceIds],
    ),
  );

  statements.push(
    guarded(
      `UPDATE songs
       SET tags = ?, status = ?, reviewed_by = ?, updated_at = datetime('now')
       WHERE id = ? AND streamer_id = ?
         AND (SELECT valid FROM merge_guard)`,
      [JSON.stringify(tags), mergedStatus, reviewedBy, canonicalSongId, streamerId],
    ),
  );

  const performanceUpdateIndex = statements.length;
  statements.push(
    guarded(
      `UPDATE performances
       SET song_id = ?, updated_at = datetime('now')
       WHERE streamer_id = ? AND song_id IN (${sourcePlaceholders})
         AND (SELECT valid FROM merge_guard)`,
      [canonicalSongId, streamerId, ...uniqueSourceIds],
    ),
  );

  const songDeleteIndex = statements.length;
  statements.push(
    guarded(
      `DELETE FROM songs
       WHERE streamer_id = ? AND id IN (${sourcePlaceholders})
         AND (SELECT valid FROM merge_guard)`,
      [streamerId, ...uniqueSourceIds],
    ),
  );

  let workRelinkIndex: number | null = null;
  let workDeleteIndex: number | null = null;
  if (sourceWorkIds.length > 0) {
    const workPlaceholders = sourceWorkIds.map(() => '?').join(', ');

    statements.push(
      guarded(
        `UPDATE work_aliases
         SET canonical_work_id = ?
         WHERE canonical_work_id IN (${workPlaceholders})
           AND (SELECT valid FROM merge_guard)`,
        [canonicalWorkId, ...sourceWorkIds],
      ),
      guarded(
        `INSERT INTO work_aliases (
           source_work_id, canonical_work_id, source_title,
           source_original_artist, source_tags, merged_by
         )
         SELECT source.id, ?, source.title,
                source.original_artist, source.tags, ?
         FROM works AS source
         WHERE source.id IN (${workPlaceholders})
           AND (SELECT valid FROM merge_guard)`,
        [canonicalWorkId, mergedBy, ...sourceWorkIds],
      ),
    );

    workRelinkIndex = statements.length;
    statements.push(
      guarded(
        `UPDATE song_work_links
         SET work_id = ?, link_method = 'manual', linked_by = ?,
             updated_at = datetime('now')
         WHERE work_id IN (${workPlaceholders})
           AND (SELECT valid FROM merge_guard)`,
        [canonicalWorkId, mergedBy, ...sourceWorkIds],
      ),
    );

    const workTags = [...new Set([
      ...parseSongTags(canonical.work_tags!),
      ...[...sourceWorks.values()].flatMap((row) => parseSongTags(row.work_tags!)),
      ...tags,
    ])];
    statements.push(
      guarded(
        `UPDATE works
         SET tags = ?, updated_at = datetime('now')
         WHERE id = ?
           AND (SELECT valid FROM merge_guard)`,
        [JSON.stringify(workTags), canonicalWorkId],
      ),
    );

    workDeleteIndex = statements.length;
    statements.push(
      guarded(
        `DELETE FROM works
         WHERE id IN (${workPlaceholders})
           AND (SELECT valid FROM merge_guard)`,
        sourceWorkIds,
      ),
    );
  }

  // The cleanup is the last mutating statement; the read that follows it is in
  // the same batch, so the revision handed back cannot miss a write that
  // landed between this merge and a caller's next one. A scan therefore stays
  // usable for several merges while still detecting anyone else's edit.
  statements.push(prepareMergeGuardCleanup(db, guard.guardToken));
  const revisionIndex = statements.length;
  statements.push(db.prepare('SELECT revision FROM work_match_state WHERE id = 1'));

  const batchResults = await db.batch(statements);
  const mergeGuard = batchResults[0]?.results[0] as { valid?: number | boolean } | undefined;
  if (mergeGuard?.valid !== 1 && mergeGuard?.valid !== true) {
    throw new SongMergeError(
      'work_merge_stale',
      'Selected song or global work data changed after review; scan again before merging',
    );
  }
  const state = batchResults[revisionIndex]?.results[0] as { revision?: number | string } | undefined;
  const revisionAfterMerge = Number(state?.revision);
  if (!Number.isSafeInteger(revisionAfterMerge) || revisionAfterMerge < 0) {
    throw new Error('Global work review state is missing or invalid; apply migration 0006');
  }
  return {
    canonicalSongId,
    canonicalWorkId,
    mergedSongs: batchResults[songDeleteIndex].meta.changes,
    movedPerformances: batchResults[performanceUpdateIndex].meta.changes,
    mergedWorks: workDeleteIndex === null ? 0 : batchResults[workDeleteIndex].meta.changes,
    relinkedSongs: workRelinkIndex === null ? 0 : batchResults[workRelinkIndex].meta.changes,
    revision: revisionAfterMerge,
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
