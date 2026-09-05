import {
  appendStreamPerformances,
  batchUpdateSongs,
  bulkUnapproveStream,
  createSongAndPerformance,
  deletePerformanceAndOrphanSong,
  deleteStreamCascade,
  exportSongs,
  findExistingStreamImportKeys,
  generatePerformanceId,
  generateSongId,
  generateStreamId,
  generateStreamIdFallback,
  generateWorkId,
  getDashboardStats,
  getSongById,
  getSongSimilarityGroups,
  importVodToAdminDb,
  insertPerformance,
  insertPerformances,
  insertStream,
  insertStreams,
  listGlobalWorksPaginated,
  mergeSongs,
  replaceStreamPerformances,
  SongMergeError,
  updateSong,
  updateStream,
} from './db';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Minimal in-memory D1 stand-in. It records every prepared statement that reaches
// .first() and .batch() so a test can assert exactly which writes importVodToAdminDb
// emits. The existing-stream lookup is the only read the function performs on this
// path, so we answer it from `existingStream` and return null for everything else.
type ExistingStream = { id: string; title: string; date: string } | null;

type CapturedStatement = { sql: string; params: unknown[] };

/** The catalog revision every merge fixture is reviewed against. */
const SCANNED_REVISION = 41;
/** Bind position of the scanned revision inside the song merge guard insert. */
const SONG_MERGE_GUARD_REVISION_INDEX = 3;
/** What the merge's own trigger bumps leave behind, read at the batch tail. */
const REVISION_AFTER_MERGE = SCANNED_REVISION + 4;

class FakeStatement {
  params: unknown[] = [];

  constructor(
    private readonly fakeDb: FakeD1Database,
    readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.fakeDb.firstStatements.push({ sql: this.sql, params: this.params });
    if (this.sql.includes('FROM streams WHERE video_id = ? AND streamer_id = ?')) {
      return this.fakeDb.existingStream as T | null;
    }
    if (this.sql.includes('SELECT song_id FROM performances WHERE id = ?')) {
      return (this.fakeDb.performanceSongId ? { song_id: this.fakeDb.performanceSongId } : null) as T | null;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.fakeDb.allStatements.push({ sql: this.sql, params: this.params });
    if (this.sql.includes('AS perf_count') && this.sql.includes('LEFT JOIN song_work_links')) {
      return { results: this.fakeDb.harmonizerRows as T[] };
    }
    if (this.sql.includes('FROM songs') && this.sql.includes('id IN')) {
      return { results: this.fakeDb.mergeRows as T[] };
    }
    if (this.sql.includes('FROM songs AS song') && this.sql.includes('LEFT JOIN song_work_links')) {
      return { results: this.fakeDb.exportSongRows as T[] };
    }
    if (this.sql.includes('FROM performances WHERE streamer_id = ?')) {
      return { results: this.fakeDb.exportPerformanceRows as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    this.fakeDb.runStatements.push({ sql: this.sql, params: this.params });
    return { meta: { changes: 1 } };
  }
}

interface GlobalWorkFixture {
  count: number;
  rows: unknown[];
  stats: unknown;
}

class FakeD1Database {
  readonly firstStatements: CapturedStatement[] = [];
  readonly allStatements: CapturedStatement[] = [];
  readonly runStatements: CapturedStatement[] = [];
  readonly batchStatements: CapturedStatement[] = [];
  batchCallCount = 0;
  mergeGuardValid = true;
  workMatchRevision = SCANNED_REVISION;
  revisionAfterMerge = REVISION_AFTER_MERGE;
  streamPerformanceCount = 0;
  dashboardStatusRows: Record<'songs' | 'streams' | 'performances', unknown[]> = {
    songs: [],
    streams: [],
    performances: [],
  };
  dashboardRecentSongRows: unknown[] = [];
  dashboardRecentStreamRows: unknown[] = [];
  performanceSongId: string | null = null;
  songStillReferencedAfterDelete = false;
  existingVideoIdRows: unknown[] = [];
  existingStreamIdRows: unknown[] = [];
  songByIdRow: unknown | null = null;
  songByIdPerformanceRows: unknown[] = [];

  constructor(
    readonly existingStream: ExistingStream,
    readonly exactSongId: string | null = null,
    readonly mergeRows: unknown[] = [],
    readonly globalWorkFixture: GlobalWorkFixture | null = null,
    readonly exportSongRows: unknown[] = [],
    readonly exportPerformanceRows: unknown[] = [],
    readonly harmonizerRows: unknown[] = [],
  ) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ results: unknown[]; meta: { changes: number } }>> {
    this.batchCallCount += 1;
    this.batchStatements.push(
      ...statements.map((statement) => ({ sql: statement.sql, params: statement.params })),
    );
    if (this.globalWorkFixture && statements[0]?.sql.includes('WITH work_rollup')) {
      return [
        { results: [{ count: this.globalWorkFixture.count }], meta: { changes: 0 } },
        { results: this.globalWorkFixture.rows, meta: { changes: 0 } },
        { results: [this.globalWorkFixture.stats], meta: { changes: 0 } },
      ];
    }

    // The merge guard is only written when its bound revision still matches
    // the catalog, exactly as the SQL fence does inside D1.
    const guardStatement = statements[0];
    const revisionFenceHolds = guardStatement === undefined
      || !/work_match_state/i.test(guardStatement.sql)
      || guardStatement.params[SONG_MERGE_GUARD_REVISION_INDEX] === this.workMatchRevision;
    const mergeGuardValid = this.mergeGuardValid && revisionFenceHolds;

    return statements.map((statement, index) => {
      if (statement.sql.includes('RETURNING id, song_id')) {
        const rows = JSON.parse(String(statement.params[0])) as Array<{ performanceId: string; songId: string }>;
        return { results: rows.map(row => ({ id: row.performanceId, song_id: this.exactSongId ?? row.songId })), meta: { changes: rows.length } };
      }
      if (statement.sql.startsWith('SELECT revision FROM work_match_state')) {
        // A merge bumps the catalog revision through its own triggers, so the
        // read at the tail of a merge batch answers with the post-merge value.
        const isBatchTail = statements.length > 1 && index === statements.length - 1;
        return {
          results: [{ revision: isBatchTail ? this.revisionAfterMerge : this.workMatchRevision }],
          meta: { changes: 0 },
        };
      }
      if (
        statement.sql.includes('AS perf_count')
        && statement.sql.includes('LEFT JOIN song_work_links')
      ) {
        return { results: this.harmonizerRows, meta: { changes: 0 } };
      }
      if (statement.sql.includes('SELECT COUNT(*) AS cnt FROM performances WHERE stream_id = ?')) {
        return {
          results: [{ cnt: this.streamPerformanceCount }],
          meta: { changes: 0 },
        };
      }
      const statusTable = (['songs', 'streams', 'performances'] as const).find((table) =>
        statement.sql.includes(`FROM ${table} WHERE streamer_id = ? GROUP BY status`),
      );
      if (statusTable) {
        return {
          results: this.dashboardStatusRows[statusTable],
          meta: { changes: 0 },
        };
      }
      if (statement.sql.includes('ORDER BY song.created_at DESC')) {
        return { results: this.dashboardRecentSongRows, meta: { changes: 0 } };
      }
      if (statement.sql.includes('FROM streams WHERE streamer_id = ? ORDER BY created_at DESC LIMIT 5')) {
        return { results: this.dashboardRecentStreamRows, meta: { changes: 0 } };
      }
      if (
        statement.sql.includes('FROM songs AS song')
        && statement.sql.includes("song.status = 'approved'")
      ) {
        return { results: this.exportSongRows, meta: { changes: 0 } };
      }
      if (
        statement.sql.includes('FROM performances WHERE streamer_id = ?')
        && statement.sql.includes("status = 'approved'")
      ) {
        return { results: this.exportPerformanceRows, meta: { changes: 0 } };
      }
      if (/RETURNING\s+1\s+AS\s+valid/i.test(statement.sql)) {
        return {
          results: mergeGuardValid ? [{ valid: 1 }] : [],
          meta: { changes: mergeGuardValid ? 1 : 0 },
        };
      }
      if (!mergeGuardValid && /merge_guard/i.test(statement.sql)) {
        return { results: [], meta: { changes: 0 } };
      }
      if (statement.sql.includes('SELECT s.id') && statement.sql.includes('s.original_artist = ?')) {
        return {
          results: this.exactSongId ? [{ id: this.exactSongId }] : [],
          meta: { changes: 0 },
        };
      }
      if (statement.sql.includes('NOT EXISTS (SELECT 1 FROM performances WHERE song_id = ?)')) {
        return { results: [], meta: { changes: this.songStillReferencedAfterDelete ? 0 : 1 } };
      }
      if (statement.sql.includes('video_id IN (SELECT value FROM json_each(?))')) {
        return { results: this.existingVideoIdRows, meta: { changes: 0 } };
      }
      if (statement.sql.includes('SELECT id FROM streams WHERE id IN (SELECT value FROM json_each(?))')) {
        return { results: this.existingStreamIdRows, meta: { changes: 0 } };
      }
      if (statement.sql.includes('song_work_links AS link ON link.song_id = s.id') && statement.sql.includes('WHERE s.id = ?')) {
        return { results: this.songByIdRow ? [this.songByIdRow] : [], meta: { changes: 0 } };
      }
      if (statement.sql.includes('FROM performances WHERE song_id = ? ORDER BY date DESC')) {
        return { results: this.songByIdPerformanceRows, meta: { changes: 0 } };
      }
      const guardedParamCount = /merge_guard/i.test(statement.sql) ? 3 : 0;
      const changes = /UPDATE\s+performances/i.test(statement.sql)
        ? 3
        : /DELETE\s+FROM\s+songs/i.test(statement.sql)
          ? Math.max(0, statement.params.length - guardedParamCount - 1)
          : /DELETE\s+FROM\s+works/i.test(statement.sql)
            ? statement.params.length - guardedParamCount
            : 1;
      return { results: [], meta: { changes } };
    });
  }
}

async function testInsertPerformancesUsesOneBatch(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  await insertPerformances(
    fakeDb as unknown as D1Database,
    'alice',
    'song-one',
    [
      {
        id: 'perf-one',
        streamId: 'stream-one',
        date: '2026-08-16',
        streamTitle: 'First stream',
        videoId: 'video-one',
        timestamp: 10,
        endTimestamp: 20,
        note: 'first',
      },
      {
        id: 'perf-two',
        streamId: 'stream-two',
        date: '2026-08-17',
        streamTitle: 'Second stream',
        videoId: 'video-two',
        timestamp: 30,
        endTimestamp: null,
        note: '',
      },
    ],
    'curator@example.com',
  );

  assertEqual(fakeDb.batchCallCount, 1, 'inline performances share one D1 batch');
  assertEqual(fakeDb.batchStatements.length, 2, 'one insert is prepared for each performance');
  assert(
    fakeDb.batchStatements.every((statement) => /INSERT\s+INTO\s+performances/i.test(statement.sql)),
    'the batch contains only performance inserts',
  );
  assertEqual(fakeDb.batchStatements[0]?.params[0], 'perf-one', 'the first generated performance ID is preserved');
  assertEqual(fakeDb.batchStatements[1]?.params[0], 'perf-two', 'the second generated performance ID is preserved');
  assertEqual(fakeDb.batchStatements[0]?.params[2], 'song-one', 'every performance targets the new song');
  assertEqual(fakeDb.batchStatements[1]?.params[11], 'curator@example.com', 'the submitter is preserved');
}

// performances columns, in bind order:
// 0 id, 1 streamer_id, 2 song_id, 3 stream_id, 4 date, 5 stream_title,
// 6 video_id, 7 timestamp, 8 end_timestamp, 9 note, 10 status, 11 submitted_by
const PERF_STREAM_ID = 3;
const PERF_SONG_ID = 2;
const PERF_DATE = 4;
const PERF_TITLE = 5;
const PERF_STATUS = 10;
// streams columns, in bind order:
// 0 id, 1 streamer_id, 2 title, 3 date, 4 video_id, 5 youtube_url, 6 credit, 7 status, 8 submitted_by
const STREAM_STATUS = 7;

// A duplicate VOD approval that lands on an already-curated stream must never destroy
// the existing catalog. importVodToAdminDb must reuse the stream and append pending
// records — no overwrite of metadata, no deletion of curated performances/songs.
async function testVodImportPreservesExistingStream(): Promise<void> {
  const fakeDb = new FakeD1Database({
    id: 'stream-existing',
    title: 'Curated Existing Title',
    date: '2026-01-01',
  });

  const result = await importVodToAdminDb(
    fakeDb as unknown as D1Database,
    {
      streamer_slug: 'alice',
      video_id: 'DUPVIDEO123',
      video_url: 'https://www.youtube.com/watch?v=DUPVIDEO123',
      stream_title: 'Submitted Replacement Title',
      stream_date: '2026-02-02',
    },
    [
      {
        song_title: 'Submitted Song',
        original_artist: 'Submitted Artist',
        start_timestamp: 12,
        end_timestamp: 34,
      },
    ],
    'curator@example.com',
  );

  assertEqual(result.streamId, 'stream-existing', 'duplicate import should reuse the existing stream id');
  assertEqual(result.created, 1, 'duplicate import should still create the pending song record');

  // The lookup must be scoped to the submitted streamer so one streamer's submission
  // can never resolve to another streamer's stream.
  const lookup = fakeDb.firstStatements[0];
  assert(
    lookup.sql.includes('video_id = ? AND streamer_id = ?'),
    'existing-stream lookup must be scoped to streamer, not video_id alone',
  );
  assertEqual(lookup.params[0], 'DUPVIDEO123', 'lookup should bind the submitted video id');
  assertEqual(lookup.params[1], 'alice', 'lookup should bind the submitted streamer');

  const sql = fakeDb.batchStatements.map((statement) => statement.sql).join('\n');
  assert(!/UPDATE\s+streams/i.test(sql), 'duplicate import must not overwrite existing stream metadata');
  assert(!/DELETE\s+FROM\s+performances/i.test(sql), 'duplicate import must not delete curated performances');
  assert(!/DELETE\s+FROM\s+songs/i.test(sql), 'duplicate import must not delete curated songs');
  assert(!/INSERT\s+INTO\s+streams/i.test(sql), 'duplicate import must not create a second stream row for the same video');

  const performanceInsert = fakeDb.batchStatements.find((statement) =>
    /INSERT\s+INTO\s+performances/i.test(statement.sql),
  );
  if (!performanceInsert) {
    throw new Error('duplicate import should insert a pending performance');
  }
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_STREAM_ID], 'stream-existing', 'pending performance should link to the existing stream');
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_DATE], '2026-01-01', 'pending performance should keep the existing stream date');
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_TITLE], 'Curated Existing Title', 'pending performance should keep the existing stream title');
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_STATUS], 'pending', 'imported performance must stay pending for curator review');
}

// The normal path (video not yet in admin) must keep working: create the stream and
// the pending performance from the submitted VOD, with no destructive writes.
async function testVodImportCreatesNewStreamWhenAbsent(): Promise<void> {
  const fakeDb = new FakeD1Database(null);

  const result = await importVodToAdminDb(
    fakeDb as unknown as D1Database,
    {
      streamer_slug: 'bob',
      video_id: 'NEWVIDEO456',
      video_url: 'https://www.youtube.com/watch?v=NEWVIDEO456',
      stream_title: 'Brand New Stream',
      stream_date: '2026-03-03',
    },
    [
      {
        song_title: 'New Song',
        original_artist: 'New Artist',
        start_timestamp: 5,
        end_timestamp: null,
      },
    ],
    'curator@example.com',
  );

  assertEqual(result.created, 1, 'fresh import should create the pending song record');

  const sql = fakeDb.batchStatements.map((statement) => statement.sql).join('\n');
  assert(/INSERT\s+INTO\s+streams/i.test(sql), 'absent video should create a new stream');
  assert(!/UPDATE\s+streams/i.test(sql), 'fresh import should not update streams');
  assert(!/DELETE\s+FROM\s+performances/i.test(sql), 'fresh import should not delete performances');

  const streamInsert = fakeDb.batchStatements.find((statement) => /INSERT\s+INTO\s+streams/i.test(statement.sql));
  if (!streamInsert) {
    throw new Error('fresh import should insert a stream');
  }
  assertEqual(streamInsert.params[STREAM_STATUS], 'pending', 'new stream should be created pending review');

  const performanceInsert = fakeDb.batchStatements.find((statement) =>
    /INSERT\s+INTO\s+performances/i.test(statement.sql),
  );
  if (!performanceInsert) {
    throw new Error('fresh import should insert a pending performance');
  }
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_DATE], '2026-03-03', 'fresh performance should use the submitted date');
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_TITLE], 'Brand New Stream', 'fresh performance should use the submitted title');
  assertEqual(catalogPerformanceParams(performanceInsert)[PERF_STATUS], 'pending', 'fresh performance must stay pending for curator review');
}

async function testVodImportReusesExactSong(): Promise<void> {
  const fakeDb = new FakeD1Database(
    { id: 'stream-existing', title: 'Existing Stream', date: '2026-01-01' },
    'song-canonical',
  );

  await importVodToAdminDb(
    fakeDb as unknown as D1Database,
    {
      streamer_slug: 'alice',
      video_id: 'DUPVIDEO123',
      video_url: 'https://www.youtube.com/watch?v=DUPVIDEO123',
      stream_title: 'Existing Stream',
      stream_date: '2026-01-01',
    },
    [{
      song_title: 'Same Song',
      original_artist: 'Same Artist',
      start_timestamp: 12,
      end_timestamp: 34,
    }],
    'curator@example.com',
  );

  const songInserts = fakeDb.batchStatements.filter((statement) =>
    /INSERT\s+INTO\s+songs/i.test(statement.sql),
  );
  assertEqual(songInserts.length, 1, 'song creation is guarded inside the write transaction');
  assert(/WHERE NOT EXISTS/.test(songInserts[0].sql), 'an existing identity suppresses the insert');

  const workInserts = fakeDb.batchStatements.filter((statement) =>
    /INSERT\s+INTO\s+works/i.test(statement.sql),
  );
  assertEqual(workInserts.length, 1, 'an exact import ensures one global work identity');
  assert(
    /NOT\s+EXISTS[\s\S]+FROM\s+work_aliases[\s\S]+JOIN\s+works/i.test(workInserts[0].sql),
    'an exact import must not recreate an identity already retired into an active canonical work',
  );
  const workLinks = fakeDb.batchStatements.filter((statement) =>
    /INSERT\s+OR\s+IGNORE\s+INTO\s+song_work_links/i.test(statement.sql),
  );
  assertEqual(workLinks.length, 1, 'a reused local song is linked to its exact global work');
  assert(
    /FROM\s+work_aliases[\s\S]+canonical_work_id/i.test(workLinks[0].sql),
    'an exact import resolves a retired identity to its canonical work',
  );
  assert(
    /ORDER\s+BY\s+resolution_order[\s\S]+LIMIT\s+1/i.test(workLinks[0].sql),
    'a retired identity wins over any stale active recreation',
  );

  const performanceInsert = fakeDb.batchStatements.find((statement) =>
    /INSERT\s+INTO\s+performances/i.test(statement.sql),
  );
  if (!performanceInsert) throw new Error('reused song should still receive a new performance');
  assert(/resolved.resolved_song_id/.test(performanceInsert.sql), 'performance uses the identity resolved inside the transaction');
}

async function testSongIdentityEditRelinksGlobalWorkAtomically(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  await updateSong(
    fakeDb as unknown as D1Database,
    'song-local',
    { title: 'Canonical Title', originalArtist: 'Original Artist' },
    'curator@example.com',
  );

  assertEqual(fakeDb.batchStatements.length, 3, 'identity edit uses one ordered three-statement batch');
  assert(/INSERT\s+INTO\s+works/i.test(fakeDb.batchStatements[0].sql), 'destination global work is ensured first');
  assert(
    /NOT\s+EXISTS[\s\S]+FROM\s+work_aliases[\s\S]+JOIN\s+works/i.test(fakeDb.batchStatements[0].sql),
    'identity edit does not recreate a retired work identity',
  );
  assert(/UPDATE\s+songs/i.test(fakeDb.batchStatements[1].sql), 'local song identity updates second');
  assert(/INSERT\s+INTO\s+song_work_links/i.test(fakeDb.batchStatements[2].sql), 'global bridge is relinked last');
  assert(
    /FROM\s+work_aliases[\s\S]+canonical_work_id/i.test(fakeDb.batchStatements[2].sql),
    'identity edit resolves a retired identity back to its canonical work',
  );
  assert(/ON\s+CONFLICT\s*\(song_id\)\s+DO\s+UPDATE/i.test(fakeDb.batchStatements[2].sql), 'existing bridge is repointed, not duplicated');
  assertEqual(fakeDb.batchStatements[2].params[0], 'curator@example.com', 'relink records the responsible curator');
  assertEqual(fakeDb.batchStatements[2].params[1], 'song-local', 'relink remains scoped to the edited local song');
}

async function testHarmonizerArtistUpdatesRelinkEveryEditedSong(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  const updated = await batchUpdateSongs(
    fakeDb as unknown as D1Database,
    [
      { songId: 'song-one', originalArtist: 'Canonical Artist' },
      { songId: 'song-two', originalArtist: 'Canonical Artist' },
    ],
    'curator@example.com',
  );

  assertEqual(updated, 2, 'Harmonizer reports both local identity updates');
  assertEqual(fakeDb.batchStatements.length, 6, 'each artist edit emits ensure, update, and relink statements');
  for (let index = 0; index < fakeDb.batchStatements.length; index += 3) {
    const ensure = fakeDb.batchStatements[index];
    const update = fakeDb.batchStatements[index + 1];
    const relink = fakeDb.batchStatements[index + 2];
    assert(/INSERT\s+INTO\s+works/i.test(ensure.sql), 'Harmonizer ensures the destination work');
    assert(/UPDATE\s+songs/i.test(update.sql), 'Harmonizer updates local display metadata');
    assert(/INSERT\s+INTO\s+song_work_links/i.test(relink.sql), 'Harmonizer relinks the work bridge');
    assert(/updated_at\s*=\s*datetime\('now'\)/i.test(relink.sql), 'relink marks static data stale');
    assertEqual(relink.params[0], 'curator@example.com', 'relink records the responsible curator');
  }
}

async function testGlobalWorksListAggregatesAcrossStreamers(): Promise<void> {
  const longSearch = '窗外下著雨看著路上撐傘的行人害我一直想到你';
  assert(new TextEncoder().encode(longSearch).length > 48, 'regression search exceeds D1 LIKE pattern limit');
  const fakeDb = new FakeD1Database(null, null, [], {
    count: 1,
    rows: [{
      id: 'work-shared',
      title: 'Shared Song',
      original_artist: 'Original Artist',
      tags: '["pop"]',
      streamer_count: 2,
      song_count: 3,
      performance_count: 7,
      streamer_ids: 'bob,alice',
      created_at: '2026-01-01',
      updated_at: '2026-01-02',
    }],
    stats: {
      total_works: 4,
      shared_works: 1,
      linked_songs: 6,
      linked_performances: 12,
      unlinked_songs: 0,
    },
  });

  const result = await listGlobalWorksPaginated(fakeDb as unknown as D1Database, {
    search: longSearch,
    sharedOnly: true,
    page: 2,
    pageSize: 25,
    sortBy: 'streamerCount',
    sortDir: 'asc',
  });

  assertEqual(result.page, 2, 'global page preserves valid requested page');
  assertEqual(result.pageSize, 25, 'global page preserves valid requested page size');
  assertEqual(result.works[0].id, 'work-shared', 'global work row is mapped');
  assertEqual(result.works[0].streamerIds.join('|'), 'alice|bob', 'cross-streamer membership is stable');
  assertEqual(result.stats.linkedPerformances, 12, 'site-wide coverage stats are mapped');

  const countQuery = fakeDb.batchStatements[0];
  const dataQuery = fakeDb.batchStatements[1];
  assert(!/JOIN performances/i.test(countQuery.sql), 'count query never expands performance rows');
  assert(/WHERE\s+streamer_count\s+>\s+1/i.test(countQuery.sql), 'shared-only filter is applied after aggregation');
  assert(/ORDER\s+BY\s+streamer_count\s+ASC/i.test(dataQuery.sql), 'sort column is selected from the safe allowlist');
  assert(/instr\s*\(\s*lower\(work\.title\)/i.test(dataQuery.sql), 'title search avoids D1 LIKE pattern limits');
  assert(/instr\s*\(\s*lower\(work\.original_artist\)/i.test(dataQuery.sql), 'artist search avoids D1 LIKE pattern limits');
  assert(!/\bLIKE\b/i.test(dataQuery.sql), 'global search does not build a length-limited LIKE pattern');
  assertEqual(dataQuery.params[0], longSearch, 'title search is bound without wildcard expansion');
  assertEqual(dataQuery.params[1], longSearch, 'artist search is bound without wildcard expansion');
  assertEqual(dataQuery.params[2], 25, 'page size is bound');
  assertEqual(dataQuery.params[3], 25, 'second-page offset is bound');
}

async function testFanSiteExportOmitsNullWorkIds(): Promise<void> {
  const baseSong = {
    original_artist: 'Original Artist',
    tags: '[]',
    status: 'approved',
    submitted_by: null,
    reviewed_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  };
  const fakeDb = new FakeD1Database(null, null, [], null, [
    { ...baseSong, id: 'song-linked', work_id: 'work-shared', title: 'Linked Song' },
    { ...baseSong, id: 'song-unlinked', work_id: null, title: 'Unlinked Song' },
  ]);

  const songs = await exportSongs(fakeDb as unknown as D1Database, 'alice');

  assertEqual(songs[0].workId, 'work-shared', 'linked fan-site song exports its global work ID');
  assert(!Object.prototype.hasOwnProperty.call(songs[1], 'workId'), 'unlinked fan-site song omits workId instead of exporting null');
  assertEqual(fakeDb.allStatements.length, 0, 'fan-site export avoids separate D1 read calls');
  assertEqual(fakeDb.batchStatements.length, 2, 'fan-site export fetches songs and performances in one batch');
}

async function testDashboardStatsBatchesIndependentReads(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  fakeDb.dashboardStatusRows = {
    songs: [
      { status: 'pending', count: 2 },
      { status: 'approved', count: 3 },
    ],
    streams: [{ status: 'rejected', count: 4 }],
    performances: [
      { status: 'excluded', count: 5 },
      { status: 'extracted', count: 6 },
    ],
  };
  fakeDb.dashboardRecentSongRows = [{
    id: 'song-recent',
    work_id: null,
    title: 'Recent Song',
    original_artist: 'Artist',
    tags: '[]',
    status: 'pending',
    submitted_by: null,
    reviewed_by: null,
    created_at: '2026-01-02 00:00:00',
    updated_at: '2026-01-02 00:00:00',
  }];
  fakeDb.dashboardRecentStreamRows = [{
    id: 'stream-recent',
    streamer_id: 'mizuki',
    title: 'Recent Stream',
    date: '2026-01-03',
    video_id: 'video-recent',
    youtube_url: 'https://www.youtube.com/watch?v=video-recent',
    credit: '{}',
    status: 'approved',
    submitted_by: null,
    reviewed_by: null,
    created_at: '2026-01-03 00:00:00',
  }];

  const stats = await getDashboardStats(fakeDb as unknown as D1Database, 'alice');

  assertEqual(stats.songs.pending, 2, 'dashboard maps batched pending song count');
  assertEqual(stats.songs.approved, 3, 'dashboard maps batched approved song count');
  assertEqual(stats.streams.rejected, 4, 'dashboard maps batched rejected stream count');
  assertEqual(stats.performances.excluded, 5, 'dashboard maps batched excluded performance count');
  assertEqual(stats.performances.extracted, 6, 'dashboard maps batched extracted performance count');
  assertEqual(
    stats.recentSubmissions.map((submission) => submission.id).join('|'),
    'stream-recent|song-recent',
    'dashboard keeps recent submissions ordered after batched reads',
  );
  assertEqual(fakeDb.allStatements.length, 0, 'dashboard avoids separate D1 read calls');
  assertEqual(fakeDb.batchStatements.length, 5, 'dashboard fetches all independent reads in one batch');
  assert(
    fakeDb.batchStatements.every((statement) => statement.params[0] === 'alice'),
    'every dashboard query remains scoped to the requested streamer',
  );
}

function mergeRow(
  id: string,
  status: 'pending' | 'approved',
  tags: string,
  options: {
    artist?: string;
    title?: string;
    workId?: string | null;
    workTitle?: string;
    workArtist?: string;
    workTags?: string;
  } = {},
): Record<string, unknown> {
  const artist = options.artist ?? 'Artist';
  const title = options.title ?? 'Song';
  const workId = options.workId === undefined ? 'work-shared' : options.workId;
  return {
    id,
    streamer_id: 'alice',
    work_id: workId,
    work_title: workId === null ? null : (options.workTitle ?? title),
    work_original_artist: workId === null ? null : (options.workArtist ?? artist),
    work_tags: workId === null ? null : (options.workTags ?? '[]'),
    title,
    original_artist: artist,
    tags,
    status,
    submitted_by: 'submitter@example.com',
    reviewed_by: status === 'approved' ? 'reviewer@example.com' : null,
    created_at: '2026-01-01 00:00:00',
  };
}

async function testHarmonizerScanUsesAndExposesWorkIds(): Promise<void> {
  const row = (
    id: string,
    workId: string | null,
    title: string,
    perfCount: number,
  ) => ({
    id,
    work_id: workId,
    title,
    original_artist: 'Artist',
    status: 'approved',
    created_at: '2026-01-01 00:00:00',
    perf_count: perfCount,
  });
  const fakeDb = new FakeD1Database(null, null, [], null, [], [], [
    row('same-work-a', 'work-one', 'Alpha', 2),
    row('same-work-b', 'work-one', 'Completely Different Title', 1),
    row('same-title-a', 'work-two', 'Shared Title', 4),
    row('same-title-b', 'work-three', 'shared title', 3),
  ]);

  const { groups, revision } = await getSongSimilarityGroups(
    fakeDb as unknown as D1Database,
    'alice',
    'exact',
    0.85,
  );

  assertEqual(fakeDb.batchCallCount, 1, 'the scan reads its songs and catalog revision in one batch');
  assertEqual(revision, SCANNED_REVISION, 'the scan reports the revision a later merge must send back');
  assertEqual(groups.length, 2, 'work identity and normalized title each form a review group');
  const workGroup = groups.find((group) => group.matchType === 'work_id');
  if (!workGroup) throw new Error('same workId songs should form a work_id group');
  assertEqual(workGroup.normalizedKey, 'work:work-one', 'same-work group identifies its authoritative work');
  assertEqual(workGroup.items[0].workId, 'work-one', 'scan response exposes workId to the UI');
  assertEqual(workGroup.items[1].workId, 'work-one', 'every scan entry exposes workId');

  const crossWorkGroup = groups.find((group) => group.matchType === 'exact');
  if (!crossWorkGroup) throw new Error('same normalized title across works should stay reviewable');
  assertEqual(
    crossWorkGroup.items.map((item) => item.workId).join('|'),
    'work-two|work-three',
    'exact title group preserves distinct work identities for explicit review',
  );
}

async function testMergeSongsPreservesPerformances(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'pending', '["canonical"]'),
    mergeRow('song-source-1', 'approved', '["source"]'),
    mergeRow('song-source-2', 'approved', '[]', { artist: 'Cover Artist' }),
  ]);

  const result = await mergeSongs({
    db: fakeDb as unknown as D1Database,
    streamerId: 'alice',
    canonicalSongId: 'song-canonical',
    sourceSongIds: ['song-source-1', 'song-source-2'],
    mergedBy: 'curator@example.com',
    revision: SCANNED_REVISION,
  });

  assertEqual(result.mergedSongs, 2, 'both source song rows are deleted');
  assertEqual(result.movedPerformances, 3, 'all source performances are repointed');
  assertEqual(result.canonicalWorkId, 'work-shared', 'same-work merge retains its global identity');
  assertEqual(result.mergedWorks, 0, 'same-work merge never deletes a global work');
  assertEqual(result.relinkedSongs, 0, 'same-work merge does not repoint unrelated song bridges');
  assert(
    !fakeDb.batchStatements.some((statement) => /UPDATE\s+works/i.test(statement.sql)),
    'same-work merge keeps local tags out of global work metadata',
  );
  assertEqual(
    fakeDb.batchStatements[0]?.params[2],
    '{}',
    'same-work merge does not depend on unrelated global work metadata',
  );

  const sql = fakeDb.batchStatements.map((statement) => statement.sql).join('\n');
  assert(/UPDATE\s+performances/i.test(sql), 'merge must repoint performances');
  assert(!/DELETE\s+FROM\s+performances/i.test(sql), 'merge must never delete performances');

  const aliasInserts = fakeDb.batchStatements.filter((statement) =>
    /INSERT\s+INTO\s+song_aliases/i.test(statement.sql),
  );
  assertEqual(aliasInserts.length, 1, 'all deleted songs are snapshotted with one bounded statement');
  assert(/SELECT\s+source\.id/i.test(aliasInserts[0].sql), 'song aliases are copied from authoritative source rows');
  assertEqual(aliasInserts[0].params.at(-2), 'song-source-1', 'first source receives an alias');
  assertEqual(aliasInserts[0].params.at(-1), 'song-source-2', 'every unique source receives an alias');

  const canonicalUpdate = fakeDb.batchStatements.find((statement) =>
    /UPDATE\s+songs/i.test(statement.sql),
  );
  if (!canonicalUpdate) throw new Error('canonical metadata should be updated');
  assertEqual(canonicalUpdate.params.at(-5), '["canonical","source"]', 'source tags are unioned into canonical tags');
  assertEqual(canonicalUpdate.params.at(-4), 'approved', 'approved status is preserved when canonical was pending');
}

async function testMergeSongsRequiresExplicitGlobalWorkConfirmation(): Promise<void> {
  const rows = [
    mergeRow('song-canonical', 'approved', '[]', { workId: 'work-canonical' }),
    mergeRow('song-source', 'approved', '[]', { workId: 'work-source' }),
  ];
  const fakeDb = new FakeD1Database(null, null, rows);

  let caught: unknown;
  try {
    await mergeSongs({
      db: fakeDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-source'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof SongMergeError, 'cross-work merge without confirmation should fail closed');
  assertEqual((caught as SongMergeError).code, 'work_merge_required', 'failure tells UI to request global confirmation');
  assertEqual(fakeDb.batchStatements.length, 0, 'missing global confirmation never writes partial data');
}

async function testMergeSongsMergesGlobalWorksAcrossVtubers(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '["canonical-local"]', {
      workId: 'work-canonical',
      workTags: '["canonical-work"]',
    }),
    mergeRow('song-source-1', 'approved', '["source-local"]', {
      workId: 'work-source',
      workTags: '["source-work"]',
    }),
    mergeRow('song-source-2', 'approved', '[]', {
      workId: 'work-source',
      workTags: '["source-work"]',
    }),
    mergeRow('song-source-3', 'approved', '["third-local"]', {
      workId: 'work-third',
      workTags: '["third-work"]',
    }),
  ]);

  const result = await mergeSongs({
    db: fakeDb as unknown as D1Database,
    streamerId: 'alice',
    canonicalSongId: 'song-canonical',
    sourceSongIds: ['song-source-1', 'song-source-2', 'song-source-3'],
    mergedBy: 'curator@example.com',
    revision: SCANNED_REVISION,
    workMergeConfirmation: {
      canonicalWorkId: 'work-canonical',
      sourceWorkIds: ['work-third', 'work-source'],
    },
  });

  assertEqual(result.canonicalWorkId, 'work-canonical', 'selected canonical song controls the global work direction');
  assertEqual(result.mergedSongs, 3, 'all selected local source songs are merged');
  assertEqual(result.mergedWorks, 2, 'every distinct source work is retired exactly once');
  assertEqual(result.relinkedSongs, 1, 'surviving linked songs are reported as repointed');

  const aliasFlatten = fakeDb.batchStatements.find((statement) =>
    /UPDATE\s+work_aliases/i.test(statement.sql),
  );
  if (!aliasFlatten) throw new Error('existing aliases should be flattened to the final canonical work');
  assertEqual(
    aliasFlatten.params.slice(-3).join('|'),
    'work-canonical|work-source|work-third',
    'alias chains point directly to the final work',
  );

  const workAliasInsert = fakeDb.batchStatements.find((statement) =>
    /INSERT\s+INTO\s+work_aliases/i.test(statement.sql)
      && /SELECT\s+source\.id/i.test(statement.sql),
  );
  if (!workAliasInsert) throw new Error('retired work should receive an audit snapshot');
  assert(/SELECT\s+source\.id/i.test(workAliasInsert.sql), 'work alias snapshot comes from the source work row');
  assertEqual(
    workAliasInsert.params.slice(-4).join('|'),
    'work-canonical|curator@example.com|work-source|work-third',
    'one alias is written per distinct source work',
  );

  const globalRelink = fakeDb.batchStatements.find((statement) =>
    /UPDATE\s+song_work_links/i.test(statement.sql),
  );
  if (!globalRelink) throw new Error('cross-work merge should repoint all surviving song bridges');
  const globalRelinkUpdate = globalRelink.sql.split(/UPDATE\s+song_work_links/i)[1] ?? '';
  assert(!/streamer_id/i.test(globalRelinkUpdate), 'global bridge update is deliberately not scoped to one VTuber');
  assert(/updated_at\s*=\s*datetime\('now'\)/i.test(globalRelink.sql), 'global relink marks every affected static export stale');
  assertEqual(
    globalRelink.params.slice(-4).join('|'),
    'work-canonical|curator@example.com|work-source|work-third',
    'global bridge update records canonical work, curator, and retired work',
  );

  const workUpdate = fakeDb.batchStatements.find((statement) => /UPDATE\s+works/i.test(statement.sql));
  if (!workUpdate) throw new Error('canonical work tags should be updated');
  assertEqual(
    workUpdate.params.at(-2),
    '["canonical-work","source-work","third-work","canonical-local","source-local","third-local"]',
    'canonical work preserves global and local tags from every merged identity',
  );
  assert(
    fakeDb.batchStatements.some((statement) => /DELETE\s+FROM\s+works/i.test(statement.sql)),
    'retired work is deleted only after every bridge and alias is updated',
  );
  assert(
    !fakeDb.batchStatements.some((statement) => /DELETE\s+FROM\s+performances/i.test(statement.sql)),
    'global work merge never deletes performances',
  );
  const statementIndex = (pattern: RegExp): number => (
    fakeDb.batchStatements.findIndex((statement) => pattern.test(statement.sql))
  );
  assert(
    statementIndex(/INSERT\s+INTO\s+work_aliases/i) < statementIndex(/UPDATE\s+song_work_links/i),
    'source work metadata is snapshotted before its global links move',
  );
  assert(
    statementIndex(/UPDATE\s+song_work_links/i) < statementIndex(/DELETE\s+FROM\s+works/i),
    'every VTuber song bridge moves before the source work is deleted',
  );
  // Guard insert + set-based mutations + guard cleanup + the post-merge
  // revision read: a constant, independent of how many songs or works merge.
  assert(fakeDb.batchStatements.length <= 13, 'set-based global merge stays within a small D1 batch');
}

async function testMergeSongsRevalidatesReviewedStateInsideBatch(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]', {
      workId: 'work-canonical',
      workTags: '["canonical-reviewed"]',
    }),
    mergeRow('song-source', 'approved', '[]', {
      workId: 'work-source',
      workTags: '["source-reviewed"]',
    }),
  ]);
  fakeDb.mergeGuardValid = false;

  let caught: unknown;
  try {
    await mergeSongs({
      db: fakeDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-source'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
      workMergeConfirmation: {
        canonicalWorkId: 'work-canonical',
        sourceWorkIds: ['work-source'],
      },
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof SongMergeError, 'a link change before the transaction should fail closed');
  assertEqual(
    (caught as SongMergeError).code,
    'work_merge_stale',
    'transaction-time link changes invalidate the reviewed confirmation',
  );
  assert(
    /WITH\s+expected_links/i.test(fakeDb.batchStatements[0]?.sql ?? '')
      && /expected_song_state/i.test(fakeDb.batchStatements[0]?.sql ?? '')
      && /expected_work_state/i.test(fakeDb.batchStatements[0]?.sql ?? '')
      && /RETURNING\s+1\s+AS\s+valid/i.test(fakeDb.batchStatements[0]?.sql ?? ''),
    'the first statement revalidates reviewed song and work state inside the D1 batch',
  );
  const expectedLinks = JSON.parse(
    String(fakeDb.batchStatements[0]?.params[0] ?? '{}'),
  ) as Record<string, string>;
  assertEqual(expectedLinks['song-canonical'], 'work-canonical', 'guard binds the reviewed canonical link');
  assertEqual(expectedLinks['song-source'], 'work-source', 'guard binds every reviewed source link');
  const expectedSongState = JSON.parse(
    String(fakeDb.batchStatements[0]?.params[1] ?? '{}'),
  ) as Record<string, {
    title: string;
    originalArtist: string;
    tags: string;
    status: string;
    reviewedBy: string | null;
  }>;
  assertEqual(expectedSongState['song-canonical']?.title, 'Song', 'guard binds canonical title');
  assertEqual(expectedSongState['song-source']?.originalArtist, 'Artist', 'guard binds source artist');
  assertEqual(expectedSongState['song-canonical']?.tags, '[]', 'guard binds canonical local tags');
  assertEqual(expectedSongState['song-source']?.status, 'approved', 'guard binds source status');
  assertEqual(
    expectedSongState['song-source']?.reviewedBy,
    'reviewer@example.com',
    'guard binds source reviewer state',
  );
  const expectedWorkState = JSON.parse(
    String(fakeDb.batchStatements[0]?.params[2] ?? '{}'),
  ) as Record<string, string>;
  assertEqual(
    expectedWorkState['work-canonical'],
    '["canonical-reviewed"]',
    'guard binds the reviewed canonical work tags',
  );
  assertEqual(
    expectedWorkState['work-source'],
    '["source-reviewed"]',
    'guard binds every reviewed source work tag set',
  );
  const mutations = fakeDb.batchStatements.slice(1, -2);
  assert(mutations.length > 0, 'the guarded merge still prepares its mutation set');
  assert(
    mutations.every((statement) => (
      /WITH\s+merge_guard/i.test(statement.sql)
      && /SELECT\s+valid\s+FROM\s+merge_guard/i.test(statement.sql)
    )),
    'every merge mutation is conditional on the same transaction-time song-and-work-state guard',
  );
  assert(
    /DELETE\s+FROM\s+merge_guards\s+WHERE\s+guard_token\s*=\s*\?/i
      .test(fakeDb.batchStatements.at(-2)?.sql ?? ''),
    'the transaction removes its short-lived guard token after the merge',
  );
}

async function testMergeSongsFencesOnTheScannedCatalogRevision(): Promise<void> {
  const rows = () => [
    mergeRow('song-canonical', 'approved', '["canonical"]'),
    mergeRow('song-source', 'approved', '["source"]'),
  ];

  const staleDb = new FakeD1Database(null, null, rows());
  let caught: unknown;
  try {
    await mergeSongs({
      db: staleDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-source'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION - 1,
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof SongMergeError, 'a catalog write since the scan fails the merge closed');
  assertEqual(
    (caught as SongMergeError).code,
    'work_merge_stale',
    'a stale scan revision reuses the existing merge conflict code',
  );
  const staleGuard = staleDb.batchStatements[0];
  assert(
    /\(SELECT\s+revision\s+FROM\s+work_match_state\s+WHERE\s+id\s*=\s*1\)\s*=\s*\?/i
      .test(staleGuard?.sql ?? ''),
    'the guard insert fences on the catalog revision the scan displayed',
  );
  assertEqual(
    staleGuard?.params[SONG_MERGE_GUARD_REVISION_INDEX],
    SCANNED_REVISION - 1,
    'the guard binds the revision the caller reviewed, not a re-read one',
  );

  const currentDb = new FakeD1Database(null, null, rows());
  const result = await mergeSongs({
    db: currentDb as unknown as D1Database,
    streamerId: 'alice',
    canonicalSongId: 'song-canonical',
    sourceSongIds: ['song-source'],
    mergedBy: 'curator@example.com',
    revision: SCANNED_REVISION,
  });

  assertEqual(result.mergedSongs, 1, 'the current scan revision authorizes the merge');
  assertEqual(
    result.revision,
    REVISION_AFTER_MERGE,
    'the merge reports the catalog revision it left behind, not the one it was fenced on',
  );
  assert(
    currentDb.batchStatements.at(-1)?.sql.startsWith('SELECT revision FROM work_match_state') === true,
    'the batch tail reads the post-merge revision inside the same transaction',
  );
  assert(
    /DELETE\s+FROM\s+merge_guards\s+WHERE\s+guard_token\s*=\s*\?/i
      .test(currentDb.batchStatements.at(-2)?.sql ?? ''),
    'the guard cleanup stays the last mutating statement, right before that read',
  );
  const guardInsert = currentDb.batchStatements[0];
  assert(
    /INSERT\s+INTO\s+merge_guards\s*\(\s*guard_token,\s*canonical_id,\s*actor\s*\)/i
      .test(guardInsert?.sql ?? ''),
    'the guard token is written to the dedicated merge_guards table',
  );
  assertEqual(
    guardInsert?.params.at(-2),
    'song-canonical',
    'the guard row records the real canonical song id',
  );
  assertEqual(
    guardInsert?.params.at(-1),
    'system:harmonizer-merge-guard',
    'the guard row records the song merge actor',
  );
  assert(
    !currentDb.batchStatements.some((statement) => (
      /INSERT\s+INTO\s+work_aliases/i.test(statement.sql)
      || /__merge_guard__/.test(statement.sql)
    )),
    'a same-work merge writes no guard sentinel into work_aliases',
  );
}

async function testMergeSongsRejectsStaleWorkConfirmation(): Promise<void> {
  const sourceChangedDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]', { workId: 'work-canonical' }),
    mergeRow('song-source', 'approved', '[]', { workId: 'work-source-new' }),
  ]);

  let sourceChangedError: unknown;
  try {
    await mergeSongs({
      db: sourceChangedDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-source'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
      workMergeConfirmation: {
        canonicalWorkId: 'work-canonical',
        sourceWorkIds: ['work-source-reviewed'],
      },
    });
  } catch (error) {
    sourceChangedError = error;
  }

  assert(sourceChangedError instanceof SongMergeError, 'changed source work should fail closed');
  assertEqual(
    (sourceChangedError as SongMergeError).code,
    'work_merge_stale',
    'source work changes invalidate the reviewed confirmation',
  );
  assertEqual(sourceChangedDb.batchStatements.length, 0, 'stale source confirmation cannot write');

  const canonicalChangedDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]', { workId: 'work-canonical-new' }),
    mergeRow('song-source', 'approved', '[]', { workId: 'work-source' }),
  ]);

  let canonicalChangedError: unknown;
  try {
    await mergeSongs({
      db: canonicalChangedDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-source'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
      workMergeConfirmation: {
        canonicalWorkId: 'work-canonical-reviewed',
        sourceWorkIds: ['work-source'],
      },
    });
  } catch (error) {
    canonicalChangedError = error;
  }

  assert(canonicalChangedError instanceof SongMergeError, 'changed canonical work should fail closed');
  assertEqual(
    (canonicalChangedError as SongMergeError).code,
    'work_merge_stale',
    'canonical work changes invalidate the reviewed confirmation',
  );
  assertEqual(canonicalChangedDb.batchStatements.length, 0, 'stale canonical confirmation cannot write');
}

async function testMergeSongsRejectsUnlinkedWork(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]'),
    mergeRow('song-unlinked', 'approved', '[]', { workId: null }),
  ]);

  let caught: unknown;
  try {
    await mergeSongs({
      db: fakeDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-unlinked'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
      workMergeConfirmation: {
        canonicalWorkId: 'work-shared',
        sourceWorkIds: ['work-unlinked'],
      },
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof SongMergeError, 'unlinked merge should raise SongMergeError');
  assertEqual((caught as SongMergeError).code, 'work_not_linked', 'unlinked songs fail with a repairable conflict');
  assertEqual(fakeDb.batchStatements.length, 0, 'unlinked song cannot trigger any merge writes');
}

async function testMergeSongsRejectsMissingOrCrossStreamerSource(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]'),
  ]);

  let caught: unknown;
  try {
    await mergeSongs({
      db: fakeDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-from-another-streamer'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof SongMergeError, 'missing scoped source should raise SongMergeError');
  assertEqual((caught as SongMergeError).code, 'song_not_found', 'cross-streamer source is indistinguishable from missing');
  assertEqual(fakeDb.batchStatements.length, 0, 'validation failure must not execute a write batch');
}

async function testMergeSongsRejectsDuplicateSourceIds(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]'),
    mergeRow('song-source', 'approved', '[]'),
  ]);

  let caught: unknown;
  try {
    await mergeSongs({
      db: fakeDb as unknown as D1Database,
      streamerId: 'alice',
      canonicalSongId: 'song-canonical',
      sourceSongIds: ['song-source', 'song-source'],
      mergedBy: 'curator@example.com',
      revision: SCANNED_REVISION,
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof SongMergeError, 'duplicate source request should fail deterministically');
  assertEqual((caught as SongMergeError).code, 'invalid_request', 'duplicate source IDs are rejected as invalid');
  assertEqual(fakeDb.allStatements.length, 0, 'duplicate source IDs are rejected before database reads');
  assertEqual(fakeDb.batchStatements.length, 0, 'duplicate source IDs cannot create duplicate alias writes');
}

async function testSharedSongsSurviveStreamMutations(): Promise<void> {
  const unapproveDb = new FakeD1Database(null);
  await bulkUnapproveStream(unapproveDb as unknown as D1Database, 'stream-one');
  const songUnapprove = unapproveDb.batchStatements.find((statement) =>
    /UPDATE\s+songs/i.test(statement.sql),
  );
  if (!songUnapprove) throw new Error('bulk unapprove should update eligible songs');
  assert(
    /NOT\s+EXISTS[\s\S]+other\.stream_id\s+<>\s+\?/i.test(songUnapprove.sql),
    'bulk unapprove must keep a song approved while another stream has an approved performance',
  );
  assertEqual(songUnapprove.params[0], 'stream-one', 'target stream is scoped in the selected songs');
  assertEqual(songUnapprove.params[1], 'stream-one', 'other approved streams are excluded from demotion');

  const deleteDb = new FakeD1Database(null);
  deleteDb.streamPerformanceCount = 4;
  const deleted = await deleteStreamCascade(deleteDb as unknown as D1Database, 'stream-one');
  assertEqual(deleteDb.firstStatements.length, 0, 'stream delete avoids a separate count call');
  assert(
    /SELECT\s+COUNT\(\*\)\s+AS\s+cnt/i.test(deleteDb.batchStatements[0]?.sql ?? ''),
    'stream delete counts performances before its mutation statements',
  );
  assertEqual(deleted.performances, 4, 'stream delete reports the pre-cascade performance count');
  const songDelete = deleteDb.batchStatements.find((statement) =>
    /DELETE\s+FROM\s+songs/i.test(statement.sql),
  );
  if (!songDelete) throw new Error('stream delete should remove songs owned only by that stream');
  assert(
    /GROUP\s+BY\s+p\.song_id[\s\S]+HAVING\s+COUNT\(\*\)/i.test(songDelete.sql),
    'stream delete must handle multiple same-stream performances without leaving orphan songs',
  );
}

async function testUpdateStreamPropagatesCopiesToPerformances(): Promise<void> {
  // performances.stream_title/date/video_id are denormalized copies that the
  // fan-site export reads; editing a stream must move them in the same transaction.
  const fakeDb = new FakeD1Database(null);
  await updateStream(fakeDb as unknown as D1Database, 'stream-2026-01-01', 'mizuki', {
    videoId: 'newVideo',
    date: '2026-01-02',
  });

  assertEqual(fakeDb.batchCallCount, 1, 'a stream edit runs as one batch');
  assertEqual(fakeDb.batchStatements.length, 2, 'a stream edit updates the stream row and its performance copies');
  const [streamUpdate, perfUpdate] = fakeDb.batchStatements;
  assert(/UPDATE\s+streams\s+SET\s+date = \?, video_id = \?/i.test(streamUpdate?.sql ?? ''), 'first statement updates the stream row');
  assert(/UPDATE\s+performances\s+SET\s+date = \?, video_id = \?/i.test(perfUpdate?.sql ?? ''), 'second statement updates the performance copies');
  assert(
    /WHERE\s+stream_id = \? AND streamer_id = \?/i.test(perfUpdate?.sql ?? ''),
    'performance copies are scoped to the edited stream AND its streamer',
  );
  assertEqual(perfUpdate?.params[0], '2026-01-02', 'performance date follows the stream');
  assertEqual(perfUpdate?.params[1], 'newVideo', 'performance video_id follows the stream');
  assertEqual(perfUpdate?.params[2], 'stream-2026-01-01', 'performance update targets the edited stream');
  assertEqual(perfUpdate?.params[3], 'mizuki', "performance update never crosses into another streamer's rows");

  const urlOnly = new FakeD1Database(null);
  await updateStream(urlOnly as unknown as D1Database, 'stream-2026-01-01', 'mizuki', {
    youtubeUrl: 'https://www.youtube.com/watch?v=newVideo',
  });
  assertEqual(urlOnly.batchStatements.length, 1, 'youtube_url has no performance copy, so only the stream row is updated');

  console.log('✓ stream edits propagate title/date/video_id to their performances');
}

// --- One catalog write pipeline (prepareCatalogWrites) shared by all three
// pipelines: createSongAndPerformance, appendStreamPerformances /
// replaceStreamPerformances, importVodToAdminDb ---

type CatalogStatementKind =
  | 'delete-songs'
  | 'delete-performances'
  | 'work'
  | 'song'
  | 'link'
  | 'performance';

function catalogStatementKind(statement: CapturedStatement): CatalogStatementKind | null {
  if (/DELETE\s+FROM\s+songs/i.test(statement.sql)) return 'delete-songs';
  if (/DELETE\s+FROM\s+performances/i.test(statement.sql)) return 'delete-performances';
  if (/INSERT\s+INTO\s+works/i.test(statement.sql)) return 'work';
  if (/INSERT\s+INTO\s+songs/i.test(statement.sql)) return 'song';
  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+song_work_links/i.test(statement.sql)) return 'link';
  if (/INSERT\s+INTO\s+performances/i.test(statement.sql)) return 'performance';
  return null;
}

function collectCatalogWriteSql(
  fakeDb: FakeD1Database,
  songSql: Set<string>,
  perfSql: Set<string>,
): void {
  for (const statement of fakeDb.batchStatements) {
    if (/INSERT\s+INTO\s+songs/i.test(statement.sql)) songSql.add(statement.sql);
    if (/INSERT\s+INTO\s+performances/i.test(statement.sql)) perfSql.add(statement.sql);
  }
}

async function testCreateSongAndPerformanceUsesSharedCatalogPipeline(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  const result = await createSongAndPerformance(fakeDb as unknown as D1Database, {
    streamerId: 'alice',
    streamId: 'stream-1',
    date: '2026-01-01',
    streamTitle: 'Stream One',
    videoId: 'video-1',
    title: 'Song A',
    originalArtist: 'Artist A',
    timestamp: 10,
    endTimestamp: 20,
    note: 'note-a',
    submittedBy: 'curator@example.com',
  });

  assert(typeof result.songId === 'string' && result.songId.length > 0, 'createSongAndPerformance returns a generated songId');
  assert(typeof result.performanceId === 'string' && result.performanceId.length > 0, 'createSongAndPerformance returns a generated performanceId');

  const kinds = fakeDb.batchStatements
    .map(catalogStatementKind)
    .filter((kind): kind is CatalogStatementKind => kind !== null);
  assertEqual(
    kinds.join(','),
    'work,song,link,performance',
    'createSongAndPerformance batches work, song, link, then performance in that order',
  );
}

// The three catalog pipelines (createSongAndPerformance, appendStreamPerformances,
// importVodToAdminDb) must all write through the exact same songs-insert and
// performances-insert SQL literal — prepareCatalogWrites' whole reason to exist.
async function testAllCatalogPipelinesShareTheSameWriteLiterals(): Promise<void> {
  const songSql = new Set<string>();
  const perfSql = new Set<string>();

  const createDb = new FakeD1Database(null);
  await createSongAndPerformance(createDb as unknown as D1Database, {
    streamerId: 'alice',
    streamId: 'stream-1',
    date: '2026-01-01',
    streamTitle: 'Stream One',
    videoId: 'video-1',
    title: 'Song A',
    originalArtist: 'Artist A',
    timestamp: 10,
    endTimestamp: 20,
    note: '',
    submittedBy: 'curator@example.com',
  });
  collectCatalogWriteSql(createDb, songSql, perfSql);

  const bulkDb = new FakeD1Database(null);
  await appendStreamPerformances(bulkDb as unknown as D1Database, {
    streamerId: 'alice',
    streamId: 'stream-1',
    date: '2026-01-01',
    streamTitle: 'Stream One',
    videoId: 'video-1',
    songs: [{ songName: 'Song B', artist: 'Artist B', startSeconds: 5, endSeconds: 15 }],
    submittedBy: 'curator@example.com',
  });
  collectCatalogWriteSql(bulkDb, songSql, perfSql);

  const vodDb = new FakeD1Database(null);
  await importVodToAdminDb(
    vodDb as unknown as D1Database,
    {
      streamer_slug: 'alice',
      video_id: 'video-2',
      video_url: 'https://www.youtube.com/watch?v=video-2',
      stream_title: 'Stream Two',
      stream_date: '2026-02-02',
    },
    [{ song_title: 'Song C', original_artist: 'Artist C', start_timestamp: 1, end_timestamp: 9 }],
    'curator@example.com',
  );
  collectCatalogWriteSql(vodDb, songSql, perfSql);

  assertEqual(songSql.size, 1, 'every catalog pipeline shares the exact same songs-insert SQL literal');
  assertEqual(perfSql.size, 1, 'every catalog pipeline shares the exact same performances-insert SQL literal');
}

// appendStreamPerformances is additive only. The whole reason the old `replace: boolean`
// flag became two named functions (audit W5) is so a caller can never accidentally
// trigger the destructive delete path — appendStreamPerformances must be structurally
// incapable of emitting a DELETE, not just default to false.
async function testAppendStreamPerformancesEmitsNoDeletes(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  const result = await appendStreamPerformances(fakeDb as unknown as D1Database, {
    streamerId: 'alice',
    streamId: 'stream-1',
    date: '2026-01-01',
    streamTitle: 'Stream One',
    videoId: 'video-1',
    songs: [{ songName: 'Song X', artist: 'Artist X', startSeconds: 1, endSeconds: 2 }],
    submittedBy: 'curator@example.com',
  });

  assertEqual(result.created, 1, 'appendStreamPerformances reports the created count');
  const deletes = fakeDb.batchStatements.filter((statement) => /DELETE\s+FROM/i.test(statement.sql));
  assertEqual(deletes.length, 0, 'appendStreamPerformances must never emit a DELETE statement');
}

// replaceStreamPerformances' delete statements must lead the shared catalog pipeline
// (prepareCatalogWrites) — prepareCatalogWrites never calls db.batch itself, so the
// caller-owned delete statements lead the batch.
async function testReplaceStreamPerformancesRunsDeletesBeforeTheSharedCatalogPipeline(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  await replaceStreamPerformances(fakeDb as unknown as D1Database, {
    streamerId: 'alice',
    streamId: 'stream-1',
    date: '2026-01-01',
    streamTitle: 'Stream One',
    videoId: 'video-1',
    songs: [{ songName: 'Song R', artist: 'Artist R', startSeconds: 1, endSeconds: 2 }],
    submittedBy: 'curator@example.com',
  });

  const kinds = fakeDb.batchStatements
    .map(catalogStatementKind)
    .filter((kind): kind is CatalogStatementKind => kind !== null);
  assertEqual(
    kinds.join(','),
    'delete-songs,delete-performances,work,song,link,performance',
    'replaceStreamPerformances deletes existing rows before the shared catalog pipeline writes new ones',
  );
}

// --- Object parameters close the positional-argument swap hole (audit W5) ---
//
// The old positional insertPerformance/insertStream/createSongAndPerformance argument
// lists placed two same-typed strings (date, streamTitle/title) in adjacent slots with
// no compiler check that a caller passed them in the right order. Object params close
// that hole at compile time: a value only satisfies the parameter type under its own
// property name, so there is no positional slot left to transpose by accident — every
// call site in this repo had to move to the object form for `npm run check`'s
// typecheck to pass (that is the compile-time proof; it cannot be expressed as a
// runtime assertion). These tests prove the runtime half of the contract: naming the
// fields correctly must route each value into its own SQL bind position, not a
// neighbor's.

async function testInsertPerformanceRoutesFieldsToTheirOwnColumns(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  await insertPerformance(fakeDb as unknown as D1Database, {
    streamerId: 'alice',
    id: 'perf-swap-check',
    songId: 'song-swap-check',
    streamId: 'stream-swap-check',
    date: '2026-04-04',
    streamTitle: 'Distinct Stream Title',
    videoId: 'video-swap-check',
    timestamp: 42,
    endTimestamp: 99,
    note: 'swap-check',
    submittedBy: 'curator@example.com',
  });

  assertEqual(fakeDb.runStatements.length, 1, 'insertPerformance issues exactly one prepared statement');
  const insert = fakeDb.runStatements[0];
  assert(/INSERT\s+INTO\s+performances/i.test(insert.sql), 'insertPerformance emits a performances insert');
  assertEqual(insert.params[PERF_DATE], '2026-04-04', 'the date field lands in the date column, not swapped with streamTitle');
  assertEqual(insert.params[PERF_TITLE], 'Distinct Stream Title', 'the streamTitle field lands in the stream_title column, not swapped with date');
  // Migrated production tables have no column DEFAULT for updated_at (SQLite's
  // ALTER TABLE ADD COLUMN cannot carry a non-constant one), so every insert
  // must set it explicitly in SQL — matching the schema DEFAULT's format —
  // rather than leaving it to a JS timestamp or an absent column.
  assert(insert.sql.includes('updated_at'), 'insertPerformance names the updated_at column');
  assert(insert.sql.includes("datetime('now')"), "insertPerformance sets updated_at via SQL datetime('now'), not a bound JS timestamp");
}

async function testInsertStreamRoutesFieldsToTheirOwnColumns(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  await insertStream(fakeDb as unknown as D1Database, {
    streamerId: 'alice',
    id: 'stream-swap-check',
    title: 'Distinct Stream Title',
    date: '2026-05-05',
    videoId: 'video-swap-check',
    youtubeUrl: 'https://www.youtube.com/watch?v=video-swap-check',
    credit: '{}',
    submittedBy: 'curator@example.com',
  });

  assertEqual(fakeDb.runStatements.length, 1, 'insertStream issues exactly one prepared statement');
  const insert = fakeDb.runStatements[0];
  assert(/INSERT\s+INTO\s+streams/i.test(insert.sql), 'insertStream emits a streams insert');
  // streams columns, in bind order: 0 id, 1 streamer_id, 2 title, 3 date, 4 video_id, ...
  assertEqual(insert.params[2], 'Distinct Stream Title', 'the title field lands in the title column, not swapped with date');
  assertEqual(insert.params[3], '2026-05-05', 'the date field lands in the date column, not swapped with title');
  // Migrated production tables have no column DEFAULT for updated_at (SQLite's
  // ALTER TABLE ADD COLUMN cannot carry a non-constant one), so every insert
  // must set it explicitly in SQL — matching the schema DEFAULT's format —
  // rather than leaving it to a JS timestamp or an absent column.
  assert(insert.sql.includes('updated_at'), 'insertStream names the updated_at column');
  assert(insert.sql.includes("datetime('now')"), "insertStream sets updated_at via SQL datetime('now'), not a bound JS timestamp");
}

// --- Batch the round-trips (audit 4.2 / W3) ---

// The import-streams route's preflight existence check is one D1 round trip
// regardless of how many videos are being imported — a json_each-expanded IN for the
// video ids and one for the candidate stream ids, both issued in a single db.batch.
async function testFindExistingStreamImportKeysUsesOnePreflightBatch(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  fakeDb.existingVideoIdRows = [{ video_id: 'video-existing' }];
  fakeDb.existingStreamIdRows = [{ id: 'stream-2026-01-01' }];

  const result = await findExistingStreamImportKeys(
    fakeDb as unknown as D1Database,
    'alice',
    ['video-existing', 'video-new-1', 'video-new-2'],
    ['stream-2026-01-01', 'stream-2026-01-02', 'stream-2026-01-03'],
  );

  assertEqual(fakeDb.batchCallCount, 1, 'the preflight existence check is one D1 round trip regardless of video count');
  assertEqual(fakeDb.batchStatements.length, 2, 'the preflight batch holds exactly the video-id and stream-id existence reads');
  assert(
    /video_id\s+IN\s*\(SELECT\s+value\s+FROM\s+json_each\(\?\)\)/i.test(fakeDb.batchStatements[0].sql),
    'the video-id existence read expands the candidate list via json_each',
  );
  assert(
    /streamer_id\s*=\s*\?/i.test(fakeDb.batchStatements[0].sql),
    'the video-id existence read is scoped to the streamer',
  );
  assert(
    /id\s+IN\s*\(SELECT\s+value\s+FROM\s+json_each\(\?\)\)/i.test(fakeDb.batchStatements[1].sql),
    'the stream-id existence read expands the candidate id list via json_each',
  );

  assertEqual([...result.existingVideoIds].join(','), 'video-existing', 'existing video ids come back from the preflight read');
  assertEqual([...result.existingStreamIds].join(','), 'stream-2026-01-01', 'colliding candidate stream ids come back from the preflight read');
}

async function testInsertStreamsUsesOneBatch(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  await insertStreams(fakeDb as unknown as D1Database, [
    {
      streamerId: 'alice',
      id: 'stream-1',
      title: 'One',
      date: '2026-01-01',
      videoId: 'video-1',
      youtubeUrl: 'https://www.youtube.com/watch?v=video-1',
      credit: '{}',
      submittedBy: 'curator@example.com',
    },
    {
      streamerId: 'alice',
      id: 'stream-2',
      title: 'Two',
      date: '2026-01-02',
      videoId: 'video-2',
      youtubeUrl: 'https://www.youtube.com/watch?v=video-2',
      credit: '{}',
      submittedBy: 'curator@example.com',
    },
  ]);

  assertEqual(fakeDb.batchCallCount, 1, 'importing multiple streams shares one D1 batch');
  assertEqual(fakeDb.batchStatements.length, 2, 'one insert is prepared for each stream');
  assert(
    fakeDb.batchStatements.every((statement) => /INSERT\s+INTO\s+streams/i.test(statement.sql)),
    'the batch contains only stream inserts',
  );
  assertEqual(fakeDb.batchStatements[0]?.params[0], 'stream-1', 'the first stream id is preserved');
  assertEqual(fakeDb.batchStatements[1]?.params[0], 'stream-2', 'the second stream id is preserved');
}

// deletePerformanceAndOrphanSong becomes atomic: one read, then one batch of two
// statements. The orphan-song delete's NOT EXISTS guard runs inside the SAME batch as
// the performance delete, so there is no separate round trip — and no window — between
// "performance gone" and "orphaned song gone."
async function testDeletePerformanceAndOrphanSongIsAtomic(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  fakeDb.performanceSongId = 'song-orphan-check';

  const deleted = await deletePerformanceAndOrphanSong(fakeDb as unknown as D1Database, 'perf-1');

  assertEqual(deleted, true, 'deleting an existing performance reports success');
  assertEqual(fakeDb.firstStatements.length, 1, 'looking up the owning song is the only read');
  assertEqual(fakeDb.batchCallCount, 1, 'the performance delete and the orphan-song delete share one batch');
  assertEqual(fakeDb.batchStatements.length, 2, 'the batch holds exactly the performance delete and the orphan-song delete');
  assert(
    /DELETE\s+FROM\s+performances\s+WHERE\s+id\s*=\s*\?/i.test(fakeDb.batchStatements[0].sql),
    'the performance delete runs first',
  );
  assert(
    /DELETE\s+FROM\s+songs\s+WHERE\s+id\s*=\s*\?\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+performances\s+WHERE\s+song_id\s*=\s*\?\s*\)/i.test(
      fakeDb.batchStatements[1].sql,
    ),
    'the orphan-song delete is conditioned on NOT EXISTS in the same statement, not a separate count read',
  );
  assertEqual(fakeDb.batchStatements[1].params[0], 'song-orphan-check', 'the orphan-song delete targets the owning song');
  assertEqual(fakeDb.batchStatements[1].params[1], 'song-orphan-check', 'the NOT EXISTS guard checks the same song id');
}

// A song still referenced by another performance must survive — the NOT EXISTS guard
// (simulated here via the fake's D1-side changes=0) is what keeps it alive, in the same
// statement shape as the orphan case above.
async function testDeletePerformanceAndOrphanSongSurvivesWhenSongStillReferenced(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  fakeDb.performanceSongId = 'song-still-referenced';
  fakeDb.songStillReferencedAfterDelete = true;

  const deleted = await deletePerformanceAndOrphanSong(fakeDb as unknown as D1Database, 'perf-1');

  assertEqual(deleted, true, 'the performance delete still succeeds even when the song survives');
  assertEqual(fakeDb.batchCallCount, 1, 'the same one-batch shape runs whether or not the song survives');
  assertEqual(fakeDb.batchStatements.length, 2, 'the same two-statement batch runs whether or not the song survives');
}

async function testGetSongByIdUsesOneBatchForSongAndPerformances(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  fakeDb.songByIdRow = {
    id: 'song-1',
    work_id: 'work-1',
    title: 'Song One',
    original_artist: 'Artist One',
    tags: '[]',
    status: 'approved',
    submitted_by: null,
    reviewed_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
  };
  fakeDb.songByIdPerformanceRows = [{
    id: 'perf-1',
    streamer_id: 'alice',
    song_id: 'song-1',
    stream_id: 'stream-1',
    date: '2026-01-01',
    stream_title: 'Stream One',
    video_id: 'video-1',
    timestamp: 10,
    end_timestamp: 20,
    note: '',
    status: 'approved',
    submitted_by: null,
    created_at: '2026-01-01',
  }];

  const song = await getSongById(fakeDb as unknown as D1Database, 'song-1');

  assertEqual(fakeDb.batchCallCount, 1, 'fetching a song and its performances shares one D1 batch');
  assertEqual(fakeDb.firstStatements.length, 0, 'getSongById no longer issues a separate .first() read');
  assertEqual(fakeDb.allStatements.length, 0, 'getSongById no longer issues a separate .all() read');
  if (!song) throw new Error('getSongById should return the song');
  assertEqual(song.id, 'song-1', 'the song row is mapped');
  assertEqual(song.workId, 'work-1', 'the linked work id is mapped');
  const performances = song.performances ?? [];
  assertEqual(performances.length, 1, 'the performances array is populated from the batched read');
  assertEqual(performances[0]?.id, 'perf-1', 'the performance row is mapped');
}

async function testGetSongByIdReturnsNullWhenMissing(): Promise<void> {
  const fakeDb = new FakeD1Database(null);
  const song = await getSongById(fakeDb as unknown as D1Database, 'song-missing');
  assertEqual(song, null, 'a missing song still returns null from the batched read');
}

// --- Every generated entity id carries a full UUID (audit decision 5) ---

function testGeneratedEntityIdsCarryFullUuids(): void {
  const songId = generateSongId();
  const performanceId = generatePerformanceId();
  const streamFallbackId = generateStreamIdFallback();
  const workId = generateWorkId();

  assert(/^song-[0-9a-f-]{36}$/.test(songId), `song ids keep the whole UUID: ${songId}`);
  assert(/^p-[0-9a-f-]{36}$/.test(performanceId), `performance ids keep the whole UUID: ${performanceId}`);
  assert(
    /^stream-[0-9a-f-]{36}$/.test(streamFallbackId),
    `stream fallback ids keep the whole UUID: ${streamFallbackId}`,
  );
  assert(/^work-[0-9a-f-]{36}$/.test(workId), `work ids are unchanged: ${workId}`);

  assert(generateSongId() !== generateSongId(), 'song ids are unique per call');
  assert(generatePerformanceId() !== generatePerformanceId(), 'performance ids are unique per call');
  assert(generateStreamIdFallback() !== generateStreamIdFallback(), 'stream fallback ids are unique per call');
}

function testDateBasedStreamIdIsUnchanged(): void {
  assertEqual(generateStreamId('2026-08-31'), 'stream-2026-08-31', 'the primary stream id stays date-derived');
  assert(
    !/^stream-[0-9a-f-]{36}$/.test(generateStreamId('2026-08-31')),
    'the date-based stream id is not a UUID id',
  );
}

async function main(): Promise<void> {
  await testUpdateStreamPropagatesCopiesToPerformances();
  await testInsertPerformancesUsesOneBatch();
  await testVodImportPreservesExistingStream();
  await testVodImportCreatesNewStreamWhenAbsent();
  await testVodImportReusesExactSong();
  await testSongIdentityEditRelinksGlobalWorkAtomically();
  await testHarmonizerArtistUpdatesRelinkEveryEditedSong();
  await testGlobalWorksListAggregatesAcrossStreamers();
  await testFanSiteExportOmitsNullWorkIds();
  await testDashboardStatsBatchesIndependentReads();
  await testHarmonizerScanUsesAndExposesWorkIds();
  await testMergeSongsPreservesPerformances();
  await testMergeSongsRequiresExplicitGlobalWorkConfirmation();
  await testMergeSongsMergesGlobalWorksAcrossVtubers();
  await testMergeSongsRevalidatesReviewedStateInsideBatch();
  await testMergeSongsFencesOnTheScannedCatalogRevision();
  await testMergeSongsRejectsStaleWorkConfirmation();
  await testMergeSongsRejectsUnlinkedWork();
  await testMergeSongsRejectsMissingOrCrossStreamerSource();
  await testMergeSongsRejectsDuplicateSourceIds();
  await testSharedSongsSurviveStreamMutations();
  await testCreateSongAndPerformanceUsesSharedCatalogPipeline();
  await testAllCatalogPipelinesShareTheSameWriteLiterals();
  await testAppendStreamPerformancesEmitsNoDeletes();
  await testReplaceStreamPerformancesRunsDeletesBeforeTheSharedCatalogPipeline();
  await testInsertPerformanceRoutesFieldsToTheirOwnColumns();
  await testInsertStreamRoutesFieldsToTheirOwnColumns();
  await testFindExistingStreamImportKeysUsesOnePreflightBatch();
  await testInsertStreamsUsesOneBatch();
  await testDeletePerformanceAndOrphanSongIsAtomic();
  await testDeletePerformanceAndOrphanSongSurvivesWhenSongStillReferenced();
  await testGetSongByIdUsesOneBatchForSongAndPerformances();
  await testGetSongByIdReturnsNullWhenMissing();
  testGeneratedEntityIdsCarryFullUuids();
  testDateBasedStreamIdIsUnchanged();
  console.log('✓ song imports reuse exact entities and merges preserve every performance');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/** Decode the set-based import payload; standalone inserts keep positional binds. */
function catalogPerformanceParams(statement: CapturedStatement): unknown[] {
  const [row] = JSON.parse(String(statement.params[0]));
  return [row.performanceId, row.streamerId, row.songId, row.streamId, row.date, row.streamTitle,
    row.videoId, row.timestamp, row.endTimestamp, row.note, 'pending', row.submittedBy];
}
