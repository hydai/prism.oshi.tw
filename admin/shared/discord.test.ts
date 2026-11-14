import {
  COLOR,
  feedbackEmbedForSubmission,
  feedbackEmbedForVod,
  newStreamerEmbed,
  newStreamEmbed,
  subscriberDigestEmbed,
  postDiscord,
  vodCorrectionAppliedEmbed,
  vodCorrectionRejectedEmbed,
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
const vodApproved = feedbackEmbedForVod('pending', 'approved', { stream_title: '新年歌枠', streamer_slug: 'earendel', reviewer_note: '', kind: 'new' });
check(vodApproved?.color === COLOR.GREEN, 'approved VOD embed is green');
check(vodApproved?.description?.includes('新年歌枠') === true, 'approved VOD embed names the stream');

const vodRejected = feedbackEmbedForVod('pending', 'rejected', { stream_title: 'T', streamer_slug: 'earendel', reviewer_note: '時間軸重複', kind: 'new' });
check(vodRejected?.fields?.[0]?.value === '時間軸重複', 'rejected VOD embed shows the reason');
check(
  feedbackEmbedForVod('approved', 'approved', { stream_title: 'T', streamer_slug: 's', reviewer_note: '', kind: 'new' }) === null,
  'no VOD embed when status unchanged',
);

// feedbackEmbedForVod for a correction: its own copy, and on approval only the summary of what changed —
// the curator's free-text note is never posted, as for any approval.
const correctionApplied = feedbackEmbedForVod(
  'pending',
  'approved',
  { stream_title: '新年歌枠', streamer_slug: 'earendel', reviewer_note: 'secret', kind: 'correction' },
  'S',
);
check(correctionApplied?.title === '✅ VOD 修正已套用', 'applied correction embed has its own title');
check(
  correctionApplied?.description === '「新年歌枠」（earendel）的修正已套用，網站稍後更新。',
  'applied correction embed says the site updates later',
);
check(correctionApplied?.color === COLOR.GREEN, 'applied correction embed is green');
check(
  JSON.stringify(correctionApplied?.fields) === JSON.stringify([{ name: '變更', value: 'S' }]),
  'applied correction embed carries the summary as its only field',
);
check(!JSON.stringify(correctionApplied).includes('secret'), 'applied correction embed never posts the reviewer note');

const correctionRejected = feedbackEmbedForVod(
  'pending',
  'rejected',
  { stream_title: 'T', streamer_slug: 's', reviewer_note: 'R', kind: 'correction' },
);
check(correctionRejected?.title === '❌ VOD 修正未採用', 'rejected correction embed has its own title');
check(correctionRejected?.description === '「T」（s）的修正未採用。', 'rejected correction embed names the stream');
check(correctionRejected?.color === COLOR.RED, 'rejected correction embed is red');
check(
  JSON.stringify(correctionRejected?.fields) === JSON.stringify([{ name: '理由', value: 'R' }]),
  'rejected correction embed shows the reason',
);
const correctionRejectedNoNote = feedbackEmbedForVod(
  'pending',
  'rejected',
  { stream_title: 'T', streamer_slug: 's', reviewer_note: '', kind: 'correction' },
);
check(correctionRejectedNoNote?.fields?.[0]?.value === '（未填理由）', 'rejected correction embed falls back when no reason given');

// A correction approved without a summary (its stream was gone, so the approval imported it): Discord
// refuses an empty field value, so the embed leaves the field out.
const correctionNoSummary = feedbackEmbedForVod(
  'pending',
  'approved',
  { stream_title: 'T', streamer_slug: 's', reviewer_note: '', kind: 'correction' },
);
check(correctionNoSummary?.title === '✅ VOD 修正已套用', 'a correction approved without a summary still reads as applied');
check(correctionNoSummary !== null && !('fields' in correctionNoSummary), 'no summary means no 變更 field');
check(
  feedbackEmbedForVod('pending', 'pending', { stream_title: 'T', streamer_slug: 's', reviewer_note: '', kind: 'correction' }, 'S') === null
    && feedbackEmbedForVod('approved', 'pending', { stream_title: 'T', streamer_slug: 's', reviewer_note: '', kind: 'correction' }, 'S') === null,
  'no correction embed when status unchanged or reverted to pending',
);

// A 'new' submission keeps today's embeds, even when an apply passes a summary.
const newWithSummary = feedbackEmbedForVod(
  'pending',
  'approved',
  { stream_title: '新年歌枠', streamer_slug: 'earendel', reviewer_note: 'secret', kind: 'new' },
  'S',
);
check(newWithSummary?.title === '✅ VOD 投稿已收錄', "a 'new' VOD approval keeps today's title");
check(
  JSON.stringify(newWithSummary) === JSON.stringify(vodApproved),
  "a 'new' VOD approval with a summary is today's embed exactly (no fields, no note)",
);
check(
  feedbackEmbedForVod('pending', 'rejected', { stream_title: 'T', streamer_slug: 'earendel', reviewer_note: '時間軸重複', kind: 'new' })?.title
    === '❌ VOD 投稿未通過',
  "a 'new' VOD rejection keeps today's title",
);

// The builders themselves, as the worker can call them directly.
check(
  JSON.stringify(vodCorrectionAppliedEmbed({ stream_title: 'T', streamer_slug: 's' }, 'x'.repeat(2000)).fields?.[0]?.value.length)
    === '1024',
  'a long summary is truncated to the field limit',
);
check(
  vodCorrectionRejectedEmbed({ stream_title: 'T', streamer_slug: 's', reviewer_note: 'R' }).fields?.[0]?.name === '理由',
  'vodCorrectionRejectedEmbed names its field 理由',
);

// newStreamerEmbed
const newStreamer = newStreamerEmbed({ displayName: 'Gabu', group: '個人勢', link: 'https://youtube.com/@gabu' });
check(newStreamer.color === COLOR.PINK, 'new streamer embed is pink');
check(newStreamer.url === 'https://youtube.com/@gabu', 'new streamer embed links the channel');
check(newStreamer.fields?.[0]?.value === '個人勢', 'new streamer embed shows the group');

const newStreamerBadLink = newStreamerEmbed({ displayName: 'X', group: '', link: 'not a url' });
check(newStreamerBadLink.url === undefined, 'new streamer embed omits an invalid link (no embed.url)');

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
