import { discoverStreams, getVideoDetails, verifyChannelId } from './youtube';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

void (async () => {
  await testDiscoveryFiltersKaraokeUploadsInOrder();
  await testVideoDetailBatchesUseBoundedConcurrency();
  await testExactChannelVerification();
  await testRejectsMissingOrDifferentIdentity();
  await testApiErrorDoesNotEchoResponseBody();
  console.log('✓ YouTube discovery and channel identity verification');
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
