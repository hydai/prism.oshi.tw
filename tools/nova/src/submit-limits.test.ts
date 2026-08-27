// Length / count caps must reject BEFORE Turnstile and BEFORE any DB access.
import app from './index';
import type { Bindings } from './types';
import { MAX_VOD_SONGS, SUBMISSION_FIELD_LIMITS, VOD_FIELD_LIMITS } from './validate';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function untouchableDb(): D1Database {
  return {
    prepare(): never {
      throw new Error('DB must not be touched when a cap rejects the request');
    },
  } as unknown as D1Database;
}

function env(): Bindings {
  return {
    DB: untouchableDb(),
    ADMIN_DB: untouchableDb(),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
    YOUTUBE_API_KEY: '',
  };
}

// Turnstile must never be consulted for a rejected request: fail loudly if fetch runs.
const realFetch = globalThis.fetch;
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
  throw new Error('outbound fetch must not run when a cap rejects the request');
}) as unknown as typeof fetch;

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    env(),
  );
}

async function testStreamerSubmitRejectsOverLongField(): Promise<void> {
  const res = await post('/api/submit', {
    youtube_channel_url: 'https://www.youtube.com/@someone',
    display_name: 'x'.repeat(SUBMISSION_FIELD_LIMITS.display_name + 1),
    turnstile_token: 'tok',
  });
  assertEqual(res.status, 400, 'an over-long display_name is a 400');
  const json = (await res.json()) as { error?: string };
  assert((json.error ?? '').includes(`display_name 長度上限為 ${SUBMISSION_FIELD_LIMITS.display_name} 字`), 'the error names the field');
}

async function testVodSubmitRejectsOverLongTitle(): Promise<void> {
  const res = await post('/vod/api/submit', {
    streamer_slug: 'mizuki',
    video_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    stream_title: 'x'.repeat(VOD_FIELD_LIMITS.stream_title + 1),
    songs: [{ song_title: 'Song', start_timestamp: 0 }],
    turnstile_token: 'tok',
  });
  assertEqual(res.status, 400, 'an over-long stream_title is a 400');
}

async function testVodSubmitRejectsTooManySongs(): Promise<void> {
  const songs = Array.from({ length: MAX_VOD_SONGS + 1 }, (_, i) => ({ song_title: `Song ${i}`, start_timestamp: i * 10 }));
  const res = await post('/vod/api/submit', {
    streamer_slug: 'mizuki',
    video_url: 'https://www.youtube.com/watch?v=abcdefghijk',
    songs,
    turnstile_token: 'tok',
  });
  assertEqual(res.status, 400, 'more than MAX_VOD_SONGS songs is a 400');
  const json = (await res.json()) as { error?: string };
  assertEqual(json.error, `歌曲數量上限為 ${MAX_VOD_SONGS} 首`, 'the error states the cap');
}

async function main(): Promise<void> {
  try {
    await testStreamerSubmitRejectsOverLongField();
    await testVodSubmitRejectsOverLongTitle();
    await testVodSubmitRejectsTooManySongs();
    console.log('submit-limits.test: all passed');
  } finally {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = realFetch;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
