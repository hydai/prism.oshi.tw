// The first test of what GET /api/channel-info actually *extracts*. index.test.ts
// already pins the route's origin gate, but nothing covered the og:title/og:image
// parse — the audit's T7.9 finding, where two hand-written regexes per tag stood in
// for an HTML parser.
//
// The parse now runs on `HTMLRewriter`, a Workers-native global that does not exist
// under plain Node, so this test cannot run under `tsx` alone the way every other
// Nova suite does. It boots the real worker under workerd via `unstable_dev`, points
// the scrape at a local fixture server through the YOUTUBE_ORIGIN binding, and
// asserts the JSON the route returns. Nothing leaves the machine: the fixture server
// listens on 127.0.0.1 and the worker never reaches youtube.com.
//
// Run with: npm run test:channel-info
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';

// --- tiny assert helper (matches admin/src/helpers.test.ts convention) ---
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOVA_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Ceiling for anything that talks to the dev server. Generous next to the ~1s a
 * healthy run takes, but it has to be a ceiling, or a worker that fails to start
 * hangs `npm run check` until CI's job timeout instead of failing in 30 seconds.
 *
 * Measured failure shape (a `node:fs` import in worker source, no nodejs_compat):
 * esbuild warns, workerd raises `No such module`, and `unstable_dev` still
 * *resolves* — in ~100ms, with a handle to a runtime that never came up. It is
 * the first `worker.fetch` that then never settles. So the watchdog has to wrap
 * the requests, not just the boot.
 */
const WATCHDOG_MS = 30_000;

/** Reject if `operation` has not settled within `WATCHDOG_MS`. */
async function withWatchdog<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${WATCHDOG_MS}ms`)), WATCHDOG_MS);
  });
  try {
    return await Promise.race([operation, expiry]);
  } finally {
    // Both on success and on the timeout, so a pending timer never holds the
    // event loop open after the test is done.
    clearTimeout(timer);
  }
}

// --- fixture channel pages ---------------------------------------------------
// Each page mimics a YouTube channel <head>: decoy meta tags around the two og:
// tags we want, so a parser that grabs the first "content=" it sees fails loudly.
function channelPage(metaTags: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>YouTube</title>
<meta name="description" content="DECOY description — must never be picked up">
<meta property="og:site_name" content="YouTube">
${metaTags}
<meta property="og:url" content="https://www.youtube.com/channel/DECOY">
<meta property="og:title" content="DECOY second og:title — first match must win">
<meta property="og:image" content="https://example.invalid/decoy-second-og-image.jpg">
</head>
<body><div id="content">…</div></body>
</html>`;
}

interface Fixture {
  /** Channel-page path; also the YouTube handle the request asks for. */
  path: string;
  /** What makes this page interesting. */
  note: string;
  html: string;
  expectedDisplayName: string;
  expectedAvatarUrl: string;
}

const FIXTURES: Fixture[] = [
  {
    path: '/@fixture-standard',
    note: 'canonical order: property then content, og:title before og:image',
    html: channelPage(
      [
        '<meta property="og:title" content="Mizuki Prism Ch.">',
        '<meta property="og:image" content="https://yt3.googleusercontent.com/standard=s900-c-k-c0x00ffffff-no-rj">',
      ].join('\n'),
    ),
    expectedDisplayName: 'Mizuki Prism Ch.',
    expectedAvatarUrl: 'https://yt3.googleusercontent.com/standard=s900-c-k-c0x00ffffff-no-rj',
  },
  {
    path: '/@fixture-reversed',
    note: 'reversed attribute order (content before property), og:image before og:title',
    html: channelPage(
      [
        '<meta content="https://yt3.googleusercontent.com/reversed=s900-c-k-c0x00ffffff-no-rj" property="og:image">',
        '<meta content="Reversed Attribute Ch." property="og:title">',
      ].join('\n'),
    ),
    expectedDisplayName: 'Reversed Attribute Ch.',
    expectedAvatarUrl: 'https://yt3.googleusercontent.com/reversed=s900-c-k-c0x00ffffff-no-rj',
  },
  {
    path: '/@fixture-entities',
    note: 'named + numeric character references, quotes and CJK in the title, and an escaped & in the image URL',
    html: channelPage(
      [
        '<meta property="og:title" content="ミズキ &amp; Prism &quot;歌枠&quot; &#39;25 &#x9332;&#30011;">',
        '<meta property="og:image" content="https://yt3.googleusercontent.com/entities?sz=900&amp;v=2&#38;t=1">',
      ].join('\n'),
    ),
    // Neither the old regexes nor workerd's `getAttribute()` decode anything — both
    // hand back the raw attribute source — so `extractChannelMeta` decodes on the way
    // out. This is the end-to-end proof of that: a channel named `R&B` must reach the
    // form as `R&B`, and an avatar URL must get real query separators back.
    // decodeHtmlEntities' own edge cases live in channel-meta.test.ts.
    expectedDisplayName: 'ミズキ & Prism "歌枠" \'25 録画',
    expectedAvatarUrl: 'https://yt3.googleusercontent.com/entities?sz=900&v=2&t=1',
  },
  {
    path: '/@fixture-extra-attrs',
    note: 'extra attributes before/between property and content — the regexes required them adjacent',
    html: channelPage(
      [
        '<meta data-source="ytInitialData" property="og:title" content="Extra Attribute Ch.">',
        '<meta property="og:image" data-source="ytInitialData" content="https://yt3.googleusercontent.com/extra=s900-c-k-c0x00ffffff-no-rj">',
      ].join('\n'),
    ),
    expectedDisplayName: 'Extra Attribute Ch.',
    expectedAvatarUrl: 'https://yt3.googleusercontent.com/extra=s900-c-k-c0x00ffffff-no-rj',
  },
];

/** Path the fixture server answers with 404, to exercise the upstream-failure branch. */
const MISSING_PATH = '/@fixture-missing';

function startFixtureServer(): Promise<Server> {
  const pages = new Map(FIXTURES.map((fixture) => [fixture.path, fixture.html]));
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const page = pages.get(req.url ?? '');
    if (page === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopFixtureServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

interface ChannelInfoResponse {
  displayName?: string;
  avatarUrl?: string;
  error?: string;
}

function channelInfoPath(handle: string): string {
  return '/api/channel-info?url=' + encodeURIComponent(`https://www.youtube.com${handle}`);
}

async function main(): Promise<void> {
  const server = await withWatchdog(startFixtureServer(), 'the fixture server');
  const { port } = server.address() as AddressInfo;
  let worker: Unstable_DevWorker | undefined;

  try {
    worker = await withWatchdog(unstable_dev(join(NOVA_DIR, 'src/index.ts'), {
      config: join(NOVA_DIR, 'wrangler.toml'),
      ip: '127.0.0.1',
      port: 0,
      local: true,
      logLevel: 'warn',
      // Keep miniflare's local D1/state inside the (git-ignored) package dir no
      // matter which directory the test was launched from. This route touches no
      // D1 binding at all, but the worker still declares two.
      persistTo: join(NOVA_DIR, '.wrangler/state'),
      vars: { YOUTUBE_ORIGIN: `http://127.0.0.1:${port}`, TURNSTILE_SITE_KEY: 'x' },
      experimental: { disableExperimentalWarning: true },
    }), 'unstable_dev');

    // `https://aurora.oshi.tw` is in ALLOWED_ORIGINS, so every request clears the
    // Task-1 trusted-origin gate (index.test.ts covers the gate itself).
    const headers = { Origin: 'https://aurora.oshi.tw' };

    // Collect every response before asserting, so one run prints the full table.
    const responses: Array<{ fixture: Fixture; status: number; body: ChannelInfoResponse }> = [];
    for (const fixture of FIXTURES) {
      const res = await withWatchdog(worker.fetch(channelInfoPath(fixture.path), { headers }), `GET ${fixture.path}`);
      responses.push({ fixture, status: res.status, body: (await res.json()) as ChannelInfoResponse });
    }
    for (const { fixture, status, body } of responses) {
      console.log(`  ${fixture.path} → ${status} ${JSON.stringify(body)}`);
    }

    for (const { fixture, status, body } of responses) {
      assertEqual(status, 200, `${fixture.path} (${fixture.note}) returns 200`);
      assertEqual(body.displayName, fixture.expectedDisplayName, `${fixture.path} displayName (${fixture.note})`);
      assertEqual(body.avatarUrl, fixture.expectedAvatarUrl, `${fixture.path} avatarUrl (${fixture.note})`);
    }
    console.log(`✓ og:title / og:image are read out of all ${FIXTURES.length} fixture pages`);

    // An upstream that 404s keeps the route's existing error shape.
    const missing = await withWatchdog(worker.fetch(channelInfoPath(MISSING_PATH), { headers }), `GET ${MISSING_PATH}`);
    const missingBody = (await missing.json()) as ChannelInfoResponse;
    console.log(`  ${MISSING_PATH} → ${missing.status} ${JSON.stringify(missingBody)}`);
    assertEqual(missing.status, 502, 'a channel page the upstream cannot serve is a 502');
    assertEqual(missingBody.error, 'Failed to fetch channel page', 'the 502 keeps its error message');
    assertEqual(missingBody.displayName, undefined, 'the 502 body carries no displayName');
    console.log('✓ an upstream 404 still yields the route’s 502 error shape');
  } finally {
    // Runs on the watchdog path too, and must not mask the failure that got us
    // there: `unstable_dev` hands back a worker handle even when the runtime
    // failed to start, and that handle's `stop()` then throws — an exception
    // raised inside `finally` would replace the real error with a misleading one.
    if (worker) await worker.stop().catch((error: unknown) => console.error('worker.stop() failed:', error));
    await stopFixtureServer(server).catch((error: unknown) => console.error('fixture server close failed:', error));
  }
}

main()
  .then(() => console.log('channel-info.workerd.test: all passed'))
  .catch((error: unknown) => {
    console.error(error);
    // `process.exit`, not `exitCode`: a `unstable_dev` call that never settles
    // leaves miniflare handles on the event loop, so returning normally would
    // hang here instead of failing — the very thing the watchdog exists to stop.
    // stderr writes are synchronous to TTYs and pipes on Linux/macOS, so the
    // error above is already flushed.
    process.exit(1);
  });
