import assert from 'node:assert/strict';
import { URL } from 'node:url';
import app from '../src/index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';
import type { DiscordEmbed } from '../shared/discord';
import type { NovaVodListItem, NovaVodSubmission } from '../shared/types';
import type {
  CorrectionApplyBody, CorrectionApplyResult, CorrectionOperation, NovaVodCorrectionView,
} from '../shared/vod-correction';
import { SQLiteD1 } from './sqlite-d1';

const CURATOR = 'curator@example.com';
const WEBHOOK = 'https://discord.example/feedback';

// alice's s-pub and bob's s-bob archive the same video (a collab), each with its own Song A at 100–200.
const CATALOG_SEED = `
  INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
    ('s-pub','alice','Pub','2026-09-01','video-pub','https://example.com/pub','approved'),
    ('s-bob','bob','Bob','2026-09-01','video-pub','https://example.com/pub','approved');
  INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('A','alice','Song A','Artist','approved'), ('bob-A','bob','Song A','Artist','approved');
  INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
    ('p1','alice','A','s-pub','2026-09-01','Pub','video-pub',100,200,'approved'),
    ('pb','bob','bob-A','s-bob','2026-09-01','Bob','video-pub',100,200,'approved');
`;
// vod-1 and vod-2 are two pending corrections of alice's video-pub; vod-3 is a video alice has no stream for.
const NOVA_SEED = `
  INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,stream_title,stream_date,status,kind) VALUES
    ('vod-1','alice','video-pub','https://example.com/pub','Pub','2026-09-01','pending','correction'),
    ('vod-2','alice','video-pub','https://example.com/pub','Pub','2026-09-01','pending','correction'),
    ('vod-3','alice','video-new','https://example.com/new','New','2026-09-05','pending','new');
  INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
    ('vs-1','vod-1','Song A','Artist',101,200,0),
    ('vs-2','vod-2','Song A','Artist',100,199,0),
    ('vs-3','vod-3','Song N','Artist',10,100,0);
`;
const NONE_SKIPPED = { time: 0, title: 0, add: 0, delete: 0 };
const SHIFT_P1: CorrectionOperation = { op: 'setTimes', performanceId: 'p1', timestamp: 101 };

interface Fixture {
  db: SQLiteD1;
  nova: SQLiteD1;
  /** Every embed the feedback webhook received, in order. */
  posted: DiscordEmbed[];
}

function fixture(): Fixture {
  const db = new SQLiteD1();
  db.sqlite.exec(CATALOG_SEED);
  const nova = new SQLiteD1(new URL('../../tools/nova/schema.sql', import.meta.url));
  nova.sqlite.exec(NOVA_SEED);
  return { db, nova, posted: [] };
}

function close(f: Fixture): void {
  f.db.sqlite.close();
  f.nova.sqlite.close();
}

function envFor(f: Fixture) {
  const emptyR2 = { get: async () => null, put: async () => null } as unknown as R2Bucket;
  return {
    DB: f.db.binding,
    NOVA_DB: f.nova.binding,
    CRYSTAL_DB: f.db.binding,
    CURATOR_EMAILS: CURATOR,
    YOUTUBE_API_KEY: '',
    DISCORD_WEBHOOK_FEEDBACK: WEBHOOK,
    VOD_EXPORT_PUBLIC: emptyR2,
    VOD_EXPORT_PRIVATE: emptyR2,
    VOD_EXPORT_DB_ID: 'test-db',
    VOD_EXPORT_NOVA_DB_ID: 'test-nova-db',
  };
}

/** One request as the curator. Resolves once every Discord post it scheduled has landed in `f.posted`. */
async function send(f: Fixture, method: string, path: string, body?: unknown): Promise<Response> {
  const scheduled: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => { scheduled.push(promise); },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === WEBHOOK) {
      f.posted.push(...(JSON.parse(String(init?.body)) as { embeds: DiscordEmbed[] }).embeds);
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const response = await app.request(path, {
      method,
      headers: {
        'CF-Access-Authenticated-User-Email': CURATOR,
        'Content-Type': 'application/json',
        [REQUEST_AUTHENTICITY_HEADER]: REQUEST_AUTHENTICITY_VALUE,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, envFor(f), ctx);
    await Promise.all(scheduled);
    return response;
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function listed(f: Fixture): Promise<Map<string, NovaVodListItem>> {
  const response = await send(f, 'GET', '/api/nova/vods');
  assert.equal(response.status, 200);
  const { data, total } = await response.json() as { data: NovaVodListItem[]; total: number };
  assert.equal(total, data.length);
  return new Map(data.map((row) => [row.id, row]));
}

async function correctionOf(f: Fixture, id: string): Promise<NovaVodCorrectionView> {
  const response = await send(f, 'GET', `/api/nova/vods/${id}/correction`);
  assert.equal(response.status, 200, `${id} has a correction review`);
  return await response.json() as NovaVodCorrectionView;
}

const applyTo = (f: Fixture, id: string, body: unknown) => send(f, 'POST', `/api/nova/vods/${id}/apply`, body);
const setStatus = (f: Fixture, id: string, body: unknown) => send(f, 'PATCH', `/api/nova/vods/${id}/status`, body);

// node:sqlite rows have a null prototype, which strict deepEqual never matches against a plain object.
const vodRow = (f: Fixture, id: string) =>
  ({ ...f.nova.sqlite.prepare('SELECT status, reviewer_note FROM vod_submissions WHERE id = ?').get(id) });
const timesOf = (f: Fixture, performanceId: string) =>
  ({ ...f.db.sqlite.prepare('SELECT timestamp, end_timestamp FROM performances WHERE id = ?').get(performanceId) });
const count = (db: SQLiteD1, table: string) => Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);

async function testListAddsTargetStream() {
  const f = fixture();
  const rows = await listed(f);
  assert.equal(rows.size, 3);
  assert.equal(rows.get('vod-1')?.target_stream?.id, 's-pub');
  assert.deepEqual(rows.get('vod-1')?.target_stream, { id: 's-pub', status: 'approved' });
  assert.equal(rows.get('vod-1')?.kind, 'correction', 'the row keeps its own columns');
  assert.equal(rows.get('vod-3')?.target_stream, null);
  close(f);
}

async function testTargetIsPerStreamer() {
  const f = fixture();
  f.nova.sqlite.exec(`
    INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status,kind) VALUES
      ('vod-b','bob','video-pub','https://example.com/pub','pending','correction');
    INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
      ('vs-b','vod-b','Song A','Artist',100,200,0);
  `);
  const rows = await listed(f);
  assert.equal(rows.get('vod-b')?.target_stream?.id, 's-bob');
  assert.equal(rows.get('vod-1')?.target_stream?.id, 's-pub');

  const bob = await correctionOf(f, 'vod-b');
  assert.equal(bob.stream.id, 's-bob');
  assert.deepEqual(bob.current.map((row) => row.performanceId), ['pb']);
  assert.deepEqual(bob.proposed[0].existingSong, { id: 'bob-A', status: 'approved' }, "resolution looks in bob's catalog");
  assert.equal(bob.otherPendingCount, 0, "alice's corrections of the same video are not bob's");
  assert.equal((await correctionOf(f, 'vod-1')).otherPendingCount, 1, "bob's correction is not alice's");
  close(f);
}

async function testCorrectionView() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  assert.equal(view.current.length, 1);
  assert.equal(view.match.pairs.length, 1);
  assert.match(view.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(view.otherPendingCount, 1);

  assert.equal(view.submission.id, 'vod-1');
  assert.equal(view.submission.kind, 'correction');
  assert.deepEqual(view.stream, { id: 's-pub', title: 'Pub', date: '2026-09-01', videoId: 'video-pub', status: 'approved' });
  assert.deepEqual(view.current[0], {
    performanceId: 'p1', songId: 'A', title: 'Song A', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200,
    status: 'approved', songStatus: 'approved', songPerformanceCount: 1,
  });
  assert.deepEqual(view.proposed, [{
    id: 'vs-1', title: 'Song A', originalArtist: 'Artist', timestamp: 101, endTimestamp: 200,
    existingSong: { id: 'A', status: 'approved' },
  }]);
  assert.deepEqual(view.match.pairs[0].changes, { start: true, end: false, title: false, artist: false });
  close(f);
}

async function testProposedFollowsTime() {
  const f = fixture();
  // Listed in the submission's own order, the later song first.
  f.nova.sqlite.exec(`
    INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status,kind) VALUES
      ('vod-s','alice','video-pub','https://example.com/pub','pending','correction');
    INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
      ('vs-late','vod-s','Song B','Artist',300,400,0),
      ('vs-early','vod-s','Song A','Artist',100,200,1);
  `);
  const view = await correctionOf(f, 'vod-s');
  assert.deepEqual(view.proposed.map((row) => row.id), ['vs-early', 'vs-late'], 'proposed rows run by time');
  assert.deepEqual(view.proposed.map((row) => row.existingSong), [{ id: 'A', status: 'approved' }, null], 'each row keeps its own resolution');
  assert.deepEqual(view.match.pairs.map((pair) => [pair.currentIndex, pair.proposedIndex]), [[0, 0]], 'indices refer to the sorted rows');
  assert.deepEqual(view.match.unpairedProposed, [1]);
  close(f);
}

async function testCorrectionViewWithoutTarget() {
  const f = fixture();
  const response = await send(f, 'GET', '/api/nova/vods/vod-3/correction');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no_target_stream' });
  const missing = await send(f, 'GET', '/api/nova/vods/vod-none/correction');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'VOD submission not found' });
  close(f);
}

async function testApproveGuard() {
  const f = fixture();
  const performances = count(f.db, 'performances');
  const refused = await setStatus(f, 'vod-1', { status: 'approved' });
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: 'use_correction_review' });
  assert.equal(vodRow(f, 'vod-1').status, 'pending', 'a refused approval writes nothing');

  const response = await setStatus(f, 'vod-1', { status: 'approved', without_applying: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as NovaVodSubmission).status, 'approved');
  assert.equal(vodRow(f, 'vod-1').status, 'approved');
  assert.equal(count(f.db, 'performances'), performances, 'approving without applying imports nothing');
  assert.equal(f.db.batches.length, 0, 'approving without applying writes nothing to the catalog');
  assert.deepEqual(f.posted, [], 'approving without applying announces nothing');

  // The flow is decided by the stream existing, whatever its status.
  f.db.sqlite.exec("UPDATE streams SET status = 'excluded' WHERE id = 's-pub'");
  const excluded = await setStatus(f, 'vod-2', { status: 'approved' });
  assert.equal(excluded.status, 409);
  assert.deepEqual(await excluded.json(), { error: 'use_correction_review' });
  close(f);
}

async function testFlowIsDecidedLiveNotByKind() {
  const f = fixture();
  // A first submission (kind 'new') of a video whose stream is still in the pipeline: the stream came after Nova
  // took the submission. Which review it gets follows the stream as it is now, never the kind.
  f.db.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-pipe','alice','Pipe','2026-09-04','video-pipe','https://example.com/pipe','pending');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('B','alice','Song B','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('pp','alice','B','s-pipe','2026-09-04','Pipe','video-pipe',100,200,'pending');
  `);
  f.nova.sqlite.exec(`
    INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,stream_title,stream_date,status,kind) VALUES
      ('vod-n','alice','video-pipe','https://example.com/pipe','Pipe','2026-09-04','pending','new');
    INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
      ('vs-n','vod-n','Song B','Artist',101,200,0);
  `);
  assert.deepEqual((await listed(f)).get('vod-n')?.target_stream, { id: 's-pipe', status: 'pending' }, 'the list names the stream');

  const refused = await setStatus(f, 'vod-n', { status: 'approved' });
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: 'use_correction_review' }, 'a plain approval of a new submission is refused too');

  const view = await correctionOf(f, 'vod-n');
  assert.equal(view.submission.kind, 'new');
  assert.equal(view.stream.id, 's-pipe', 'the review is of the stream in the pipeline');
  const response = await applyTo(f, 'vod-n', {
    fingerprint: view.fingerprint,
    operations: [{ op: 'setTimes', performanceId: 'pp', timestamp: 101 }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(response.status, 200);
  assert.equal(timesOf(f, 'pp').timestamp, 101);
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].title, '✅ VOD 投稿已收錄', "a 'new' submission is announced as one, not as a correction");
  close(f);
}

async function testRejectStaysAllowed() {
  const f = fixture();
  const response = await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R' });
  assert.equal(response.status, 200);
  assert.equal(vodRow(f, 'vod-1').status, 'rejected');
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].title, '❌ VOD 修正未採用');
  assert.deepEqual(f.posted[0].fields, [{ name: '理由', value: 'R' }]);

  // without_applying only means something on an approval: a rejection carrying it is announced as usual.
  const flagged = await setStatus(f, 'vod-2', { status: 'rejected', reviewer_note: 'R2', without_applying: true });
  assert.equal(flagged.status, 200);
  assert.equal(f.posted.length, 2);
  assert.deepEqual(f.posted[1].fields, [{ name: '理由', value: 'R2' }]);
  close(f);
}

async function testApproveWithoutTargetStillImports() {
  const f = fixture();
  const response = await setStatus(f, 'vod-3', { status: 'approved' });
  assert.equal(response.status, 200);
  const stream = f.db.sqlite.prepare("SELECT id FROM streams WHERE streamer_id = 'alice' AND video_id = 'video-new'").get();
  assert.ok(stream, 'the approval imported the VOD as a new stream');
  assert.equal(Number(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM performances WHERE stream_id = ?').get(String(stream.id))!.n), 1);
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].title, '✅ VOD 投稿已收錄', "a 'new' submission keeps today's embed");
  close(f);
}

async function testApproveWithoutApplyingNeedsATarget() {
  const f = fixture();
  const before = vodRow(f, 'vod-3');
  const streams = count(f.db, 'streams');
  const performances = count(f.db, 'performances');
  // vod-3's video has no stream: an approval that applies nothing to it must not import one either.
  const response = await setStatus(f, 'vod-3', { status: 'approved', reviewer_note: 'R', without_applying: true });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no_target_stream' });
  assert.deepEqual(vodRow(f, 'vod-3'), before, 'the submission stays pending, its note untouched');
  assert.equal(count(f.db, 'streams'), streams, 'no stream is imported');
  assert.equal(count(f.db, 'performances'), performances, 'and no performance');
  assert.equal(f.db.batches.length, 0, 'nothing is written to the catalog');
  assert.deepEqual(f.posted, [], 'and nothing is announced');
  close(f);
}

async function testWithoutApplyingNeverImports() {
  // s-pub is deleted after the approval's existence check passes. Approving without applying
  // must still import nothing; a later existence lookup would read the video as new.
  const f = fixture();
  const prepare = f.db.prepare.bind(f.db);
  let lookups = 0;
  f.db.prepare = (sql: string) => {
    if (sql === 'SELECT 1 FROM streams WHERE video_id = ? AND streamer_id = ?' && ++lookups === 2) {
      f.db.sqlite.exec("DELETE FROM performances WHERE stream_id = 's-pub'; DELETE FROM streams WHERE id = 's-pub'");
    }
    return prepare(sql);
  };
  const response = await setStatus(f, 'vod-1', { status: 'approved', reviewer_note: 'R', without_applying: true });
  assert.equal(response.status, 200);
  assert.equal(vodRow(f, 'vod-1').status, 'approved');
  assert.equal(f.db.batches.length, 0, 'nothing is imported');
  assert.equal(Number(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM streams WHERE id <> 's-pub' AND video_id = 'video-pub' AND streamer_id = 'alice'").get()!.n), 0, 'no stream is created for the video');
  close(f);
}

async function testApplyHappyPath() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const body: CorrectionApplyBody = { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED };
  const response = await applyTo(f, 'vod-1', body);
  assert.equal(response.status, 200);
  const result = await response.json() as CorrectionApplyResult;
  assert.equal(result.summary, '套用 1 項（時間 1）');
  assert.equal(result.submission.id, 'vod-1');
  assert.equal(result.submission.status, 'approved');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: '套用 1 項（時間 1）' });
  assert.equal(timesOf(f, 'p1').timestamp, 101);
  assert.equal(f.db.batches.length, 1, 'one catalog batch');

  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].title, '✅ VOD 修正已套用');
  assert.deepEqual(f.posted[0].fields, [{ name: '變更', value: '套用 1 項（時間 1）' }]);
  close(f);
}

async function testApplyNoteStaysOffDiscord() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const response = await applyTo(f, 'vod-1', {
    fingerprint: view.fingerprint,
    reviewerNote: '  secret thanks  ',
    operations: [SHIFT_P1],
    skipped: { time: 0, title: 1, add: 0, delete: 0 },
  });
  assert.equal(response.status, 200);
  const summary = '套用 1 項（時間 1）；略過 1 項（歌名 1）';
  assert.equal((await response.json() as CorrectionApplyResult).summary, summary);
  assert.equal(vodRow(f, 'vod-1').reviewer_note, `secret thanks\n${summary}`, "the note keeps the curator's words, then the summary");
  assert.equal(f.posted.length, 1);
  assert.deepEqual(f.posted[0].fields, [{ name: '變更', value: summary }]);
  assert.ok(!JSON.stringify(f.posted).includes('secret'), 'the free-text note is never posted');
  close(f);
}

async function testApplyStale() {
  const f = fixture();
  const response = await applyTo(f, 'vod-1', { fingerprint: 'x', operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'stale' });
  assert.equal(f.db.batches.length, 0, 'nothing written to the catalog');
  assert.equal(timesOf(f, 'p1').timestamp, 100);
  assert.equal(vodRow(f, 'vod-1').status, 'pending');
  assert.deepEqual(f.posted, []);
  close(f);
}

async function testApplyNotPending() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  f.nova.sqlite.exec("UPDATE vod_submissions SET status = 'approved' WHERE id = 'vod-1'");
  const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'not_pending' });
  assert.equal(f.db.batches.length, 0);
  close(f);
}

async function testApplyChecksInOrder() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const valid = { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED };
  const invalid = { ...valid, operations: [] };
  const answer = async (id: string, body: unknown) => {
    const response = await applyTo(f, id, body);
    return [response.status, await response.json()];
  };

  assert.deepEqual(await answer('vod-none', invalid), [404, { error: 'VOD submission not found' }], 'a missing VOD comes first');
  f.nova.sqlite.exec("UPDATE vod_submissions SET status = 'rejected' WHERE id = 'vod-2'");
  assert.deepEqual(await answer('vod-2', invalid), [409, { error: 'not_pending' }], 'then its status, before the body is read');
  assert.deepEqual(
    await answer('vod-3', invalid),
    [400, { error: 'Invalid operations: expected at least one operation' }],
    'then the body, before the target is looked up',
  );
  assert.deepEqual(await answer('vod-3', valid), [404, { error: 'no_target_stream' }], 'then the target');
  assert.deepEqual(await answer('vod-1', { ...valid, fingerprint: 'x' }), [409, { error: 'stale' }], 'then the fingerprint');
  assert.equal(f.db.batches.length, 0);
  close(f);
}

async function testApplyInvalid() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const response = await applyTo(f, 'vod-1', {
    fingerprint: view.fingerprint,
    operations: [{ op: 'setTimes', performanceId: 'p1', endTimestamp: 50 }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(response.status, 400);
  const json = await response.json() as { error: string; details: string[] };
  assert.equal(json.error, 'invalid_operations');
  assert.deepEqual(json.details, ['operation 0: end must be greater than start (start 100, end 50)']);
  assert.deepEqual(Object.keys(json).sort(), ['details', 'error']);
  assert.equal(f.db.batches.length, 0);
  assert.equal(vodRow(f, 'vod-1').status, 'pending');
  assert.deepEqual(f.posted, []);
  close(f);
}

async function testApplyWouldPublishHidden() {
  const f = fixture();
  // Song P is pending and has an approved row on a stream that is not public: promoting it would publish that row.
  f.db.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-hidden','alice','Hidden','2026-09-03','video-hidden','https://example.com/hidden','pending');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('P','alice','Song P','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('p5','alice','P','s-hidden','2026-09-03','Hidden','video-hidden',100,200,'approved');
  `);
  const view = await correctionOf(f, 'vod-1');
  const response = await applyTo(f, 'vod-1', {
    fingerprint: view.fingerprint,
    operations: [{ op: 'relinkToSong', performanceId: 'p1', songId: 'P' }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'would_publish_hidden',
    performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'P' }],
  });
  assert.equal(f.db.batches.length, 0);
  assert.equal(vodRow(f, 'vod-1').status, 'pending');
  close(f);
}

async function testSecondCorrectionSeesFirstApplied() {
  const f = fixture();
  const before = await correctionOf(f, 'vod-2');
  const first = await correctionOf(f, 'vod-1');
  assert.equal((await applyTo(f, 'vod-1', { fingerprint: first.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 200);

  const after = await correctionOf(f, 'vod-2');
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.equal(after.current[0].timestamp, 101);
  assert.deepEqual(after.match.pairs[0].changes, { start: true, end: true, title: false, artist: false }, 'pairs are made afresh');
  assert.equal(after.otherPendingCount, 0, 'vod-1 is no longer pending');

  const stale = await applyTo(f, 'vod-2', { fingerprint: before.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(stale.status, 409, 'a review of the old list cannot be applied');
  assert.deepEqual(await stale.json(), { error: 'stale' });
  close(f);
}

async function testConcurrentAppliesOfOneSubmission() {
  // Two tabs apply vod-1 at once: both pass the fingerprint check before either batch runs.
  // Only the batch that reaches the catalog first may write; the other is refused as stale.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const body: CorrectionApplyBody = {
    fingerprint: view.fingerprint,
    operations: [SHIFT_P1, { op: 'addPerformance', title: 'Song Z', originalArtist: 'Artist', timestamp: 300, endTimestamp: 400 }],
    skipped: NONE_SKIPPED,
  };
  let second: Response | undefined;
  f.db.beforeBatch = async () => {
    f.db.beforeBatch = undefined;
    second = await applyTo(f, 'vod-1', body);
  };
  const first = await applyTo(f, 'vod-1', body);
  assert.equal(second?.status, 200, 'the apply whose batch ran first went through');
  assert.equal(first.status, 409);
  assert.deepEqual(await first.json(), { error: 'stale' });
  assert.equal(timesOf(f, 'p1').timestamp, 101);
  assert.equal(Number(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM performances WHERE stream_id = 's-pub'").get()!.n), 2, 'p1 and one Song Z: the add landed once');
  assert.equal(vodRow(f, 'vod-1').status, 'approved');
  assert.equal(f.posted.length, 1, 'one announcement');
  close(f);
}

async function testApply502WhenNovaWriteFails() {
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const prepare = f.nova.prepare.bind(f.nova);
  f.nova.prepare = (sql: string) => {
    if (sql.includes('UPDATE vod_submissions')) throw new Error('Nova is unavailable');
    return prepare(sql);
  };
  const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'Catalog updated but the submission could not be marked reviewed',
    appliedToCatalog: true,
  });
  assert.equal(timesOf(f, 'p1').timestamp, 101, 'the catalog batch had committed');
  assert.equal(vodRow(f, 'vod-1').status, 'pending');
  assert.deepEqual(f.posted, [], 'nothing is announced for an apply whose submission was not marked reviewed');
  close(f);
}

const tests = [
  testListAddsTargetStream,
  testTargetIsPerStreamer,
  testCorrectionView,
  testProposedFollowsTime,
  testCorrectionViewWithoutTarget,
  testApproveGuard,
  testFlowIsDecidedLiveNotByKind,
  testRejectStaysAllowed,
  testApproveWithoutTargetStillImports,
  testApproveWithoutApplyingNeedsATarget,
  testWithoutApplyingNeverImports,
  testApplyHappyPath,
  testApplyNoteStaysOffDiscord,
  testApplyStale,
  testApplyNotPending,
  testApplyChecksInOrder,
  testApplyInvalid,
  testApplyWouldPublishHidden,
  testSecondCorrectionSeesFirstApplied,
  testConcurrentAppliesOfOneSubmission,
  testApply502WhenNovaWriteFails,
];

async function main() {
  for (const test of tests) {
    try {
      await test();
    } catch (error) {
      console.error(`✗ ${test.name}`);
      throw error;
    }
  }
  console.log(`✓ Nova VOD correction routes: list targets, review view, approve guard, apply and its errors (${tests.length} tests)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
