// Corrections through Nova, end to end over real SQL: POST /vod/api/submit, GET /vod/api/current and
// GET /vod/api/check. Nova's schema.sql and seed.sql share one in-memory database (DB), the admin
// worker's schema.sql another (ADMIN_DB), both through the node:sqlite D1 shim the admin tests use.
// Every test builds its own pair, so no answer depends on the order the tests run in.
// Run with: npm run test:vod-routes
import assert from 'node:assert/strict';
// The shim takes node's URL; the global one here is workers-types', which does not match it.
import { URL } from 'node:url';
import app from '../src/index';
import { listAllVodSubmissions } from '../src/vod-db';
import type { Bindings } from '../src/types';
import { SQLiteD1 } from '../../../admin/tests/sqlite-d1';

const TURNSTILE = 'challenges.cloudflare.com/turnstile/v0/siteverify';
const OEMBED = 'youtube.com/oembed';
const DATA_API = 'googleapis.com/youtube/v3/videos';

// mizuki's streams in the admin DB. Only s-pub is public, and its one row is Song A at 100–200.
// Every other status holds an approved row on purpose: what hides a non-public stream is the
// stream's own status, never the state of its rows.
const ADMIN_SEED = `
  INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
    ('s-pub','mizuki','Public','2026-09-01','vidPUB00001','https://example.com','approved'),
    ('s-pipe','mizuki','Pipeline','2026-09-02','vidPIPE0001','https://example.com','pending'),
    ('s-excl','mizuki','Excluded','2026-09-03','vidEXCL0001','https://example.com','excluded'),
    ('s-extr','mizuki','Extracted','2026-09-04','vidEXTR0001','https://example.com','extracted'),
    ('s-rej','mizuki','Rejected','2026-09-05','vidREJE0001','https://example.com','rejected');
  INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('song-a','mizuki','Song A','Artist','approved');
  INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
    ('p-pub','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',100,200,'approved'),
    ('p-pipe','mizuki','song-a','s-pipe','2026-09-02','Pipeline','vidPIPE0001',10,20,'approved'),
    ('p-excl','mizuki','song-a','s-excl','2026-09-03','Excluded','vidEXCL0001',10,20,'approved'),
    ('p-extr','mizuki','song-a','s-extr','2026-09-04','Extracted','vidEXTR0001',10,20,'approved'),
    ('p-rej','mizuki','song-a','s-rej','2026-09-05','Rejected','vidREJE0001',10,20,'approved');
`;

const NOT_PUBLIC = [
  ['pending', 'vidPIPE0001'],
  ['excluded', 'vidEXCL0001'],
  ['extracted', 'vidEXTR0001'],
  ['rejected', 'vidREJE0001'],
] as const;

interface SongInput {
  song_title: string;
  original_artist: string;
  start_timestamp: string;
  end_timestamp?: string;
}

/** Exactly what s-pub publishes. */
const SONG_A: SongInput = { song_title: 'Song A', original_artist: 'Artist', start_timestamp: '0:01:40', end_timestamp: '0:03:20' };
/** What the pipeline streams hold as approved rows. */
const SONG_A_EARLY: SongInput = { song_title: 'Song A', original_artist: 'Artist', start_timestamp: '0:00:10', end_timestamp: '0:00:20' };
const SONG_A_LINE = '01. 0:01:40 ~ 0:03:20 Song A / Artist';

interface Fixture {
  db: SQLiteD1;
  adminDb: SQLiteD1;
  env: Bindings;
}

function fixture(): Fixture {
  const db = new SQLiteD1(new URL('../schema.sql', import.meta.url), new URL('../seed.sql', import.meta.url));
  const adminDb = new SQLiteD1(new URL('../../../admin/schema.sql', import.meta.url));
  adminDb.sqlite.exec(ADMIN_SEED);
  return {
    db,
    adminDb,
    env: {
      DB: db.binding,
      ADMIN_DB: adminDb.binding,
      TURNSTILE_SITE_KEY: 'test-site-key',
      TURNSTILE_SECRET_KEY: 'test-secret',
      YOUTUBE_API_KEY: 'test-youtube-key',
    },
  };
}

function close(f: Fixture): void {
  f.db.sqlite.close();
  f.adminDb.sqlite.close();
}

// --- outbound fetch: Turnstile passes, YouTube answers with a title, anything else is a 404 ---
const realFetch = globalThis.fetch;
let outbound: string[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function installFetch(): void {
  outbound = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    outbound.push(url);
    if (url.includes(TURNSTILE)) return jsonResponse({ success: true });
    if (url.includes(OEMBED)) return jsonResponse({ title: 'Mock Stream', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
    if (url.includes(DATA_API)) return jsonResponse({ items: [{ snippet: { title: 'API Title' }, liveStreamingDetails: { actualStartTime: '2026-09-01T12:00:00Z' } }] });
    return new Response('unexpected outbound request', { status: 404 });
  }) as typeof fetch;
}

// --- requests: a status and the parsed body, or the raw text when the body is not JSON ---
interface Answer {
  status: number;
  body: unknown;
}

const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' };

async function answer(response: Response): Promise<Answer> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (a 404 page, say): keep the text, and the assertion on the status says what happened.
  }
  return { status: response.status, body };
}

function query(slug: string, videoId: string): string {
  return `streamer_slug=${slug}&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
}

async function current(f: Fixture, slug: string, videoId: string, headers: Record<string, string> = SAME_ORIGIN): Promise<Answer> {
  return answer(await app.request(`/vod/api/current?${query(slug, videoId)}`, { headers }, f.env));
}

async function check(f: Fixture, slug: string, videoId: string): Promise<Answer> {
  return answer(await app.request(`/vod/api/check?${query(slug, videoId)}`, { headers: SAME_ORIGIN }, f.env));
}

async function submit(f: Fixture, videoId: string, songs: SongInput[], slug = 'mizuki'): Promise<Answer> {
  return answer(await app.request('/vod/api/submit', {
    method: 'POST',
    headers: { ...SAME_ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      streamer_slug: slug,
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      songs,
      turnstile_token: 'ok',
    }),
  }, f.env));
}

/** A 201 carries exactly { id, kind }; returns the new submission's id. */
function created(a: Answer, kind: 'new' | 'correction'): string {
  assert.equal(a.status, 201, `expected 201, got ${a.status}: ${JSON.stringify(a.body)}`);
  const body = a.body as { id: string; kind: string };
  assert.deepEqual(Object.keys(body).sort(), ['id', 'kind']);
  assert.equal(body.kind, kind);
  assert.match(body.id, /^vod-[0-9a-f]{8}$/);
  return body.id;
}

// node:sqlite rows have a null prototype, so read single columns instead of comparing whole rows.
const count = (db: SQLiteD1, table: string) => Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
const storedKind = (f: Fixture, id: string) => f.db.sqlite.prepare('SELECT kind FROM vod_submissions WHERE id = ?').get(id)?.kind;

function addNovaVod(f: Fixture, id: string, slug: string, videoId: string, status: string): void {
  f.db.sqlite.prepare(
    'INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status) VALUES (?,?,?,?,?)',
  ).run(id, slug, videoId, `https://www.youtube.com/watch?v=${videoId}`, status);
}

// --- POST /vod/api/submit ---

async function testNewVideoIsNew() {
  const f = fixture();
  const id = created(await submit(f, 'vidNEW00001', [SONG_A]), 'new');
  assert.equal(storedKind(f, id), 'new');
  assert.equal(count(f.db, 'vod_songs'), 1, 'the song rows are stored');
  assert.equal(f.db.sqlite.prepare('SELECT stream_title FROM vod_submissions WHERE id = ?').get(id)?.stream_title, 'Mock Stream', 'an accepted submission still fills its title from YouTube');
  close(f);
}

async function testArchivedDifferentIsCorrection() {
  const f = fixture();
  const id = created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  assert.equal(storedKind(f, id), 'correction', 'the stored row is a correction');
  assert.equal(count(f.db, 'vod_songs'), 1, 'its songs are stored like any submission');
  const row = (await listAllVodSubmissions(f.db.binding)).find((candidate) => candidate.id === id);
  assert.equal(row?.kind, 'correction', 'the status page reads it as a correction');
  close(f);
}

async function testArchivedIdenticalIsNoChanges() {
  const f = fixture();
  const before = [count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')];
  assert.deepEqual(await submit(f, 'vidPUB00001', [SONG_A]), { status: 422, body: { error: 'no_changes' } });
  assert.deepEqual([count(f.db, 'vod_submissions'), count(f.db, 'vod_songs')], before, 'nothing is inserted');
  assert.deepEqual(outbound.filter((url) => !url.includes(TURNSTILE)), [], 'a refused list spends no YouTube lookup');
  close(f);
}

async function testSpacedSlashTitleSurvivesTheForm() {
  // The paste text cannot carry `Song B / Live`: the form parsers read its line back as `Song B` by `Live / Artist`.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-b','mizuki','Song B / Live','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-b','mizuki','song-b','s-pub','2026-09-01','Public','vidPUB00001',300,400,'approved');
  `);
  const misread: SongInput = { song_title: 'Song B', original_artist: 'Live / Artist', start_timestamp: '0:05:00', end_timestamp: '0:06:40' };
  assert.deepEqual(await submit(f, 'vidPUB00001', [SONG_A, misread]), { status: 422, body: { error: 'no_changes' } }, 'the loaded list, unchanged, changes nothing');

  const id = created(await submit(f, 'vidPUB00001', [SONG_A, { ...misread, start_timestamp: '0:05:01' }]), 'correction');
  const stored = f.db.sqlite.prepare(
    'SELECT song_title, original_artist FROM vod_songs WHERE vod_submission_id = ? AND start_timestamp = 301',
  ).get(id);
  assert.equal(stored?.song_title, 'Song B / Live', 'a time fix keeps the archived title');
  assert.equal(stored?.original_artist, 'Artist', 'and the archived artist');
  close(f);
}

async function testMissingEndSurvivesTheForm() {
  // Song C is archived at 0:00:30 without an end; the form parsers give it the next row's start.
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-c','mizuki','Song C','Artist','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pub-c','mizuki','song-c','s-pub','2026-09-01','Public','vidPUB00001',30,NULL,'approved');
  `);
  const filled: SongInput = { song_title: 'Song C', original_artist: 'Artist', start_timestamp: '0:00:30', end_timestamp: '0:01:40' };
  assert.deepEqual(await submit(f, 'vidPUB00001', [filled, SONG_A]), { status: 422, body: { error: 'no_changes' } }, 'the loaded list, unchanged, changes nothing');

  // Song A's start moves, and the parsers fill Song C's end with the new start.
  const id = created(await submit(f, 'vidPUB00001', [{ ...filled, end_timestamp: '0:01:41' }, { ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  const stored = f.db.sqlite.prepare('SELECT end_timestamp FROM vod_songs WHERE vod_submission_id = ? AND start_timestamp = 30').get(id);
  assert.equal(stored?.end_timestamp, null, 'the filled-in end is stored as none');
  close(f);
}

async function testPipelineAndExcludedAreAccepted() {
  const f = fixture();
  // The list a non-public stream's approved rows hold is still a new submission, with the
  // same answer as for an unknown video: a no_changes would tell the contributor the stream exists.
  for (const [status, videoId] of NOT_PUBLIC) {
    const id = created(await submit(f, videoId, [SONG_A_EARLY]), 'new');
    assert.equal(storedKind(f, id), 'new', `a ${status} stream is stored as new`);
  }
  close(f);
}

async function testApprovedNovaRowNoLongerBlocks() {
  const f = fixture();
  addNovaVod(f, 'vod-approved', 'mizuki', 'vidNOVA00001', 'approved');
  created(await submit(f, 'vidNOVA00001', [SONG_A]), 'new');
  assert.equal(count(f.db, 'vod_submissions'), 2);

  // The usual archived VOD got there through an approved submission of its own, which used to block twice over.
  addNovaVod(f, 'vod-archived', 'mizuki', 'vidPUB00001', 'approved');
  created(await submit(f, 'vidPUB00001', [{ ...SONG_A, start_timestamp: '0:01:41' }]), 'correction');
  assert.equal(count(f.db, 'vod_submissions'), 4);
  close(f);
}

async function testArchivedStreamWithoutPublicRows() {
  const f = fixture();
  // Approved stream, but its only performance is pending: its public list is empty, and it is still archived.
  f.adminDb.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-empty','mizuki','Empty','2026-09-06','vidEMPT0001','https://example.com','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-empty','mizuki','song-a','s-empty','2026-09-06','Empty','vidEMPT0001',50,60,'pending');
  `);
  assert.deepEqual(await current(f, 'mizuki', 'vidEMPT0001'), { status: 200, body: { archived: true, text: '' } });
  assert.deepEqual((await check(f, 'mizuki', 'vidEMPT0001')).body, {
    exists: true, archived: true, count: 0, hasApproved: false, pendingCount: 0, rejectedCount: 0, latestStatus: null,
  });
  created(await submit(f, 'vidEMPT0001', [SONG_A]), 'correction');
  close(f);
}

// --- GET /vod/api/current ---

async function testCurrentApproved() {
  const f = fixture();
  assert.deepEqual(await current(f, 'mizuki', 'vidPUB00001'), { status: 200, body: { archived: true, text: SONG_A_LINE } });
  close(f);
}

async function testCurrentHidesPipeline() {
  const f = fixture();
  const unknown = await current(f, 'mizuki', 'vidNEW00001');
  assert.deepEqual(unknown, { status: 200, body: { archived: false, text: '' } });
  for (const [status, videoId] of NOT_PUBLIC) {
    assert.deepEqual(await current(f, 'mizuki', videoId), unknown, `a ${status} stream answers as an unknown video`);
  }
  close(f);
}

async function testCurrentSkipsPendingRows() {
  const f = fixture();
  f.adminDb.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-pending','mizuki','Song P','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-pending','mizuki','song-a','s-pub','2026-09-01','Public','vidPUB00001',300,400,'pending'),
      ('p-pending-song','mizuki','song-pending','s-pub','2026-09-01','Public','vidPUB00001',500,600,'approved');
  `);
  assert.deepEqual(await current(f, 'mizuki', 'vidPUB00001'), { status: 200, body: { archived: true, text: SONG_A_LINE } },
    'neither the pending performance nor the approved performance of a pending song is listed');
  close(f);
}

async function testCurrentUntrusted() {
  const f = fixture();
  const forbidden = { status: 403, body: { error: 'Forbidden' } };
  assert.deepEqual(await current(f, 'mizuki', 'vidPUB00001', {}), forbidden, 'no same-origin signal');
  assert.deepEqual(
    await current(f, 'mizuki', 'vidPUB00001', { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }),
    forbidden,
    'a foreign page',
  );
  const missing = await answer(await app.request('/vod/api/current', {}, f.env));
  assert.deepEqual(missing, forbidden, 'the gate runs before the parameter checks');
  close(f);
}

async function testCurrentAllowsAurora() {
  const f = fixture();
  // What a browser sends from Aurora: cross-site, with Aurora's origin.
  const headers = { Origin: 'https://aurora.oshi.tw', 'Sec-Fetch-Site': 'cross-site' };
  const response = await app.request(`/vod/api/current?${query('mizuki', 'vidPUB00001')}`, { headers }, f.env);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://aurora.oshi.tw');
  assert.deepEqual(await answer(response), { status: 200, body: { archived: true, text: SONG_A_LINE } });
  close(f);
}

async function testCurrentRejectsBadInput() {
  const f = fixture();
  const get = async (path: string) => (await answer(await app.request(path, { headers: SAME_ORIGIN }, f.env))).status;
  const url = encodeURIComponent('https://www.youtube.com/watch?v=vidPUB00001');
  assert.equal(await get('/vod/api/current'), 400, 'no parameters');
  assert.equal(await get(`/vod/api/current?url=${url}`), 400, 'no streamer_slug');
  assert.equal(await get('/vod/api/current?streamer_slug=mizuki'), 400, 'no url');
  assert.equal(await get(`/vod/api/current?streamer_slug=mizuki&url=${encodeURIComponent('https://example.com/watch')}`), 400, 'not a YouTube video URL');
  close(f);
}

// --- GET /vod/api/check ---

async function testCheckArchived() {
  const f = fixture();
  assert.deepEqual(await check(f, 'mizuki', 'vidPUB00001'), {
    status: 200,
    body: { exists: true, archived: true, count: 0, hasApproved: false, pendingCount: 0, rejectedCount: 0, latestStatus: null },
  });
  addNovaVod(f, 'vod-pending', 'mizuki', 'vidPUB00001', 'pending');
  assert.deepEqual((await check(f, 'mizuki', 'vidPUB00001')).body, {
    exists: true, archived: true, count: 1, hasApproved: false, pendingCount: 1, rejectedCount: 0, latestStatus: 'pending',
  }, 'the Nova submission counts still arrive beside archived');
  close(f);
}

async function testCheckNoLeak() {
  const f = fixture();
  const unknown = await check(f, 'mizuki', 'vidNEW00001');
  assert.deepEqual(unknown, {
    status: 200,
    body: { exists: false, archived: false, count: 0, hasApproved: false, pendingCount: 0, rejectedCount: 0, latestStatus: null },
  });
  for (const [status, videoId] of NOT_PUBLIC) {
    const a = await check(f, 'mizuki', videoId);
    const body = a.body as Record<string, unknown>;
    assert.ok(!('inAdmin' in body) && !('adminStatus' in body), `a ${status} stream's answer names no admin state`);
    assert.equal(body.archived, false);
    assert.equal(body.exists, false);
    assert.deepEqual(a, unknown, `a ${status} stream answers as an unknown video`);
  }

  // With Nova submissions on file the counts are all that is reported, with or without the pipeline stream.
  addNovaVod(f, 'vod-pipe', 'mizuki', 'vidPIPE0001', 'pending');
  addNovaVod(f, 'vod-plain', 'mizuki', 'vidNEW00001', 'pending');
  const withStream = await check(f, 'mizuki', 'vidPIPE0001');
  assert.deepEqual(withStream, await check(f, 'mizuki', 'vidNEW00001'));
  assert.deepEqual(withStream.body, {
    exists: true, archived: false, count: 1, hasApproved: false, pendingCount: 1, rejectedCount: 0, latestStatus: 'pending',
  });

  const junk = (await answer(await app.request('/vod/api/check?streamer_slug=mizuki&url=not-a-video', {}, f.env))).body as Record<string, unknown>;
  assert.ok(!('inAdmin' in junk) && !('adminStatus' in junk));
  close(f);
}

// --- one video, two streamers ---

async function testCollabIsKeyedPerStreamer() {
  const f = fixture();
  // vidCOLL0001 is public under both streamers with different lists; under vidCOLL0002 gabu's copy is still in the pipeline.
  f.adminDb.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-coll-m','mizuki','Collab','2026-09-07','vidCOLL0001','https://example.com','approved'),
      ('s-coll-g','gabu','Collab','2026-09-07','vidCOLL0001','https://example.com','approved'),
      ('s-coll2-m','mizuki','Collab 2','2026-09-08','vidCOLL0002','https://example.com','approved'),
      ('s-coll2-g','gabu','Collab 2','2026-09-08','vidCOLL0002','https://example.com','pending');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song-g','gabu','Song G','Artist G','approved');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p-coll-m','mizuki','song-a','s-coll-m','2026-09-07','Collab','vidCOLL0001',100,200,'approved'),
      ('p-coll-g','gabu','song-g','s-coll-g','2026-09-07','Collab','vidCOLL0001',30,90,'approved'),
      ('p-coll2-m','mizuki','song-a','s-coll2-m','2026-09-08','Collab 2','vidCOLL0002',100,200,'approved'),
      ('p-coll2-g','gabu','song-g','s-coll2-g','2026-09-08','Collab 2','vidCOLL0002',30,90,'approved');
  `);

  const archivedOf = async (slug: string, videoId: string) => ((await check(f, slug, videoId)).body as { archived: boolean }).archived;

  assert.deepEqual((await current(f, 'mizuki', 'vidCOLL0001')).body, { archived: true, text: SONG_A_LINE });
  assert.deepEqual((await current(f, 'gabu', 'vidCOLL0001')).body, { archived: true, text: '01. 0:00:30 ~ 0:01:30 Song G / Artist G' });
  assert.equal(await archivedOf('gabu', 'vidCOLL0001'), true);

  // Mizuki's own list is nothing new to mizuki, and a correction of gabu's.
  assert.deepEqual(await submit(f, 'vidCOLL0001', [SONG_A], 'mizuki'), { status: 422, body: { error: 'no_changes' } });
  created(await submit(f, 'vidCOLL0001', [SONG_A], 'gabu'), 'correction');

  // Public for mizuki, in the pipeline for gabu: gabu's answers must not see mizuki's stream.
  assert.deepEqual((await current(f, 'mizuki', 'vidCOLL0002')).body, { archived: true, text: SONG_A_LINE });
  assert.deepEqual(await current(f, 'gabu', 'vidCOLL0002'), { status: 200, body: { archived: false, text: '' } });
  assert.equal(await archivedOf('gabu', 'vidCOLL0002'), false);
  created(await submit(f, 'vidCOLL0002', [SONG_A], 'gabu'), 'new');
  assert.deepEqual(await submit(f, 'vidCOLL0002', [SONG_A], 'mizuki'), { status: 422, body: { error: 'no_changes' } });
  close(f);
}

const tests = [
  testNewVideoIsNew,
  testArchivedDifferentIsCorrection,
  testArchivedIdenticalIsNoChanges,
  testSpacedSlashTitleSurvivesTheForm,
  testMissingEndSurvivesTheForm,
  testPipelineAndExcludedAreAccepted,
  testApprovedNovaRowNoLongerBlocks,
  testArchivedStreamWithoutPublicRows,
  testCurrentApproved,
  testCurrentHidesPipeline,
  testCurrentSkipsPendingRows,
  testCurrentUntrusted,
  testCurrentAllowsAurora,
  testCurrentRejectsBadInput,
  testCheckArchived,
  testCheckNoLeak,
  testCollabIsKeyedPerStreamer,
];

async function main() {
  let failed = 0;
  try {
    for (const test of tests) {
      installFetch();
      try {
        await test();
      } catch (error) {
        failed += 1;
        console.error(`✗ ${test.name}`);
        console.error(error);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
  if (failed > 0) {
    console.error(`${failed} of ${tests.length} Nova VOD route tests failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ Nova VOD routes: submit tags corrections, current serves the public list, check leaks no pipeline state (${tests.length} tests)`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
