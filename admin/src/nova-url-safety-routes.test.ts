import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';
import type { NovaSubmission } from '../shared/types';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const CURATOR = 'curator@example.com';

class RecordingStatement {
  private params: unknown[] = [];

  constructor(private readonly db: RecordingD1, readonly sql: string) {}

  bind(...params: unknown[]): RecordingStatement {
    this.params = params;
    this.db.binds.push({ sql: this.sql, params });
    return this;
  }

  async run<T>(): Promise<{ meta: { changes: number }; results: T[] }> {
    this.db.runs.push({ sql: this.sql, params: this.params });
    const returningSubmissionId = this.sql.includes('RETURNING id') && this.db.updateMatches
      ? [{ id: 'sub-test' } as T]
      : [];
    // D1 exposes sqlite3_total_changes(), so the revision trigger makes a
    // successful submission update report more than one changed row.
    return { meta: { changes: this.sql.includes('UPDATE submissions') ? 2 : 1 }, results: returningSubmissionId };
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('youtube_channel_verified_id') && this.sql.includes('FROM submissions')) {
      return {
        id: 'sub-test',
        youtube_channel_id: 'UC123',
        youtube_channel_verified_id: null,
        youtube_channel_verified_at: null,
      } as T;
    }
    if (this.sql === 'SELECT id FROM submissions WHERE id = ?') {
      return { id: 'sub-test' } as T;
    }
    if (this.sql === 'SELECT id, youtube_channel_id FROM submissions WHERE id = ?') {
      return { id: 'sub-test', youtube_channel_id: 'UC123' } as T;
    }
    if (this.sql === 'SELECT * FROM submissions WHERE id = ?') {
      return makeSubmission() as T;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }
}

class RecordingD1 {
  binds: Array<{ sql: string; params: unknown[] }> = [];
  runs: Array<{ sql: string; params: unknown[] }> = [];

  constructor(readonly updateMatches = true) {}

  prepare(sql: string): RecordingStatement {
    return new RecordingStatement(this, sql);
  }
}

function makeSubmission(): NovaSubmission {
  return {
    id: 'sub-test',
    youtube_channel_url: 'https://www.youtube.com/@safe',
    youtube_channel_id: 'UC123',
    youtube_channel_verified_id: null,
    youtube_channel_verified_at: null,
    slug: 'safe',
    brand_name: 'Safe Brand',
    display_name: 'Safe Streamer',
    description: '',
    avatar_url: 'https://yt3.ggpht.com/avatar=s240',
    subscriber_count: '1,234',
    link_youtube: 'https://www.youtube.com/@safe',
    link_twitter: 'https://x.com/safe',
    link_facebook: '',
    link_instagram: '',
    link_twitch: '',
    group: '',
    enabled: 1,
    display_order: 0,
    theme_json: '',
    external_url: '',
    status: 'pending',
    submitted_at: '2026-06-17T00:00:00Z',
    reviewed_at: null,
    reviewer_note: '',
  };
}

function envFor(db: RecordingD1, youtubeApiKey = '') {
  const d1 = db as unknown as D1Database;
  return {
    DB: d1,
    NOVA_DB: d1,
    CRYSTAL_DB: d1,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: youtubeApiKey,
  };
}

function verifyYoutubeChannel(db: RecordingD1): Promise<Response> {
  return Promise.resolve(app.request(
    '/api/nova/submissions/sub-test/verify-youtube-channel',
    {
      method: 'POST',
      headers: {
        'CF-Access-Authenticated-User-Email': CURATOR,
        [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      },
    },
    envFor(db, 'test-key'),
  ));
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

function putSubmission(body: unknown, db: RecordingD1): Promise<Response> {
  return Promise.resolve(app.request(
    '/api/nova/submissions/sub-test',
    {
      method: 'PUT',
      headers: {
        'CF-Access-Authenticated-User-Email': CURATOR,
        'Content-Type': 'application/json',
        [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      },
      body: JSON.stringify(body),
    },
    envFor(db),
  ));
}

async function testRejectsUnsafeUrlUpdate(): Promise<void> {
  const db = new RecordingD1();
  const res = await putSubmission({ link_twitter: 'javascript:alert(document.domain)' }, db);
  assertEqual(res.status, 400, 'unsafe URL update is rejected');
  assert(!db.runs.some((run) => run.sql.startsWith('UPDATE submissions SET')), 'rejected URL update does not write to D1');
}

async function testRejectsNonObjectUpdateBody(): Promise<void> {
  const db = new RecordingD1();
  const res = await putSubmission(null, db);
  assertEqual(res.status, 400, 'non-object update body is rejected');
  assert(!db.runs.some((run) => run.sql.startsWith('UPDATE submissions SET')), 'non-object update body does not write to D1');
}

async function testAllowsSafeUrlUpdate(): Promise<void> {
  const db = new RecordingD1();
  const res = await putSubmission({ link_twitter: 'https://www.twitter.com/safe' }, db);
  assertEqual(res.status, 200, 'safe URL update is accepted');

  const update = db.runs.find((run) => run.sql.startsWith('UPDATE submissions SET'));
  assert(update !== undefined, 'safe URL update writes to D1');
  assert(update.params.includes('https://www.twitter.com/safe'), 'safe URL is stored in normalized href form');
}

async function testChannelVerificationIgnoresTriggeredTotalChanges(): Promise<void> {
  await withFetch(async () => Response.json({ items: [{ id: 'UC123', snippet: {} }] }), async () => {
    const db = new RecordingD1();
    const res = await verifyYoutubeChannel(db);
    assertEqual(res.status, 200, 'successful channel verification is not rejected by trigger changes');
    const update = db.runs.find((run) => run.sql.includes('youtube_channel_verified_id'));
    assert(update?.sql.includes('RETURNING id') === true, 'verification uses the matched row identity');
  });
}

async function testChannelVerificationDetectsConcurrentIdChange(): Promise<void> {
  await withFetch(async () => Response.json({ items: [{ id: 'UC123', snippet: {} }] }), async () => {
    const db = new RecordingD1(false);
    const res = await verifyYoutubeChannel(db);
    assertEqual(res.status, 409, 'missing returned row still detects a concurrent channel ID change');
  });
}

void (async () => {
  await testRejectsUnsafeUrlUpdate();
  await testRejectsNonObjectUpdateBody();
  await testAllowsSafeUrlUpdate();
  await testChannelVerificationIgnoresTriggeredTotalChanges();
  await testChannelVerificationDetectsConcurrentIdChange();
  console.log('✓ Nova submission URL and YouTube verification routes');
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
