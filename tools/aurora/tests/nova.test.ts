import assert from 'node:assert/strict';
import {
  loadNovaCurrentList,
  loadNovaStreamers,
  loadNovaVideoDate,
  submitResultMessage,
} from '../src/lib/nova';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function main(): Promise<void> {
  const controller = new AbortController();
  let requestedUrl = '';
  let requestedSignal: AbortSignal | null = null;
  const streamers = await loadNovaStreamers(controller.signal, async (input, init) => {
    requestedUrl = String(input);
    requestedSignal = init?.signal as AbortSignal;
    return jsonResponse([{
      slug: 'mizuki',
      display_name: 'Mizuki',
      avatar_url: 'https://example.com/mizuki.png',
    }]);
  });

  assert.equal(requestedUrl, 'https://nova.oshi.tw/vod/api/streamers');
  assert.equal(requestedSignal, controller.signal);
  assert.equal(streamers[0]?.slug, 'mizuki');

  await assert.rejects(
    loadNovaStreamers(controller.signal, async () => jsonResponse({ error: 'unavailable' }, 503)),
    /status 503/,
  );
  await assert.rejects(
    loadNovaStreamers(controller.signal, async () => jsonResponse([{ slug: 'missing-fields' }])),
    /invalid shape/,
  );

  const videoDate = await loadNovaVideoDate(
    'https://www.youtube.com/watch?v=qgMiX4lw2TQ',
    controller.signal,
    async (input) => {
      assert.match(String(input), /url=https%3A%2F%2Fwww\.youtube\.com/);
      return jsonResponse({ date: '2026-08-13' });
    },
  );
  assert.equal(videoDate, '2026-08-13');

  const missingDate = await loadNovaVideoDate(
    'https://youtu.be/qgMiX4lw2TQ',
    controller.signal,
    async () => jsonResponse({ title: 'Video without a date' }),
  );
  assert.equal(missingDate, null);

  console.log('✓ Aurora Nova requests validate responses and forward cancellation');

  const archivedText = '01. 0:01:00 ~ 0:04:30 Song A / Artist A\n02. 0:05:00 Song B / Artist B';
  let currentUrl = '';
  let currentSignal: AbortSignal | null = null;
  const archived = await loadNovaCurrentList(
    'mizuki',
    'https://youtu.be/x',
    controller.signal,
    async (input, init) => {
      currentUrl = String(input);
      currentSignal = init?.signal as AbortSignal;
      return jsonResponse({ archived: true, text: archivedText });
    },
  );
  assert.equal(
    currentUrl,
    'https://nova.oshi.tw/vod/api/current?streamer_slug=mizuki&url=https%3A%2F%2Fyoutu.be%2Fx',
  );
  assert.equal(currentSignal, controller.signal);
  assert.deepEqual(archived, { archived: true, text: archivedText });

  const notArchived = await loadNovaCurrentList(
    'mizuki',
    'https://youtu.be/x',
    controller.signal,
    async () => jsonResponse({ archived: false, text: '' }),
  );
  assert.deepEqual(notArchived, { archived: false, text: '' });

  await assert.rejects(
    loadNovaCurrentList('mizuki', 'https://youtu.be/x', controller.signal, async () => jsonResponse({ archived: 'yes' })),
    /invalid shape/,
  );
  await assert.rejects(
    loadNovaCurrentList('mizuki', 'https://youtu.be/x', controller.signal, async () => jsonResponse({ archived: true })),
    /invalid shape/,
  );
  await assert.rejects(
    loadNovaCurrentList('mizuki', 'https://youtu.be/x', controller.signal, async () => jsonResponse(null)),
    /invalid shape/,
  );
  await assert.rejects(
    loadNovaCurrentList('mizuki', 'https://youtu.be/x', controller.signal, async () => jsonResponse({ error: 'Forbidden' }, 403)),
    /status 403/,
  );

  assert.deepEqual(
    submitResultMessage(201, { id: 'vod-1', kind: 'correction' }),
    { type: 'success', message: '修正已送出！ID: vod-1' },
  );
  assert.deepEqual(
    submitResultMessage(201, { id: 'vod-2', kind: 'new' }),
    { type: 'success', message: '提交成功！ID: vod-2' },
  );
  assert.deepEqual(
    submitResultMessage(422, { error: 'no_changes' }),
    { type: 'error', message: '與目前歌單相同，沒有需要修正的地方' },
  );
  assert.deepEqual(
    submitResultMessage(500, {}),
    { type: 'error', message: '提交失敗，請稍後再試' },
  );
  // The server's own words win over the fallback, and only no_changes is special on a 422.
  assert.deepEqual(
    submitResultMessage(400, { error: '歌曲 "X" 的開始時間格式無效' }),
    { type: 'error', message: '歌曲 "X" 的開始時間格式無效' },
  );
  assert.deepEqual(
    submitResultMessage(422, { error: 'something_else' }),
    { type: 'error', message: 'something_else' },
  );
  // A body that is not an object (or an error that is not text) falls back instead of throwing.
  assert.deepEqual(submitResultMessage(502, null), { type: 'error', message: '提交失敗，請稍後再試' });
  assert.deepEqual(submitResultMessage(500, { error: 42 }), { type: 'error', message: '提交失敗，請稍後再試' });

  console.log('✓ Aurora loads the current song list and words every submit answer');
}

await main();
