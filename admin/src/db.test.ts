import {
  batchUpdateSongs,
  bulkUnapproveStream,
  deleteStreamCascade,
  exportSongs,
  getSongSimilarityGroups,
  importVodToAdminDb,
  listGlobalWorksPaginated,
  mergeSongs,
  SongMergeError,
  updateSong,
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
  readonly batchStatements: CapturedStatement[] = [];

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

    return statements.map((statement) => {
      if (statement.sql.includes('SELECT s.id') && statement.sql.includes('s.original_artist = ?')) {
        return {
          results: this.exactSongId ? [{ id: this.exactSongId }] : [],
          meta: { changes: 0 },
        };
      }
      const changes = /UPDATE\s+performances/i.test(statement.sql)
        ? 3
        : /DELETE\s+FROM\s+songs/i.test(statement.sql)
          ? Math.max(0, statement.params.length - 1)
          : /DELETE\s+FROM\s+works/i.test(statement.sql)
            ? statement.params.length
            : 1;
      return { results: [], meta: { changes } };
    });
  }
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
  assertEqual(performanceInsert.params[PERF_STREAM_ID], 'stream-existing', 'pending performance should link to the existing stream');
  assertEqual(performanceInsert.params[PERF_DATE], '2026-01-01', 'pending performance should keep the existing stream date');
  assertEqual(performanceInsert.params[PERF_TITLE], 'Curated Existing Title', 'pending performance should keep the existing stream title');
  assertEqual(performanceInsert.params[PERF_STATUS], 'pending', 'imported performance must stay pending for curator review');
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
  assertEqual(performanceInsert.params[PERF_DATE], '2026-03-03', 'fresh performance should use the submitted date');
  assertEqual(performanceInsert.params[PERF_TITLE], 'Brand New Stream', 'fresh performance should use the submitted title');
  assertEqual(performanceInsert.params[PERF_STATUS], 'pending', 'fresh performance must stay pending for curator review');
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
  assertEqual(songInserts.length, 0, 'an exact existing song must be reused instead of duplicated');

  const workInserts = fakeDb.batchStatements.filter((statement) =>
    /INSERT\s+INTO\s+works/i.test(statement.sql),
  );
  assertEqual(workInserts.length, 1, 'an exact import ensures one global work identity');
  const workLinks = fakeDb.batchStatements.filter((statement) =>
    /INSERT\s+OR\s+IGNORE\s+INTO\s+song_work_links/i.test(statement.sql),
  );
  assertEqual(workLinks.length, 1, 'a reused local song is linked to its exact global work');

  const performanceInsert = fakeDb.batchStatements.find((statement) =>
    /INSERT\s+INTO\s+performances/i.test(statement.sql),
  );
  if (!performanceInsert) throw new Error('reused song should still receive a new performance');
  assertEqual(performanceInsert.params[PERF_SONG_ID], 'song-canonical', 'new performance links to exact canonical song');
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
  assert(/UPDATE\s+songs/i.test(fakeDb.batchStatements[1].sql), 'local song identity updates second');
  assert(/INSERT\s+INTO\s+song_work_links/i.test(fakeDb.batchStatements[2].sql), 'global bridge is relinked last');
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

  const groups = await getSongSimilarityGroups(
    fakeDb as unknown as D1Database,
    'alice',
    'exact',
    0.85,
  );

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

  const result = await mergeSongs(
    fakeDb as unknown as D1Database,
    'alice',
    'song-canonical',
    ['song-source-1', 'song-source-2'],
    'curator@example.com',
  );

  assertEqual(result.mergedSongs, 2, 'both source song rows are deleted');
  assertEqual(result.movedPerformances, 3, 'all source performances are repointed');
  assertEqual(result.canonicalWorkId, 'work-shared', 'same-work merge retains its global identity');
  assertEqual(result.mergedWorks, 0, 'same-work merge never deletes a global work');
  assertEqual(result.relinkedSongs, 0, 'same-work merge does not repoint unrelated song bridges');

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
  assertEqual(canonicalUpdate.params[0], '["canonical","source"]', 'source tags are unioned into canonical tags');
  assertEqual(canonicalUpdate.params[1], 'approved', 'approved status is preserved when canonical was pending');
}

async function testMergeSongsRequiresExplicitGlobalWorkConfirmation(): Promise<void> {
  const rows = [
    mergeRow('song-canonical', 'approved', '[]', { workId: 'work-canonical' }),
    mergeRow('song-source', 'approved', '[]', { workId: 'work-source' }),
  ];
  const fakeDb = new FakeD1Database(null, null, rows);

  let caught: unknown;
  try {
    await mergeSongs(
      fakeDb as unknown as D1Database,
      'alice',
      'song-canonical',
      ['song-source'],
      'curator@example.com',
    );
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

  const result = await mergeSongs(
    fakeDb as unknown as D1Database,
    'alice',
    'song-canonical',
    ['song-source-1', 'song-source-2', 'song-source-3'],
    'curator@example.com',
    true,
  );

  assertEqual(result.canonicalWorkId, 'work-canonical', 'selected canonical song controls the global work direction');
  assertEqual(result.mergedSongs, 3, 'all selected local source songs are merged');
  assertEqual(result.mergedWorks, 2, 'every distinct source work is retired exactly once');
  assertEqual(result.relinkedSongs, 1, 'surviving linked songs are reported as repointed');

  const aliasFlatten = fakeDb.batchStatements.find((statement) =>
    /UPDATE\s+work_aliases/i.test(statement.sql),
  );
  if (!aliasFlatten) throw new Error('existing aliases should be flattened to the final canonical work');
  assertEqual(
    aliasFlatten.params.join('|'),
    'work-canonical|work-source|work-third',
    'alias chains point directly to the final work',
  );

  const workAliasInsert = fakeDb.batchStatements.find((statement) =>
    /INSERT\s+INTO\s+work_aliases/i.test(statement.sql),
  );
  if (!workAliasInsert) throw new Error('retired work should receive an audit snapshot');
  assert(/SELECT\s+source\.id/i.test(workAliasInsert.sql), 'work alias snapshot comes from the source work row');
  assertEqual(
    workAliasInsert.params.join('|'),
    'work-canonical|curator@example.com|work-source|work-third',
    'one alias is written per distinct source work',
  );

  const globalRelink = fakeDb.batchStatements.find((statement) =>
    /UPDATE\s+song_work_links/i.test(statement.sql),
  );
  if (!globalRelink) throw new Error('cross-work merge should repoint all surviving song bridges');
  assert(!/streamer_id/i.test(globalRelink.sql), 'global bridge update is deliberately not scoped to one VTuber');
  assert(/updated_at\s*=\s*datetime\('now'\)/i.test(globalRelink.sql), 'global relink marks every affected static export stale');
  assertEqual(
    globalRelink.params.join('|'),
    'work-canonical|curator@example.com|work-source|work-third',
    'global bridge update records canonical work, curator, and retired work',
  );

  const workUpdate = fakeDb.batchStatements.find((statement) => /UPDATE\s+works/i.test(statement.sql));
  if (!workUpdate) throw new Error('canonical work tags should be updated');
  assertEqual(
    workUpdate.params[0],
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
  assert(fakeDb.batchStatements.length <= 10, 'set-based global merge stays within a small D1 batch');
}

async function testMergeSongsRejectsUnlinkedWork(): Promise<void> {
  const fakeDb = new FakeD1Database(null, null, [
    mergeRow('song-canonical', 'approved', '[]'),
    mergeRow('song-unlinked', 'approved', '[]', { workId: null }),
  ]);

  let caught: unknown;
  try {
    await mergeSongs(
      fakeDb as unknown as D1Database,
      'alice',
      'song-canonical',
      ['song-unlinked'],
      'curator@example.com',
      true,
    );
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
    await mergeSongs(
      fakeDb as unknown as D1Database,
      'alice',
      'song-canonical',
      ['song-from-another-streamer'],
      'curator@example.com',
    );
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
    await mergeSongs(
      fakeDb as unknown as D1Database,
      'alice',
      'song-canonical',
      ['song-source', 'song-source'],
      'curator@example.com',
    );
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
  await deleteStreamCascade(deleteDb as unknown as D1Database, 'stream-one');
  const songDelete = deleteDb.batchStatements.find((statement) =>
    /DELETE\s+FROM\s+songs/i.test(statement.sql),
  );
  if (!songDelete) throw new Error('stream delete should remove songs owned only by that stream');
  assert(
    /GROUP\s+BY\s+p\.song_id[\s\S]+HAVING\s+COUNT\(\*\)/i.test(songDelete.sql),
    'stream delete must handle multiple same-stream performances without leaving orphan songs',
  );
}

async function main(): Promise<void> {
  await testVodImportPreservesExistingStream();
  await testVodImportCreatesNewStreamWhenAbsent();
  await testVodImportReusesExactSong();
  await testSongIdentityEditRelinksGlobalWorkAtomically();
  await testHarmonizerArtistUpdatesRelinkEveryEditedSong();
  await testGlobalWorksListAggregatesAcrossStreamers();
  await testFanSiteExportOmitsNullWorkIds();
  await testHarmonizerScanUsesAndExposesWorkIds();
  await testMergeSongsPreservesPerformances();
  await testMergeSongsRequiresExplicitGlobalWorkConfirmation();
  await testMergeSongsMergesGlobalWorksAcrossVtubers();
  await testMergeSongsRejectsUnlinkedWork();
  await testMergeSongsRejectsMissingOrCrossStreamerSource();
  await testMergeSongsRejectsDuplicateSourceIds();
  await testSharedSongsSurviveStreamMutations();
  console.log('✓ song imports reuse exact entities and merges preserve every performance');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
