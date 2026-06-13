import {
  COLOR,
  feedbackEmbedForSubmission,
  feedbackEmbedForVod,
  newStreamerEmbed,
  newStreamEmbed,
  subscriberDigestEmbed,
  postDiscord,
} from './discord';

declare const process: { exitCode?: number };

let passed = 0;
let failed = 0;

function check(cond: boolean, message: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${message}`);
  }
}

// feedbackEmbedForSubmission
check(
  feedbackEmbedForSubmission('pending', 'pending', { display_name: 'X', reviewer_note: '' }) === null,
  'no submission embed when status unchanged',
);
check(
  feedbackEmbedForSubmission('approved', 'pending', { display_name: 'X', reviewer_note: '' }) === null,
  'no submission embed when new status is pending',
);

const subApproved = feedbackEmbedForSubmission('pending', 'approved', { display_name: '浠Mizuki', reviewer_note: '' });
check(subApproved?.color === COLOR.GREEN, 'approved submission embed is green');
check(subApproved?.description?.includes('浠Mizuki') === true, 'approved submission embed names the streamer');

const subRejected = feedbackEmbedForSubmission('pending', 'rejected', { display_name: 'X', reviewer_note: '頻道不符收錄範圍' });
check(subRejected?.color === COLOR.RED, 'rejected submission embed is red');
check(subRejected?.fields?.[0]?.value === '頻道不符收錄範圍', 'rejected submission embed shows the reason');

const subRejectedNoNote = feedbackEmbedForSubmission('pending', 'rejected', { display_name: 'X', reviewer_note: '' });
check(subRejectedNoNote?.fields?.[0]?.value === '（未填理由）', 'rejected submission embed falls back when no reason given');

// feedbackEmbedForVod
const vodApproved = feedbackEmbedForVod('pending', 'approved', { stream_title: '新年歌枠', streamer_slug: 'earendel', reviewer_note: '' });
check(vodApproved?.color === COLOR.GREEN, 'approved VOD embed is green');
check(vodApproved?.description?.includes('新年歌枠') === true, 'approved VOD embed names the stream');

const vodRejected = feedbackEmbedForVod('pending', 'rejected', { stream_title: 'T', streamer_slug: 'earendel', reviewer_note: '時間軸重複' });
check(vodRejected?.fields?.[0]?.value === '時間軸重複', 'rejected VOD embed shows the reason');
check(
  feedbackEmbedForVod('approved', 'approved', { stream_title: 'T', streamer_slug: 's', reviewer_note: '' }) === null,
  'no VOD embed when status unchanged',
);

// newStreamerEmbed
const newStreamer = newStreamerEmbed({ displayName: 'Gabu', group: '個人勢', link: 'https://youtube.com/@gabu' });
check(newStreamer.color === COLOR.PINK, 'new streamer embed is pink');
check(newStreamer.url === 'https://youtube.com/@gabu', 'new streamer embed links the channel');
check(newStreamer.fields?.[0]?.value === '個人勢', 'new streamer embed shows the group');

// subscriberDigestEmbed
const digest = subscriberDigestEmbed([
  { displayName: 'A', from: '1萬', to: '2萬' },
  { displayName: 'B', from: '3萬', to: '4萬' },
]);
check(digest.description?.includes('A') === true && digest.description?.includes('2萬') === true, 'subscriber digest lists each change');

const bigDigest = subscriberDigestEmbed(Array.from({ length: 35 }, (_, i) => ({ displayName: `S${i}`, from: '1', to: '2' })));
check(bigDigest.description?.includes('還有 5 筆') === true, 'subscriber digest truncates beyond 30 entries');

// newStreamEmbed
const newStream = newStreamEmbed({
  displayName: 'earendel',
  streamTitle: 'Acoustic',
  videoId: 'abc123',
  songCount: 12,
  thumbnailUrl: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
});
check(newStream.url === 'https://youtu.be/abc123', 'new stream embed links the video');
check(newStream.fields?.[0]?.value === '12 首', 'new stream embed shows the song count');
check(newStream.thumbnail?.url === 'https://i.ytimg.com/vi/abc123/mqdefault.jpg', 'new stream embed sets a thumbnail');

// postDiscord no-op when no webhook configured.
// Wrapped in an async IIFE because admin's package is CJS under tsx (no "type":
// "module"), where top-level await is unsupported.
void (async () => {
  const noop = await postDiscord(undefined, [newStream]);
  check(noop === undefined, 'postDiscord is a no-op when the webhook URL is missing');

  // fetch is mocked via withMockedFetch so it is ALWAYS restored — even if an
  // assertion or postDiscord throws — via try/finally (no leaked mock between tests).
  const g = globalThis as unknown as { fetch: typeof fetch };
  const originalFetch = g.fetch;
  async function withMockedFetch(mock: typeof fetch, fn: () => Promise<void>): Promise<void> {
    g.fetch = mock;
    try {
      await fn();
    } finally {
      g.fetch = originalFetch;
    }
  }

  // Split into messages of 10 embeds when each embed is small.
  const chunkSizes: number[] = [];
  let lastAllowedMentions = '';
  await withMockedFetch(
    ((_url: string | URL, init?: { body?: string }) => {
      const parsed = JSON.parse(String(init?.body ?? '{"embeds":[]}')) as { embeds: unknown[]; allowed_mentions?: unknown };
      chunkSizes.push(parsed.embeds.length);
      lastAllowedMentions = JSON.stringify(parsed.allowed_mentions);
      return Promise.resolve({ ok: true, status: 200 });
    }) as unknown as typeof fetch,
    () => postDiscord('https://example.test/webhook', Array.from({ length: 23 }, () => newStream)),
  );
  check(
    chunkSizes.length === 3 && chunkSizes[0] === 10 && chunkSizes[1] === 10 && chunkSizes[2] === 3,
    'postDiscord splits small embeds into messages of 10',
  );
  check(lastAllowedMentions === '{"parse":[]}', 'postDiscord disables mention parsing (allowed_mentions)');

  // Cap a message by total embed characters: three ~3000-char embeds → one per message
  // even though the count is under 10 (Discord rejects >6000 chars per message).
  const bigEmbed = { title: 'x', description: 'd'.repeat(3000), color: 1 };
  const charBatchSizes: number[] = [];
  await withMockedFetch(
    ((_url: string | URL, init?: { body?: string }) => {
      const parsed = JSON.parse(String(init?.body ?? '{"embeds":[]}')) as { embeds: unknown[] };
      charBatchSizes.push(parsed.embeds.length);
      return Promise.resolve({ ok: true, status: 200 });
    }) as unknown as typeof fetch,
    () => postDiscord('https://example.test/webhook', [bigEmbed, bigEmbed, bigEmbed]),
  );
  check(
    charBatchSizes.length === 3 && charBatchSizes.every((n) => n === 1),
    'postDiscord caps a message by total embed character count',
  );

  // Retry transient 5xx until success.
  let attempts = 0;
  await withMockedFetch(
    (() => {
      attempts++;
      return Promise.resolve(attempts < 3 ? { ok: false, status: 500 } : { ok: true, status: 200 });
    }) as unknown as typeof fetch,
    () => postDiscord('https://example.test/webhook', [newStream], { baseDelayMs: 0 }),
  );
  check(attempts === 3, 'postDiscord retries transient 5xx until success');

  // Read Discord's Retry-After header on a 429 and retry.
  let attempts429 = 0;
  let sawRetryAfter = false;
  await withMockedFetch(
    (() => {
      attempts429++;
      return Promise.resolve({
        ok: attempts429 >= 2,
        status: attempts429 >= 2 ? 200 : 429,
        headers: {
          get: (k: string) => {
            if (k.toLowerCase() !== 'retry-after') return null;
            sawRetryAfter = true;
            return '0';
          },
        },
      });
    }) as unknown as typeof fetch,
    () => postDiscord('https://example.test/webhook', [newStream], { baseDelayMs: 0 }),
  );
  check(attempts429 === 2 && sawRetryAfter, 'postDiscord reads Retry-After and retries on 429');

  // Fail fast on a non-retryable 4xx without consuming retries.
  let attempts4xx = 0;
  let threw4xx = false;
  await withMockedFetch(
    (() => {
      attempts4xx++;
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof fetch,
    async () => {
      try {
        await postDiscord('https://example.test/webhook', [newStream], { baseDelayMs: 0, maxAttempts: 3 });
      } catch {
        threw4xx = true;
      }
    },
  );
  check(attempts4xx === 1 && threw4xx, 'postDiscord fails fast on a non-retryable 4xx');

  console.log(`discord.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
