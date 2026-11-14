import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SQLInputValue } from 'node:sqlite';
import { URL } from 'node:url';
import app from '../src/index';
import { REQUEST_AUTHENTICITY_HEADER, REQUEST_AUTHENTICITY_VALUE } from '../shared/csrf';
import type { DiscordEmbed } from '../shared/discord';
import type { NovaVodListItem, NovaVodSubmission, Status } from '../shared/types';
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
/**
 * A setTimes that names p1's current start (p1 is at 100): it builds a statement, so its batch commits and writes an
 * apply record, but it moves nothing the fingerprint or the batch's target guard reads. The page never sends one (it
 * sends only the times that differ from the row's); through the API it lets two applies of one submission both land.
 */
const SAME_START_P1: CorrectionOperation = { op: 'setTimes', performanceId: 'p1', timestamp: 100 };

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
/** The apply records of submission `id`, in the order they were written. */
const appliesOf = (f: Fixture, id: string) => f.db.sqlite
  .prepare(`SELECT reviewer_note, summary, actor, announced_at IS NOT NULL AS announced
            FROM vod_correction_applies WHERE submission_id = ? ORDER BY rowid`)
  .all(id)
  .map((row) => ({ ...row }));

/** Run `body` with console.error collected instead of printed; resolves with each error's arguments. */
async function errorsDuring(body: () => Promise<void>): Promise<unknown[][]> {
  const error = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    await body();
  } finally {
    console.error = error;
  }
  return errors;
}

/**
 * `promise`, unless `ms` pass first: then a failure naming what it waited for. A wait that never ends would otherwise
 * let the event loop drain, and the suite stop early with exit code 0, skipping the tests after it.
 */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Apply `body` to `id` while Nova refuses status writes: the catalog batch commits, and the apply answers 502. */
async function applyWithNovaDown(f: Fixture, id: string, body: CorrectionApplyBody): Promise<void> {
  const prepare = f.nova.prepare.bind(f.nova);
  f.nova.prepare = (sql: string) => {
    if (sql.includes('UPDATE vod_submissions')) throw new Error('Nova is unavailable');
    return prepare(sql);
  };
  try {
    await errorsDuring(async () => {
      const response = await applyTo(f, id, body);
      assert.equal(response.status, 502);
      assert.equal((await response.json() as { appliedToCatalog?: unknown }).appliedToCatalog, true);
    });
  } finally {
    f.nova.prepare = prepare;
  }
}

/**
 * Make Nova's status write commit and then reject, as a D1 call can; with `failReadsAfter`, every read of a submission
 * after that write fails too. Returns the function that puts Nova back.
 */
function landNovaWritesThenThrow(f: Fixture, failReadsAfter = false): () => void {
  const prepare = f.nova.prepare.bind(f.nova);
  let written = false;
  f.nova.prepare = (sql: string) => {
    if (failReadsAfter && written && sql.includes('FROM vod_submissions')) throw new Error('Nova read failed');
    const statement = prepare(sql);
    if (sql.includes('UPDATE vod_submissions')) {
      const run = statement.run.bind(statement);
      statement.run = async () => {
        await run();
        written = true;
        throw new Error('Nova connection lost');
      };
    }
    return statement;
  };
  return () => { f.nova.prepare = prepare; };
}

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
  assert.equal(view.base, null, 'vod-1 was stored with no base');
  assert.deepEqual(view.current[0], {
    performanceId: 'p1', songId: 'A', title: 'Song A', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200,
    status: 'approved', songStatus: 'approved', onSite: true, songPerformanceCount: 1,
  });
  assert.deepEqual(view.proposed, [{
    id: 'vs-1', title: 'Song A', originalArtist: 'Artist', timestamp: 101, endTimestamp: 200, endFilled: false, nextSubmittedId: null,
    existingSong: { id: 'A', status: 'approved' },
  }]);
  assert.deepEqual(view.match.pairs[0].changes, { start: true, end: false, title: false, artist: false });
  close(f);
}

/** Stores `json` as vod-1's base, the public list Nova compared it against. */
const setBase = (f: Fixture, json: string | null) =>
  f.nova.sqlite.prepare("UPDATE vod_submissions SET base_songs = ? WHERE id = 'vod-1'").run(json);

async function testCorrectionViewCarriesItsBase() {
  const f = fixture();
  try {
    setBase(f, JSON.stringify([
      { performance_id: 'p1', song_title: 'Song A', original_artist: 'Artist', start_timestamp: 100, end_timestamp: 200 },
    ]));
    const view = await correctionOf(f, 'vod-1');
    assert.deepEqual(view.base, [{ performanceId: 'p1', title: 'Song A', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200 }]);
    assert.equal('base_songs' in view.submission, false, 'the base comes once, read, and never as Nova stores it');

    setBase(f, '[]');
    assert.deepEqual((await correctionOf(f, 'vod-1')).base, [], 'a stream that showed nothing');
    for (const malformed of ['[{', '{"rows":[]}', JSON.stringify([{ performance_id: 'p1' }])]) {
      setBase(f, malformed);
      assert.equal((await correctionOf(f, 'vod-1')).base, null, `${malformed} reads as no base`);
    }
  } finally {
    close(f);
  }
}

async function testCorrectionViewCarriesBaseVerified() {
  // Nova keeps whether a base_revision confirmed the base (base_verified, 1 or 0) beside the base itself: a submission
  // sent with the revision the form loaded stores 1, one sent without stores 0, and both keep the public list as their
  // base. The review reports it as baseVerified, and the stored column never reaches the submission, as the base does not.
  const f = fixture();
  try {
    const base = JSON.stringify([
      { performance_id: 'p1', song_title: 'Song A', original_artist: 'Artist', start_timestamp: 100, end_timestamp: 200 },
    ]);
    const store = f.nova.sqlite.prepare('UPDATE vod_submissions SET base_songs = ?, base_verified = ? WHERE id = ?');
    store.run(base, 1, 'vod-1');
    store.run(base, 0, 'vod-2');

    const withRevision = await correctionOf(f, 'vod-1');
    const withoutRevision = await correctionOf(f, 'vod-2');
    assert.equal(withRevision.baseVerified, true, 'a revision confirmed this base');
    assert.equal(withoutRevision.baseVerified, false, 'no revision confirmed this one');
    assert.ok(withRevision.base !== null && withoutRevision.base !== null, 'both kept a base: the flag is the revision, not the base');
    for (const view of [withRevision, withoutRevision]) {
      assert.equal('base_verified' in view.submission, false, `${view.submission.id}: the flag comes once, as baseVerified, and never as Nova stores it`);
    }
  } finally {
    close(f);
  }
}

async function testAPreDeployRowReadsUnverified() {
  // A submission stored before Nova kept the confirmation took the column's DEFAULT: its insert names no base_verified.
  // It reads as unverified, with no base, and so does one that has a base recorded: the flag decides, not the base.
  const f = fixture();
  try {
    f.nova.sqlite.exec(`
      INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status,kind) VALUES
        ('vod-old','alice','video-pub','https://example.com/pub','pending','correction');
      INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
        ('vs-old','vod-old','Song A','Artist',101,200,0);
    `);
    const stored = f.nova.sqlite.prepare("SELECT base_verified FROM vod_submissions WHERE id = 'vod-old'").get();
    assert.equal(stored?.base_verified, 0, 'the column took its DEFAULT');

    const view = await correctionOf(f, 'vod-old');
    assert.equal(view.baseVerified, false, 'a row stored before the column reads as unverified');
    assert.equal(view.base, null, 'and has no base');

    f.nova.sqlite.prepare("UPDATE vod_submissions SET base_songs = '[]' WHERE id = 'vod-old'").run();
    const withBase = await correctionOf(f, 'vod-old');
    assert.deepEqual(withBase.base, [], 'a base is recorded');
    assert.equal(withBase.baseVerified, false, 'and still reads as unverified');
  } finally {
    close(f);
  }
}

async function testCurrentRowsSayWhetherTheSiteShowsThem() {
  const f = fixture();
  try {
    // A row is on the site when it and its song are approved: a pending song or a pending row keeps it off.
    f.db.sqlite.exec(`
      INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('H','alice','Song H','Artist','pending');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
        ('ph','alice','H','s-pub','2026-09-01','Pub','video-pub',300,400,'approved'),
        ('pq','alice','A','s-pub','2026-09-01','Pub','video-pub',500,600,'pending');
    `);
    const onSite = (view: NovaVodCorrectionView) => view.current.map((row) => [row.performanceId, row.onSite]);
    assert.deepEqual(onSite(await correctionOf(f, 'vod-1')), [['p1', true], ['ph', false], ['pq', false]]);
    // The fan export ignores the stream's status, and so does onSite.
    f.db.sqlite.exec("UPDATE streams SET status = 'pending' WHERE id = 's-pub'");
    assert.deepEqual(onSite(await correctionOf(f, 'vod-1')), [['p1', true], ['ph', false], ['pq', false]]);
  } finally {
    close(f);
  }
}

interface VectorRow { title: string; artist: string; start: number; end: number | null }

/** A fixture both workers' tests read (admin/tests/fixtures). */
const sharedVectors = <T>(file: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as T;

/**
 * A vector's rows as Nova's submit route stores them (tools/nova/src/index.ts, its parse loop). A row with a blank title
 * is dropped and every other one keeps its index as sort_order. A kept row whose end is the start of the dropped row
 * right below it (the end the parsers filled from that row) takes the next kept row's start instead, or none when no
 * kept row follows.
 */
function storedAsNovaStoresThem(rows: VectorRow[]): Array<VectorRow & { index: number }> {
  const stored: Array<VectorRow & { index: number }> = [];
  let refilled: (VectorRow & { index: number }) | null = null;
  for (const [index, row] of rows.entries()) {
    if (row.title.trim() === '') {
      const above = stored[stored.length - 1];
      if (above !== undefined && above.index === index - 1 && above.end === row.start) {
        above.end = null;
        refilled = above;
      }
      continue;
    }
    if (refilled !== null) {
      refilled.end = row.start;
      refilled = null;
    }
    stored.push({ ...row, index });
  }
  return stored;
}

async function testEndFilledIsReadInSubmittedOrder() {
  // The shared derived-end vectors, through the route: each submission stored as Nova's submit route stores it
  // (storedAsNovaStoresThem), and read back from the review. `derived` lists the stored rows: an end that is null, or
  // that the route marks filled (the next stored row's start).
  const vectors = sharedVectors<Array<{ name: string; rows: VectorRow[]; derived: boolean[] }>>('derived-end-vectors.json');
  assert.ok(vectors.length >= 6, 'the six cases the plan names, at least');
  const f = fixture();
  try {
    for (const [at, vector] of vectors.entries()) {
      const id = `vod-v${at}`;
      f.nova.sqlite.prepare(`INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status,kind)
        VALUES (?,'alice','video-pub','https://example.com/pub','pending','correction')`).run(id);
      const insert = f.nova.sqlite.prepare(`INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order)
        VALUES (?,?,?,?,?,?,?)`);
      const stored = storedAsNovaStoresThem(vector.rows).map((row) => ({ ...row, id: `${id}-${row.index}` }));
      for (const row of stored) insert.run(row.id, id, row.title.trim(), row.artist, row.start, row.end, row.index);

      const view = await correctionOf(f, id);
      const byId = new Map(view.proposed.map((row) => [row.id, row]));
      const inOrder = stored.map((row) => byId.get(row.id));
      assert.deepEqual(inOrder.map((row) => row?.endFilled === true || row?.endTimestamp === null), vector.derived, vector.name);
      assert.ok(inOrder.every((row) => !(row?.endFilled && row.endTimestamp === null)), `${vector.name}: a missing end is never filled`);
      assert.deepEqual(inOrder.map((row) => row?.nextSubmittedId), [...stored.slice(1).map((row) => row.id), null],
        `${vector.name}: each row names the next stored row`);
    }
  } finally {
    close(f);
  }
}

async function testUntouchedRowsPairById() {
  // Finding #2. Contributor Y loaded Song A 100–200 and Song B 300–400 and moved only Song B, to 310. Meanwhile the
  // curator applied X's fix to Song A: the review pairs Y's Song A, which repeats the base, with that performance by
  // its id, however far X moved it.
  const f = fixture();
  try {
    f.db.sqlite.exec(`
      INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('B','alice','Song B','Artist','approved');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
        ('p2','alice','B','s-pub','2026-09-01','Pub','video-pub',300,400,'approved');
    `);
    f.nova.sqlite.exec(`
      INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status,kind,base_songs) VALUES
        ('vod-y','alice','video-pub','https://example.com/pub','pending','correction',
         '[{"performance_id":"p1","song_title":"Song A","original_artist":"Artist","start_timestamp":100,"end_timestamp":200},
           {"performance_id":"p2","song_title":"Song B","original_artist":"Artist","start_timestamp":300,"end_timestamp":400}]');
      INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
        ('vs-ya','vod-y','Song A','Artist',100,200,0), ('vs-yb','vod-y','Song B','Artist',310,400,1);
    `);
    const pairedIds = (view: NovaVodCorrectionView) => view.match.pairs
      .map((pair) => [view.current[pair.currentIndex].performanceId, view.proposed[pair.proposedIndex].id])
      .sort(([left], [right]) => left.localeCompare(right));
    for (const [what, start, end] of [['a small move', 130, 200], ['a move past any overlap', 1000, 1100]] as const) {
      f.db.sqlite.prepare("UPDATE performances SET timestamp = ?, end_timestamp = ? WHERE id = 'p1'").run(start, end);
      const view = await correctionOf(f, 'vod-y');
      assert.deepEqual(pairedIds(view), [['p1', 'vs-ya'], ['p2', 'vs-yb']], `${what}: both by id, Song A untouched and Song B the base row it changed`);
      assert.deepEqual([view.match.unpairedCurrent, view.match.unpairedProposed], [[], []], `${what}: no add, no delete`);
    }
  } finally {
    close(f);
  }
}

async function testListRowsNeverCarryTheBase() {
  // NULL against '[]' tells a stream in the pipeline from none: no list query selects the base.
  const f = fixture();
  try {
    setBase(f, '[]');
    const rows = await listed(f);
    assert.equal(rows.size, 3);
    for (const [id, row] of rows) assert.equal('base_songs' in row, false, `${id} carries no base`);
  } finally {
    close(f);
  }
}

async function testListFlagsAnOpenApply() {
  // An apply that reached the catalog but not the submission (502) leaves the submission pending with an open record.
  // The list says so on its row, so that the row's 直接通過 can tell the curator the changes are in. Only a pending
  // submission has an apply to finish: the review carries none for another (testAReopenedReviewCarriesTheOpenApply).
  const f = fixture();
  try {
    const flags = async () => Object.fromEntries([...await listed(f)].map(([id, row]) => [id, row.open_apply]));
    assert.deepEqual(await flags(), { 'vod-1': false, 'vod-2': false, 'vod-3': false }, 'before any apply, no row has one');

    const view = await correctionOf(f, 'vod-1');
    await applyWithNovaDown(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
    assert.deepEqual(await flags(), { 'vod-1': true, 'vod-2': false, 'vod-3': false }, "the 502's submission has one, and no other row does");

    // One read of the apply records for the whole list, not one per row.
    const prepare = f.db.prepare.bind(f.db);
    const reads: string[] = [];
    f.db.prepare = (sql: string) => {
      if (sql.includes('vod_correction_applies')) reads.push(sql);
      return prepare(sql);
    };
    try {
      await listed(f);
    } finally {
      f.db.prepare = prepare;
    }
    assert.equal(reads.length, 1, 'the list reads the apply records once, however many rows it has');

    // The approval that recovers the apply closes its record, so the row has none left to finish.
    assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
    assert.deepEqual(await flags(), { 'vod-1': false, 'vod-2': false, 'vod-3': false }, 'once recovered, no row has one');
  } finally {
    close(f);
  }

  // A mark that landed but could not be confirmed (502) leaves its record open and the submission approved: no apply
  // is left to finish on that row.
  const g = fixture();
  try {
    const gView = await correctionOf(g, 'vod-1');
    const restore = landNovaWritesThenThrow(g, true);
    await errorsDuring(async () => {
      assert.equal((await applyTo(g, 'vod-1', { fingerprint: gView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 502);
    });
    restore();
    assert.deepEqual(appliesOf(g, 'vod-1').map((row) => row.announced), [0], 'its record is open');
    const row = (await listed(g)).get('vod-1');
    assert.deepEqual([row?.status, row?.open_apply], ['approved', false], 'but the submission is not pending, so its row carries none');
  } finally {
    close(g);
  }
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

async function testABlankArtistResolvesWithEachLiveArtist() {
  // Finding #12. 改連到新的歌 offers a row submitted with no artist under the artist of the live row it is paired
  // with, and the curator may pair it with any live row: so its title resolves with each artist the stream has too,
  // in the batch that resolves the submitted ones, approved first. A row that names an artist resolves for it alone.
  const f = fixture();
  try {
    f.db.sqlite.exec(`
      INSERT INTO songs (id,streamer_id,title,original_artist,status,created_at) VALUES
        ('Q','alice','Song Q','Artist Q','approved','2026-01-01 00:00:00'),
        ('A2','alice','Song A2','Artist','approved','2026-01-01 00:00:00'),
        ('X-Q','alice','Song X','Artist Q','pending','2026-01-01 00:00:00'),
        ('X-A-pending','alice','Song X','Artist','pending','2020-01-01 00:00:00'),
        ('X-A','alice','Song X','Artist','approved','2026-01-01 00:00:00');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
        ('pq','alice','Q','s-pub','2026-09-01','Pub','video-pub',300,400,'approved'),
        ('p3','alice','A2','s-pub','2026-09-01','Pub','video-pub',500,600,'approved');
    `);
    f.nova.sqlite.exec(`
      INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,status,kind) VALUES
        ('vod-x','alice','video-pub','https://example.com/pub','pending','correction');
      INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
        ('vs-xa','vod-x','Song A','Artist',100,200,0), ('vs-xq','vod-x','Song X','',300,400,1);
    `);
    const view = await correctionOf(f, 'vod-x');
    assert.deepEqual(view.current.map((row) => row.originalArtist), ['Artist', 'Artist Q', 'Artist'], 'two artists on the stream, one of them twice');
    const [named, blank] = view.proposed;
    assert.equal(blank.id, 'vs-xq');
    assert.equal(blank.existingSong, null, 'submitted as it is, Song X / Unknown resolves to no song');
    assert.deepEqual(blank.existingSongsByLiveArtist, [
      { originalArtist: 'Artist', existingSong: { id: 'X-A', status: 'approved' } },
      { originalArtist: 'Artist Q', existingSong: { id: 'X-Q', status: 'pending' } },
    ], 'one entry per artist the stream has, resolved as the apply resolves (approved first, then oldest)');
    assert.equal(named.id, 'vs-xa');
    assert.deepEqual(named.existingSong, { id: 'A', status: 'approved' });
    assert.equal('existingSongsByLiveArtist' in named, false, 'a row that names an artist resolves for it alone');
  } finally {
    close(f);
  }
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
  assert.deepEqual(f.posted, [], "approving an archived VOD's correction without applying announces nothing");

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

async function testApplyReadsTheStatusTheReviewShowed() {
  // A relink carries the status the review showed for the song it lands on (`expectedSongStatus`). The apply refuses it
  // as stale when the catalog has another by now, and a value that is no status as a malformed operation: neither
  // writes anything. One that matches goes through.
  const f = fixture();
  f.db.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','approved')");
  const view = await correctionOf(f, 'vod-1');
  const relink = (expectedSongStatus: unknown) => applyTo(f, 'vod-1', {
    fingerprint: view.fingerprint,
    operations: [{ op: 'relinkToSong', performanceId: 'p1', songId: 'D', expectedSongStatus }],
    skipped: NONE_SKIPPED,
  });
  const songOfP1 = () => f.db.sqlite.prepare("SELECT song_id FROM performances WHERE id = 'p1'").get()?.song_id;

  const stale = await relink('pending');
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'stale' });
  const malformed = await relink('archived');
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'Invalid operation 0' });
  assert.equal(f.db.batches.length, 0, 'neither writes to the catalog');
  assert.equal(songOfP1(), 'A', 'p1 stays on its song');
  assert.equal(vodRow(f, 'vod-1').status, 'pending');
  assert.deepEqual(f.posted, [], 'nothing is announced');

  const applied = await relink('approved');
  assert.equal(applied.status, 200);
  assert.equal(songOfP1(), 'D', "the status the review showed is the catalog's: the relink lands");
  assert.equal(vodRow(f, 'vod-1').status, 'approved');
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

async function testUnpublishingRelinkIs409() {
  const f = fixture();
  // s-pipe is still in the pipeline, yet pp, an approved row of approved A, is on the site: the export ignores
  // stream status. Relinking pp onto pending Q would take it off the site.
  f.db.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-pipe','alice','Pipe','2026-09-04','video-pipe','https://example.com/pipe','pending');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('Q','alice','Song Q','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('pp','alice','A','s-pipe','2026-09-04','Pipe','video-pipe',100,200,'approved');
  `);
  f.nova.sqlite.exec(`
    INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,stream_title,stream_date,status,kind) VALUES
      ('vod-p','alice','video-pipe','https://example.com/pipe','Pipe','2026-09-04','pending','new');
    INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
      ('vs-p','vod-p','Song Q','Artist',100,200,0);
  `);
  const view = await correctionOf(f, 'vod-p');
  const response = await applyTo(f, 'vod-p', {
    fingerprint: view.fingerprint,
    operations: [{ op: 'relinkToSong', performanceId: 'pp', songId: 'Q' }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'would_unpublish', performanceIds: ['pp'] });
  assert.equal(f.db.batches.length, 0, 'nothing is written to the catalog');
  assert.equal(vodRow(f, 'vod-p').status, 'pending');
  assert.deepEqual(f.posted, [], 'nothing is announced');
  close(f);
}

async function testApplyWouldPublishEndless() {
  const f = fixture();
  // Song P is pending, and its approved row on another public stream has no end: promoting P would put that row in the
  // VOD export, which stops for every streamer on a row with no end.
  f.db.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
      ('s-other','alice','Other','2026-09-02','video-other','https://example.com/other','approved');
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('P','alice','Song P','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('po','alice','P','s-other','2026-09-02','Other','video-other',100,NULL,'approved');
  `);
  const view = await correctionOf(f, 'vod-1');
  const response = await applyTo(f, 'vod-1', {
    fingerprint: view.fingerprint,
    operations: [{ op: 'relinkToSong', performanceId: 'p1', songId: 'P' }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'would_publish_endless',
    performances: [{ performanceId: 'po', streamId: 's-other', songId: 'P' }],
  });
  assert.equal(f.db.batches.length, 0, 'nothing is written to the catalog');
  assert.equal(vodRow(f, 'vod-1').status, 'pending');
  assert.deepEqual(f.posted, [], 'nothing is announced');
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
  // The failed status write is logged, which is how it reaches the worker's logs: collected here and checked, not
  // printed with its stack.
  let response!: Response;
  const errors = await errorsDuring(async () => {
    response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  });
  assert.equal(errors.length, 1, 'the failed status write is logged once');
  assert.equal(errors[0]![0], 'VOD correction applied, but marking its submission reviewed failed');
  assert.equal((errors[0]![1] as Error).message, 'Nova is unavailable', 'with the error the write threw');
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

async function test502RecoveryWritesTheRecordedNoteAndAnnounces() {
  // The apply committed its catalog batch, but vod-1 could not be marked reviewed. The list's 直接通過（不套用） sends no
  // note: the recovery writes the note the apply would have written, and posts the announcement it would have posted.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const body: CorrectionApplyBody = {
    fingerprint: view.fingerprint, reviewerNote: '  secret thanks  ', operations: [SHIFT_P1], skipped: NONE_SKIPPED,
  };
  await applyWithNovaDown(f, 'vod-1', body);
  assert.equal(f.posted.length, 0, 'the apply announced nothing');

  const response = await setStatus(f, 'vod-1', { status: 'approved', without_applying: true });
  assert.equal(response.status, 200);
  const summary = '套用 1 項（時間 1）';
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: `secret thanks\n${summary}` }, "the apply's note, not the request's");
  assert.equal((await response.json() as NovaVodSubmission).reviewer_note, `secret thanks\n${summary}`, 'and the answer shows it');

  // The same apply on a Nova that took the write: its announcement is the one the recovery posts.
  const direct = fixture();
  const directView = await correctionOf(direct, 'vod-1');
  assert.equal((await applyTo(direct, 'vod-1', { ...body, fingerprint: directView.fingerprint })).status, 200);
  assert.equal(direct.posted.length, 1);
  assert.deepEqual(f.posted, direct.posted, 'one announcement, the one the apply would have posted');
  assert.deepEqual(f.posted[0].fields, [{ name: '變更', value: summary }]);
  assert.ok(!JSON.stringify(f.posted).includes('secret'), 'the free-text note is never posted');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1], 'the record is marked announced');
  close(f);
  close(direct);
}

async function testAReopenedReviewCarriesTheOpenApply() {
  // An apply reached the catalog but not the submission (502). A review opened after it, a reload or another curator's,
  // carries that apply's summary, and only its summary, so the page offers only the approval that recovers it. Once
  // recovered, the record is closed and the review carries none. The list never carries the summary: only the flag that
  // an apply is open (open_apply, testListFlagsAnOpenApply).
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  assert.equal(view.openApply, null, 'a review with no apply before it carries none');
  await applyWithNovaDown(f, 'vod-1', {
    fingerprint: view.fingerprint, reviewerNote: 'secret thanks', operations: [SHIFT_P1], skipped: NONE_SKIPPED,
  });
  const reopened = await correctionOf(f, 'vod-1');
  assert.deepEqual(reopened.openApply, { summary: '套用 1 項（時間 1）' }, 'the reopened review carries the summary of the apply');
  assert.ok(!JSON.stringify(reopened).includes('secret'), "never the apply's note");
  assert.equal('openApply' in (await listed(f)).get('vod-1')!, false, 'and the list carries no summary of it');

  assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
  assert.equal((await correctionOf(f, 'vod-1')).openApply, null, 'once recovered, the review carries none');
  close(f);

  // Only while the submission is pending: an apply whose mark landed but could not be confirmed (502) leaves its record
  // open and the submission approved, and that review, read-only, carries none.
  const g = fixture();
  const gView = await correctionOf(g, 'vod-1');
  const restore = landNovaWritesThenThrow(g, true);
  await errorsDuring(async () => {
    assert.equal((await applyTo(g, 'vod-1', { fingerprint: gView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 502);
  });
  restore();
  assert.deepEqual(appliesOf(g, 'vod-1').map((row) => row.announced), [0], 'the record is open');
  assert.equal(vodRow(g, 'vod-1').status, 'approved');
  assert.equal((await correctionOf(g, 'vod-1')).openApply, null, 'but the submission is not pending, so the review carries none');
  close(g);
}

async function testASecondApplyAfterALandedApplyIsRefused() {
  // Apply 1 reached the catalog but not the submission (502). A second apply, from a reopened review or another
  // curator's, would apply again on top of what is live: it is refused right after the status check, before its body
  // is read, and writes nothing. Only the approval that recovers apply 1 may follow: it writes apply 1's note and
  // announces it, once.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  await applyWithNovaDown(f, 'vod-1', { fingerprint: view.fingerprint, reviewerNote: 'note 1', operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  const reopened = await correctionOf(f, 'vod-1');
  const before = vodRow(f, 'vod-1');
  const batches = f.db.batches.length;
  const second = await applyTo(f, 'vod-1', {
    fingerprint: reopened.fingerprint,
    reviewerNote: 'note 2',
    operations: [{ op: 'setTimes', performanceId: 'p1', timestamp: 102 }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: 'already_applied', appliedToCatalog: true });
  assert.deepEqual(timesOf(f, 'p1'), { timestamp: 101, end_timestamp: 200 }, "the catalog keeps apply 1's changes");
  assert.equal(f.db.batches.length, batches, 'no batch is sent');
  assert.equal(appliesOf(f, 'vod-1').length, 1, 'no record is written');
  assert.deepEqual(vodRow(f, 'vod-1'), before, 'Nova is untouched');
  assert.equal(f.posted.length, 0, 'and nothing is posted');
  const unread = await applyTo(f, 'vod-1', { fingerprint: reopened.fingerprint, operations: [], skipped: NONE_SKIPPED });
  assert.deepEqual([unread.status, await unread.json()], [409, { error: 'already_applied', appliedToCatalog: true }], 'before the body is read');

  assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'note 1\n套用 1 項（時間 1）' }, "the recovery writes apply 1's note");
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'and announces it, once');
  close(f);
}

async function testRecoveryAnnouncesOnlyOnce() {
  // Once the recovery has announced the apply, its record is spent: after a Revert, a second approval without applying
  // is a plain re-approval of an archived VOD's correction, which announces nothing and writes the request's note.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  await applyWithNovaDown(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true })).status, 200);
  assert.equal(f.posted.length, 1, 'the recovery announces the apply');

  assert.equal((await setStatus(f, 'vod-1', { status: 'pending' })).status, 200, 'Revert');
  const again = await setStatus(f, 'vod-1', { status: 'approved', reviewer_note: 'R', without_applying: true });
  assert.equal(again.status, 200);
  assert.equal(f.posted.length, 1, 'the second recovery posts nothing');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'R' }, "and writes the request's note");
  assert.equal(appliesOf(f, 'vod-1').length, 1, 'an approval writes no record');
  close(f);
}

async function testReapplyAfterRevertIsAllowed() {
  // The record log is append-only: a correction reverted and applied again records and announces its second apply too.
  const f = fixture();
  const first = await correctionOf(f, 'vod-1');
  assert.equal((await applyTo(f, 'vod-1', { fingerprint: first.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 200);
  assert.equal((await setStatus(f, 'vod-1', { status: 'pending' })).status, 200, 'Revert');

  const second = await correctionOf(f, 'vod-1');
  const response = await applyTo(f, 'vod-1', {
    fingerprint: second.fingerprint,
    reviewerNote: 'again',
    operations: [{ op: 'setTimes', performanceId: 'p1', timestamp: 102 }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(response.status, 200);
  const summary = '套用 1 項（時間 1）';
  assert.equal(timesOf(f, 'p1').timestamp, 102, 'the second apply landed');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: `again\n${summary}` });
  assert.equal(f.posted.length, 2, 'each apply is announced');
  assert.deepEqual(appliesOf(f, 'vod-1'), [
    { reviewer_note: summary, summary, actor: CURATOR, announced: 1 },
    { reviewer_note: `again\n${summary}`, summary, actor: CURATOR, announced: 1 },
  ]);
  close(f);
}

/** Make every claim of the catalog's open apply records fail. */
function failClaims(f: Fixture): void {
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = (sql: string) => {
    if (sql.includes('UPDATE vod_correction_applies')) throw new Error('D1 is unavailable');
    return prepare(sql);
  };
}

async function testClaimThatThrowsStillPosts() {
  // A claim that fails only risks a duplicate announcement later, never a lost one: whatever posts the embed logs the
  // failure and posts it anyway, and the record stays open.
  // The apply, which still answers 200.
  const applied = fixture();
  const view = await correctionOf(applied, 'vod-1');
  failClaims(applied);
  const applyErrors = await errorsDuring(async () => {
    const response = await applyTo(applied, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
    assert.equal(response.status, 200);
  });
  assert.equal(applyErrors.length, 1, 'the failed claim is logged');
  assert.equal(vodRow(applied, 'vod-1').status, 'approved');
  assert.deepEqual(applied.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'the apply is announced');
  assert.deepEqual(appliesOf(applied, 'vod-1').map((row) => row.announced), [0], 'its record is still open');
  close(applied);

  // The recovery of an apply that answered 502.
  const recovered = fixture();
  const recoveredView = await correctionOf(recovered, 'vod-1');
  await applyWithNovaDown(recovered, 'vod-1', { fingerprint: recoveredView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  failClaims(recovered);
  const recoveryErrors = await errorsDuring(async () => {
    assert.equal((await setStatus(recovered, 'vod-1', { status: 'approved', without_applying: true })).status, 200);
  });
  assert.equal(recoveryErrors.length, 1, 'the failed claim is logged');
  assert.deepEqual(recovered.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'the recovery still announces');
  close(recovered);

  // A rejection.
  const rejected = fixture();
  failClaims(rejected);
  const rejectionErrors = await errorsDuring(async () => {
    assert.equal((await setStatus(rejected, 'vod-1', { status: 'rejected', reviewer_note: 'R' })).status, 200);
  });
  assert.equal(rejectionErrors.length, 1, 'the failed claim is logged');
  assert.deepEqual(rejected.posted.map((embed) => embed.title), ['❌ VOD 修正未採用'], 'the rejection is still posted');
  close(rejected);
}

async function testRevertClosesOpenApplies() {
  // An apply landed and was announced, but closing its record failed (logged; the embed is posted anyway), so the record
  // stayed open on an approved submission. A Revert puts the submission back in review and closes it: the reopened
  // review carries no open apply, and a re-apply goes through and is announced, where the open record would refuse it.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const prepare = f.db.prepare.bind(f.db);
  failClaims(f);
  await errorsDuring(async () => {
    assert.equal((await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 200);
  });
  f.db.prepare = prepare;
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [0], 'the record stayed open');

  assert.equal((await setStatus(f, 'vod-1', { status: 'pending', expected_status: 'approved' })).status, 200, 'Revert');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1], 'the Revert closes it');
  const reopened = await correctionOf(f, 'vod-1');
  assert.equal(reopened.openApply, null, 'the reopened review carries no open apply');
  const again = await applyTo(f, 'vod-1', {
    fingerprint: reopened.fingerprint,
    operations: [{ op: 'setTimes', performanceId: 'p1', timestamp: 102 }],
    skipped: NONE_SKIPPED,
  });
  assert.equal(again.status, 200, 'and the re-apply goes through');
  assert.equal(timesOf(f, 'p1').timestamp, 102);
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用', '✅ VOD 修正已套用'], 'each apply is announced once');
  close(f);

  // Only a Revert closes them: a write of pending on a submission that is pending already is none. After an apply that
  // answered 502, its record stays open, and a rejection is still refused.
  const g = fixture();
  const gView = await correctionOf(g, 'vod-1');
  await applyWithNovaDown(g, 'vod-1', { fingerprint: gView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal((await setStatus(g, 'vod-1', { status: 'pending' })).status, 200);
  assert.deepEqual(appliesOf(g, 'vod-1').map((row) => row.announced), [0], 'the record stays open');
  assert.equal((await setStatus(g, 'vod-1', { status: 'rejected', reviewer_note: 'R' })).status, 409, 'and a rejection is still refused');
  close(g);

  // A Revert whose close fails is logged, and stands.
  const h = fixture();
  const hView = await correctionOf(h, 'vod-1');
  failClaims(h);
  await errorsDuring(async () => {
    assert.equal((await applyTo(h, 'vod-1', { fingerprint: hView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 200);
  });
  const errors = await errorsDuring(async () => {
    assert.equal((await setStatus(h, 'vod-1', { status: 'pending', expected_status: 'approved' })).status, 200, 'the Revert');
  });
  assert.equal(errors.length, 1, 'the failed close is logged');
  assert.match(String(errors[0]?.[0]), /apply record/, 'saying what could not be closed');
  assert.equal(vodRow(h, 'vod-1').status, 'pending', 'and the Revert stands');
  close(h);
}

async function testAnnouncementSupersedesOlderApplies() {
  // The page can't reach this setup, so this pins the worker's contract. Two open records of one submission need a
  // second batch to commit while the first's record is open: the already_applied check and the batch's target guard
  // rule that out for every batch that moves the rows, as each of the page's does, but not for a same-start setTimes.
  // Apply B passes its checks. Just before its batch, apply A, a same-start setTimes, answers 502 with its record open.
  // B's batch then commits, B is marked reviewed and announced, and its announcement claims every open record, A's
  // included: A is superseded. A later Revert and 直接通過（不套用） find nothing to recover: no embed, and A's note is
  // never written back.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  f.db.beforeBatch = async () => {
    f.db.beforeBatch = undefined;
    await applyWithNovaDown(f, 'vod-1', { fingerprint: view.fingerprint, reviewerNote: 'note A', operations: [SAME_START_P1], skipped: NONE_SKIPPED });
  };
  const applied = await applyTo(f, 'vod-1', {
    fingerprint: view.fingerprint,
    reviewerNote: 'note B',
    operations: [{ op: 'setTimes', performanceId: 'p1', timestamp: 102 }],
    skipped: { time: 0, title: 1, add: 0, delete: 0 },
  });
  assert.equal(applied.status, 200, 'B lands');
  const summaryB = '套用 1 項（時間 1）；略過 1 項（歌名 1）';
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: `note B\n${summaryB}` });
  assert.deepEqual(f.posted.map((embed) => embed.fields), [[{ name: '變更', value: summaryB }]], "B's announcement, once");
  assert.deepEqual(
    appliesOf(f, 'vod-1').map((row) => [row.reviewer_note, row.announced]),
    [['note A\n套用 1 項（時間 1）', 1], [`note B\n${summaryB}`, 1]],
    "B's announcement closes A's record too",
  );

  assert.equal((await setStatus(f, 'vod-1', { status: 'pending' })).status, 200, 'Revert');
  assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true })).status, 200);
  assert.equal(f.posted.length, 1, 'nothing more is announced');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: '' }, "A's note is not written back");
  close(f);
}

async function testNovaWriteThatLandedIsASuccess() {
  // D1 can commit a write and still reject the call. Marking vod-1 reviewed landed although its call threw: read back
  // approved with exactly this apply's note, it is a success, answered and announced like any other apply.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const restore = landNovaWritesThenThrow(f);
  const summary = '套用 1 項（時間 1）';
  const errors = await errorsDuring(async () => {
    const response = await applyTo(f, 'vod-1', {
      fingerprint: view.fingerprint, reviewerNote: 'thanks', operations: [SHIFT_P1], skipped: NONE_SKIPPED,
    });
    assert.equal(response.status, 200);
    const result = await response.json() as CorrectionApplyResult;
    assert.equal(result.summary, summary);
    assert.deepEqual([result.submission.status, result.submission.reviewer_note], ['approved', `thanks\n${summary}`]);
  });
  restore();
  assert.equal(errors.length, 1, 'the rejected call is logged');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: `thanks\n${summary}` });
  assert.equal(f.posted.length, 1, 'the apply is announced');
  assert.deepEqual(f.posted[0].fields, [{ name: '變更', value: summary }]);
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1], 'and its record is marked');
  close(f);
}

async function testUnconfirmedNovaWriteIs502() {
  // The write landed, but the read-back fails too, so the apply cannot tell: it answers the 502 and announces nothing.
  // The recovery the page then offers sends the pending it was shown, while Nova says approved, so it is refused and
  // the apply stays unannounced (an accepted residual). A Revert then closes its record, so nothing announces it later.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const restore = landNovaWritesThenThrow(f, true);
  await errorsDuring(async () => {
    const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Catalog updated but the submission could not be marked reviewed', appliedToCatalog: true,
    });
  });
  restore();
  assert.equal(vodRow(f, 'vod-1').status, 'approved', 'the write had landed');
  assert.equal(f.posted.length, 0, 'nothing is announced');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [0], 'the record waits for the recovery');

  const recovery = await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' });
  assert.equal(recovery.status, 409);
  assert.deepEqual(await recovery.json(), { error: 'status_changed', status: 'approved' });
  assert.equal(f.posted.length, 0, "the page's recovery announces nothing");
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [0], 'and the record stays open');

  assert.equal((await setStatus(f, 'vod-1', { status: 'pending', expected_status: 'approved' })).status, 200, 'Revert');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1], 'the Revert closes the record');
  // At the Revert this record can't be told apart from one whose claim failed after its embed was posted; closing it
  // trades a missing late announcement on a doubly rare path for a guard that never blocks a re-apply after a Revert.
  assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
  assert.deepEqual(f.posted, [], 'so the approval after it announces nothing');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: '' }, "and writes no note of the apply's");
  close(f);
}

async function testNovaRowApprovedWithAnotherNoteIs502() {
  // The write failed, and the row reads approved, but with a note this apply never wrote: that approval is not this
  // apply's, so the apply answers the 502 and announces nothing.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const prepare = f.nova.prepare.bind(f.nova);
  f.nova.prepare = (sql: string) => {
    if (sql.includes('UPDATE vod_submissions')) {
      f.nova.sqlite.exec("UPDATE vod_submissions SET status = 'approved', reviewer_note = 'another review' WHERE id = 'vod-1'");
      throw new Error('Nova is unavailable');
    }
    return prepare(sql);
  };
  await errorsDuring(async () => {
    const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
    assert.equal(response.status, 502);
  });
  f.nova.prepare = prepare;
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'another review' });
  assert.equal(f.posted.length, 0, 'nothing is announced');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [0], 'the record waits for the recovery');
  close(f);
}

async function testARejectAfterALandedApplyIsRefused() {
  // Apply A answered 502: its changes are live and its record is open. A rejection, from a reopened review, another
  // curator or the list, would tell the contributor 未採用 while they are, and its embed would close A's record, leaving
  // nothing to recover it. It is refused, with or without the status it saw: it writes and posts nothing, and the record
  // stays open. 直接通過（不套用） then recovers A: it writes A's note and posts 已套用, once.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  await applyWithNovaDown(f, 'vod-1', { fingerprint: view.fingerprint, reviewerNote: 'note A', operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  const before = vodRow(f, 'vod-1');
  for (const body of [
    { status: 'rejected', reviewer_note: 'wrong', expected_status: 'pending' },
    { status: 'rejected', reviewer_note: 'wrong' },
  ]) {
    const response = await setStatus(f, 'vod-1', body);
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: 'already_applied', appliedToCatalog: true }, JSON.stringify(body));
  }
  assert.deepEqual(vodRow(f, 'vod-1'), before, 'Nova is untouched');
  assert.equal(f.posted.length, 0, 'no 未採用 is posted');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [0], 'and the record is still open');

  assert.equal((await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'note A\n套用 1 項（時間 1）' }, "the recovery writes A's note");
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'and posts 已套用, once');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1]);

  // Recovered, the apply's record is closed, so it refuses nothing more: after a Revert, a rejection goes through and
  // tells the contributor 未採用.
  assert.equal((await setStatus(f, 'vod-1', { status: 'pending', expected_status: 'approved' })).status, 200, 'the Revert');
  const rejected = await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'wrong after all', expected_status: 'pending' });
  assert.equal(rejected.status, 200, 'the rejection after the Revert');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'rejected', reviewer_note: 'wrong after all' });
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用', '❌ VOD 修正未採用'], 'and 未採用 is posted');
  close(f);
}

async function testRecoveryRacingAnApplyAnnouncesOnce() {
  // An approval without applying lands between the apply's batch commit and its Nova write: it finds the record, writes
  // the note and announces. The apply's own announcement then finds the record already claimed and posts nothing, so the
  // correction is announced exactly once.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  let recovery: Response | undefined;
  f.db.afterBatch = async () => {
    f.db.afterBatch = undefined;
    recovery = await setStatus(f, 'vod-1', { status: 'approved', without_applying: true });
  };
  const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, reviewerNote: 'thanks', operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(recovery?.status, 200, 'the recovery went through');
  assert.equal(response.status, 200, 'and so did the apply');
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'one announcement');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'thanks\n套用 1 項（時間 1）' });
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1]);
  close(f);
}

async function testStaleRejectAfterApplyIs409() {
  // Tab 1 applied vod-1; tab 2 still shows it pending and rejects it. The rejection carries the status tab 2 saw, so it
  // changes nothing: the correction stays approved with its summary, and no 未採用 is posted.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  assert.equal((await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 200);
  const response = await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R', expected_status: 'pending' });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'status_changed', status: 'approved' });
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: '套用 1 項（時間 1）' }, 'Nova still says approved, with the summary');
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'and only the apply was announced');
  close(f);
}

async function testStaleWithoutApplyingIs409() {
  // Tab 1 rejected vod-1; tab 2 still shows it pending and approves it without applying. The status tab 2 saw is checked
  // first: nothing of the catalog is read (no stream check, no apply record), written, imported or posted.
  const f = fixture();
  assert.equal((await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R' })).status, 200);
  const prepare = f.db.prepare.bind(f.db);
  const prepared: string[] = [];
  f.db.prepare = (sql: string) => {
    prepared.push(sql);
    return prepare(sql);
  };
  const response = await setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' });
  f.db.prepare = prepare;
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'status_changed', status: 'rejected' });
  assert.deepEqual(prepared, [], 'the catalog is not asked anything');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'rejected', reviewer_note: 'R' }, 'the rejection stands');
  assert.deepEqual(f.posted.map((embed) => embed.title), ['❌ VOD 修正未採用'], 'and nothing more is posted');
  assert.equal(f.db.batches.length, 0, 'nothing is imported');

  // It comes before the approval's own refusals too: a stale Approve of a VOD whose video has a stream is stale first.
  const approve = await setStatus(f, 'vod-1', { status: 'approved', expected_status: 'pending' });
  assert.equal(approve.status, 409);
  assert.deepEqual(await approve.json(), { error: 'status_changed', status: 'rejected' });
  close(f);
}

async function testRevertStillWorks() {
  // The status the caller saw is not "pending only": a Revert of an approval or of a rejection, and the approval without
  // applying that re-approves after it, carry the status Nova has, and go through.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  assert.equal((await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED })).status, 200);
  assert.equal((await setStatus(f, 'vod-1', { status: 'pending', expected_status: 'approved' })).status, 200, 'Revert of an approval');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'pending', reviewer_note: null });
  const again = await setStatus(f, 'vod-1', { status: 'approved', reviewer_note: 'R', without_applying: true, expected_status: 'pending' });
  assert.equal(again.status, 200, 'the re-approval');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'R' });
  assert.equal((await setStatus(f, 'vod-2', { status: 'rejected', reviewer_note: 'R2', expected_status: 'pending' })).status, 200, 'a rejection');
  assert.equal((await setStatus(f, 'vod-2', { status: 'pending', expected_status: 'rejected' })).status, 200, 'Revert of a rejection');
  assert.equal(vodRow(f, 'vod-2').status, 'pending');
  assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用', '❌ VOD 修正未採用'], 'the apply and the rejection');

  // A Revert that saw another status is refused like any other change, and the field must name a status.
  const stale = await setStatus(f, 'vod-1', { status: 'pending', expected_status: 'rejected' });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'status_changed', status: 'approved' });
  const invalid = await setStatus(f, 'vod-1', { status: 'pending', expected_status: 'archived' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Invalid expected_status: must be one of pending, approved, rejected' });
  assert.equal(vodRow(f, 'vod-1').status, 'approved', 'neither wrote anything');
  close(f);
}

async function testReviewDuringApplyIsNotOverwritten() {
  // Another review lands while the apply runs, after its checks. The apply marks the submission reviewed only while it
  // is still pending, so that review stands: the apply answers 409 status_changed, saying the catalog has its changes,
  // and posts nothing. The submission has its outcome, that review's, so the apply closes its own record (that one
  // only), which may never announce after it.
  // A rejection from another tab, which still saw it pending, sent just before the batch: no apply record exists yet,
  // so it goes through, and its 未採用 is the one announcement.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  let rejection: Response | undefined;
  f.db.beforeBatch = async () => {
    f.db.beforeBatch = undefined;
    rejection = await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'wrong', expected_status: 'pending' });
  };
  const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, reviewerNote: 'thanks', operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(rejection?.status, 200, 'the rejection went through');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'status_changed', status: 'rejected', appliedToCatalog: true });
  assert.equal(timesOf(f, 'p1').timestamp, 101, 'the catalog batch had committed');
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'rejected', reviewer_note: 'wrong' }, 'the rejection stands');
  assert.deepEqual(f.posted.map((embed) => embed.title), ['❌ VOD 修正未採用'], 'only the rejection is announced');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1], 'and the apply closed its record');
  close(f);

  // The same rejection sent once the batch has committed meets the apply's open record: it is refused (409
  // already_applied), so no 未採用 is posted while the changes are live, and the apply marks the submission reviewed
  // and announces it.
  const h = fixture();
  const hView = await correctionOf(h, 'vod-1');
  let refused: Response | undefined;
  h.db.afterBatch = async () => {
    h.db.afterBatch = undefined;
    refused = await setStatus(h, 'vod-1', { status: 'rejected', reviewer_note: 'wrong', expected_status: 'pending' });
  };
  const applied = await applyTo(h, 'vod-1', { fingerprint: hView.fingerprint, reviewerNote: 'thanks', operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(refused?.status, 409, 'the rejection is refused');
  assert.deepEqual(await refused?.json(), { error: 'already_applied', appliedToCatalog: true });
  assert.equal(applied.status, 200, 'and the apply lands');
  assert.deepEqual(vodRow(h, 'vod-1'), { status: 'approved', reviewer_note: 'thanks\n套用 1 項（時間 1）' });
  assert.deepEqual(h.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'only the apply is announced');
  assert.deepEqual(appliesOf(h, 'vod-1').map((row) => row.announced), [1]);
  close(h);

  // An approval without applying, sent just before the batch, with a note of its own: it found no apply to recover and
  // announced nothing, so the apply's own 409 closes its record. A Revert and an approval without applying with a typed
  // note then announce nothing, and write the typed note.
  const g = fixture();
  const gView = await correctionOf(g, 'vod-1');
  let approval: Response | undefined;
  g.db.beforeBatch = async () => {
    g.db.beforeBatch = undefined;
    approval = await setStatus(g, 'vod-1', { status: 'approved', reviewer_note: 'R', without_applying: true, expected_status: 'pending' });
  };
  const other = await applyTo(g, 'vod-1', { fingerprint: gView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  assert.equal(approval?.status, 200, 'the approval went through');
  assert.equal(other.status, 409);
  assert.deepEqual(await other.json(), { error: 'status_changed', status: 'approved', appliedToCatalog: true });
  assert.equal(timesOf(g, 'p1').timestamp, 101, 'the catalog batch committed');
  assert.deepEqual(vodRow(g, 'vod-1'), { status: 'approved', reviewer_note: 'R' }, "the approval's note stays");
  assert.deepEqual(g.posted, [], 'and nothing is posted');
  assert.deepEqual(appliesOf(g, 'vod-1').map((row) => row.announced), [1], "the apply's record is closed");
  assert.equal((await setStatus(g, 'vod-1', { status: 'pending', expected_status: 'approved' })).status, 200, 'Revert');
  const typed = await setStatus(g, 'vod-1', { status: 'approved', reviewer_note: 'typed', without_applying: true, expected_status: 'pending' });
  assert.equal(typed.status, 200);
  assert.deepEqual(g.posted, [], 'no 已套用 is posted');
  assert.deepEqual(vodRow(g, 'vod-1'), { status: 'approved', reviewer_note: 'typed' }, 'and Nova gets the typed note');
  close(g);
}

async function testClosingTheApplyRecordAfterAnotherReviewMayFail() {
  // The apply met another review, and closing its record fails: that is logged, and the apply still answers the 409 and
  // posts nothing. The record stays open.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  let approval: Response | undefined;
  f.db.beforeBatch = async () => {
    f.db.beforeBatch = undefined;
    approval = await setStatus(f, 'vod-1', { status: 'approved', reviewer_note: 'R', without_applying: true, expected_status: 'pending' });
    failClaims(f);
  };
  const errors = await errorsDuring(async () => {
    const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'status_changed', status: 'approved', appliedToCatalog: true });
  });
  assert.equal(approval?.status, 200, 'the approval went through');
  assert.equal(errors.length, 1, 'the failed claim is logged');
  assert.match(String(errors[0]?.[0]), /apply record/, 'saying what could not be closed');
  assert.deepEqual(f.posted, [], 'nothing is posted');
  assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [0], 'and the record stays open');
  close(f);
}

/**
 * Land another review of `id` (its status and note) just before the next status write to Nova is prepared: in the
 * window between a request's check of the status and its write. Once only.
 */
function landReviewBeforeTheWrite(f: Fixture, id: string, status: string, note: string): () => void {
  const prepare = f.nova.prepare.bind(f.nova);
  f.nova.prepare = (sql: string) => {
    if (sql.includes('UPDATE vod_submissions')) {
      f.nova.prepare = prepare;
      f.nova.sqlite.prepare('UPDATE vod_submissions SET status = ?, reviewer_note = ? WHERE id = ?').run(status, note, id);
    }
    return prepare(sql);
  };
  return () => { f.nova.prepare = prepare; };
}

async function testReviewBetweenCheckAndWriteIs409() {
  // A status change that carries the status it saw passes the check, and another review lands before its write. The
  // write is a compare-and-set on that status, so it changes nothing: the request answers 409 status_changed with the
  // status the other review left, and imports, posts and closes nothing. The other review's status and note survive.
  // A rejection. (One sent while an apply that answered 502 waits for its recovery is refused before it gets this far,
  // 409 already_applied, which leaves that apply's record open: testARejectAfterALandedApplyIsRefused.)
  const f = fixture();
  let restore = landReviewBeforeTheWrite(f, 'vod-1', 'approved', 'other review');
  const rejection = await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R', expected_status: 'pending' });
  restore();
  assert.equal(rejection.status, 409);
  assert.deepEqual(await rejection.json(), { error: 'status_changed', status: 'approved' });
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: 'other review' }, "the other review's status and note survive");
  assert.deepEqual(f.posted, [], 'nothing is posted');
  close(f);

  // That recovery itself: it read the open apply, but its write found the other review, so it announces nothing.
  const g = fixture();
  const gView = await correctionOf(g, 'vod-1');
  await applyWithNovaDown(g, 'vod-1', { fingerprint: gView.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
  restore = landReviewBeforeTheWrite(g, 'vod-1', 'rejected', 'wrong');
  const recovery = await setStatus(g, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' });
  restore();
  assert.equal(recovery.status, 409);
  assert.deepEqual(await recovery.json(), { error: 'status_changed', status: 'rejected' });
  assert.deepEqual(vodRow(g, 'vod-1'), { status: 'rejected', reviewer_note: 'wrong' }, "the apply's note is not written");
  assert.deepEqual(g.posted, [], 'nothing is announced');
  assert.deepEqual(appliesOf(g, 'vod-1').map((row) => row.announced), [0], 'and the apply stays open');
  close(g);

  // An approval of a VOD whose video has no stream, which would import it: nothing is imported.
  const h = fixture();
  const streams = count(h.db, 'streams');
  restore = landReviewBeforeTheWrite(h, 'vod-3', 'rejected', 'wrong');
  const approval = await setStatus(h, 'vod-3', { status: 'approved', expected_status: 'pending' });
  restore();
  assert.equal(approval.status, 409);
  assert.deepEqual(await approval.json(), { error: 'status_changed', status: 'rejected' });
  assert.deepEqual(vodRow(h, 'vod-3'), { status: 'rejected', reviewer_note: 'wrong' });
  assert.equal(count(h.db, 'streams'), streams, 'no stream is imported');
  assert.equal(h.db.batches.length, 0, 'nothing is written to the catalog');
  assert.deepEqual(h.posted, [], 'and nothing is posted');
  close(h);

  // A request that names no status is written as it always was: the field is optional, and only it guards the write.
  const k = fixture();
  restore = landReviewBeforeTheWrite(k, 'vod-2', 'approved', 'other review');
  const plain = await setStatus(k, 'vod-2', { status: 'rejected', reviewer_note: 'R' });
  restore();
  assert.equal(plain.status, 200);
  assert.deepEqual(vodRow(k, 'vod-2'), { status: 'rejected', reviewer_note: 'R' }, 'over the other review');
  close(k);
}

async function testUnreadableRowAfterAMissIs502() {
  // The mark changed nothing, so another review is there, but the row cannot be read back to say whose: the apply
  // cannot tell, so it is the 502, and the other review is still not overwritten.
  const f = fixture();
  const view = await correctionOf(f, 'vod-1');
  const prepare = f.nova.prepare.bind(f.nova);
  f.db.afterBatch = async () => {
    f.db.afterBatch = undefined;
    f.nova.sqlite.exec("UPDATE vod_submissions SET status = 'rejected', reviewer_note = 'wrong' WHERE id = 'vod-1'");
    f.nova.prepare = (sql: string) => {
      if (sql.startsWith('SELECT') && sql.includes('FROM vod_submissions')) throw new Error('Nova read failed');
      return prepare(sql);
    };
  };
  await errorsDuring(async () => {
    const response = await applyTo(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SHIFT_P1], skipped: NONE_SKIPPED });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Catalog updated but the submission could not be marked reviewed', appliedToCatalog: true,
    });
  });
  f.nova.prepare = prepare;
  assert.deepEqual(vodRow(f, 'vod-1'), { status: 'rejected', reviewer_note: 'wrong' }, 'the other review stands');
  assert.deepEqual(f.posted, [], 'nothing is announced');
  close(f);
}

/** How many streams vod-3's video has in the catalog. */
const streamsOfVod3 = (f: Fixture) => Number(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM streams WHERE video_id = 'video-new'").get()!.n);

/** Approve vod-3 with `body` while its import's batch fails; resolves with the status the approval answered. */
async function approveWithTheImportFailing(f: Fixture, body: unknown): Promise<number> {
  f.db.beforeBatch = async () => {
    f.db.beforeBatch = undefined;
    throw new Error('import batch failed');
  };
  let status = 0;
  await errorsDuring(async () => {
    status = (await setStatus(f, 'vod-3', body)).status;
  });
  return status;
}

async function testAFailedImportIsRetriedByTheSameApprove() {
  // An approval writes Nova before it imports, so one whose import fails leaves the VOD approved with no stream, while
  // the list, which reloads nothing after a failure, still shows it pending. Its Approve, sent again with that pending,
  // is not a stale write but the import still owed: it imports, answers the row, and leaves Nova as it is (status and
  // note), posting nothing, as any re-approval does.
  const f = fixture();
  const shown = (await listed(f)).get('vod-3')!.status;
  assert.equal(shown, 'pending', 'the list shows vod-3 pending');
  const body = { status: 'approved', expected_status: shown };
  assert.equal(await approveWithTheImportFailing(f, { ...body, reviewer_note: 'first review' }), 500, 'the import failed');
  const approved = vodRow(f, 'vod-3');
  assert.deepEqual(approved, { status: 'approved', reviewer_note: 'first review' }, 'after Nova was written');
  assert.equal(streamsOfVod3(f), 0, 'and nothing was imported');

  const retry = await setStatus(f, 'vod-3', body);
  assert.equal(retry.status, 200);
  const answer = await retry.json() as NovaVodSubmission;
  assert.deepEqual([answer.id, answer.status, answer.reviewer_note], ['vod-3', 'approved', 'first review'], 'it answers the row');
  assert.equal(streamsOfVod3(f), 1, 'the retry imported the VOD');
  const stream = String(f.db.sqlite.prepare("SELECT id FROM streams WHERE video_id = 'video-new'").get()!.id);
  assert.equal(Number(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM performances WHERE stream_id = ?').get(stream)!.n), 1, 'with its song');
  assert.deepEqual(vodRow(f, 'vod-3'), approved, "Nova's status and note are untouched");
  assert.deepEqual(f.posted, [], 'and nothing is posted');

  // Once imported, nothing is owed: the same Approve is a stale write again.
  const again = await setStatus(f, 'vod-3', body);
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'status_changed', status: 'approved' });
  assert.equal(streamsOfVod3(f), 1, 'and imports nothing more');
  close(f);
}

async function testAStaleChangeOfAnImportOwedVodIs409() {
  // Only that Approve is the retry. Any other change carrying a status the VOD no longer has is refused, though its
  // import is still owed: a Reject or a Revert, an approval without applying, and an Approve that expected another status.
  // So is that same Approve of a VOD rejected with no stream, which owes no import.
  const f = fixture();
  assert.equal(await approveWithTheImportFailing(f, { status: 'approved', expected_status: 'pending' }), 500);
  const approved = vodRow(f, 'vod-3');
  const stale = [
    { status: 'rejected', reviewer_note: 'R', expected_status: 'pending' },
    { status: 'pending', expected_status: 'rejected' },
    { status: 'approved', without_applying: true, expected_status: 'pending' },
    { status: 'approved', expected_status: 'rejected' },
  ];
  for (const body of stale) {
    const response = await setStatus(f, 'vod-3', body);
    assert.equal(response.status, 409, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: 'status_changed', status: 'approved' }, JSON.stringify(body));
  }
  assert.deepEqual(vodRow(f, 'vod-3'), approved, 'Nova is untouched');
  assert.equal(streamsOfVod3(f), 0, 'nothing is imported');
  assert.deepEqual(f.posted, [], 'and nothing is posted');
  close(f);

  const g = fixture();
  assert.equal((await setStatus(g, 'vod-3', { status: 'rejected', reviewer_note: 'R', expected_status: 'pending' })).status, 200);
  const rejected = vodRow(g, 'vod-3');
  const posted = g.posted.length;
  const approval = await setStatus(g, 'vod-3', { status: 'approved', expected_status: 'pending' });
  assert.equal(approval.status, 409, 'a stale Approve of a rejected VOD with no stream');
  assert.deepEqual(await approval.json(), { error: 'status_changed', status: 'rejected' });
  assert.deepEqual(vodRow(g, 'vod-3'), rejected, 'the rejection stands');
  assert.equal(streamsOfVod3(g), 0, 'nothing is imported');
  assert.equal(g.posted.length, posted, 'and nothing more is posted');
  close(g);
}

async function testARecoveryRacingAnApplysRefusalStillAnnounces() {
  // The page can't reach this setup (see testAnnouncementSupersedesOlderApplies), so this pins the worker's contract.
  // Apply 2 passes its checks. Just before its batch, apply 1, a same-start setTimes, answers 502 with its record open,
  // and the page's recovery of it starts: it writes apply 1's note and reaches its claim, where it waits. Apply 2's batch
  // then commits, and its mark finds that approval: it answers 409 and closes its own record only (claimApply), so the
  // recovery's claim still takes apply 1's record and announces it, once.
  const f = fixture();
  const original = globalThis.fetch;
  // The requests overlap, so their webhook stubs do too: posts are collected for the whole scenario.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === WEBHOOK) f.posted.push(...(JSON.parse(String(init?.body)) as { embeds: DiscordEmbed[] }).embeds);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const view = await correctionOf(f, 'vod-1');

    // The first claim of the submission's open records, the recovery's, waits until apply 2 has answered.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void;
    const atClaim = new Promise<void>((resolve) => { reached = resolve; });
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!sql.includes('RETURNING token')) return statement;
      f.db.prepare = prepare;
      return {
        bind: (...params: SQLInputValue[]) => {
          const bound = statement.bind(...params);
          return { all: async () => { reached(); await gate; return bound.all(); } };
        },
      };
    }) as typeof f.db.prepare;

    let recovery: Promise<Response> | undefined;
    let stalled: unknown;
    f.db.beforeBatch = async () => {
      f.db.beforeBatch = undefined;
      await applyWithNovaDown(f, 'vod-1', { fingerprint: view.fingerprint, operations: [SAME_START_P1], skipped: NONE_SKIPPED });
      recovery = setStatus(f, 'vod-1', { status: 'approved', without_applying: true, expected_status: 'pending' });
      // A regression that keeps the recovery from its claim fails the test, rather than stopping the suite.
      await within(atClaim, 2000, 'the recovery to reach its claim').catch((error: unknown) => { stalled = error; });
    };
    const response = await applyTo(f, 'vod-1', {
      fingerprint: view.fingerprint,
      reviewerNote: 'second',
      operations: [{ op: 'setTimes', performanceId: 'p1', timestamp: 102 }],
      skipped: NONE_SKIPPED,
    });
    if (stalled !== undefined) throw stalled;
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'status_changed', status: 'approved', appliedToCatalog: true });
    release();
    assert.equal((await within(recovery!, 2000, 'the recovery to answer')).status, 200, 'the recovery went through');
    assert.deepEqual(vodRow(f, 'vod-1'), { status: 'approved', reviewer_note: '套用 1 項（時間 1）' }, "with apply 1's note");
    assert.deepEqual(f.posted.map((embed) => embed.title), ['✅ VOD 修正已套用'], 'apply 1 is announced, once');
    assert.deepEqual(appliesOf(f, 'vod-1').map((row) => row.announced), [1, 1], 'and both records are closed');
  } finally {
    globalThis.fetch = original;
    close(f);
  }
}

// --- The public kind (finding #8): an embed calls a submission a correction only while its stream is approved ---

/**
 * alice's video-diff, with a catalog stream of `streamStatus` titled apart from the submission and holding one pending
 * row (pd at 100–200), or with none when `streamStatus` is null. Nova holds vod-d, a pending submission of it with one
 * song, stored as Nova stores it: a correction when the video has a stream, new when it has none.
 */
function withDiffVideo(f: Fixture, streamStatus: Status | null): void {
  if (streamStatus !== null) {
    f.db.sqlite.exec(`
      INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
        ('s-diff','alice','Pipeline Title','2026-09-06','video-diff','https://example.com/diff','${streamStatus}');
      INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','pending');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
        ('pd','alice','D','s-diff','2026-09-06','Pipeline Title','video-diff',100,200,'pending');
    `);
  }
  f.nova.sqlite.exec(`
    INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,stream_title,stream_date,status,kind) VALUES
      ('vod-d','alice','video-diff','https://example.com/diff','Diff','2026-09-06','pending','${streamStatus === null ? 'new' : 'correction'}');
    INSERT INTO vod_songs (id,vod_submission_id,song_title,original_artist,start_timestamp,end_timestamp,sort_order) VALUES
      ('vs-d','vod-d','Song D','Artist',101,200,0);
  `);
}

const SHIFT_PD: CorrectionOperation = { op: 'setTimes', performanceId: 'pd', timestamp: 101 };

/** What the feedback webhook received while `decide` reviewed vod-d, on a fresh fixture whose video-diff stream is `streamStatus`. */
async function postedFor(streamStatus: Status | null, decide: (f: Fixture) => Promise<void>): Promise<DiscordEmbed[]> {
  const f = fixture();
  try {
    withDiffVideo(f, streamStatus);
    await decide(f);
    return f.posted;
  } finally {
    close(f);
  }
}

async function rejectDiff(f: Fixture): Promise<void> {
  assert.equal((await setStatus(f, 'vod-d', { status: 'rejected', reviewer_note: '時間軸錯誤', expected_status: 'pending' })).status, 200);
}

async function applyDiff(f: Fixture): Promise<void> {
  const view = await correctionOf(f, 'vod-d');
  assert.equal((await applyTo(f, 'vod-d', { fingerprint: view.fingerprint, operations: [SHIFT_PD], skipped: NONE_SKIPPED })).status, 200);
}

async function testPipelineCorrectionIsAnnouncedLikeAnUnknownVideo() {
  // The leak check for Discord. With video-diff's stream in a status the public cannot see, vod-d is a stored
  // correction; with no stream, it is the same submission stored as new. Every embed its contributor can get reads
  // the same: the rejection, and the approval, which the second imports as a new VOD and the first gets only through
  // the correction review: by an apply, by the recovery of an apply that answered 502, or by an approval without
  // applying, which must not be silent where the unknown video's approval is announced.
  const rejected = await postedFor(null, rejectDiff);
  assert.deepEqual(rejected.map((embed) => embed.title), ['❌ VOD 投稿未通過'], 'the unknown video is rejected as a new VOD');
  const approved = await postedFor(null, async (f) => {
    assert.equal((await setStatus(f, 'vod-d', { status: 'approved', expected_status: 'pending' })).status, 200);
  });
  assert.deepEqual(approved.map((embed) => embed.title), ['✅ VOD 投稿已收錄'], 'and approved as one');

  for (const streamStatus of ['pending', 'extracted', 'rejected', 'excluded'] as const) {
    assert.deepEqual(await postedFor(streamStatus, rejectDiff), rejected, `a ${streamStatus} stream: the rejection`);
    assert.deepEqual(await postedFor(streamStatus, applyDiff), approved, `a ${streamStatus} stream: the apply, which posts no summary`);
    const recovered = await postedFor(streamStatus, async (f) => {
      const view = await correctionOf(f, 'vod-d');
      await applyWithNovaDown(f, 'vod-d', { fingerprint: view.fingerprint, operations: [SHIFT_PD], skipped: NONE_SKIPPED });
      assert.equal((await setStatus(f, 'vod-d', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
    });
    assert.deepEqual(recovered, approved, `a ${streamStatus} stream: the recovery of an apply that answered 502`);
    const approvedAsIs = await postedFor(streamStatus, async (f) => {
      assert.equal((await setStatus(f, 'vod-d', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
    });
    assert.deepEqual(approvedAsIs, approved, `a ${streamStatus} stream: an approval without applying`);
  }
}

async function testArchivedVodApprovedAsIsStaysSilent() {
  // An approval that applies nothing to an archived VOD announces nothing, whatever the submission's kind: the VOD is
  // public, so silence tells nothing. Here, both of the archived video-pub and stored as new: a duplicate, and the
  // submission that created the stream, reverted and approved again.
  const f = fixture();
  try {
    f.nova.sqlite.exec(`
      INSERT INTO vod_submissions (id,streamer_slug,video_id,video_url,stream_title,stream_date,status,kind) VALUES
        ('vod-dup','alice','video-pub','https://example.com/pub','Pub','2026-09-01','pending','new'),
        ('vod-creator','alice','video-pub','https://example.com/pub','Pub','2026-09-01','approved','new');
    `);
    assert.equal((await setStatus(f, 'vod-dup', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
    assert.equal((await setStatus(f, 'vod-creator', { status: 'pending', expected_status: 'approved' })).status, 200, 'Revert');
    assert.equal((await setStatus(f, 'vod-creator', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
    assert.deepEqual([vodRow(f, 'vod-dup').status, vodRow(f, 'vod-creator').status], ['approved', 'approved']);
    assert.deepEqual(f.posted, [], 'neither approval is announced');
  } finally {
    close(f);
  }
}

async function testSameStatusChangeReadsNoStream() {
  // A change to the status a submission already has posts nothing, so it reads no stream either: it never pays for
  // the read, nor logs that it announces an embed it does not post.
  const f = fixture();
  try {
    assert.equal((await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R', expected_status: 'pending' })).status, 200);
    const prepare = f.db.prepare.bind(f.db);
    const streamReads: string[] = [];
    f.db.prepare = (sql: string) => {
      if (/\bstreams\b/.test(sql)) streamReads.push(sql);
      return prepare(sql);
    };
    try {
      const again = await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R2', expected_status: 'rejected' });
      assert.equal(again.status, 200);
    } finally {
      f.db.prepare = prepare;
    }
    assert.deepEqual(streamReads, [], 'no stream is read');
    assert.deepEqual(vodRow(f, 'vod-1'), { status: 'rejected', reviewer_note: 'R2' }, 'the note is still written');
    assert.deepEqual(f.posted.map((embed) => embed.title), ['❌ VOD 修正未採用'], 'only the first rejection is posted');
  } finally {
    close(f);
  }
}

async function testCorrectionIsAnnouncedAsOneOnceItsStreamIsApproved() {
  // The kind an embed shows is read from the stream as the embed is built: vod-d was stored as a correction of a
  // stream still pending, which the curator then approved, so the archived VOD's correction is announced as one.
  const applied = await postedFor('pending', async (f) => {
    f.db.sqlite.exec("UPDATE streams SET status = 'approved' WHERE id = 's-diff'");
    await applyDiff(f);
  });
  assert.deepEqual(applied.map((embed) => embed.title), ['✅ VOD 修正已套用']);
  assert.deepEqual(applied[0].fields, [{ name: '變更', value: '套用 1 項（時間 1）' }], 'with its summary');

  const rejected = await postedFor('pending', async (f) => {
    f.db.sqlite.exec("UPDATE streams SET status = 'approved' WHERE id = 's-diff'");
    await rejectDiff(f);
  });
  assert.deepEqual(rejected.map((embed) => embed.title), ['❌ VOD 修正未採用']);

  // A stored correction whose stream is gone again, approved and imported as new, is announced as a new VOD.
  const reimported = await postedFor('pending', async (f) => {
    f.db.sqlite.exec("DELETE FROM performances WHERE stream_id = 's-diff'; DELETE FROM streams WHERE id = 's-diff'");
    assert.equal((await setStatus(f, 'vod-d', { status: 'approved', expected_status: 'pending' })).status, 200);
  });
  assert.deepEqual(reimported.map((embed) => embed.title), ['✅ VOD 投稿已收錄']);
}

async function testStreamLookupThatFailsIsAnnouncedAsNew() {
  // PATCH reads the stream once Nova has its status, so a read that fails must not lose the embed: it is logged, and
  // the embed reads as a new VOD's, the wording that never reveals a stream. vod-1's and vod-2's stream is approved,
  // so vod-1's rejection would otherwise read 修正未採用, and vod-2's approval without applying would post nothing.
  const f = fixture();
  const prepare = f.db.prepare.bind(f.db);
  try {
    // Only that read (findTargetStreams) fails: the approval's own check that the video has a stream still answers.
    f.db.prepare = (sql: string) => {
      if (sql.includes('json_each')) throw new Error('D1 is unavailable');
      return prepare(sql);
    };
    const errors = await errorsDuring(async () => {
      assert.equal((await setStatus(f, 'vod-1', { status: 'rejected', reviewer_note: 'R', expected_status: 'pending' })).status, 200);
      assert.equal((await setStatus(f, 'vod-2', { status: 'approved', without_applying: true, expected_status: 'pending' })).status, 200);
    });
    assert.equal(errors.length, 2, 'each failed read is logged');
    assert.deepEqual(vodRow(f, 'vod-1'), { status: 'rejected', reviewer_note: 'R' });
    assert.equal(vodRow(f, 'vod-2').status, 'approved');
    assert.deepEqual(f.posted.map((embed) => embed.title), ['❌ VOD 投稿未通過', '✅ VOD 投稿已收錄'], "both are posted as a new VOD's");
    assert.deepEqual(f.posted[0].fields, [{ name: '理由', value: 'R' }]);
  } finally {
    f.db.prepare = prepare;
    close(f);
  }
}

const tests = [
  testListAddsTargetStream,
  testListRowsNeverCarryTheBase,
  testListFlagsAnOpenApply,
  testTargetIsPerStreamer,
  testCorrectionView,
  testCorrectionViewCarriesItsBase,
  testCorrectionViewCarriesBaseVerified,
  testAPreDeployRowReadsUnverified,
  testCurrentRowsSayWhetherTheSiteShowsThem,
  testEndFilledIsReadInSubmittedOrder,
  testUntouchedRowsPairById,
  testProposedFollowsTime,
  testABlankArtistResolvesWithEachLiveArtist,
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
  testApplyReadsTheStatusTheReviewShowed,
  testApplyWouldPublishHidden,
  testUnpublishingRelinkIs409,
  testApplyWouldPublishEndless,
  testSecondCorrectionSeesFirstApplied,
  testConcurrentAppliesOfOneSubmission,
  testApply502WhenNovaWriteFails,
  test502RecoveryWritesTheRecordedNoteAndAnnounces,
  testAReopenedReviewCarriesTheOpenApply,
  testASecondApplyAfterALandedApplyIsRefused,
  testRecoveryAnnouncesOnlyOnce,
  testReapplyAfterRevertIsAllowed,
  testClaimThatThrowsStillPosts,
  testRevertClosesOpenApplies,
  testAnnouncementSupersedesOlderApplies,
  testNovaWriteThatLandedIsASuccess,
  testUnconfirmedNovaWriteIs502,
  testNovaRowApprovedWithAnotherNoteIs502,
  testARejectAfterALandedApplyIsRefused,
  testRecoveryRacingAnApplyAnnouncesOnce,
  testStaleRejectAfterApplyIs409,
  testStaleWithoutApplyingIs409,
  testRevertStillWorks,
  testReviewDuringApplyIsNotOverwritten,
  testUnreadableRowAfterAMissIs502,
  testReviewBetweenCheckAndWriteIs409,
  testClosingTheApplyRecordAfterAnotherReviewMayFail,
  testAFailedImportIsRetriedByTheSameApprove,
  testAStaleChangeOfAnImportOwedVodIs409,
  testARecoveryRacingAnApplysRefusalStillAnnounces,
  testPipelineCorrectionIsAnnouncedLikeAnUnknownVideo,
  testCorrectionIsAnnouncedAsOneOnceItsStreamIsApproved,
  testStreamLookupThatFailsIsAnnouncedAsNew,
  testArchivedVodApprovedAsIsStaysSilent,
  testSameStatusChangeReadsNoStream,
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
  console.log(`✓ Nova VOD correction routes: list targets, review view, approve guard, apply and its errors, 502 recovery (${tests.length} tests)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
