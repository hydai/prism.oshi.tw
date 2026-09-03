// Regression guards for the "public Nova endpoint can drain YouTube API quota"
// finding. The security invariant: the public GET /vod/api/video-info route MUST
// NOT spend the worker's shared YOUTUBE_API_KEY. Only Turnstile-protected flows
// may call the YouTube Data API. Run with: npm run test:video-info
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

// === Security headers: Hono defaults on a page route and an API route, with
// NO Content-Security-Policy (T7.2, headers half — CSP itself is deferred; see
// docs/superpowers/plans/2026-09-03-phase5c-worker-hardening.md). ===
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

function assertSecureHeaders(res: Response, label: string): void {
  assertEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN', `${label}: x-frame-options`);
  assertEqual(res.headers.get('x-content-type-options'), 'nosniff', `${label}: x-content-type-options`);
  // Not Hono's `no-referrer` default: that would suppress the same-origin Referer
  // the auto-fill gate falls back to on browsers without Fetch Metadata.
  assertEqual(res.headers.get('referrer-policy'), 'same-origin', `${label}: referrer-policy`);
  assert(!!res.headers.get('strict-transport-security'), `${label}: strict-transport-security is present`);
  assertEqual(res.headers.get('content-security-policy'), null, `${label}: no content-security-policy (CSP is deferred)`);
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
  console.log('✓ GET / carries the security headers (same-origin referrer policy), no CSP');
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
  console.log('✓ GET /api/check carries the security headers (same-origin referrer policy), no CSP');
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
    assertEqual(await hit.text(), await miss.text(), 'the hit serves the stored body');
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

async function main(): Promise<void> {
  await testHelperWithKeyUsesDataApi();
  await testHelperWithoutKeySkipsDataApi();
  await testPublicRouteDoesNotSpendQuota();
  await testGateStillRejectsForeignRequests();
  await testChannelInfoGateRejectsForeignRequests();
  await testChannelInfoGateAllowsSameOriginRequests();
  await testChannelInfoGateAcceptsRefererOnly();
  await testSubmitRequiresTimeline();
  await testSecurityHeadersOnPageRoute();
  await testSecurityHeadersOnApiRoute();
  await testSecurityHeadersOnCorsPreflight();
  await testStatusIsServedFromTheEdgeCache();
  console.log('✓ nova video-info quota-drain guards');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
