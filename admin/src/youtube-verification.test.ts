import { verifyChannelId } from './youtube';

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
  await testExactChannelVerification();
  await testRejectsMissingOrDifferentIdentity();
  await testApiErrorDoesNotEchoResponseBody();
  console.log('✓ YouTube channel identity verification');
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
