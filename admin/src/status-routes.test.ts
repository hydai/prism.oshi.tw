import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// One approved song, performance and stream, each answered by the lookup its status route makes.
// The song's reviewer is the curator who approved it first, so an answer that is the stored row
// shows it.
const SONG_ROW = {
  id: 'song-1',
  streamer_id: 'mizuki',
  work_id: null,
  title: 'Song',
  original_artist: 'Artist',
  tags: '[]',
  status: 'approved',
  submitted_by: null,
  reviewed_by: 'first@example.com',
  created_at: '2026-01-01 00:00:00',
  updated_at: '2026-01-01 00:00:00',
};

const PERFORMANCE_ID = 'perf-1';

const STREAM_ROW = {
  id: 'stream-1',
  streamer_id: 'mizuki',
  title: 'Karaoke night',
  date: '2026-01-01',
  video_id: 'vid00000001',
  youtube_url: 'https://www.youtube.com/watch?v=vid00000001',
  credit: '{}',
  status: 'approved',
  submitted_by: null,
  reviewed_by: 'first@example.com',
  created_at: '2026-01-01 00:00:00',
};

class StatusStatement {
  params: unknown[] = [];
  constructor(private readonly db: StatusD1, readonly sql: string) {}
  bind(...params: unknown[]): StatusStatement {
    this.params = params;
    return this;
  }
  async run(): Promise<{ meta: { changes: number } }> {
    this.db.executed.push(this);
    return { meta: { changes: 1 } };
  }
  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM streams WHERE id = ? AND streamer_id = ?')) {
      return (this.params[0] === STREAM_ROW.id && this.params[1] === STREAM_ROW.streamer_id ? STREAM_ROW : null) as T | null;
    }
    if (this.sql.includes('SELECT status FROM performances WHERE id = ?')) {
      return (this.params[0] === PERFORMANCE_ID ? { status: 'approved' } : null) as T | null;
    }
    return null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    const songLookup = this.sql.includes('FROM songs AS s') && this.params[0] === SONG_ROW.id;
    return { results: (songLookup ? [SONG_ROW] : []) as T[] };
  }
}

class StatusD1 {
  executed: StatusStatement[] = [];
  prepare(sql: string): StatusStatement {
    return new StatusStatement(this, sql);
  }
  async batch(statements: StatusStatement[]): Promise<Array<{ results: unknown[]; meta: { changes: number } }>> {
    this.executed.push(...statements);
    return Promise.all(statements.map(async (statement) => ({ ...(await statement.all()), meta: { changes: 0 } })));
  }
  writes(): StatusStatement[] {
    return this.executed.filter((statement) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(statement.sql));
  }
}

const CURATOR = 'curator@example.com';

function envFor(db: StatusD1) {
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

function statusPatch(status: string): RequestInit {
  return {
    method: 'PATCH',
    headers: {
      'CF-Access-Authenticated-User-Email': CURATOR,
      'Content-Type': 'application/json',
      [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
    },
    body: JSON.stringify({ status }),
  };
}

const ROUTES = [
  { name: 'song', path: `/api/songs/${SONG_ROW.id}/status?streamer=mizuki` },
  { name: 'performance', path: `/api/performances/${PERFORMANCE_ID}/status?streamer=mizuki` },
  { name: 'stream', path: `/api/streams/${STREAM_ROW.id}/status?streamer=mizuki` },
] as const;

// A retried change whose first attempt went through (its answer lost on the way back) asks for the
// status the record already has: it succeeds, with the answer a change gives, and writes nothing —
// not even reviewed_by or updated_at.
async function testSameStatusIsANoOp(): Promise<void> {
  for (const route of ROUTES) {
    const db = new StatusD1();
    const res = await app.request(route.path, statusPatch('approved'), envFor(db));
    assertEqual(res.status, 200, `a ${route.name} asked for the status it has answers 200`);
    const json = (await res.json()) as { id?: string; status?: string; reviewedBy?: string };
    assertEqual(json.status, 'approved', `the ${route.name}'s answer carries its status`);
    assertEqual(db.writes().length, 0, `a ${route.name} asked for the status it has is not written`);
    if (route.name === 'song') {
      assertEqual(json.id, SONG_ROW.id, 'the song answer is the song');
      assertEqual(json.reviewedBy, SONG_ROW.reviewed_by, 'the song answer keeps the reviewer who decided it');
    } else {
      assertEqual(json.id, route.name === 'stream' ? STREAM_ROW.id : PERFORMANCE_ID, `the ${route.name} answer names it`);
      assertEqual(Object.keys(json).sort().join(','), 'id,status', `the ${route.name} answer is { id, status }, as a change's is`);
    }
  }
}

async function testRealTransitionStillWrites(): Promise<void> {
  for (const route of ROUTES) {
    const db = new StatusD1();
    const res = await app.request(route.path, statusPatch('pending'), envFor(db));
    assertEqual(res.status, 200, `a ${route.name} moved from approved to pending answers 200`);
    const writes = db.writes();
    assertEqual(writes.length, 1, `a ${route.name} moved from approved to pending is written once`);
    assertEqual(writes[0]?.params[0], 'pending', `the ${route.name}'s write sets the new status`);
  }
}

async function testRefusedTransitionStillRefused(): Promise<void> {
  for (const route of ROUTES) {
    const db = new StatusD1();
    const res = await app.request(route.path, statusPatch('rejected'), envFor(db));
    assertEqual(res.status, 400, `a ${route.name} moved from approved to rejected is refused`);
    const json = (await res.json()) as { error?: string };
    assertEqual(json.error, 'Cannot transition from approved to rejected', `the ${route.name}'s refusal names both statuses`);
    assertEqual(db.writes().length, 0, `a refused ${route.name} change writes nothing`);
  }
}

async function main(): Promise<void> {
  await testSameStatusIsANoOp();
  await testRealTransitionStillWrites();
  await testRefusedTransitionStillRefused();
  console.log('✓ status routes: the status a record has is a no-op 200, a change writes once, a refused one still answers 400');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
