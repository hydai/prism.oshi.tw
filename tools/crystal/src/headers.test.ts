// Security headers: Hono defaults plus the Content-Security-Policy, on a page
// route and an API route, and per-request nonce stamping on both HTML pages.
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

/** One directive's value out of a policy string, '' when the directive is absent. */
function cspDirective(csp: string, name: string): string {
  const match = new RegExp(`(?:^|; )${name} ([^;]*)`).exec(csp);
  return match ? match[1] : '';
}

function assertCsp(res: Response, label: string): void {
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.ok(csp.length > 0, `${label}: content-security-policy is present`);
  assert.equal(cspDirective(csp, 'default-src'), "'self'", `${label}: default-src`);
  assert.equal(cspDirective(csp, 'base-uri'), "'self'", `${label}: base-uri`);
  assert.equal(cspDirective(csp, 'object-src'), "'none'", `${label}: object-src`);
  assert.equal(cspDirective(csp, 'frame-ancestors'), "'self'", `${label}: frame-ancestors`);
  assert.equal(cspDirective(csp, 'form-action'), "'self'", `${label}: form-action`);
  assert.equal(cspDirective(csp, 'connect-src'), "'self'", `${label}: connect-src`);
  // Inline script and style run by nonce only.
  const scriptSrc = cspDirective(csp, 'script-src');
  assert.ok(scriptSrc.startsWith("'nonce-"), `${label}: script-src is nonce-based (${scriptSrc})`);
  assert.ok(cspDirective(csp, 'style-src').startsWith("'nonce-"), `${label}: style-src is nonce-based`);
  // 'unsafe-inline' is allowed on style-src-attr and nowhere else: on any of these
  // three it would hand every injected string back the run of the page.
  for (const directive of ['script-src', 'style-src', 'default-src']) {
    assert.ok(
      !cspDirective(csp, directive).includes("'unsafe-inline'"),
      `${label}: ${directive} must never allow 'unsafe-inline' (${cspDirective(csp, directive)})`,
    );
  }
  assert.equal(cspDirective(csp, 'style-src-attr'), "'unsafe-inline'", `${label}: style-src-attr`);
  // Turnstile loads its own script and renders in its own iframe.
  assert.ok(scriptSrc.includes('https://challenges.cloudflare.com'), `${label}: script-src allows Turnstile`);
  // 'self' is there for what Cloudflare's edge appends to every HTML response: Bot
  // Fight Mode's JavaScript-detections bootstrap loads
  // /cdn-cgi/challenge-platform/scripts/jsd/main.js from this origin. Drop it and
  // that script dies on every production page load — nothing local would notice.
  assert.ok(scriptSrc.includes("'self'"), `${label}: script-src allows this origin (${scriptSrc})`);
  assert.equal(cspDirective(csp, 'frame-src'), 'https://challenges.cloudflare.com', `${label}: frame-src`);
  // Images: Crystal renders no remote images — 'self' plus the data: URI the
  // shared .form-select chevron is drawn with.
  assert.equal(cspDirective(csp, 'img-src'), "'self' data:", `${label}: img-src`);
}

function assertSecureHeaders(res: Response, label: string): void {
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', `${label}: x-frame-options`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: x-content-type-options`);
  // Crystal keeps Hono's default (unlike Nova, it has no same-origin auto-fill
  // fetch that would need the Referer restored).
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer', `${label}: referrer-policy`);
  assert.ok(res.headers.get('strict-transport-security'), `${label}: strict-transport-security is present`);
  assertCsp(res, label);
}

/** The nonce the response's own policy allows. */
function headerNonce(res: Response, label: string): string {
  const match = /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '');
  assert.ok(match !== null, `${label}: the policy carries a nonce`);
  return match![1];
}

/**
 * Every inline `<script>`/`<style>` in the document is stamped with the one nonce
 * the header allows, and no inline event-handler attribute survives anywhere.
 */
function assertDocumentNonce(body: string, nonce: string, label: string): void {
  const inlineTags = body.match(/<(?:script|style)(?:\s[^>]*)?>/g) ?? [];
  assert.ok(inlineTags.length >= 3, `${label}: the page still ships its inline tags (found ${inlineTags.length})`);
  for (const tag of inlineTags) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `${label}: inline tag carries the header's nonce — ${tag.slice(0, 60)}`);
  }
  const stamped = new Set(Array.from(body.matchAll(/nonce="([^"]*)"/g), (m) => m[1]));
  assert.equal(stamped.size, 1, `${label}: the whole document uses exactly one nonce value`);
  assert.ok(stamped.has(nonce), `${label}: the document's nonce is the header's`);
  assert.ok(!/ on[a-z]+="/.test(body), `${label}: no inline event-handler attribute survives`);
}

async function assertRouteNonce(path: string, label: string): Promise<string> {
  const res = await app.request(path, {}, env());
  assert.equal(res.status, 200, `${label}: renders`);
  const nonce = headerNonce(res, label);
  assertDocumentNonce(await res.text(), nonce, label);
  return nonce;
}

async function main(): Promise<void> {
  await test('GET /qa carries Hono default security headers plus the CSP', async () => {
    const res = await app.request('/qa', {}, env());
    assert.equal(res.status, 200);
    assertSecureHeaders(res, 'GET /qa');
  });

  await test('GET /api/qa carries Hono default security headers plus the CSP', async () => {
    const res = await app.request('/api/qa', {}, env());
    assert.equal(res.status, 200);
    assertSecureHeaders(res, 'GET /api/qa');
  });

  await test('GET / and GET /qa stamp the header nonce on every inline tag', async () => {
    await assertRouteNonce('/', 'GET /');
    await assertRouteNonce('/qa', 'GET /qa');
  });

  await test('every request gets a fresh nonce', async () => {
    const first = await assertRouteNonce('/', 'GET / (first)');
    const second = await assertRouteNonce('/', 'GET / (second)');
    assert.notEqual(first, second, 'each request gets its own nonce (a fixed one would be worthless)');
  });

  console.log('\nAll headers tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
