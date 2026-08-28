import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// One stream owned by mizuki. Reads answer only when the SQL is scoped by
// streamer_id AND the bound streamer matches; everything else is empty.
const STREAM_ROW = {
  id: 'stream-1',
  streamer_id: 'mizuki',
  title: 'Karaoke night',
  date: '2026-01-01',
  video_id: 'vid00000001',
  youtube_url: 'https://www.youtube.com/watch?v=vid00000001',
  credit: '{}',
  status: 'pending',
  submitted_by: null,
  reviewed_by: null,
  created_at: '2026-01-01 00:00:00',
};

// One song owned by mizuki, answered only through the streamer-scoped lookup.
const SONG_ROW = { id: 'song-1', streamer_id: 'mizuki' };

class ScopedStatement {
  params: unknown[] = [];
  constructor(private readonly db: ScopedD1, readonly sql: string) {}
  bind(...params: unknown[]): ScopedStatement {
    this.params = params;
    return this;
  }
  async run(): Promise<{ meta: { changes: number } }> {
    this.db.executed.push(this);
    return { meta: { changes: 1 } };
  }
  async first<T>(): Promise<T | null> {
    const scoped = this.sql.includes('FROM streams WHERE id = ? AND streamer_id = ?');
    if (scoped && this.params[0] === STREAM_ROW.id && this.params[1] === STREAM_ROW.streamer_id) {
      return STREAM_ROW as T;
    }
    const scopedSong = this.sql.includes('FROM songs WHERE id = ? AND streamer_id = ?');
    if (scopedSong && this.params[0] === SONG_ROW.id && this.params[1] === SONG_ROW.streamer_id) {
      return SONG_ROW as T;
    }
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}

class ScopedD1 {
  prepareCalls = 0;
  batched: ScopedStatement[] = [];
  executed: ScopedStatement[] = [];
  prepare(sql: string): ScopedStatement {
    this.prepareCalls += 1;
    return new ScopedStatement(this, sql);
  }
  async batch(statements: ScopedStatement[]): Promise<Array<{ results: unknown[]; meta: { changes: number } }>> {
    this.batched.push(...statements);
    return statements.map(() => ({ results: [], meta: { changes: 0 } }));
  }
}

const CURATOR = 'curator@example.com';

function envFor(db: ScopedD1) {
  const d1 = db as unknown as D1Database;
  const emptyR2 = { get: async () => null, put: async () => null } as unknown as R2Bucket;
  return {
    DB: d1,
    NOVA_DB: d1,
    CRYSTAL_DB: d1,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: '',
    VOD_EXPORT_PUBLIC: emptyR2,
    VOD_EXPORT_PRIVATE: emptyR2,
    VOD_EXPORT_DB_ID: 'test-db',
    VOD_EXPORT_NOVA_DB_ID: 'test-nova-db',
  };
}

function curatorRequest(method: string, body?: unknown): RequestInit {
  const init: RequestInit = {
    method,
    headers: {
      'CF-Access-Authenticated-User-Email': CURATOR,
      'Content-Type': 'application/json',
      [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return init;
}

async function testMissingStreamerIsRejectedBeforeDb(): Promise<void> {
  const db = new ScopedD1();
  const res = await app.request('/api/streams', curatorRequest('GET'), envFor(db));
  assertEqual(res.status, 400, 'a catalog route without ?streamer= is a 400');
  assertEqual(db.prepareCalls, 0, 'the missing scope is rejected before any query runs');
  const json = (await res.json()) as { error?: string };
  assertEqual(json.error, 'Missing or invalid ?streamer= query parameter', 'the error names the missing parameter');
}

async function testMalformedStreamerIsRejected(): Promise<void> {
  const db = new ScopedD1();
  const res = await app.request('/api/streams?streamer=Not%20A%20Slug', curatorRequest('GET'), envFor(db));
  assertEqual(res.status, 400, 'a malformed streamer slug is a 400');
  assertEqual(db.prepareCalls, 0, 'a malformed slug never reaches the database');
}

async function testStreamMutationIsScopedToStreamer(): Promise<void> {
  const wrongScope = new ScopedD1();
  const wrong = await app.request(
    '/api/streams/stream-1/status?streamer=other',
    curatorRequest('PATCH', { status: 'approved' }),
    envFor(wrongScope),
  );
  assertEqual(wrong.status, 404, "another streamer's stream is invisible to this scope");

  const rightScope = new ScopedD1();
  const right = await app.request(
    '/api/streams/stream-1/status?streamer=mizuki',
    curatorRequest('PATCH', { status: 'approved' }),
    envFor(rightScope),
  );
  assertEqual(right.status, 200, 'the owning streamer can mutate its stream');
}

async function testInlinePerformanceStreamMustBelongToStreamer(): Promise<void> {
  // stream-1 belongs to mizuki; another streamer's song may not attach a performance to it.
  const db = new ScopedD1();
  const res = await app.request(
    '/api/songs?streamer=someone-else',
    curatorRequest('POST', {
      title: 'Song',
      originalArtist: 'Artist',
      performances: [{ streamId: 'stream-1', timestamp: 10 }],
    }),
    envFor(db),
  );
  assertEqual(res.status, 404, "an inline performance pointing at another streamer's stream is rejected");
  assertEqual(db.batched.length, 0, 'nothing is inserted when the stream lookup fails');
}

async function testInlinePerformanceCopiesComeFromStream(): Promise<void> {
  // The denormalized stream_title/date/video_id copies are taken from the stream
  // row, never from the request body.
  const db = new ScopedD1();
  const res = await app.request(
    '/api/songs?streamer=mizuki',
    curatorRequest('POST', {
      title: 'Song',
      originalArtist: 'Artist',
      performances: [{ streamId: 'stream-1', timestamp: 10, date: 'bogus', streamTitle: 'bogus', videoId: 'bogus' }],
    }),
    envFor(db),
  );
  assertEqual(res.status, 201, 'a well-formed inline performance is accepted');
  const insert = db.batched.find((statement) => /INSERT\s+INTO\s+performances/i.test(statement.sql));
  if (!insert) throw new Error('the inline performance should be inserted in a batch');
  assertEqual(insert.params[4], STREAM_ROW.date, 'date copy comes from the stream row');
  assertEqual(insert.params[5], STREAM_ROW.title, 'stream_title copy comes from the stream row');
  assertEqual(insert.params[6], STREAM_ROW.video_id, 'video_id copy comes from the stream row');
  assertEqual(insert.params.includes('bogus'), false, 'body-supplied copies are ignored');
}

async function testPerformanceSongMustBelongToStreamer(): Promise<void> {
  // song-1 belongs to mizuki; a performance may not bind mizuki's stream to another
  // streamer's song (stream-level bulk approve/delete would follow that link).
  const foreign = new ScopedD1();
  const rejected = await app.request(
    '/api/performances?streamer=mizuki',
    curatorRequest('POST', { songId: 'song-of-someone-else', streamId: 'stream-1', timestamp: 5 }),
    envFor(foreign),
  );
  assertEqual(rejected.status, 404, "a song outside the streamer's scope is invisible");
  assertEqual(
    foreign.executed.filter((statement) => /INSERT/i.test(statement.sql)).length,
    0,
    'nothing is inserted for a foreign song',
  );

  const own = new ScopedD1();
  const accepted = await app.request(
    '/api/performances?streamer=mizuki',
    curatorRequest('POST', { songId: 'song-1', streamId: 'stream-1', timestamp: 5 }),
    envFor(own),
  );
  assertEqual(accepted.status, 201, "the streamer's own song accepts the performance");
  const insert = own.executed.find((statement) => /INSERT\s+INTO\s+performances/i.test(statement.sql));
  if (!insert) throw new Error('the performance should be inserted');
  assertEqual(insert.params[5], STREAM_ROW.title, 'stream_title copy comes from the scoped stream row');
}

async function main(): Promise<void> {
  await testMissingStreamerIsRejectedBeforeDb();
  await testMalformedStreamerIsRejected();
  await testStreamMutationIsScopedToStreamer();
  await testInlinePerformanceStreamMustBelongToStreamer();
  await testInlinePerformanceCopiesComeFromStream();
  await testPerformanceSongMustBelongToStreamer();
  console.log('✓ catalog routes require ?streamer= and scope stream lookups to it');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
