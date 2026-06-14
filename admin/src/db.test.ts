import { importVodToAdminDb } from './db';

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
}

class FakeD1Database {
  readonly firstStatements: CapturedStatement[] = [];
  readonly batchStatements: CapturedStatement[] = [];

  constructor(readonly existingStream: ExistingStream) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ meta: { changes: number } }>> {
    this.batchStatements.push(
      ...statements.map((statement) => ({ sql: statement.sql, params: statement.params })),
    );
    return statements.map(() => ({ meta: { changes: 1 } }));
  }
}

// performances columns, in bind order:
// 0 id, 1 streamer_id, 2 song_id, 3 stream_id, 4 date, 5 stream_title,
// 6 video_id, 7 timestamp, 8 end_timestamp, 9 note, 10 status, 11 submitted_by
const PERF_STREAM_ID = 3;
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

async function main(): Promise<void> {
  await testVodImportPreservesExistingStream();
  await testVodImportCreatesNewStreamWhenAbsent();
  console.log('✓ importVodToAdminDb preserves existing stream data and still imports fresh VODs');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
