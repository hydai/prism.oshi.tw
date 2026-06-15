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

async function main(): Promise<void> {
  await testHelperWithKeyUsesDataApi();
  await testHelperWithoutKeySkipsDataApi();
  await testPublicRouteDoesNotSpendQuota();
  await testGateStillRejectsForeignRequests();
  await testSubmitRequiresTimeline();
  console.log('✓ nova video-info quota-drain guards');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
