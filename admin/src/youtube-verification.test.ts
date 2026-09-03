import {
  discoverStreams,
  fetchChannelInfos,
  fetchComments,
  getVideoDetails,
  verifyChannelId,
  YouTubeApiError,
  type YouTubeApiErrorReason,
} from './youtube';
import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function withFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  test: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: handler });
  try {
    await test();
  } finally {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  }
}

async function testExactChannelVerification(): Promise<void> {
  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    assert(url.pathname.endsWith('/youtube/v3/channels'), 'uses channels.list');
    assert(url.searchParams.get('part') === 'snippet', 'requests a valid minimal part');
    assert(url.searchParams.get('id') === 'UC-exact', 'passes the exact requested ID');
    assert(url.searchParams.get('key') === 'test-key', 'passes the configured API key');
    assert(new Headers(init?.headers).get('Referer') === 'https://prism-admin.oshi.tw/', 'uses the restricted-key Referer');
    return Response.json({ items: [{ id: 'UC-exact', snippet: {} }] });
  }, async () => {
    assert(await verifyChannelId('test-key', 'UC-exact') === 'UC-exact', 'accepts an exact API identity');
  });
}

async function testDiscoveryFiltersKaraokeUploadsInOrder(): Promise<void> {
  let playlistRequests = 0;
  let detailsRequests = 0;

  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    assert(
      new Headers(init?.headers).get('Referer') === 'https://prism-admin.oshi.tw/',
      'uses the restricted-key Referer',
    );

    if (url.pathname.endsWith('/youtube/v3/playlistItems')) {
      playlistRequests++;
      assert(
        url.searchParams.get('playlistId') === 'UU-test',
        'converts the channel ID to its uploads playlist',
      );

      if (url.searchParams.get('pageToken') === null) {
        return Response.json({
          items: [
            { snippet: { title: 'Weekly chat', resourceId: { videoId: 'chat' } } },
            { snippet: { title: '【歌枠】First set', resourceId: { videoId: 'first-set' } } },
          ],
          nextPageToken: 'page-2',
        });
      }

      assert(url.searchParams.get('pageToken') === 'page-2', 'requests the next uploads page');
      return Response.json({
        items: [
          { snippet: { title: 'Late night singing', resourceId: { videoId: 'singing-set' } } },
          { snippet: { title: 'Game stream', resourceId: { videoId: 'game' } } },
        ],
      });
    }

    assert(url.pathname.endsWith('/youtube/v3/videos'), 'uses videos.list for matching upload details');
    detailsRequests++;
    assert(
      url.searchParams.get('id') === 'first-set,singing-set',
      'passes only karaoke uploads to videos.list in discovery order',
    );
    return Response.json({
      items: [
        {
          id: 'first-set',
          snippet: {
            title: '【歌枠】First set',
            publishedAt: '2026-08-01T12:00:00Z',
            description: 'first',
            liveBroadcastContent: 'none',
          },
          contentDetails: { duration: 'PT1H' },
        },
        {
          id: 'singing-set',
          snippet: {
            title: 'Late night singing',
            publishedAt: '2026-08-02T12:00:00Z',
            description: 'second',
            liveBroadcastContent: 'none',
          },
          contentDetails: { duration: 'PT2H' },
        },
      ],
    });
  }, async () => {
    const videos = await discoverStreams('test-key', 'UC-test');
    assert(
      videos.map((video) => video.videoId).join(',') === 'first-set,singing-set',
      'preserves discovery order',
    );
  });

  assert(playlistRequests === 2, 'reads every uploads page');
  assert(detailsRequests === 1, 'fetches matching video details once');
}

async function testVideoDetailBatchesUseBoundedConcurrency(): Promise<void> {
  const videoIds = Array.from(
    { length: 351 },
    (_, index) => `video-${String(index).padStart(3, '0')}`,
  );
  const requestSizes: number[] = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;

  await withFetch(async (input) => {
    const url = new URL(String(input));
    const ids = url.searchParams.get('id')?.split(',') ?? [];
    requestSizes.push(ids.length);
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeRequests -= 1;
    return Response.json({
      items: ids.map((id) => ({
        id,
        snippet: {
          title: id,
          publishedAt: '2026-08-01T12:00:00Z',
          description: `Description for ${id}`,
          liveBroadcastContent: 'none',
        },
        contentDetails: { duration: 'PT1H' },
      })),
    });
  }, async () => {
    const videos = await getVideoDetails('test-key', videoIds);
    assert(requestSizes.join(',') === '50,50,50,50,50,50,50,1', 'uses 50-ID batches');
    assert(maxActiveRequests === 6, 'runs at most six YouTube batches concurrently');
    assert(videos.length === videoIds.length, 'returns every video detail');
    assert(videos[0]?.videoId === videoIds[0], 'preserves the first batch result order');
    assert(videos.at(-1)?.videoId === videoIds.at(-1), 'preserves the final batch result order');
  });
}

async function testRejectsMissingOrDifferentIdentity(): Promise<void> {
  await withFetch(
    async () => Response.json({ items: [{ id: 'UC-different', snippet: {} }] }),
    async () => {
      assert(await verifyChannelId('test-key', 'UC-requested') === null, 'rejects a different returned ID');
    },
  );
  await withFetch(
    async () => Response.json({ items: [] }),
    async () => {
      assert(await verifyChannelId('test-key', 'UC-missing') === null, 'rejects a missing channel');
    },
  );
}

async function testApiErrorDoesNotEchoResponseBody(): Promise<void> {
  await withFetch(
    async () => new Response('secret upstream diagnostics', { status: 403 }),
    async () => {
      let message = '';
      try {
        await verifyChannelId('test-key', 'UC-requested');
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      assert(message.includes('(403)'), 'reports the upstream status');
      assert(!message.includes('secret upstream diagnostics'), 'does not echo the upstream response body');
    },
  );
}

// --- Error classification -------------------------------------------------
//
// Every non-ok YouTube response becomes a YouTubeApiError carrying the reason
// the API gave, because one caller (the extract route below) has to tell a
// spent quota — worth reporting as 429 and retrying tomorrow — apart from a
// rejected key, which no amount of waiting fixes.

/** A YouTube Data API error body, as the API actually shapes it. */
function apiErrorBody(reason: string, status: number): string {
  return JSON.stringify({
    error: {
      code: status,
      message: `The request cannot be completed: ${reason}.`,
      errors: [{ domain: 'youtube.quota', reason, message: 'reason detail' }],
    },
  });
}

const REASON_CASES: Array<{ status: number; body: string; reason: YouTubeApiErrorReason }> = [
  { status: 403, body: apiErrorBody('quotaExceeded', 403), reason: 'quota' },
  { status: 403, body: apiErrorBody('dailyLimitExceeded', 403), reason: 'quota' },
  { status: 403, body: apiErrorBody('rateLimitExceeded', 403), reason: 'quota' },
  { status: 403, body: 'quotaExceeded — a proxy error page without a JSON body', reason: 'quota' },
  { status: 403, body: apiErrorBody('forbidden', 403), reason: 'forbidden' },
  { status: 403, body: 'a referrer-restricted key rejected without a JSON body', reason: 'forbidden' },
  { status: 404, body: apiErrorBody('videoNotFound', 404), reason: 'other' },
  { status: 500, body: apiErrorBody('backendError', 500), reason: 'other' },
];

async function captureApiError(call: () => Promise<unknown>): Promise<YouTubeApiError> {
  try {
    await call();
  } catch (error) {
    assert(error instanceof YouTubeApiError, `expected a YouTubeApiError, got ${String(error)}`);
    return error;
  }
  throw new Error('expected the call to reject');
}

async function testEveryApiErrorCarriesItsReason(): Promise<void> {
  for (const testCase of REASON_CASES) {
    await withFetch(
      async () => new Response(testCase.body, { status: testCase.status }),
      async () => {
        const error = await captureApiError(() => fetchComments('test-key', 'video-1'));
        equal(error.reason, testCase.reason, `commentThreads ${testCase.body.slice(0, 40)} reason`);
        equal(error.status, testCase.status, 'the error carries the upstream status');
      },
    );
  }
}

async function testCommentsDisabledStaysAnEmptyCommentList(): Promise<void> {
  // Both shapes: the documented JSON, and the raw text the route has always
  // matched on — a body that only mentions commentsDisabled must still recover.
  for (const body of [apiErrorBody('commentsDisabled', 403), 'reason: commentsDisabled']) {
    await withFetch(
      async () => new Response(body, { status: 403 }),
      async () => {
        const comments = await fetchComments('test-key', 'video-1');
        equal(comments.length, 0, 'a video with comments off reads as "no comments", not an error');
      },
    );
  }
}

async function testEveryYouTubeCallReportsTheSameWay(): Promise<void> {
  const quota = apiErrorBody('quotaExceeded', 403);
  await withFetch(async () => new Response(quota, { status: 403 }), async () => {
    for (const [label, call] of [
      ['playlistItems.list', () => discoverStreams('test-key', 'UC-test')],
      ['videos.list', () => getVideoDetails('test-key', ['video-1'])],
      ['channels.list', () => fetchChannelInfos('test-key', ['UC-test'])],
      ['channels.list verification', () => verifyChannelId('test-key', 'UC-test')],
    ] as Array<[string, () => Promise<unknown>]>) {
      const error = await captureApiError(call);
      equal(error.reason, 'quota', `${label} classifies a spent quota`);
      equal(error.status, 403, `${label} carries the upstream status`);
    }
  });
}

// --- POST /api/pipeline/extract -------------------------------------------
//
// The route's contract for a failed comments fetch: a spent quota is the ONLY
// thing it answers 429 to. Comments switched off is the ONLY thing that falls
// through to the video description — fetchComments turns that one into an
// empty comment list rather than an error. Everything else (a rejected key,
// an upstream 5xx) is reported as a 502 carrying its reason, because neither
// is a condition a curator fixes by waiting.

const CURATOR = 'curator@example.com';

const STREAM_ROW = {
  id: 'stream-1',
  streamer_id: 'mizuki',
  title: 'Karaoke',
  date: '2026-08-01',
  video_id: 'video-1',
  youtube_url: 'https://youtube.com/watch?v=video-1',
  credit: '{}',
  status: 'approved',
  submitted_by: null,
  reviewed_by: null,
  created_at: '2026-08-01T00:00:00Z',
};

/** Answers getStreamById with one approved stream; nothing else in the route reads D1. */
const oneStreamDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => STREAM_ROW,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 0 } }),
    }),
  }),
};

function extractEnv(): Parameters<typeof app.request>[2] {
  return {
    DB: oneStreamDb,
    NOVA_DB: oneStreamDb,
    CRYSTAL_DB: oneStreamDb,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: 'test-key',
  } as unknown as Parameters<typeof app.request>[2];
}

const TIMESTAMPED_DESCRIPTION = '0:00 One\n3:20 Two\n7:45 Three';

/** A comments page whose top comment carries the three timestamps the route wants. */
function commentsWithTimestamps(): Response {
  return Response.json({
    items: [{
      id: 'thread-1',
      snippet: {
        topLevelComment: {
          id: 'comment-1',
          snippet: {
            textOriginal: TIMESTAMPED_DESCRIPTION,
            authorDisplayName: 'Fan',
            likeCount: 12,
            publishedAt: '2026-08-01T13:00:00Z',
          },
        },
      },
    }],
  });
}

/**
 * Drives the extract route with a stubbed commentThreads.list reply, capturing
 * console.error for the duration. The description stage always succeeds with
 * three timestamps, so a 200 whose source is "description" proves the comments
 * stage fell through — and the captured log is the only other place that
 * fall-through is visible at all.
 */
async function runExtract(
  commentThreads: () => Response,
): Promise<{ response: Response; logged: unknown[][] }> {
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  let response!: Response;
  try {
    await withFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/youtube/v3/commentThreads')) return commentThreads();
      assert(url.pathname.endsWith('/youtube/v3/videos'), 'only the two pipeline stages call out');
      return Response.json({
        items: [{
          id: 'video-1',
          snippet: {
            title: 'Karaoke',
            publishedAt: '2026-08-01T12:00:00Z',
            description: TIMESTAMPED_DESCRIPTION,
            liveBroadcastContent: 'none',
          },
          contentDetails: { duration: 'PT1H' },
        }],
      });
    }, async () => {
      response = await app.request(
        '/api/pipeline/extract?streamer=mizuki',
        {
          method: 'POST',
          headers: {
            'CF-Access-Authenticated-User-Email': CURATOR,
            'Content-Type': 'application/json',
            [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
          },
          body: JSON.stringify({ streamId: 'stream-1' }),
        },
        extractEnv(),
      );
    });
  } finally {
    console.error = originalConsoleError;
  }

  return { response, logged };
}

function extractWithFailingComments(
  status: number,
  body: string,
): Promise<{ response: Response; logged: unknown[][] }> {
  return runExtract(() => new Response(body, { status }));
}

async function testSpentQuotaIsTheOnly429(): Promise<void> {
  const quota = await extractWithFailingComments(403, apiErrorBody('quotaExceeded', 403));
  equal(quota.response.status, 429, 'a spent quota is reported as "too many requests"');

  // A rejected key and an upstream 5xx are not fixed by waiting, so both are
  // reported to the curator as a 502 carrying the reason, rather than being
  // silently retried against the video description.
  for (const [label, status, body, reason] of [
    ['a rejected key', 403, apiErrorBody('forbidden', 403), 'forbidden'],
    ['an upstream failure', 500, apiErrorBody('backendError', 500), 'other'],
  ] as Array<[string, number, string, string]>) {
    const { response } = await extractWithFailingComments(status, body);
    equal(response.status, 502, `${label} is reported rather than silently retried`);
    const payload = (await response.json()) as { error: string; reason: string };
    equal(payload.reason, reason, `${label} carries its reason`);
  }

  // commentsDisabled is the one 403 fetchComments never throws for — it
  // returns an empty comment list — so it is still the only failure that
  // falls through to the video description.
  const { response } = await extractWithFailingComments(403, apiErrorBody('commentsDisabled', 403));
  equal(response.status, 200, 'comments switched off is not a failure');
  const payload = (await response.json()) as { source: string | null };
  equal(payload.source, 'description', 'comments switched off falls through to the video description');
}

/**
 * A rejected key now answers 502, but the Worker log is written before that
 * response is built — losing this line would leave the 502 as the only trace
 * of a curator's broken key, with no detail on which stage or reason.
 */
async function testAFailedCommentsStageIsAlwaysLogged(): Promise<void> {
  const { response, logged } = await extractWithFailingComments(403, apiErrorBody('forbidden', 403));
  equal(response.status, 502, 'a rejected key is reported, but only after being logged');
  equal(logged.length, 1, 'the failed comments stage is logged exactly once');

  const message = String(logged[0]?.[0]);
  assert(message.includes('comments stage'), `the log names the comments stage: ${message}`);
  assert(message.includes('forbidden'), `the log carries the reason: ${message}`);
  assert(message.includes('403'), `the log carries the upstream status: ${message}`);
}

async function testASuccessfulCommentsStageLogsNothing(): Promise<void> {
  const { response, logged } = await runExtract(commentsWithTimestamps);
  equal(response.status, 200, 'a readable comment thread is a 200');
  const payload = (await response.json()) as { source: string | null };
  equal(payload.source, 'comment', 'the timestamps come from the comment');
  equal(logged.length, 0, 'nothing is logged when the comments stage succeeds');
}

void (async () => {
  await testDiscoveryFiltersKaraokeUploadsInOrder();
  await testVideoDetailBatchesUseBoundedConcurrency();
  await testExactChannelVerification();
  await testRejectsMissingOrDifferentIdentity();
  await testApiErrorDoesNotEchoResponseBody();
  await testEveryApiErrorCarriesItsReason();
  await testCommentsDisabledStaysAnEmptyCommentList();
  await testEveryYouTubeCallReportsTheSameWay();
  await testSpentQuotaIsTheOnly429();
  await testAFailedCommentsStageIsAlwaysLogged();
  await testASuccessfulCommentsStageLogsNothing();
  console.log('✓ YouTube discovery, channel identity verification and API error reasons');
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
