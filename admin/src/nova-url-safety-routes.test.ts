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

  async run(): Promise<{ meta: { changes: number } }> {
    this.db.runs.push({ sql: this.sql, params: this.params });
    return { meta: { changes: 1 } };
  }

  async first<T>(): Promise<T | null> {
    if (this.sql === 'SELECT id FROM submissions WHERE id = ?') {
      return { id: 'sub-test' } as T;
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

  prepare(sql: string): RecordingStatement {
    return new RecordingStatement(this, sql);
  }
}

function makeSubmission(): NovaSubmission {
  return {
    id: 'sub-test',
    youtube_channel_url: 'https://www.youtube.com/@safe',
    youtube_channel_id: 'UC123',
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

function envFor(db: RecordingD1) {
  const d1 = db as unknown as D1Database;
  return {
    DB: d1,
    NOVA_DB: d1,
    CRYSTAL_DB: d1,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: '',
  };
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

void (async () => {
  await testRejectsUnsafeUrlUpdate();
  await testRejectsNonObjectUpdateBody();
  await testAllowsSafeUrlUpdate();
  console.log('✓ Nova submission URL route validation');
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
