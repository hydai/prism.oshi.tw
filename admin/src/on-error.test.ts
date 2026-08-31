import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// A D1 stand-in whose every method throws — simulates an unexpected failure
// deep in a route handler (a real D1 outage, a coding bug, anything that
// isn't validation) reaching app.onError, following authz.test.ts's
// app-invocation pattern (app.request(path, init, env), no network/Miniflare).
const THROW_MESSAGE = 'simulated D1 failure: connection reset';

class ThrowingD1 {
  prepare(): never {
    throw new Error(THROW_MESSAGE);
  }

  batch(): never {
    throw new Error(THROW_MESSAGE);
  }
}

const CURATOR = 'curator@example.com';

function envFor(overrides: Partial<{ DB: unknown; NOVA_DB: unknown; CRYSTAL_DB: unknown }> = {}) {
  const harmlessD1 = {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      }),
    }),
  };
  const emptyR2 = {
    get: async () => null,
    put: async () => null,
  };
  return {
    DB: overrides.DB ?? harmlessD1,
    NOVA_DB: overrides.NOVA_DB ?? harmlessD1,
    CRYSTAL_DB: overrides.CRYSTAL_DB ?? harmlessD1,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: '',
    VOD_EXPORT_PUBLIC: emptyR2,
    VOD_EXPORT_PRIVATE: emptyR2,
    VOD_EXPORT_DB_ID: 'test-db',
    VOD_EXPORT_NOVA_DB_ID: 'test-nova-db',
  } as unknown as Parameters<typeof app.request>[2];
}

function authHeaders(): HeadersInit {
  return { 'CF-Access-Authenticated-User-Email': CURATOR };
}

async function testUnhandledErrorReturnsGenericJsonContract(): Promise<void> {
  const originalConsoleError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  let res: Response;
  try {
    // GET /api/streamers reads NOVA_DB directly; a throwing NOVA_DB simulates
    // an unexpected failure with nothing to do with request validation.
    res = await app.request('/api/streamers', { headers: authHeaders() }, envFor({ NOVA_DB: new ThrowingD1() }));
  } finally {
    console.error = originalConsoleError;
  }

  assertEqual(res.status, 500, 'an unhandled error becomes a 500');
  assertEqual(res.headers.get('content-type')?.includes('application/json'), true, 'the body is JSON, not Hono\'s plain-text default');

  const body = await res.json() as { error?: unknown; code?: unknown };
  assertEqual(typeof body.error, 'string', 'the body carries a string error message');
  assertEqual(body.code, 'INTERNAL_ERROR', 'the body carries the INTERNAL_ERROR code');
  assert(
    !(body.error as string).includes(THROW_MESSAGE),
    'the real error message must not leak into the client-facing body',
  );
  assert(
    !JSON.stringify(body).toLowerCase().includes('at ') && !JSON.stringify(body).includes('.ts:'),
    'no stack trace leaks into the response body',
  );

  assert(
    logged.some((args) => args.some((a) => a instanceof Error && a.message === THROW_MESSAGE)
      || args.some((a) => typeof a === 'string' && a.includes(THROW_MESSAGE))),
    'the real error is still logged server-side via console.error, just not exposed to the client',
  );
}

async function testHttpExceptionStatusIsHonoredNotGenericized(): Promise<void> {
  // getStreamerId (http.ts) throws a real hono/http-exception HTTPException
  // with its own JSON response pre-attached whenever ?streamer= is missing —
  // onError must return that response as-is, not fold it into the generic
  // 500 contract.
  const res = await app.request('/api/songs', { headers: authHeaders() }, envFor());

  assertEqual(res.status, 400, 'the HTTPException\'s own status (400) is preserved, not overridden to 500');
  const body = await res.json() as { error?: unknown; code?: unknown };
  assertEqual(body.error, 'Missing or invalid ?streamer= query parameter', 'the HTTPException\'s own message is preserved verbatim');
  assertEqual(body.code, undefined, 'an honored HTTPException keeps its original body shape — no INTERNAL_ERROR code is injected');
}

async function testHttpExceptionOnADifferentRouteIsAlsoHonored(): Promise<void> {
  // Same getStreamerId call site, exercised through a different route's
  // wiring, so "honor HTTPException" isn't proven by only one call site.
  const res = await app.request('/api/streams', { headers: authHeaders() }, envFor());
  assertEqual(res.status, 400, 'a second route hitting the same HTTPException-throwing helper also keeps its 400');
  const body = await res.json() as { error?: unknown };
  assertEqual(body.error, 'Missing or invalid ?streamer= query parameter', 'same honored message on a different route');
}

class SyntaxErrorD1 {
  // Models an internal JSON.parse blowing up on malformed PERSISTED data (e.g.
  // a row mapper decoding a pre-parser credit value) — must NOT be mistaken
  // for a malformed request body.
  prepare(): never {
    throw new SyntaxError('Unexpected token i in JSON at position 0');
  }

  batch(): never {
    throw new SyntaxError('Unexpected token i in JSON at position 0');
  }
}

async function testInternalSyntaxErrorStaysALoggedServerError(): Promise<void> {
  const logged: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const res = await app.request('/api/streamers', { headers: authHeaders() }, envFor({ NOVA_DB: new SyntaxErrorD1() }));
    assertEqual(res.status, 500, 'an internal SyntaxError is a server error, never INVALID_JSON');
    const body = await res.json() as { code?: unknown };
    assertEqual(body.code, 'INTERNAL_ERROR', 'internal SyntaxErrors keep the generic contract');
    assertEqual(logged.length > 0, true, 'and are still logged server-side');
  } finally {
    console.error = originalError;
  }
}

async function testMalformedJsonBodyIsAClientError(): Promise<void> {
  // readJsonBody (http.ts) wraps c.req.json() inside the route handler — a
  // malformed request is the caller's error: 400 INVALID_JSON, never the
  // generic 500 INTERNAL_ERROR (and never before authorization has run).
  const res = await app.request(
    '/api/songs?streamer=mizuki',
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      },
      body: '{"title": "unterminated',
    },
    envFor(),
  );
  assertEqual(res.status, 400, 'malformed JSON is a client error, not a 500');
  const body = await res.json() as { error?: unknown; code?: unknown };
  assertEqual(body.error, 'Invalid JSON body', 'the INVALID_JSON contract message');
  assertEqual(body.code, 'INVALID_JSON', 'the INVALID_JSON contract code');
}

class DuplicateStreamRaceD1 {
  // Both existence preflights answer "no row" (first() -> null), then the
  // INSERT hits the composite UNIQUE — the shape of two concurrent creates
  // racing past the preflight.
  prepare(sql: string) {
    return {
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO streams')) {
            throw new Error('D1_ERROR: UNIQUE constraint failed: streams.streamer_id, streams.video_id');
          }
          return { meta: { changes: 0 } };
        },
      }),
    };
  }

  batch(): never {
    throw new Error('unexpected batch in duplicate-stream race test');
  }
}

async function testDuplicateStreamRaceTranslatesTo409(): Promise<void> {
  const res = await app.request(
    '/api/streams?streamer=mizuki',
    {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      },
      body: JSON.stringify({ title: 'T', date: '2026-01-01', videoId: 'v123', youtubeUrl: 'https://youtube.com/watch?v=v123' }),
    },
    envFor({ DB: new DuplicateStreamRaceD1() }),
  );
  assertEqual(res.status, 409, 'the race loser gets the STREAM_EXISTS contract, not a 500');
  const body = await res.json() as { code?: unknown };
  assertEqual(body.code, 'STREAM_EXISTS', 'same code as the preflight path');
}

class StoredTimestampsD1 {
  // A performance stored as [100, 150] — the one-sided-edit guard must merge
  // incoming fields with these before checking end > start.
  updates = 0;
  updateChanges = 1;

  prepare(sql: string) {
    return {
      bind: () => ({
        first: async () => {
          if (sql.includes('SELECT timestamp, end_timestamp')) {
            return { timestamp: 100, end_timestamp: 150 };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('UPDATE performances')) {
            this.updates += 1;
            return { meta: { changes: this.updateChanges } };
          }
          return { meta: { changes: 1 } };
        },
      }),
    };
  }

  batch(): never {
    throw new Error('unexpected batch in stored-timestamps test');
  }
}

async function testOneSidedTimestampEditsRespectStoredValues(): Promise<void> {
  const patch = (db: StoredTimestampsD1, body: unknown) =>
    app.request(
      '/api/performances/p-1/timestamps?streamer=mizuki',
      {
        method: 'PATCH',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
          [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
        },
        body: JSON.stringify(body),
      },
      envFor({ DB: db }),
    );

  // Moving the start past the stored end (150) must be rejected...
  const rejectDb = new StoredTimestampsD1();
  const rejected = await patch(rejectDb, { timestamp: 200 });
  assertEqual(rejected.status, 400, 'a one-sided start edit past the stored end is rejected');
  assertEqual(rejectDb.updates, 0, 'and nothing was written');

  // ...while a start move that stays under the stored end goes through.
  const acceptDb = new StoredTimestampsD1();
  const accepted = await patch(acceptDb, { timestamp: 90 });
  assertEqual(accepted.status, 200, 'a legal one-sided start edit still succeeds');
  assertEqual(acceptDb.updates, 1, 'and the update ran');

  // A one-sided end edit below the stored start (100) is rejected too.
  const endDb = new StoredTimestampsD1();
  const endRejected = await patch(endDb, { endTimestamp: 50 });
  assertEqual(endRejected.status, 400, 'a one-sided end edit before the stored start is rejected');
  assertEqual(endDb.updates, 0, 'with no write');

  // Concurrency: the pre-read passes but the guarded UPDATE writes nothing
  // (a concurrent edit moved the other bound) — 409, never a silent success.
  const raceDb = new StoredTimestampsD1();
  raceDb.updateChanges = 0;
  const raced = await patch(raceDb, { timestamp: 90 });
  assertEqual(raced.status, 409, 'a lost write race surfaces as a conflict');
}

class FetchDurationD1 {
  // A performance read as [100, null] for the song "Artist — Song". The fill
  // is computed by the "database" from startAtWrite (the start current when
  // the UPDATE runs — move it to simulate a concurrent edit) and lands only
  // while endFilled is true (false: an end was set concurrently).
  updates = 0;
  startAtWrite = 100;
  endFilled = true;
  boundDuration: unknown = undefined;

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('JOIN songs s ON s.id = p.song_id')) {
            return { id: 'p-1', title: 'Song', original_artist: 'Artist', timestamp: 100, end_timestamp: null };
          }
          if (sql.includes('SELECT timestamp, end_timestamp')) {
            return { timestamp: this.startAtWrite, end_timestamp: null };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('UPDATE performances')) {
            this.updates += 1;
            this.boundDuration = args[0];
            const results = this.endFilled ? [{ end_timestamp: this.startAtWrite + Number(args[0]) }] : [];
            return { results, meta: { changes: results.length } };
          }
          return { results: [], meta: { changes: 1 } };
        },
      }),
    };
  }

  batch(): never {
    throw new Error('unexpected batch in fetch-duration test');
  }
}

async function testFetchDurationFillsFromTheStartCurrentAtWriteTime(): Promise<void> {
  // The route's iTunes lookup goes through global fetch — answer it with one
  // 200-second track.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        resultCount: 1,
        results: [{ trackTimeMillis: 200_000, trackName: 'Song', artistName: 'Artist' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const post = (db: FetchDurationD1) =>
      app.request(
        '/api/performances/p-1/fetch-duration?streamer=mizuki',
        {
          method: 'POST',
          headers: { ...authHeaders(), [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE },
        },
        envFor({ DB: db }),
      );

    const parse = async (res: Response) =>
      (await res.json()) as { ok?: boolean; endTimestamp?: number | null; error?: string };

    const filledDb = new FetchDurationD1();
    const filled = await post(filledDb);
    assertEqual(filled.status, 200, 'a fill that lands reports success');
    assertEqual((await parse(filled)).endTimestamp, 300, 'with end = stored start + duration (100 + 200)');
    assertEqual(filledDb.boundDuration, 200, 'the duration, not a precomputed end, is what the UPDATE binds');

    // A start edit that lands during the iTunes round-trip (100 → 150): the
    // database computes the end from the CURRENT start, so the clip keeps the
    // fetched length and the response reports the value actually stored.
    const movedDb = new FetchDurationD1();
    movedDb.startAtWrite = 150;
    const moved = await post(movedDb);
    assertEqual(moved.status, 200, 'a concurrent start move does not fail the fill');
    assertEqual((await parse(moved)).endTimestamp, 350, 'and the reported end is 150 + 200, not the stale 300');

    // An end set concurrently: the UPDATE writes nothing — the client must
    // not be told a value was saved.
    const raceDb = new FetchDurationD1();
    raceDb.endFilled = false;
    const raced = await post(raceDb);
    assertEqual(raced.status, 409, 'a lost fill surfaces as a conflict');
    const racedBody = await parse(raced);
    assert(racedBody.ok !== true && typeof racedBody.error === 'string', 'and the body carries an error, not ok: true');
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function main(): Promise<void> {
  await testUnhandledErrorReturnsGenericJsonContract();
  await testHttpExceptionStatusIsHonoredNotGenericized();
  await testHttpExceptionOnADifferentRouteIsAlsoHonored();
  await testMalformedJsonBodyIsAClientError();
  await testInternalSyntaxErrorStaysALoggedServerError();
  await testDuplicateStreamRaceTranslatesTo409();
  await testOneSidedTimestampEditsRespectStoredValues();
  await testFetchDurationFillsFromTheStartCurrentAtWriteTime();
  console.log('✓ app.onError: unexpected errors get the generic {error, code} contract; HTTPException statuses are honored');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
