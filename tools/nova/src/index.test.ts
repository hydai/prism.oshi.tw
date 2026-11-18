// Regression guards for the "public Nova endpoint can drain YouTube API quota"
// finding. The security invariant: the public GET /vod/api/video-info route MUST
// NOT spend the worker's shared YOUTUBE_API_KEY. Only Turnstile-protected flows
// may call the YouTube Data API. Run with: npm run test:video-info
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import app, { fetchYoutubeVideoInfo } from './index';
import type { Bindings } from './types';

declare const process: { exitCode?: number };

// --- tiny assert helpers (matches admin/src/helpers.test.ts convention) ---
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

// --- outbound fetch mock: records every URL, serves canned YouTube responses ---
const OEMBED = 'youtube.com/oembed';
const DATA_API = 'googleapis.com/youtube/v3/videos';
const SITEVERIFY = 'challenges.cloudflare.com/turnstile/v0/siteverify';

let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installMockFetch(): void {
  fetchCalls = [];
  const mock = async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
    fetchCalls.push(url);
    if (url.includes(OEMBED)) {
      return jsonResponse({ title: 'Test Stream Title', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
    }
    if (url.includes(DATA_API)) {
      return jsonResponse({
        items: [{
          snippet: { title: 'API Title', publishedAt: '2024-01-02T00:00:00Z' },
          liveStreamingDetails: { actualStartTime: '2024-01-01T12:00:00Z' },
        }],
      });
    }
    if (url.includes(SITEVERIFY)) {
      return jsonResponse({ success: true });
    }
    return new Response('not found', { status: 404 });
  };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
}

function restoreFetch(): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
}

function dataApiCalls(): string[] {
  return fetchCalls.filter((u) => u.includes(DATA_API));
}

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return { YOUTUBE_API_KEY: 'TEST_SERVER_KEY', ...overrides } as unknown as Bindings;
}

const SAME_ORIGIN: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' };
const VIDEO_URL = 'https://www.youtube.com/watch?v=AAAAAAAAAAA';
const VIDEO_PATH = '/vod/api/video-info?url=' + encodeURIComponent(VIDEO_URL);

// === Helper contract: the Data API is opt-in via apiKey ======================
async function testHelperWithKeyUsesDataApi(): Promise<void> {
  installMockFetch();
  try {
    const info = await fetchYoutubeVideoInfo('AAAAAAAAAAA', 'TEST_SERVER_KEY');
    assertEqual(dataApiCalls().length, 1, 'with apiKey the Data API is called exactly once');
    assert(dataApiCalls()[0].includes('key=TEST_SERVER_KEY'), 'Data API call carries the server key');
    assertEqual(info.date, '2024-01-01', 'date comes from liveStreamingDetails.actualStartTime');
    assertEqual(info.title, 'Test Stream Title', 'title comes from oEmbed');
  } finally {
    restoreFetch();
  }
  console.log('✓ fetchYoutubeVideoInfo(key) uses the YouTube Data API');
}

async function testHelperWithoutKeySkipsDataApi(): Promise<void> {
  installMockFetch();
  try {
    const info = await fetchYoutubeVideoInfo('AAAAAAAAAAA');
    assertEqual(dataApiCalls().length, 0, 'without apiKey the Data API is never called');
    assertEqual(info.date, '', 'no date is produced without the Data API');
    assertEqual(info.title, 'Test Stream Title', 'title still comes from oEmbed');
    assert(info.thumbnail.length > 0, 'thumbnail still comes from oEmbed');
  } finally {
    restoreFetch();
  }
  console.log('✓ fetchYoutubeVideoInfo() without key never touches the Data API');
}

// === Route guard: the public preview route must not spend quota ==============
async function testPublicRouteDoesNotSpendQuota(): Promise<void> {
  installMockFetch();
  try {
    // Same-origin headers are attacker-spoofable, so they must NOT unlock the key.
    const res = await app.request(VIDEO_PATH, { headers: SAME_ORIGIN }, makeEnv());
    assertEqual(res.status, 200, 'same-origin request is allowed (200)');
    assertEqual(dataApiCalls().length, 0, 'public /vod/api/video-info must NOT call the YouTube Data API');
    const body = (await res.json()) as { title: string; thumbnail: string; date: string };
    assertEqual(body.title, 'Test Stream Title', 'still returns the oEmbed title');
    assert(body.thumbnail.length > 0, 'still returns the oEmbed thumbnail');
    assertEqual(body.date, '', 'public route returns no date (no quota spent)');
  } finally {
    restoreFetch();
  }
  console.log('✓ public /vod/api/video-info does not spend YouTube API quota');
}

async function testGateStillRejectsForeignRequests(): Promise<void> {
  installMockFetch();
  try {
    // A real foreign request always carries a Host (Cloudflare sets it). We send one
    // here without any same-origin signal or allowed Origin, so the gate must reject.
    const res = await app.request(VIDEO_PATH, { headers: { Host: 'nova.oshi.tw' } }, makeEnv());
    assertEqual(res.status, 403, 'request without same-origin / allowed-origin headers is forbidden');
    assertEqual(fetchCalls.length, 0, 'forbidden request performs no outbound fetch at all');
  } finally {
    restoreFetch();
  }
  console.log('✓ same-origin gate still rejects foreign requests');
}

// === /api/channel-info gate: same origin/allowed-origin check as video-info ==
async function testChannelInfoGateRejectsForeignRequests(): Promise<void> {
  installMockFetch();
  try {
    // Same foreign-request shape as testGateStillRejectsForeignRequests: a real Host
    // header (Cloudflare sets it) with no same-origin / allowed-origin signal.
    const res = await app.request(
      '/api/channel-info?url=' + encodeURIComponent('https://www.youtube.com/@example'),
      { headers: { Host: 'nova.oshi.tw' } },
      makeEnv(),
    );
    assertEqual(res.status, 403, 'foreign request to /api/channel-info is forbidden');
    assertEqual(fetchCalls.length, 0, 'forbidden request performs no outbound fetch at all');
  } finally {
    restoreFetch();
  }
  console.log('✓ /api/channel-info gate rejects foreign requests');
}

async function testChannelInfoGateAllowsSameOriginRequests(): Promise<void> {
  installMockFetch();
  try {
    // Same-origin clears the gate and reaches the channel-page fetch, which the
    // shared mock fails (404, since the URL matches neither OEMBED nor DATA_API)
    // — the 502 (not 403) proves the gate let the request through.
    const res = await app.request(
      '/api/channel-info?url=' + encodeURIComponent('https://www.youtube.com/@example'),
      { headers: SAME_ORIGIN },
      makeEnv(),
    );
    assertEqual(res.status, 502, 'same-origin request clears the gate and reaches the (failing) upstream fetch');
    assertEqual(fetchCalls.length, 1, 'same-origin request performs exactly the channel-page fetch');
  } finally {
    restoreFetch();
  }
  console.log('✓ /api/channel-info gate allows same-origin requests through');
}

async function testChannelInfoGateAcceptsRefererOnly(): Promise<void> {
  installMockFetch();
  try {
    // What a browser without Fetch Metadata (Safari/iOS ≤ 16.3, Firefox < 90,
    // Chrome < 76) sends from the form page: no Sec-Fetch-Site, and no Origin
    // either because it is a same-origin GET. The Referer is the only signal, and
    // Referrer-Policy: same-origin is what keeps it from being suppressed. As
    // above, the 502 (not 403) proves the gate let the request through.
    const res = await app.request(
      'https://nova.oshi.tw/api/channel-info?url=' + encodeURIComponent('https://www.youtube.com/@example'),
      { headers: { Referer: 'https://nova.oshi.tw/' } },
      makeEnv(),
    );
    assertEqual(res.status, 502, 'a Referer-only same-origin request clears the gate');
    assertEqual(fetchCalls.length, 1, 'and reaches the channel-page fetch');
  } finally {
    restoreFetch();
  }
  console.log('✓ /api/channel-info gate accepts a Referer-only same-origin request');
}

// === VOD submit: a timeline is mandatory =====================================
async function testSubmitRequiresTimeline(): Promise<void> {
  installMockFetch();
  try {
    const base = {
      streamer_slug: 'mizuki',
      video_url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    };
    const post = (payload: unknown) =>
      app.request(
        '/vod/api/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        makeEnv(),
      );

    // (a) songs omitted entirely → 400, before any subrequest
    const resNone = await post({ ...base });
    assertEqual(resNone.status, 400, 'submission with no songs field is rejected (400)');
    const bodyNone = (await resNone.json()) as { error: string };
    assert(bodyNone.error.includes('請至少提供一首歌曲的時間戳'), 'error states a timeline is required');
    assertEqual(fetchCalls.length, 0, 'rejection happens before Turnstile/DB (no outbound fetch)');

    // (b) songs present but every title is blank → 400
    const resBlank = await post({ ...base, songs: [{ song_title: '   ', start_timestamp: '0:30' }] });
    assertEqual(resBlank.status, 400, 'submission whose songs are all title-less is rejected (400)');

    // (c) a titled song clears the timeline guard and reaches the Turnstile check
    const resOk = await post({ ...base, songs: [{ song_title: '歌名', start_timestamp: '0:30' }] });
    assertEqual(resOk.status, 400, 'titled song passes timeline guard, then fails Turnstile (400)');
    const bodyOk = (await resOk.json()) as { error: string };
    assert(bodyOk.error.includes('人機驗證'), 'past the timeline guard the next gate is Turnstile');
  } finally {
    restoreFetch();
  }
  console.log('✓ /vod/api/submit requires at least one song timestamp');
}

// === VOD submit: a deleted admin stream frees its VOD =======================
/** One prepared statement on the SQLite stand-in for D1, run when D1 would run it. */
class SqliteStatement {
  private params: SQLInputValue[] = [];

  constructor(private readonly sqlite: DatabaseSync, private readonly sql: string) {}

  bind(...params: SQLInputValue[]): this {
    this.params = params;
    return this;
  }

  execute(): { results: unknown[] } {
    const statement = this.sqlite.prepare(this.sql);
    if (statement.columns().length > 0) return { results: statement.all(...this.params) };
    statement.run(...this.params);
    return { results: [] };
  }

  async first(): Promise<unknown> {
    return this.execute().results[0] ?? null;
  }

  async all(): Promise<{ results: unknown[] }> {
    return this.execute();
  }
}

/** Nova's D1 as SQLite bootstrapped from schema.sql, as a fresh database is, so the route's own SQL runs. */
function makeNovaSqlite(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../schema.sql'), 'utf8'));
  const db = {
    prepare: (sql: string) => new SqliteStatement(sqlite, sql),
    // D1 runs a batch as one transaction.
    batch: async (statements: SqliteStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

/** The admin DB, holding a stream for ichii's VqAa6fUDZXI in `status`, or none. */
function makeAdminDb(status: string | null): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () =>
          (status !== null && sql.includes('FROM streams') && args[0] === 'ichii' && args[1] === 'VqAa6fUDZXI' ? { status } : null),
      }),
    }),
  } as unknown as D1Database;
}

// ichii's VqAa6fUDZXI had an approved Nova submission with wrong data. A curator unapproved and deleted the stream it
// had imported, and the corrected list was refused for good (2026-11-18). An approved submission blocks only while the
// video still has a stream in admin, in any status: approving another would not import it, since the import skips a
// video that has one. Once the stream is deleted the VOD takes a new submission, and approving that one imports it.
async function testADeletedStreamFreesItsVod(): Promise<void> {
  installMockFetch();
  try {
    const cases: Array<{ admin: string | null; approved: boolean; status: number; inAdmin?: true }> = [
      { admin: null, approved: true, status: 201 },
      { admin: 'rejected', approved: true, status: 409 },
      { admin: 'excluded', approved: true, status: 409 },
      { admin: 'rejected', approved: false, status: 201 },
      { admin: 'approved', approved: true, status: 409, inAdmin: true },
      { admin: 'pending', approved: true, status: 409, inAdmin: true },
      { admin: 'extracted', approved: true, status: 409, inAdmin: true },
    ];
    for (const { admin, approved, status, inAdmin } of cases) {
      const label = `admin stream ${admin ?? 'deleted'}, ${approved ? 'an' : 'no'} approved Nova submission`;
      const nova = makeNovaSqlite();
      nova.sqlite.exec(`INSERT INTO submissions (id, youtube_channel_url, slug, display_name, status)
        VALUES ('sub-ichii', 'https://www.youtube.com/@ichii', 'ichii', 'ichii', 'approved')`);
      if (approved) {
        nova.sqlite.exec(`INSERT INTO vod_submissions (id, streamer_slug, video_id, video_url, status, submitted_at)
          VALUES ('vod-6e8c5ec3', 'ichii', 'VqAa6fUDZXI', 'https://www.youtube.com/watch?v=VqAa6fUDZXI', 'approved', '2026-11-08 17:11:50')`);
      }

      const res = await app.request(
        '/vod/api/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            streamer_slug: 'ichii',
            video_url: 'https://www.youtube.com/live/VqAa6fUDZXI?si=V4VxLqR8Pwzjnuu5',
            songs: [{ song_title: 'Late Night Drive', original_artist: '', start_timestamp: '0:14:41', end_timestamp: '0:17:04' }],
            turnstile_token: 'test-token',
          }),
        },
        makeEnv({ DB: nova.db, ADMIN_DB: makeAdminDb(admin), TURNSTILE_SECRET_KEY: 'test-secret' }),
      );
      assertEqual(res.status, status, label);
      const body = (await res.json()) as { id?: string; inAdmin?: boolean; adminStatus?: string; submittedAt?: string };
      const rows = nova.sqlite
        .prepare("SELECT id, status FROM vod_submissions WHERE streamer_slug = 'ichii' AND video_id = 'VqAa6fUDZXI'")
        .all() as Array<{ id: string; status: string }>;
      const earlier = approved ? 1 : 0;
      if (status === 201) {
        assertEqual(rows.length, earlier + 1, `${label}: the submission is stored beside any earlier one`);
        assertEqual(rows.find((row) => row.id === body.id)?.status, 'pending', `${label}: under the id the answer gives, pending`);
      } else {
        assertEqual(rows.length, earlier, `${label}: nothing is stored`);
        if (inAdmin) {
          assertEqual(body.inAdmin, true, `${label}: the admin stream blocks it`);
          assertEqual(body.adminStatus, admin, `${label}: and the answer names its status`);
        } else {
          assertEqual(body.inAdmin, undefined, `${label}: the approved submission blocks it`);
          assertEqual(body.submittedAt, '2026-11-08 17:11:50', `${label}: and the answer says when it came`);
        }
      }
    }
  } finally {
    restoreFetch();
  }
  console.log('✓ /vod/api/submit: a VOD whose admin stream was deleted takes a new submission; one with a stream does not');
}

// === Security headers: Hono defaults plus the Content-Security-Policy, on a page
// route, an API route and a CORS preflight. ===
function makeCheckDb(): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return { first: async () => null };
        },
      };
    },
  } as unknown as D1Database;
}

/** One directive's value out of a policy string, '' when the directive is absent. */
function cspDirective(csp: string, name: string): string {
  const match = new RegExp(`(?:^|; )${name} ([^;]*)`).exec(csp);
  return match ? match[1] : '';
}

function assertCsp(res: Response, label: string): void {
  const csp = res.headers.get('content-security-policy') ?? '';
  assert(csp.length > 0, `${label}: content-security-policy is present`);
  assertEqual(cspDirective(csp, 'default-src'), "'self'", `${label}: default-src`);
  assertEqual(cspDirective(csp, 'base-uri'), "'self'", `${label}: base-uri`);
  assertEqual(cspDirective(csp, 'object-src'), "'none'", `${label}: object-src`);
  assertEqual(cspDirective(csp, 'frame-ancestors'), "'self'", `${label}: frame-ancestors`);
  assertEqual(cspDirective(csp, 'form-action'), "'self'", `${label}: form-action`);
  assertEqual(cspDirective(csp, 'connect-src'), "'self'", `${label}: connect-src`);
  // Inline script and style run by nonce only.
  const scriptSrc = cspDirective(csp, 'script-src');
  assert(scriptSrc.startsWith("'nonce-"), `${label}: script-src is nonce-based (${scriptSrc})`);
  assert(cspDirective(csp, 'style-src').startsWith("'nonce-"), `${label}: style-src is nonce-based`);
  // 'unsafe-inline' is allowed on style-src-attr and nowhere else: on any of these
  // three it would hand every injected string back the run of the page.
  for (const directive of ['script-src', 'style-src', 'default-src']) {
    assert(
      !cspDirective(csp, directive).includes("'unsafe-inline'"),
      `${label}: ${directive} must never allow 'unsafe-inline' (${cspDirective(csp, directive)})`,
    );
  }
  assertEqual(cspDirective(csp, 'style-src-attr'), "'unsafe-inline'", `${label}: style-src-attr`);
  // Turnstile loads its own script and renders in its own iframe.
  assert(scriptSrc.includes('https://challenges.cloudflare.com'), `${label}: script-src allows Turnstile`);
  // 'self' is there for what Cloudflare's edge appends to every HTML response: Bot
  // Fight Mode's JavaScript-detections bootstrap loads
  // /cdn-cgi/challenge-platform/scripts/jsd/main.js from this origin. Drop it and
  // that script dies on every production page load — nothing local would notice.
  assert(scriptSrc.includes("'self'"), `${label}: script-src allows this origin (${scriptSrc})`);
  assertEqual(cspDirective(csp, 'frame-src'), 'https://challenges.cloudflare.com', `${label}: frame-src`);
  // Images: the same YouTube CDNs the submit routes accept, plus the data: URI the
  // shared .form-select chevron is drawn with.
  const imgSrc = cspDirective(csp, 'img-src');
  for (const source of ["'self'", 'data:', 'https://i.ytimg.com', 'https://yt3.googleusercontent.com', 'https://yt3.ggpht.com']) {
    assert(imgSrc.includes(source), `${label}: img-src allows ${source} (${imgSrc})`);
  }
}

function assertSecureHeaders(res: Response, label: string): void {
  assertEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN', `${label}: x-frame-options`);
  assertEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: x-content-type-options`);
  // Not Hono's `no-referrer` default: that would suppress the same-origin Referer
  // the auto-fill gate falls back to on browsers without Fetch Metadata.
  assertEqual(res.headers.get('referrer-policy'), 'same-origin', `${label}: referrer-policy`);
  assert(!!res.headers.get('strict-transport-security'), `${label}: strict-transport-security is present`);
  assertCsp(res, label);
}

/** The nonce the response's own policy allows. */
function headerNonce(res: Response, label: string): string {
  const match = /'nonce-([^']+)'/.exec(res.headers.get('content-security-policy') ?? '');
  assert(match !== null, `${label}: the policy carries a nonce`);
  return match![1];
}

/**
 * Every inline `<script>`/`<style>` in the document is stamped with the one nonce
 * the header allows, and no inline event-handler attribute survives anywhere.
 */
function assertDocumentNonce(body: string, nonce: string, label: string): void {
  const inlineTags = body.match(/<(?:script|style)(?:\s[^>]*)?>/g) ?? [];
  assert(inlineTags.length >= 3, `${label}: the page still ships its inline tags (found ${inlineTags.length})`);
  for (const tag of inlineTags) {
    assert(tag.includes(`nonce="${nonce}"`), `${label}: inline tag carries the header's nonce — ${tag.slice(0, 60)}`);
  }
  const stamped = new Set(Array.from(body.matchAll(/nonce="([^"]*)"/g), (m) => m[1]));
  assertEqual(stamped.size, 1, `${label}: the whole document uses exactly one nonce value`);
  assert(stamped.has(nonce), `${label}: the document's nonce is the header's`);
  assert(!/ on[a-z]+="/.test(body), `${label}: no inline event-handler attribute survives`);
}

async function assertRouteNonce(path: string, env: Bindings, label: string): Promise<string> {
  const res = await app.request(path, {}, env);
  assertEqual(res.status, 200, `${label}: renders`);
  const nonce = headerNonce(res, label);
  assertDocumentNonce(await res.text(), nonce, label);
  return nonce;
}

async function testSecurityHeadersOnPageRoute(): Promise<void> {
  installMockFetch();
  try {
    const res = await app.request('/', {}, makeEnv({ TURNSTILE_SITE_KEY: 'test-site-key' }));
    assertEqual(res.status, 200, 'GET / succeeds');
    assertSecureHeaders(res, 'GET /');
  } finally {
    restoreFetch();
  }
  console.log('✓ GET / carries the security headers (same-origin referrer policy) and the CSP');
}

async function testSecurityHeadersOnApiRoute(): Promise<void> {
  installMockFetch();
  try {
    const res = await app.request(
      '/api/check?url=' + encodeURIComponent('https://www.youtube.com/@example'),
      {},
      makeEnv({ DB: makeCheckDb() }),
    );
    assertEqual(res.status, 200, 'GET /api/check succeeds');
    assertSecureHeaders(res, 'GET /api/check');
  } finally {
    restoreFetch();
  }
  console.log('✓ GET /api/check carries the security headers (same-origin referrer policy) and the CSP');
}

// === Per-request nonces: the header allows exactly what the document stamps ===
async function testPageScriptsCarryTheHeaderNonce(): Promise<void> {
  installMockFetch();
  try {
    await assertRouteNonce('/', makeEnv({ TURNSTILE_SITE_KEY: 'test-site-key' }), 'GET /');
    await assertRouteNonce(
      '/vod',
      makeEnv({ TURNSTILE_SITE_KEY: 'test-site-key', DB: makeCountingDb().db }),
      'GET /vod',
    );
  } finally {
    restoreFetch();
  }
  console.log('✓ GET / and GET /vod stamp the header nonce on every inline tag');
}

async function testNonceDiffersPerRequest(): Promise<void> {
  installMockFetch();
  try {
    const env = makeEnv({ TURNSTILE_SITE_KEY: 'test-site-key' });
    const first = await assertRouteNonce('/', env, 'GET / (first)');
    const second = await assertRouteNonce('/', env, 'GET / (second)');
    assert(first !== second, 'each request gets its own nonce (a fixed one would be worthless)');
  } finally {
    restoreFetch();
  }
  console.log('✓ every request gets a fresh nonce');
}

async function testSecurityHeadersOnCorsPreflight(): Promise<void> {
  // Hono's cors() answers a preflight itself without calling the next middleware, so
  // secureHeaders() must be registered BEFORE it or preflight responses miss the set.
  const res = await app.request(
    '/vod/api/submit',
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://aurora.oshi.tw',
        'Access-Control-Request-Method': 'POST',
      },
    },
    makeEnv(),
  );
  assertEqual(res.status, 204, 'OPTIONS /vod/api/submit preflight succeeds');
  assertEqual(
    res.headers.get('access-control-allow-origin'),
    'https://aurora.oshi.tw',
    'preflight: cors still answers for an allowed origin',
  );
  assertSecureHeaders(res, 'OPTIONS /vod/api/submit');
  console.log('✓ a CORS preflight carries the security headers too');
}

// === /status edge cache: one round of D1 reads per (filters, colo, TTL) =====
type FakeCaches = {
  default: { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };
  keys: string[];
};

function installFakeCaches(): FakeCaches {
  const store = new Map<string, Response>();
  const fake: FakeCaches = {
    keys: [],
    default: {
      async match(req) {
        const hit = store.get(req.url);
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        fake.keys.push(req.url);
        store.set(req.url, res);
      },
    },
  };
  (globalThis as unknown as { caches: unknown }).caches = fake;
  return fake;
}

function removeFakeCaches(): void {
  delete (globalThis as unknown as { caches?: unknown }).caches;
}

function makeCountingDb(): { db: D1Database; reads: () => number } {
  let count = 0;
  const stmt = { bind: () => stmt, all: async () => ({ results: [] }), first: async () => null };
  const db = { prepare() { count += 1; return stmt; } } as unknown as D1Database;
  return { db, reads: () => count };
}

function makeExecutionCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) { pending.push(p); },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { ctx, settled: async () => { await Promise.all(pending); } };
}

async function testStatusIsServedFromTheEdgeCache(): Promise<void> {
  const caches = installFakeCaches();
  const nova = makeCountingDb();
  const admin = makeCountingDb();
  const env = makeEnv({ DB: nova.db, ADMIN_DB: admin.db });
  const reads = (): number => nova.reads() + admin.reads();
  try {
    const first = makeExecutionCtx();
    const miss = await app.request('/status', {}, env, first.ctx);
    await first.settled();
    assertEqual(miss.status, 200, 'GET /status renders');
    assertEqual(miss.headers.get('x-status-cache'), 'MISS', 'the first request is a miss');
    assertEqual(miss.headers.get('cache-control'), 'public, max-age=60', 'the copy is stored for 60 s');
    assertEqual(reads(), 3, 'a miss performs the three table reads');
    assertEqual(caches.keys[0], 'http://localhost/status?vtuber=all&vod=all', 'the key carries the validated filters');
    assertSecureHeaders(miss, 'GET /status (miss)');

    const second = makeExecutionCtx();
    const hit = await app.request('/status?vtuber=nonsense&x=1', {}, env, second.ctx);
    await second.settled();
    assertEqual(hit.status, 200, 'GET /status (hit) renders');
    assertEqual(hit.headers.get('x-status-cache'), 'HIT', 'an unknown query string collapses onto the cached entry');
    assertEqual(reads(), 3, 'a hit performs no D1 read');
    assertEqual(
      (await hit.text()).replaceAll(headerNonce(hit, 'hit'), headerNonce(miss, 'miss')),
      await miss.text(),
      "the hit serves the stored body, differing only in this request's nonce",
    );
    assertSecureHeaders(hit, 'GET /status (hit)');

    const third = makeExecutionCtx();
    const other = await app.request('/status?vtuber=pending', {}, env, third.ctx);
    await third.settled();
    assertEqual(other.headers.get('x-status-cache'), 'MISS', 'a different validated filter is its own entry');
    assertEqual(caches.keys[1], 'http://localhost/status?vtuber=pending&vod=all', 'validated filters vary the key');
  } finally {
    removeFakeCaches();
  }
  console.log('✓ GET /status is served from the edge cache; unknown query strings cannot bust it');
}

/**
 * The cached copy was rendered with the *storing* request's nonce, while
 * secureHeaders() stamps every response — hits included — with a fresh one.
 * Served verbatim, a hit's scripts would be blocked, so the hit path rewrites the
 * stored nonce into the one its own header allows.
 */
async function testStatusCacheHitRewritesTheNonce(): Promise<void> {
  installFakeCaches();
  const nova = makeCountingDb();
  const admin = makeCountingDb();
  const env = makeEnv({ DB: nova.db, ADMIN_DB: admin.db });
  try {
    const first = makeExecutionCtx();
    const miss = await app.request('/status', {}, env, first.ctx);
    await first.settled();
    const missNonce = headerNonce(miss, 'GET /status (miss)');
    assertDocumentNonce(await miss.text(), missNonce, 'GET /status (miss)');
    assertEqual(miss.headers.get('x-status-nonce'), null, 'only the stored copy carries the nonce marker');

    const second = makeExecutionCtx();
    const hit = await app.request('/status', {}, env, second.ctx);
    await second.settled();
    assertEqual(hit.headers.get('x-status-cache'), 'HIT', 'the second request is a hit');
    const hitNonce = headerNonce(hit, 'GET /status (hit)');
    assert(hitNonce !== missNonce, 'the hit is stamped with its own fresh nonce');
    assertDocumentNonce(await hit.text(), hitNonce, 'GET /status (hit)');
    assertEqual(hit.headers.get('x-status-nonce'), null, 'the bookkeeping header never reaches the client');
  } finally {
    removeFakeCaches();
  }
  console.log('✓ a cached /status body is rewritten to the nonce its own header allows');
}

/**
 * A copy stored before this rule shipped (or one that lost the marker) carries no
 * X-Status-Nonce, so there is nothing to rewrite its body's nonce *from* — served
 * as-is its inline tags would be dropped by the browser. The handler re-renders
 * instead. This is the path every /status request takes for the first ≤ 60 s
 * after a deploy (the stored copies live at most `max-age=60`), and it is the
 * easiest condition to "simplify" away into a bare `if (hit)` later.
 */
async function testStatusLegacyCachedCopyIsReRendered(): Promise<void> {
  const caches = installFakeCaches();
  const nova = makeCountingDb();
  const admin = makeCountingDb();
  const env = makeEnv({ DB: nova.db, ADMIN_DB: admin.db });
  const reads = (): number => nova.reads() + admin.reads();
  const stale = '<!DOCTYPE html><html><body><script nonce="STALE"></script></body></html>';
  try {
    // Seeded exactly as the pre-rule miss path left it: a rendered page, no marker.
    await caches.default.put(
      new Request('http://localhost/status?vtuber=all&vod=all'),
      new Response(stale, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Status-Cache': 'MISS' } }),
    );

    const ctx = makeExecutionCtx();
    const res = await app.request('/status', {}, env, ctx.ctx);
    await ctx.settled();
    assertEqual(res.status, 200, 'GET /status renders');
    assertEqual(res.headers.get('x-status-cache'), 'MISS', 'a stored copy without the marker is re-rendered');
    assertEqual(reads(), 3, 'the re-render performs the three table reads');
    assertEqual(res.headers.get('x-status-nonce'), null, 'the bookkeeping header never reaches the client');
    const body = await res.text();
    assert(!body.includes('STALE'), 'the copy whose scripts are already dead is not served');
    assertDocumentNonce(body, headerNonce(res, 'GET /status (legacy copy)'), 'GET /status (legacy copy)');
  } finally {
    removeFakeCaches();
  }
  console.log('✓ a cached /status copy without the nonce marker is re-rendered, not served with dead scripts');
}

async function main(): Promise<void> {
  await testHelperWithKeyUsesDataApi();
  await testHelperWithoutKeySkipsDataApi();
  await testPublicRouteDoesNotSpendQuota();
  await testGateStillRejectsForeignRequests();
  await testChannelInfoGateRejectsForeignRequests();
  await testChannelInfoGateAllowsSameOriginRequests();
  await testChannelInfoGateAcceptsRefererOnly();
  await testSubmitRequiresTimeline();
  await testADeletedStreamFreesItsVod();
  await testSecurityHeadersOnPageRoute();
  await testSecurityHeadersOnApiRoute();
  await testSecurityHeadersOnCorsPreflight();
  await testPageScriptsCarryTheHeaderNonce();
  await testNonceDiffersPerRequest();
  await testStatusIsServedFromTheEdgeCache();
  await testStatusCacheHitRewritesTheNonce();
  await testStatusLegacyCachedCopyIsReRendered();
  console.log('✓ nova video-info quota-drain guards');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
