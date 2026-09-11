import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

// Empty-reads / zero-changes D1 stand-in: enough to drive every validation
// branch and the "row not found" branches without a database.
class Statement {
  params: unknown[] = [];
  constructor(readonly sql: string) {}
  bind(...params: unknown[]): Statement { this.params = params; return this; }
  async run(): Promise<{ meta: { changes: number } }> { return { meta: { changes: 0 } }; }
  async first<T>(): Promise<T | null> { return null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: [] }; }
}
class EmptyD1 {
  prepare(sql: string): Statement { return new Statement(sql); }
  async batch(statements: Statement[]): Promise<Array<{ results: unknown[]; meta: { changes: number } }>> {
    return statements.map(() => ({ results: [], meta: { changes: 0 } }));
  }
}

// Like EmptyD1, but the work exists: the guarded UPDATE still changes nothing (its
// revision token does not match), and the follow-up SELECT finds the row — the conflict path.
class StaleWorkStatement extends Statement {
  async first<T>(): Promise<T | null> {
    return (this.sql.startsWith('SELECT tags FROM works') ? { tags: '["language:zh"]' } : null) as T | null;
  }
}
class StaleWorkD1 extends EmptyD1 {
  prepare(sql: string): Statement { return new StaleWorkStatement(sql); }
}

const CURATOR = 'curator@example.com';

function env(db: EmptyD1 = new EmptyD1()) {
  const d1 = db as unknown as D1Database;
  const emptyR2 = { get: async () => null, put: async () => null } as unknown as R2Bucket;
  return {
    DB: d1, NOVA_DB: d1, CRYSTAL_DB: d1,
    CURATOR_EMAILS: CURATOR, YOUTUBE_API_KEY: '',
    VOD_EXPORT_PUBLIC: emptyR2, VOD_EXPORT_PRIVATE: emptyR2,
    VOD_EXPORT_DB_ID: 'test-db', VOD_EXPORT_NOVA_DB_ID: 'test-nova-db',
  };
}

async function status(method: string, path: string, body?: unknown, db?: EmptyD1): Promise<number> {
  const res = await app.request(path, {
    method,
    headers: {
      'CF-Access-Authenticated-User-Email': CURATOR,
      'Content-Type': 'application/json',
      [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env(db));
  return res.status;
}

async function main(): Promise<void> {
  assertEqual(await status('PUT', '/api/works/work-1/tags', { tags: 'language:ja' }), 400, 'tags must be an array');
  assertEqual(await status('PUT', '/api/works/work-1/tags', { tags: ['genre:pop'] }), 400, 'unknown IDs are rejected');
  assertEqual(await status('PUT', '/api/works/work-1/tags', {}), 400, 'a missing tags field is rejected');
  assertEqual(await status('PUT', '/api/works/work-1/tags', { tags: ['language:ja'] }), 404, 'a valid body against a missing work is 404');
  assertEqual(await status('PUT', '/api/works/work-1/tags', { tags: ['language:ja'], expectedUpdatedAt: 123 }), 400, 'expectedUpdatedAt must be a string when present');
  assertEqual(await status('PUT', '/api/works/work-1/tags', { tags: ['language:ja'], expectedUpdatedAt: '' }), 400, 'expectedUpdatedAt must not be empty');
  assertEqual(await status('PUT', '/api/works/work-1/tags', { tags: ['language:ja'], expectedUpdatedAt: '2026-01-01 00:00:00' }, new StaleWorkD1()), 409, 'a save whose revision token is stale is a conflict');

  const bulk = '/api/works/tags/bulk';
  assertEqual(await status('POST', bulk, { workIds: [], add: ['language:ja'], remove: [] }), 400, 'workIds must not be empty');
  assertEqual(await status('POST', bulk, { workIds: Array.from({ length: 101 }, (_, i) => `w${i}`), add: ['language:ja'], remove: [] }), 400, 'workIds is capped at 100');
  assertEqual(await status('POST', bulk, { workIds: ['w1', 'w1'], add: ['language:ja'], remove: [] }), 400, 'duplicate workIds are rejected');
  assertEqual(await status('POST', bulk, { workIds: ['w1', ' '], add: ['language:ja'], remove: [] }), 400, 'blank workIds are rejected');
  assertEqual(await status('POST', bulk, { workIds: ['w1'], add: [], remove: [] }), 400, 'an empty delta is rejected');
  assertEqual(await status('POST', bulk, { workIds: ['w1'], add: ['language:ja'], remove: ['language:ja'] }), 400, 'add and remove must be disjoint');
  assertEqual(await status('POST', bulk, { workIds: ['w1'], add: ['genre:pop'], remove: [] }), 400, 'unknown IDs in add are rejected');
  assertEqual(await status('POST', bulk, { workIds: ['w1'], add: [], remove: ['genre:pop'] }), 400, 'unknown IDs in remove are rejected');
  assertEqual(await status('POST', bulk, { workIds: ['w1'], add: ['language:ja'], remove: [] }), 404, 'a missing work fails the whole request');

  assertEqual(await status('GET', '/api/works?tag=genre:pop'), 400, 'an unknown tag filter is rejected');

  console.log('✓ work tag routes validate bodies, report missing works and refuse stale saves');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
