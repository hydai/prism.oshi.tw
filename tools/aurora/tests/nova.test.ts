import assert from 'node:assert/strict';
import { loadNovaStreamers, loadNovaVideoDate } from '../src/lib/nova';

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
}

await main();
