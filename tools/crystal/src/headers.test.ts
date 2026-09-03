// Security headers: Hono defaults on a page route and an API route, with NO
// Content-Security-Policy (T7.2, headers half — CSP itself is deferred; see
// docs/superpowers/plans/2026-09-03-phase5c-worker-hardening.md).
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

// GET /qa and GET /api/qa both call listPublicReplied (no `q` param): a COUNT
// query (.first()) and a SELECT query (.all()). Stub both to empty results —
// only the response headers are under test here.
function makeEmptyDb(): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            first: async () => ({ cnt: 0 }),
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

function env(): Bindings {
  return {
    DB: makeEmptyDb(),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
  };
}

function assertSecureHeaders(res: Response, label: string): void {
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', `${label}: x-frame-options`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: x-content-type-options`);
  assert.ok(res.headers.get('referrer-policy'), `${label}: referrer-policy is present`);
  assert.ok(res.headers.get('strict-transport-security'), `${label}: strict-transport-security is present`);
  assert.equal(res.headers.get('content-security-policy'), null, `${label}: no content-security-policy (CSP is deferred)`);
}

async function main(): Promise<void> {
  await test('GET /qa carries Hono default security headers, no CSP', async () => {
    const res = await app.request('/qa', {}, env());
    assert.equal(res.status, 200);
    assertSecureHeaders(res, 'GET /qa');
  });

  await test('GET /api/qa carries Hono default security headers, no CSP', async () => {
    const res = await app.request('/api/qa', {}, env());
    assert.equal(res.status, 200);
    assertSecureHeaders(res, 'GET /api/qa');
  });

  console.log('\nAll headers tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
