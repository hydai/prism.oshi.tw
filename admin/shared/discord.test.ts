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

  // postDiscord chunks embeds into batches of 10 so a large announcement is never
  // silently dropped (Discord caps a single message at 10 embeds).
  const g = globalThis as unknown as { fetch: typeof fetch };
  const originalFetch = g.fetch;
  const chunkSizes: number[] = [];
  g.fetch = ((_url: string | URL, init?: { body?: string }) => {
    const parsed = JSON.parse(String(init?.body ?? '{"embeds":[]}')) as { embeds: unknown[] };
    chunkSizes.push(parsed.embeds.length);
    return Promise.resolve({ ok: true, status: 200 });
  }) as unknown as typeof fetch;
  await postDiscord('https://example.test/webhook', Array.from({ length: 23 }, () => newStream));
  g.fetch = originalFetch;
  check(
    chunkSizes.length === 3 && chunkSizes[0] === 10 && chunkSizes[1] === 10 && chunkSizes[2] === 3,
    'postDiscord sends all embeds in chunks of 10',
  );

  console.log(`discord.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
