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
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// Recording D1 stand-in. It counts every prepare() call so a test can prove
// whether a request reached the data layer at all. Every read returns empty and
// every write reports zero changes, so a handler that DOES run still completes
// cleanly (typically 404/200) — letting us distinguish "blocked at the auth
// layer" (zero prepare calls) from "reached the handler" (one or more calls).
class RecordingStatement {
  constructor(private readonly db: RecordingD1, readonly sql: string) {}

  bind(..._params: unknown[]): RecordingStatement {
    return this;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return { meta: { changes: 0 } };
  }

  async first<T>(): Promise<T | null> {
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}

class RecordingD1 {
  prepareCalls = 0;

  prepare(sql: string): RecordingStatement {
    this.prepareCalls += 1;
    return new RecordingStatement(this, sql);
  }

  async batch(statements: RecordingStatement[]): Promise<Array<{ meta: { changes: number } }>> {
    return statements.map(() => ({ meta: { changes: 0 } }));
  }
}

const CURATOR = 'curator@example.com';
const CONTRIBUTOR = 'attacker@example.com';

function envFor(db: RecordingD1) {
  const d1 = db as unknown as D1Database;
  const emptyR2 = {
    get: async () => null,
    put: async () => null,
  } as unknown as R2Bucket;
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

type Route = {
  method: string;
  path: string;
  body?: unknown;
};

function reqInit(route: Route, email: string): RequestInit {
  const init: RequestInit = {
    method: route.method,
    headers: {
      'CF-Access-Authenticated-User-Email': email,
      'Content-Type': 'application/json',
      // Pass the CSRF authenticity gate (mounted globally on /api/*) the same way
      // the real UI does, so this test exercises authorization, not the CSRF gate.
      [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
    },
  };
  if (route.body !== undefined) {
    init.body = JSON.stringify(route.body);
  }
  return init;
}

// Every stamp-editor mutation route. These edit/delete approved catalog staging
// data, so they must be curator-only — a contributor must never reach the DB.
const PROTECTED_ROUTES: Route[] = [
  { method: 'PATCH', path: '/api/performances/perf-1/timestamps', body: { timestamp: 999, endTimestamp: 1001 } },
  { method: 'PATCH', path: '/api/performances/perf-1/details', body: { title: 'Hacked', originalArtist: 'Hacker' } },
  { method: 'DELETE', path: '/api/performances/perf-1' },
  { method: 'PATCH', path: '/api/performances/perf-1/note', body: { note: 'Hacked note' } },
  { method: 'POST', path: '/api/streams/stream-1/paste-import', body: { text: 'Song - Artist 0:10', replace: true } },
  { method: 'DELETE', path: '/api/streams/stream-1/end-timestamps' },
  { method: 'POST', path: '/api/performances/perf-1/fetch-duration' },
  { method: 'POST', path: '/api/harmonize/merge', body: { canonicalSongId: 'song-1', sourceSongIds: ['song-2'] } },
  { method: 'GET', path: '/api/vod-export/status' },
  { method: 'POST', path: '/api/vod-export/preview' },
  { method: 'GET', path: '/api/vod-export/candidates/00000000-0000-4000-8000-000000000000' },
  { method: 'GET', path: '/api/vod-export/candidates/00000000-0000-4000-8000-000000000000/download' },
  { method: 'GET', path: '/api/vod-export/repair/performance/1' },
  { method: 'POST', path: '/api/vod-export/candidates/00000000-0000-4000-8000-000000000000/publish' },
  { method: 'POST', path: '/api/vod-export/reconcile' },
  { method: 'GET', path: '/api/vod-export/control-recovery' },
  { method: 'POST', path: '/api/vod-export/control-recovery', body: {} },
  { method: 'POST', path: '/api/vod-export/maintenance' },
];

async function testContributorBlockedFromStampMutations(): Promise<void> {
  const failures: string[] = [];

  for (const route of PROTECTED_ROUTES) {
    const db = new RecordingD1();
    const res = await app.request(route.path, reqInit(route, CONTRIBUTOR), envFor(db));
    const label = `${route.method} ${route.path}`;

    if (res.status !== 403) {
      failures.push(`${label}: contributor got ${res.status}, expected 403`);
    }
    if (db.prepareCalls !== 0) {
      failures.push(`${label}: contributor reached DB (${db.prepareCalls} prepare calls) — authorization bypassed`);
    }
  }

  assertEqual(failures.length, 0, `contributor must be blocked from all stamp mutations:\n  ${failures.join('\n  ')}`);
}

async function testCuratorPassesAuthorization(): Promise<void> {
  const failures: string[] = [];

  for (const route of PROTECTED_ROUTES) {
    const db = new RecordingD1();
    const res = await app.request(route.path, reqInit(route, CURATOR), envFor(db));
    const label = `${route.method} ${route.path}`;

    // A curator must clear the authorization gate. With an empty DB the handler
    // then returns 404/200 — anything but 403 proves authorization passed.
    if (res.status === 403) {
      failures.push(`${label}: curator was wrongly denied with 403`);
    }
  }

  assertEqual(failures.length, 0, `curator must pass authorization on every stamp route:\n  ${failures.join('\n  ')}`);
}

async function testContributorStillAuthenticates(): Promise<void> {
  const db = new RecordingD1();
  const res = await app.request(
    '/api/me',
    { headers: { 'CF-Access-Authenticated-User-Email': CONTRIBUTOR } },
    envFor(db),
  );
  assertEqual(res.status, 200, 'contributor should still authenticate via CF Access header');
  const me = (await res.json()) as { role: string };
  assertEqual(me.role, 'contributor', 'a non-curator email must resolve to the contributor role');
}

async function testContributorRetainsReadOnlyStampAccess(): Promise<void> {
  const db = new RecordingD1();
  const res = await app.request(
    '/api/stamp/streams',
    { headers: { 'CF-Access-Authenticated-User-Email': CONTRIBUTOR } },
    envFor(db),
  );
  // Locking down mutations must not lock contributors out of read-only views.
  assert(res.status !== 403, `contributor should keep read-only stamp access, got ${res.status}`);
}

async function testVodExportMutationRequiresAuthenticityHeader(): Promise<void> {
  const db = new RecordingD1();
  const res = await app.request(
    '/api/vod-export/preview',
    {
      method: 'POST',
      headers: { 'CF-Access-Authenticated-User-Email': CURATOR },
    },
    envFor(db),
  );
  assertEqual(res.status, 403, 'curator VOD export mutation without the CSRF authenticity header is blocked');
  assertEqual(db.prepareCalls, 0, 'CSRF-blocked VOD export mutation never reaches D1');
}

async function main(): Promise<void> {
  await testContributorStillAuthenticates();
  await testContributorRetainsReadOnlyStampAccess();
  await testCuratorPassesAuthorization();
  await testContributorBlockedFromStampMutations();
  await testVodExportMutationRequiresAuthenticityHeader();
  console.log('✓ curator-only Admin mutations and VOD export CSRF boundaries');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
