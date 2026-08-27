import * as assert from 'node:assert/strict';

import app from './index';
import type { Bindings } from './types';

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// A malformed body must be rejected before validation or storage: any DB call is a bug.
function envWithUntouchableDb(): Bindings {
  const db = {
    prepare(): never {
      throw new Error('DB must not be touched for a malformed body');
    },
  };
  return {
    DB: db as unknown as D1Database,
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
  };
}

function submit(body: string): Promise<Response> {
  return app.request(
    '/api/submit',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    envWithUntouchableDb(),
  );
}

// tsx transforms this package to CJS (no "type": "module" in package.json), which
// does not support top-level await — so, like qa-api.test.ts, the async cases run
// inside main() rather than as bare top-level `await test(...)` calls.
async function main(): Promise<void> {
  await test('malformed JSON is a 400, not a 500', async () => {
    const res = await submit('{"title":');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid JSON body' });
  });

  await test('a JSON array body is a 400', async () => {
    const res = await submit('[]');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid JSON body' });
  });

  await test('a JSON null body is a 400', async () => {
    const res = await submit('null');
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Invalid JSON body' });
  });

  await test('a well-formed object still reaches field validation', async () => {
    const res = await submit(JSON.stringify({ type: 'bug', title: '', body: '', turnstile_token: '' }));
    assert.equal(res.status, 400);
    const json = (await res.json()) as { errors?: string[] };
    assert.ok(Array.isArray(json.errors) && json.errors.length > 0, 'validation errors are reported as before');
  });

  console.log('\nAll submit-guard tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
