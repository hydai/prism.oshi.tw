import { Hono } from 'hono';
import { requireApiRequestAuthenticity } from './auth';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';
import type { AuthUser } from '../shared/types';

declare const process: { exitCode?: number };

type Bindings = {
  DB: D1Database;
  CURATOR_EMAILS: string;
  DEV_AUTH_EMAIL?: string;
};
type Variables = { user: AuthUser };

// app.request() with a bare path builds an http://localhost/... URL,
// so the request "origin" the middleware compares against is this:
const SAME_ORIGIN = 'http://localhost';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function buildApp(): Hono<{ Bindings: Bindings; Variables: Variables }> {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('/api/*', requireApiRequestAuthenticity);
  app.get('/api/probe', (c) => c.json({ ok: true }));
  app.post('/api/probe', (c) => c.json({ ok: true }));
  return app;
}

async function status(method: string, headers?: Record<string, string>): Promise<number> {
  const res = await buildApp().request('/api/probe', { method, headers });
  return res.status;
}

const VALID = { [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE };

async function main(): Promise<void> {
  // Safe methods never require the header.
  assertEqual(await status('GET'), 200, 'safe GET passes without the authenticity header');

  // Hard gate: the custom header.
  assertEqual(await status('POST'), 403, 'POST without the header is rejected');
  assertEqual(
    await status('POST', { [REQUEST_AUTHENTICITY_HEADER]: 'nope' }),
    403,
    'POST with a wrong header value is rejected',
  );
  assertEqual(await status('POST', { ...VALID }), 200, 'POST with the correct header passes');

  // Defense-in-depth: reject only when the signal is PRESENT and cross-origin.
  assertEqual(
    await status('POST', { ...VALID, 'Sec-Fetch-Site': 'cross-site' }),
    403,
    'POST with cross-site Sec-Fetch-Site is rejected',
  );
  assertEqual(
    await status('POST', { ...VALID, Origin: 'https://attacker.invalid' }),
    403,
    'POST with a mismatched Origin is rejected',
  );
  assertEqual(
    await status('POST', { ...VALID, Origin: SAME_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }),
    200,
    'POST with the correct header + same-origin Origin/Sec-Fetch passes',
  );

  // Regression (Codex P2): the Vite dev server (:5173) proxies /api to the Worker
  // (:8787), so the browser sends Sec-Fetch-Site: same-origin but an Origin that
  // will not equal the Worker's own URL. The browser's same-origin signal wins.
  assertEqual(
    await status('POST', {
      ...VALID,
      Origin: 'http://localhost:5173',
      'Sec-Fetch-Site': 'same-origin',
    }),
    200,
    'POST through the dev proxy (same-origin Sec-Fetch-Site, port-mismatched Origin) passes',
  );

  // same-site is NOT same-origin (e.g. a sibling subdomain) — still rejected.
  assertEqual(
    await status('POST', { ...VALID, 'Sec-Fetch-Site': 'same-site' }),
    403,
    'POST with same-site Sec-Fetch-Site is rejected',
  );

  console.log('✓ requireApiRequestAuthenticity');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
