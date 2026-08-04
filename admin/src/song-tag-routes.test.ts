import app from './index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const CURATOR = 'curator@example.com';

const SONG_ROW = {
  id: 'song-1',
  streamer_id: 'mizuki',
  title: 'Existing Title',
  original_artist: 'Existing Artist',
  tags: '[]',
  status: 'approved',
  submitted_by: CURATOR,
  reviewed_by: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  work_id: 'work-1',
};

class FakeStatement {
  constructor(readonly sql: string) {}

  bind(): FakeStatement {
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM songs AS s')) return SONG_ROW as T;
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    return { meta: { changes: 1 } };
  }
}

class FakeD1 {
  prepare(sql: string): FakeStatement {
    return new FakeStatement(sql);
  }

  async batch(statements: FakeStatement[]): Promise<Array<{ results: unknown[]; meta: { changes: number } }>> {
    return statements.map(() => ({ results: [], meta: { changes: 1 } }));
  }
}

function envFor(db: FakeD1) {
  const d1 = db as unknown as D1Database;
  return { DB: d1, NOVA_DB: d1, CRYSTAL_DB: d1, CURATOR_EMAILS: CURATOR, YOUTUBE_API_KEY: '' };
}

function putSong(body: unknown): Promise<Response> {
  return Promise.resolve(app.request(
    '/api/songs/song-1',
    {
      method: 'PUT',
      headers: {
        'CF-Access-Authenticated-User-Email': CURATOR,
        'Content-Type': 'application/json',
        [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      },
      body: JSON.stringify(body),
    },
    envFor(new FakeD1()),
  ));
}

// Tags moved to the work and performance scopes, so this route silently ignored the
// field it used to honour. A caller on an older bundle must be told, not given a 200
// for an edit that was discarded.
async function testSongUpdateRejectsRetiredTagsField(): Promise<void> {
  const response = await putSong({
    title: 'New Title',
    originalArtist: 'New Artist',
    tags: ['genre:pop'],
  });

  assertEqual(response.status, 400, 'a tags payload must be rejected rather than silently dropped');
  const payload = await response.json() as { error?: string };
  assertEqual(
    typeof payload.error === 'string' && payload.error.length > 0,
    true,
    'the rejection must explain why the request failed',
  );
}

async function testSongUpdateStillAcceptsIdentityEdits(): Promise<void> {
  const response = await putSong({ title: 'New Title', originalArtist: 'New Artist' });
  assertEqual(response.status, 200, 'an ordinary identity edit must still succeed');
}

async function main(): Promise<void> {
  await testSongUpdateRejectsRetiredTagsField();
  await testSongUpdateStillAcceptsIdentityEdits();
  console.log('✓ song identity edits reject the retired tags field');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
