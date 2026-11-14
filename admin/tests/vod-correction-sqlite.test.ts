import assert from 'node:assert/strict';
import { URL } from 'node:url';
import type { Status } from '../shared/types';
import type { CorrectionOperation } from '../shared/vod-correction';
import {
  applyCorrection, claimApply, claimOpenApplies, correctionFingerprint, findOpenApplies, findTargetStreams,
  findUnannouncedApply, loadCorrectionTarget, resolveExistingSongs, streamKey,
} from '../src/vod-correction-db';
import type { CorrectionApplyRecord, CorrectionTarget } from '../src/vod-correction-db';
import { SQLiteD1 } from './sqlite-d1';

const CURATOR = 'curator@example.com';
const SUMMARY = '套用 1 項（時間 1）';
// alice's s-pub and s-other are public; s-hidden is still in the pipeline. A, B and C are approved
// songs sung on s-pub, A on s-other too. P is pending and sung (approved) only on s-hidden; Q is
// pending and sung nowhere. Every song is linked to its exact work.
const SEED = `
  INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES
    ('s-pub','alice','Pub','2026-09-01','video-pub','https://example.com/pub','approved'),
    ('s-other','alice','Other','2026-09-02','video-other','https://example.com/other','approved'),
    ('s-hidden','alice','Hidden','2026-09-03','video-hidden','https://example.com/hidden','pending');
  INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('A','alice','Song A','Artist','approved'), ('B','alice','Song B','Artist','approved'),
    ('C','alice','Song C','Artist','approved'), ('P','alice','Song P','Artist','pending'),
    ('Q','alice','Song Q','Artist','pending');
  INSERT INTO works (id,title,original_artist) VALUES
    ('w-a','Song A','Artist'), ('w-b','Song B','Artist'), ('w-c','Song C','Artist'),
    ('w-p','Song P','Artist'), ('w-q','Song Q','Artist');
  INSERT INTO song_work_links (song_id,work_id,link_method,linked_by) VALUES
    ('A','w-a','import_exact','seed'), ('B','w-b','import_exact','seed'), ('C','w-c','import_exact','seed'),
    ('P','w-p','import_exact','seed'), ('Q','w-q','import_exact','seed');
  INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
    ('p1','alice','A','s-pub','2026-09-01','Pub','video-pub',100,200,'approved'),
    ('p2','alice','B','s-pub','2026-09-01','Pub','video-pub',300,400,'approved'),
    ('p3','alice','C','s-pub','2026-09-01','Pub','video-pub',500,600,'approved'),
    ('p4','alice','A','s-other','2026-09-02','Other','video-other',100,200,'approved'),
    ('p5','alice','P','s-hidden','2026-09-03','Hidden','video-hidden',100,200,'approved');
`;
const ADD_Z: CorrectionOperation = { op: 'addPerformance', title: 'Song Z', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 };
// Every status a stream can have but approved: a row an apply adds there is created pending, like an imported row.
const NOT_APPROVED = ['pending', 'rejected', 'excluded', 'extracted'] as const;
// p6, an approved row of approved B on s-hidden, is on the site: the export ignores stream status.
const ON_SITE_P6 = `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
  VALUES ('p6','alice','B','s-hidden','2026-09-03','Hidden','video-hidden',300,400,'approved')`;
// The VOD export reads an approved row of an approved song on an approved stream, and one with no end stops it for every
// streamer (MISSING_END_SECONDS). p7 is an approved row of pending P on s-pub with no end, which it leaves out.
const ENDLESS_P7 = `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
  VALUES ('p7','alice','P','s-pub','2026-09-01','Pub','video-pub',700,NULL,'approved')`;
// p8, an approved row of pending Q with no end on s-other, and p9, one on s-pub: promoting Q would put both in the export.
const ENDLESS_P8 = `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
  VALUES ('p8','alice','Q','s-other','2026-09-02','Other','video-other',300,NULL,'approved')`;
const ENDLESS_P9 = `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
  VALUES ('p9','alice','Q','s-pub','2026-09-01','Pub','video-pub',900,NULL,'approved')`;
// An add that lands on pending Q, which the apply then promotes.
const ADD_Q: CorrectionOperation = { op: 'addPerformance', title: 'Song Q', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 };

function fixture() {
  const db = new SQLiteD1();
  db.sqlite.exec(SEED);
  return db;
}
function count(db: SQLiteD1, table: string, where = '1') {
  return Number(db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get()!.n);
}
// node:sqlite rows have a null prototype, which strict deepEqual never matches against a plain object.
const plain = (row: object | undefined) => ({ ...row });
const songOf = (db: SQLiteD1, performanceId: string) =>
  db.sqlite.prepare('SELECT song_id FROM performances WHERE id = ?').get(performanceId)?.song_id;
const titleOf = (db: SQLiteD1, songId: unknown) =>
  db.sqlite.prepare('SELECT title FROM songs WHERE id = ?').get(String(songId))?.title;
const workTitleOf = (db: SQLiteD1, songId: unknown) => db.sqlite.prepare(
  'SELECT work.title FROM song_work_links AS link JOIN works AS work ON work.id = link.work_id WHERE link.song_id = ?',
).get(String(songId))?.title;
const timesOf = (db: SQLiteD1, performanceId: string) =>
  plain(db.sqlite.prepare('SELECT timestamp, end_timestamp FROM performances WHERE id = ?').get(performanceId));
const streamStatusOf = (db: SQLiteD1, streamId: string) =>
  db.sqlite.prepare('SELECT status FROM streams WHERE id = ?').get(streamId)?.status;
const songStatusOf = (db: SQLiteD1, songId: string) =>
  db.sqlite.prepare('SELECT status FROM songs WHERE id = ?').get(songId)?.status;
/** What the VOD export reads of a performance: its status and end, and its song's status and title. */
const exportedOf = (db: SQLiteD1, performanceId: string) => plain(db.sqlite.prepare(
  `SELECT p.status, p.end_timestamp, s.status AS song_status, s.title
   FROM performances AS p JOIN songs AS s ON s.id = p.song_id WHERE p.id = ?`,
).get(performanceId));
const exportRevision = (db: SQLiteD1) =>
  Number(db.sqlite.prepare("SELECT revision FROM fan_export_revisions WHERE streamer_id = 'alice'").get()?.revision ?? 0);
/** The added performance of the song titled `title`, with what its song recorded about the review. */
const addedRow = (db: SQLiteD1, title: string) => plain(db.sqlite.prepare(
  `SELECT p.stream_id, p.video_id, p.timestamp, p.end_timestamp, p.status, p.submitted_by,
          s.status AS song_status, s.reviewed_by
   FROM performances AS p JOIN songs AS s ON s.id = p.song_id WHERE s.title = ?`,
).get(title));

async function targetOf(db: SQLiteD1, videoId = 'video-pub'): Promise<CorrectionTarget> {
  const target = await loadCorrectionTarget(db.binding, 'alice', videoId);
  assert.ok(target, `alice has a stream for ${videoId}`);
  return target;
}
let applyCount = 0;
/** A record for one apply of vod-1, as the route makes one: a fresh token every time. */
function recordFor(): CorrectionApplyRecord {
  applyCount += 1;
  return { token: `apply-${applyCount}`, submissionId: 'vod-1', reviewerNote: `thanks\n${SUMMARY}`, summary: SUMMARY };
}
async function apply(db: SQLiteD1, operations: CorrectionOperation[], videoId = 'video-pub', record = recordFor()) {
  return applyCorrection(db.binding, await targetOf(db, videoId), operations, CURATOR, record);
}
const recordOf = (db: SQLiteD1, token: string) => plain(db.sqlite.prepare(
  'SELECT submission_id, reviewer_note, summary, actor, announced_at FROM vod_correction_applies WHERE token = ?',
).get(token));
/** Run `body` with console.warn collected instead of printed; resolves with each warning's arguments. */
async function warningsDuring(body: () => Promise<void>): Promise<unknown[][]> {
  const warn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    await body();
  } finally {
    console.warn = warn;
  }
  return warnings;
}
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

function testShimRunsEachSchemaInOrder() {
  const nova = new SQLiteD1(
    new URL('../../tools/nova/schema.sql', import.meta.url),
    new URL('../../tools/nova/seed.sql', import.meta.url),
  );
  assert.ok(count(nova, 'submissions') > 0, 'the seed ran after the schema it fills');
  assert.equal(count(nova, 'sqlite_master', "name = 'songs'"), 0, 'given schemas replace the admin default');
  nova.sqlite.close();
}

async function testLoadTarget() {
  const db = fixture();
  const target = await targetOf(db);
  assert.deepEqual(target.stream, { id: 's-pub', streamerId: 'alice', title: 'Pub', date: '2026-09-01', videoId: 'video-pub', status: 'approved' });
  assert.deepEqual(target.current.map((row) => row.performanceId), ['p1', 'p2', 'p3']);
  assert.equal(target.current[0].songPerformanceCount, 2, 'A is sung on s-pub and s-other');
  assert.deepEqual(target.current[0], {
    performanceId: 'p1', songId: 'A', title: 'Song A', originalArtist: 'Artist', timestamp: 100, endTimestamp: 200,
    status: 'approved', songStatus: 'approved', onSite: true, songPerformanceCount: 2,
  });
  db.sqlite.exec(`INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,status) VALUES
    ('p0','alice','B','s-pub','2026-09-01','Pub','video-pub',50,'rejected'),
    ('p6','alice','B','s-pub','2026-09-01','Pub','video-pub',300,'extracted')`);
  assert.deepEqual((await targetOf(db)).current.map((row) => row.performanceId), ['p1', 'p2', 'p6', 'p3'], 'rejected rows stay out; ties sort by id');
  assert.equal(await loadCorrectionTarget(db.binding, 'bob', 'video-pub'), null, 'the stream is looked up per streamer');
  assert.equal(await loadCorrectionTarget(db.binding, 'alice', 'video-none'), null);
  db.sqlite.close();
}

async function testOnSiteIsThePerformanceAndItsSong() {
  // A row is on the site when it and its song are approved, whatever the stream's status: the fan export ignores it.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
    ('p7','alice','P','s-pub','2026-09-01','Pub','video-pub',700,800,'approved'),
    ('p8','alice','A','s-pub','2026-09-01','Pub','video-pub',900,1000,'pending')`);
  db.sqlite.exec(ON_SITE_P6);
  const onSite = async (videoId: string) =>
    Object.fromEntries((await targetOf(db, videoId)).current.map((row) => [row.performanceId, row.onSite]));
  assert.deepEqual(await onSite('video-pub'), { p1: true, p2: true, p3: true, p7: false, p8: false },
    'an approved row of a pending song is not on the site, nor is a pending row of an approved one');
  assert.deepEqual(await onSite('video-hidden'), { p5: false, p6: true }, "a stream in the pipeline: p6 is on the site, p5's song is pending");
  db.sqlite.close();
}

async function testFindTargetStreams() {
  const db = fixture();
  db.sqlite.exec("INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES ('s-bob','bob','Bob','2026-09-01','video-pub','https://example.com/bob','approved')");
  const targets = await findTargetStreams(db.binding, [
    { streamerId: 'alice', videoId: 'video-pub' }, { streamerId: 'bob', videoId: 'video-pub' },
    { streamerId: 'alice', videoId: 'video-hidden' }, { streamerId: 'alice', videoId: 'video-none' },
  ]);
  assert.deepEqual(Object.fromEntries(targets), {
    [streamKey('alice', 'video-pub')]: { id: 's-pub', status: 'approved' },
    [streamKey('bob', 'video-pub')]: { id: 's-bob', status: 'approved' },
    [streamKey('alice', 'video-hidden')]: { id: 's-hidden', status: 'pending' },
  });
  assert.equal((await findTargetStreams(db.binding, [])).size, 0);
  assert.notEqual(streamKey('a', 'bc'), streamKey('ab', 'c'), 'the separator keeps keys apart');
  db.sqlite.close();
}

async function testFindOpenApplies() {
  // The list asks once for every submission it shows: which of them have a record of an apply that was never announced.
  // A record announced (closed) counts for nothing; one open among closed ones counts; another submission's, unasked,
  // is left out.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO vod_correction_applies (token,submission_id,reviewer_note,summary,actor,announced_at) VALUES
    ('t-open-a','vod-1','n','s','x',NULL),
    ('t-open-b','vod-1','n','s','x',NULL),
    ('t-closed','vod-2','n','s','x','2026-11-01 00:00:00'),
    ('t-closed-3','vod-3','n','s','x','2026-11-01 00:00:00'),
    ('t-open-3','vod-3','n','s','x',NULL),
    ('t-unasked','vod-9','n','s','x',NULL),
    ('t-quoted','a"b''c','n','s','x',NULL)`);
  assert.deepEqual(
    [...await findOpenApplies(db.binding, ['vod-1', 'vod-2', 'vod-3', 'vod-none'])].sort(),
    ['vod-1', 'vod-3'],
    'open records, however many, and only for the ids asked',
  );
  assert.deepEqual([...await findOpenApplies(db.binding, ['vod-1', 'vod-1'])], ['vod-1'], 'an id asked twice is answered once');
  assert.deepEqual([...await findOpenApplies(db.binding, ['a"b\'c'])], ['a"b\'c'], 'ids travel as data, whatever characters they hold');
  assert.equal((await findOpenApplies(db.binding, [])).size, 0, 'no ids, no answer');

  const prepare = db.prepare.bind(db);
  const statements: string[] = [];
  db.prepare = (sql: string) => {
    statements.push(sql);
    return prepare(sql);
  };
  await findOpenApplies(db.binding, []);
  assert.equal(statements.length, 0, 'nothing to ask, nothing sent');
  await findOpenApplies(db.binding, Array.from({ length: 300 }, (_, i) => `vod-${i}`));
  assert.equal(statements.length, 1, 'one statement, however many ids');
  db.prepare = prepare;
  db.sqlite.close();
}

async function testResolveExistingSongs() {
  const db = fixture();
  db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('P2','alice','Song P','Artist','approved'), ('U','alice','Song U','Unknown','approved'),
    ('R','alice','Song R','Artist','rejected'), ('bob-A','bob','Song A','Artist','approved')`);
  assert.deepEqual(await resolveExistingSongs(db.binding, 'alice', [
    { title: 'Song P', originalArtist: 'Artist' },
    { title: 'Song Q', originalArtist: 'Artist' },
    { title: 'Song U', originalArtist: '' },
    { title: 'Song R', originalArtist: 'Artist' },
    { title: 'Song X', originalArtist: 'Artist' },
    { title: 'Song A', originalArtist: 'Artist' },
  ]), [
    { id: 'P2', status: 'approved' }, // approved beats pending
    { id: 'Q', status: 'pending' },
    { id: 'U', status: 'approved' }, // an empty artist reads as Unknown
    null, // a rejected song is never reused
    null,
    { id: 'A', status: 'approved' }, // alice's own, never bob's
  ]);
  assert.deepEqual(await resolveExistingSongs(db.binding, 'alice', []), []);
  db.sqlite.close();
}

async function testResolveExistingSongsAnswersAsBefore() {
  // The lookup the review makes renames nothing, and it answers as it always has, over a catalog that also holds a
  // song an apply could rename away (A) and the names a rename could give it, twins of every status, and other
  // streamers' songs: the streamer's own approved or pending song with exactly that title and artist (a blank artist
  // reads as Unknown), approved first, then the oldest, then the lowest id.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status,created_at) VALUES
    ('P2','alice','Song P','Artist','approved','2026-01-02 00:00:00'), ('P3','alice','Song P','Artist','approved','2026-01-01 00:00:00'),
    ('V2','alice','Song V','Artist','approved','2026-01-01 00:00:00'), ('V1','alice','Song V','Artist','approved','2026-01-01 00:00:00'),
    ('W1','alice','Song W','Artist','pending','2026-02-01 00:00:00'), ('W2','alice','Song W','Artist','pending','2026-01-01 00:00:00'),
    ('X','alice','Song X','Artist','excluded','2020-01-01 00:00:00'), ('E','alice','Song E','Artist','extracted','2020-01-01 00:00:00'),
    ('U','alice','Song U','Unknown','approved','2026-01-01 00:00:00'), ('lower','alice','song a','Artist','approved','2020-01-01 00:00:00'),
    ('bob-A','bob','Song A','Artist','approved','2020-01-01 00:00:00')`);
  assert.deepEqual(await resolveExistingSongs(db.binding, 'alice', [
    { title: 'Song P', originalArtist: 'Artist' },
    { title: 'Song V', originalArtist: 'Artist' },
    { title: 'Song W', originalArtist: 'Artist' },
    { title: 'Song Q', originalArtist: 'Artist' },
    { title: 'Song X', originalArtist: 'Artist' },
    { title: 'Song E', originalArtist: 'Artist' },
    { title: 'Song U', originalArtist: '' },
    { title: 'Song A', originalArtist: 'Artist' },
    { title: 'Song A2', originalArtist: 'Artist' },
    { title: 'song a', originalArtist: 'Artist' },
    { title: 'Song P', originalArtist: 'Artist' },
  ]), [
    { id: 'P3', status: 'approved' }, // approved beats pending, and the older of two approved twins wins
    { id: 'V1', status: 'approved' }, // twins of one age: the lower id
    { id: 'W2', status: 'pending' }, // the older of two pending twins
    { id: 'Q', status: 'pending' },
    null, // an excluded song is never reused
    null, // nor an extracted one
    { id: 'U', status: 'approved' }, // a blank artist reads as Unknown
    { id: 'A', status: 'approved' }, // a song an apply could rename away answers to the name it has, alice's own
    null, // and nothing answers to a name no rename gave
    { id: 'lower', status: 'approved' }, // the title as stored: another case is another song
    { id: 'P3', status: 'approved' }, // an identity asked twice resolves twice
  ]);
  db.sqlite.close();
}

/** Every statement prepared on `db` from now on, with what it was bound to. */
function recordStatements(db: SQLiteD1): Array<ReturnType<SQLiteD1['prepare']>> {
  const statements: Array<ReturnType<SQLiteD1['prepare']>> = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    statements.push(statement);
    return statement;
  };
  return statements;
}

/** The song resolution among `statements`: the one lookup of titles and artists the plan or the review makes. */
function resolutionOf(statements: Array<ReturnType<SQLiteD1['prepare']>>) {
  const found = statements.filter((statement) => statement.sql.includes('FROM matched JOIN songs AS song'));
  assert.equal(found.length, 1, 'one resolution statement');
  return found[0];
}

async function testALookupWithNoRenameSeeksTheIdentityIndex() {
  // The review resolves each submitted row, and for a row with no artist its title with every artist the stream has:
  // thousands of titles and artists for a long title-only paste. With no rename in the batch, each is one search of
  // idx_songs_streamer_title_artist; a rename's songs, found by their ids, would otherwise make each a scan of every
  // song the streamer has.
  const db = fixture();
  const statements = recordStatements(db);
  await resolveExistingSongs(db.binding, 'alice', [{ title: 'Song A', originalArtist: 'Artist' }]);
  const lookup = resolutionOf(statements);
  const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${lookup.sql}`).all(...lookup.params).map((step) => String(step.detail));
  assert.ok(
    plan.some((detail) => detail.includes('USING INDEX idx_songs_streamer_title_artist (streamer_id=? AND title=? AND original_artist=?)')),
    `each title and artist is a search of the identity index (plan: ${plan.join(' | ')})`,
  );
  db.sqlite.close();

  // An apply that renames a song into the name a relink asks for still finds that song by its id.
  const renaming = fixture();
  const applied = recordStatements(renaming);
  assert.deepEqual(await apply(renaming, [
    { op: 'renameSong', songId: 'A', title: 'Song A2' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song A2', originalArtist: 'Artist' },
  ]), { ok: true });
  assert.ok(resolutionOf(applied).sql.includes('json_each(wanted.renamed_into)'), 'a rename into a name is read by its id');
  assert.equal(songOf(renaming, 'p2'), 'A');
  renaming.sqlite.close();
}

async function testFingerprintTracksRows() {
  const db = fixture();
  const first = await correctionFingerprint(await targetOf(db));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await correctionFingerprint(await targetOf(db)), first, 'two loads of an unchanged stream agree');
  const target = await targetOf(db);
  assert.equal(await correctionFingerprint({ ...target, current: [...target.current].reverse() }), first, 'row order does not matter');
  db.sqlite.exec("UPDATE performances SET timestamp=101 WHERE id='p1'");
  const moved = await correctionFingerprint(await targetOf(db));
  assert.notEqual(moved, first, 'a time edit changes it');
  db.sqlite.exec("UPDATE streams SET status='pending' WHERE id='s-pub'");
  assert.notEqual(await correctionFingerprint(await targetOf(db)), moved, 'so does the stream status');
  // An added row copies the stream's title and date (and its video, which the load is keyed on).
  for (const [what, sql] of [
    ['the stream title', "UPDATE streams SET title='Pub!' WHERE id='s-pub'"],
    ['the stream date', "UPDATE streams SET date='2026-09-09' WHERE id='s-pub'"],
  ]) {
    const before = await correctionFingerprint(await targetOf(db));
    db.sqlite.exec(sql);
    assert.notEqual(await correctionFingerprint(await targetOf(db)), before, `so does ${what}`);
  }
  db.sqlite.close();
}

async function testSetTimesKeepsId() {
  const db = fixture();
  assert.deepEqual(await apply(db, [{ op: 'setTimes', performanceId: 'p1', timestamp: 101, endTimestamp: 199 }]), { ok: true });
  assert.deepEqual(plain(db.sqlite.prepare("SELECT timestamp, end_timestamp, status FROM performances WHERE id = 'p1'").get()), { timestamp: 101, end_timestamp: 199, status: 'approved' });
  db.sqlite.close();
}

async function testRenameReachesEveryStream() {
  const db = fixture();
  assert.deepEqual(await apply(db, [{ op: 'renameSong', songId: 'A', title: 'Song A2' }]), { ok: true });
  assert.deepEqual([songOf(db, 'p1'), songOf(db, 'p4')], ['A', 'A'], 'both performances keep their song');
  assert.equal(titleOf(db, 'A'), 'Song A2');
  assert.equal(workTitleOf(db, 'A'), 'Song A2', "A's work link follows the new title");
  db.sqlite.close();
}

async function testRelinkToExistingKeepsIdAndDropsOrphan() {
  const db = fixture();
  assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p3', songId: 'B' }]), { ok: true });
  assert.equal(songOf(db, 'p3'), 'B');
  assert.equal(count(db, 'songs', "id = 'C'"), 0, 'C lost its only performance');
  assert.equal(count(db, 'song_work_links', "song_id = 'C'"), 0, 'and its work link went with it');
  db.sqlite.close();
}

async function testRelinkToNewSongCreatesApproved() {
  const db = fixture();
  assert.deepEqual(await apply(db, [{ op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: 'Artist' }]), { ok: true });
  const created = db.sqlite.prepare("SELECT id FROM songs WHERE title = 'Song N'").get()!.id;
  assert.equal(songOf(db, 'p2'), created, 'p2 keeps its id and points at the new song');
  assert.deepEqual(plain(db.sqlite.prepare("SELECT status, submitted_by, reviewed_by FROM songs WHERE title = 'Song N'").get()), { status: 'approved', submitted_by: CURATOR, reviewed_by: CURATOR });
  assert.equal(workTitleOf(db, created), 'Song N', 'the new song is linked to its exact work');
  assert.equal(count(db, 'songs', "id = 'B'"), 0, 'B lost its only performance');
  db.sqlite.close();
}

async function testRelinkToNewSongReusesExactMatch() {
  const db = fixture();
  const songs = count(db, 'songs');
  assert.deepEqual(await apply(db, [{ op: 'relinkToNewSong', performanceId: 'p2', title: 'Song A', originalArtist: 'Artist' }]), { ok: true });
  assert.equal(songOf(db, 'p2'), 'A');
  assert.equal(count(db, 'songs'), songs - 1, 'only the orphaned B is gone; no song was created');
  assert.equal(count(db, 'songs', "id = 'B'"), 0);
  db.sqlite.close();
}

async function testAddOnApprovedStreamIsApproved() {
  const db = fixture();
  assert.deepEqual(await apply(db, [ADD_Z]), { ok: true });
  assert.deepEqual(addedRow(db, 'Song Z'), {
    stream_id: 's-pub', video_id: 'video-pub', timestamp: 700, end_timestamp: 800, status: 'approved',
    submitted_by: CURATOR, song_status: 'approved', reviewed_by: CURATOR,
  });
  db.sqlite.close();
}

async function testAddOnPendingStreamIsPending() {
  const db = fixture();
  assert.deepEqual(await apply(db, [ADD_Z], 'video-hidden'), { ok: true });
  assert.deepEqual(addedRow(db, 'Song Z'), {
    stream_id: 's-hidden', video_id: 'video-hidden', timestamp: 700, end_timestamp: 800, status: 'pending',
    submitted_by: CURATOR, song_status: 'pending', reviewed_by: null,
  });
  db.sqlite.close();
}

async function testAddPromotesPendingSong() {
  const db = fixture();
  assert.deepEqual(await apply(db, [{ op: 'addPerformance', title: 'Song Q', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 }]), { ok: true });
  assert.deepEqual(plain(db.sqlite.prepare("SELECT status, reviewed_by FROM songs WHERE id = 'Q'").get()), { status: 'approved', reviewed_by: CURATOR });
  assert.equal(count(db, 'songs', "title = 'Song Q'"), 1, 'the add reused Q instead of creating a twin');
  assert.equal(count(db, 'performances', "song_id = 'Q' AND stream_id = 's-pub' AND status = 'approved'"), 1);
  db.sqlite.close();
}

async function testRelinksPromotePendingSong() {
  // A relinked row on an approved stream must stay on the site, so the pending song it lands on (Q, sung nowhere)
  // is approved along with the apply, whether the relink names Q or resolves to it.
  const relinks: CorrectionOperation[] = [
    { op: 'relinkToSong', performanceId: 'p2', songId: 'Q' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song Q', originalArtist: 'Artist' },
  ];
  for (const relink of relinks) {
    const db = fixture();
    assert.deepEqual(await apply(db, [relink]), { ok: true }, relink.op);
    assert.equal(songOf(db, 'p2'), 'Q', `${relink.op} lands p2 on Q`);
    assert.deepEqual(
      plain(db.sqlite.prepare("SELECT status, reviewed_by FROM songs WHERE id = 'Q'").get()),
      { status: 'approved', reviewed_by: CURATOR },
      `${relink.op} approves Q, reviewed by the curator`,
    );
    assert.equal(count(db, 'songs', "title = 'Song Q'"), 1, `${relink.op} creates no twin of Q`);
    db.sqlite.close();
  }
}

async function testWouldPublishHidden() {
  const db = fixture();
  const batches = db.batches.length;
  assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p3', songId: 'P' }]), {
    ok: false, status: 409, error: 'would_publish_hidden',
    performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'P' }],
  });
  assert.equal(songOf(db, 'p3'), 'C');
  assert.equal(db.batches.length, batches, 'nothing is written');
  // The export shows an approved row whose stream row is gone, too.
  db.sqlite.exec("DELETE FROM streams WHERE id = 's-hidden'");
  const orphaned = await apply(db, [{ op: 'relinkToSong', performanceId: 'p3', songId: 'P' }]);
  assert.ok(!orphaned.ok && orphaned.error === 'would_publish_hidden', 'a row without a stream is not public either');
  assert.deepEqual(orphaned.performances, [{ performanceId: 'p5', streamId: 's-hidden', songId: 'P' }]);
  db.sqlite.close();
}

async function testDeleteDropsOrphan() {
  const db = fixture();
  assert.deepEqual(await apply(db, [{ op: 'deletePerformance', performanceId: 'p3' }]), { ok: true });
  assert.equal(count(db, 'performances', "id = 'p3'"), 0);
  assert.equal(count(db, 'songs', "id = 'C'"), 0);
  db.sqlite.close();
}

async function testRejectsInvertedTimes() {
  const db = fixture();
  const batches = db.batches.length;
  const result = await apply(db, [{ op: 'setTimes', performanceId: 'p1', endTimestamp: 50 }]);
  assert.ok(!result.ok && result.status === 400, 'an end before the stored start is refused');
  assert.match(result.details[0], /^operation 0: .*end must be greater than start/);
  const added = await apply(db, [{ op: 'addPerformance', title: 'Song Z', originalArtist: 'Artist', timestamp: 800, endTimestamp: 800 }]);
  assert.ok(!added.ok && added.status === 400, 'an add that ends where it starts is refused');
  assert.match(added.details[0], /^operation 0: .*end must be greater than start/);
  assert.equal(db.batches.length, batches, 'nothing is written');
  assert.deepEqual(timesOf(db, 'p1'), { timestamp: 100, end_timestamp: 200 });
  db.sqlite.close();
}

async function testAddWithoutEndIsRefusedOnAnApprovedStream() {
  // An add is born approved on an approved stream, and an approved row without an end stops the VOD export for every
  // streamer (MISSING_END_SECONDS).
  const endless: CorrectionOperation = { op: 'addPerformance', title: 'Song Z', originalArtist: 'Artist', timestamp: 700, endTimestamp: null };
  const db = fixture();
  assert.equal(streamStatusOf(db, 's-pub'), 'approved', "the premise: video-pub's stream is approved");
  const batches = db.batches.length;
  const songs = count(db, 'songs');
  assert.deepEqual(await apply(db, [endless]), {
    ok: false, status: 400, error: 'invalid_operations', details: ['operation 0: an added performance needs an end'],
  });
  assert.equal(db.batches.length, batches, 'nothing is written');
  assert.equal(count(db, 'songs'), songs, 'no song is created');

  // An add with more than one problem lists each of them.
  const blankAndEndless: CorrectionOperation = { op: 'addPerformance', title: '  ', originalArtist: 'Artist', timestamp: 700, endTimestamp: null };
  assert.deepEqual(await apply(db, [blankAndEndless]), {
    ok: false, status: 400, error: 'invalid_operations',
    details: ['operation 0: title must not be empty', 'operation 0: an added performance needs an end'],
  });
  db.sqlite.close();
}

async function testAddWithoutEndOnAStreamThatIsNotApprovedIsCreatedPending() {
  // On a stream that is not approved the add is created pending, like an imported row, and stamped later in the
  // pipeline, so a start-only add (the last line of a paste has no end) goes through with no end. Any status but
  // approved will do.
  const endless: CorrectionOperation = { op: 'addPerformance', title: 'Song Z', originalArtist: 'Artist', timestamp: 700, endTimestamp: null };
  for (const status of NOT_APPROVED) {
    const db = fixture();
    db.sqlite.exec(`UPDATE streams SET status = '${status}' WHERE id = 's-hidden'`);
    assert.equal(streamStatusOf(db, 's-hidden'), status, `the premise: the stream is ${status}`);
    assert.deepEqual(await apply(db, [endless], 'video-hidden'), { ok: true }, status);
    assert.deepEqual(addedRow(db, 'Song Z'), {
      stream_id: 's-hidden', video_id: 'video-hidden', timestamp: 700, end_timestamp: null, status: 'pending',
      submitted_by: CURATOR, song_status: 'pending', reviewed_by: null,
    }, `${status}: the add is created pending, with no end`);
    db.sqlite.close();
  }

  // Every other check of an add stands there: a blank title, and an end that does not come after the start.
  const db = fixture();
  const batches = db.batches.length;
  const blank: CorrectionOperation = { op: 'addPerformance', title: '  ', originalArtist: 'Artist', timestamp: 700, endTimestamp: null };
  assert.deepEqual(await apply(db, [blank], 'video-hidden'), {
    ok: false, status: 400, error: 'invalid_operations', details: ['operation 0: title must not be empty'],
  }, 'a blank title, with no end to report');
  const inverted: CorrectionOperation = { op: 'addPerformance', title: 'Song Z', originalArtist: 'Artist', timestamp: 800, endTimestamp: 800 };
  assert.deepEqual(await apply(db, [inverted], 'video-hidden'), {
    ok: false, status: 400, error: 'invalid_operations', details: ['operation 0: end must be greater than start (start 800, end 800)'],
  });
  assert.equal(db.batches.length, batches, 'nothing is written');
  db.sqlite.close();
}

async function testClearingAnEndIsRefused() {
  // A time edit may move an end, never empty it: the row would reach the export without one. Unlike an add's end, that
  // holds on every stream: the row already exists, and p5 is an approved row of a stream that is not approved.
  const db = fixture();
  const batches = db.batches.length;
  const cases: Array<[CorrectionOperation, string]> = [
    [{ op: 'setTimes', performanceId: 'p1', endTimestamp: null }, 'video-pub'],
    [{ op: 'setTimes', performanceId: 'p1', timestamp: 101, endTimestamp: null }, 'video-pub'],
    [{ op: 'setTimes', performanceId: 'p5', endTimestamp: null }, 'video-hidden'],
  ];
  for (const [operation, videoId] of cases) {
    assert.deepEqual(await apply(db, [operation], videoId), {
      ok: false, status: 400, error: 'invalid_operations', details: ['operation 0: the end must not be cleared'],
    }, JSON.stringify(operation));
  }
  // Whatever the status of the stream that is not approved.
  for (const status of NOT_APPROVED) {
    db.sqlite.exec(`UPDATE streams SET status = '${status}' WHERE id = 's-hidden'`);
    assert.deepEqual(await apply(db, [{ op: 'setTimes', performanceId: 'p5', endTimestamp: null }], 'video-hidden'), {
      ok: false, status: 400, error: 'invalid_operations', details: ['operation 0: the end must not be cleared'],
    }, `a stream that is ${status}`);
  }
  assert.equal(db.batches.length, batches, 'nothing is written');
  assert.deepEqual(timesOf(db, 'p1'), { timestamp: 100, end_timestamp: 200 });
  assert.deepEqual(timesOf(db, 'p5'), { timestamp: 100, end_timestamp: 200 });
  db.sqlite.close();
}

async function testNullEndStaysNullOnPipelineRow() {
  // A row in the pipeline has no end until it is stamped, so a time edit may send its empty end back empty.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
    VALUES ('p6','alice','Q','s-hidden','2026-09-03','Hidden','video-hidden',300,NULL,'extracted')`);
  assert.deepEqual(await apply(db, [{ op: 'setTimes', performanceId: 'p6', timestamp: 301, endTimestamp: null }], 'video-hidden'), { ok: true });
  assert.deepEqual(timesOf(db, 'p6'), { timestamp: 301, end_timestamp: null });
  db.sqlite.close();
}

/** The relinks of p7, each with the title of the song it lands on: approved A, pending Q, and a song the apply creates. */
const RELINKS_OF_P7: Array<[CorrectionOperation, string]> = [
  [{ op: 'relinkToSong', performanceId: 'p7', songId: 'A' }, 'Song A'],
  [{ op: 'relinkToSong', performanceId: 'p7', songId: 'Q' }, 'Song Q'],
  [{ op: 'relinkToNewSong', performanceId: 'p7', title: 'Song N', originalArtist: 'Artist' }, 'Song N'],
];
const publishesWithNoEnd = (index: number) => ({
  ok: false, status: 400, error: 'invalid_operations', details: [`operation ${index}: a performance the relink publishes needs an end`],
});

async function testARelinkThatPublishesARowWithNoEndIsRefused() {
  // On an approved stream a relink publishes an approved row whose song is not approved, whatever it lands on: an
  // approved song, a song the apply creates (born approved there), or a pending one the apply promotes. p7 has no end,
  // so the relink is refused. A time edit that gives no end leaves it with none: one that moves the start, or one that
  // sends the empty end back empty.
  const startOnly: CorrectionOperation = { op: 'setTimes', performanceId: 'p7', timestamp: 701 };
  const stillEndless: CorrectionOperation = { op: 'setTimes', performanceId: 'p7', endTimestamp: null };
  for (const [relink] of RELINKS_OF_P7) {
    const db = fixture();
    db.sqlite.exec(ENDLESS_P7);
    const batches = db.batches.length;
    const songs = count(db, 'songs');
    assert.deepEqual(await apply(db, [relink]), publishesWithNoEnd(0), JSON.stringify(relink));
    assert.deepEqual(await apply(db, [startOnly, relink]), publishesWithNoEnd(1), `${JSON.stringify(relink)}, after a new start`);
    assert.deepEqual(await apply(db, [relink, stillEndless]), publishesWithNoEnd(0), `${JSON.stringify(relink)}, before an empty end`);
    assert.equal(db.batches.length, batches, `${JSON.stringify(relink)}: nothing is written`);
    assert.equal(count(db, 'songs'), songs, `${JSON.stringify(relink)}: no song is created`);
    assert.deepEqual([songOf(db, 'p7'), timesOf(db, 'p7')], ['P', { timestamp: 700, end_timestamp: null }], `${JSON.stringify(relink)}: p7 is as it was`);
    db.sqlite.close();
  }

  // The relink is checked once every operation is planned, and its problem is still listed in operation order.
  const db = fixture();
  db.sqlite.exec(ENDLESS_P7);
  const blank: CorrectionOperation = { op: 'addPerformance', title: ' ', originalArtist: 'Artist', timestamp: 900, endTimestamp: 950 };
  assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p7', songId: 'A' }, blank]), {
    ok: false, status: 400, error: 'invalid_operations',
    details: ['operation 0: a performance the relink publishes needs an end', 'operation 1: title must not be empty'],
  });
  db.sqlite.close();
}

async function testARelinkWithAnEndFromTheSameApplyGoesThrough() {
  // What counts is the end p7 has once the apply is done: a time edit in the same apply gives it one, sent before the
  // relink or after it. p7 then goes on the site with that end, its song approved.
  const end: CorrectionOperation = { op: 'setTimes', performanceId: 'p7', endTimestamp: 800 };
  for (const [relink, title] of RELINKS_OF_P7) {
    for (const operations of [[end, relink], [relink, end]]) {
      const db = fixture();
      db.sqlite.exec(ENDLESS_P7);
      assert.deepEqual(await apply(db, operations), { ok: true }, JSON.stringify(operations));
      assert.deepEqual(exportedOf(db, 'p7'), { status: 'approved', end_timestamp: 800, song_status: 'approved', title }, JSON.stringify(operations));
      db.sqlite.close();
    }
  }
}

async function testARelinkOfAnOnSiteRowWithNoEndGoesThrough() {
  // p1 is on the site with no end: it is in the VOD export already, and a relink keeps it there, so refusing it would
  // block every correction of the row that is not about its end. That holds onto a pending song the apply promotes as
  // well, by id or by identity: the check before the promotion inside the batch leaves out the row the batch relinked.
  for (const [relink, title] of [
    [{ op: 'relinkToSong', performanceId: 'p1', songId: 'B' }, 'Song B'],
    [{ op: 'relinkToNewSong', performanceId: 'p1', title: 'Song N', originalArtist: 'Artist' }, 'Song N'],
    [{ op: 'relinkToSong', performanceId: 'p1', songId: 'Q' }, 'Song Q'],
    [{ op: 'relinkToNewSong', performanceId: 'p1', title: 'Song Q', originalArtist: 'Artist' }, 'Song Q'],
  ] satisfies Array<[CorrectionOperation, string]>) {
    const db = fixture();
    db.sqlite.exec("UPDATE performances SET end_timestamp = NULL WHERE id = 'p1'");
    assert.deepEqual(await apply(db, [relink]), { ok: true }, JSON.stringify(relink));
    assert.deepEqual(exportedOf(db, 'p1'), { status: 'approved', end_timestamp: null, song_status: 'approved', title }, JSON.stringify(relink));
    db.sqlite.close();
  }

  // Only that row is left out: another approved row of Q with no end on an approved stream still stops the promotion.
  const db = fixture();
  db.sqlite.exec(`UPDATE performances SET end_timestamp = NULL WHERE id = 'p1'; ${ENDLESS_P8}`);
  const batches = db.batches.length;
  assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p1', songId: 'Q' }]), {
    ok: false, status: 409, error: 'would_publish_endless', performances: [{ performanceId: 'p8', streamId: 's-other', songId: 'Q' }],
  });
  assert.equal(db.batches.length, batches, 'nothing is written');
  assert.deepEqual([songOf(db, 'p1'), songStatusOf(db, 'Q')], ['A', 'pending']);
  db.sqlite.close();
}

async function testTheRelinkEndRuleHoldsOnlyOnAnApprovedStream() {
  // On a stream that is not approved nothing is promoted and the VOD export leaves the stream's rows out, so a relink
  // there needs no end: p5, an approved row of pending P on s-hidden with its end taken off, may be relinked onto
  // pending Q, which stays pending, so its p8 on s-other stays out of the export. The rules of what the site shows
  // still stand: onto approved A the relink would publish p5.
  for (const status of NOT_APPROVED) {
    const db = fixture();
    db.sqlite.exec(`UPDATE streams SET status = '${status}' WHERE id = 's-hidden'; UPDATE performances SET end_timestamp = NULL WHERE id = 'p5'; ${ENDLESS_P8}`);
    assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p5', songId: 'A' }], 'video-hidden'), {
      ok: false, status: 409, error: 'would_publish_hidden', performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'A' }],
    }, `${status}: onto approved A`);
    assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p5', songId: 'Q' }], 'video-hidden'), { ok: true }, `${status}: onto pending Q`);
    assert.deepEqual([songOf(db, 'p5'), timesOf(db, 'p5'), songStatusOf(db, 'Q')], ['Q', { timestamp: 100, end_timestamp: null }, 'pending'], status);
    db.sqlite.close();
  }
}

async function testAPromotionThatPublishesARowWithNoEndIsRefused() {
  // An add or a relink that lands on pending Q promotes it along with the apply, which publishes every approved row of
  // Q on an approved stream. p8, on s-other, has no end.
  for (const landing of [
    ADD_Q,
    { op: 'relinkToSong', performanceId: 'p2', songId: 'Q' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song Q', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    const db = fixture();
    db.sqlite.exec(ENDLESS_P8);
    const batches = db.batches.length;
    assert.deepEqual(await apply(db, [landing]), {
      ok: false, status: 409, error: 'would_publish_endless', performances: [{ performanceId: 'p8', streamId: 's-other', songId: 'Q' }],
    }, landing.op);
    assert.equal(db.batches.length, batches, `${landing.op}: nothing is written`);
    assert.deepEqual([songStatusOf(db, 'Q'), songOf(db, 'p2'), count(db, 'performances', "stream_id = 's-pub'")], ['pending', 'B', 3],
      `${landing.op}: Q stays pending, p2 on B, and no row is added`);
    db.sqlite.close();
  }

  // Every such row is listed, by song, then stream, then id, as would_publish_hidden lists its rows: O's row first, then
  // Q's on s-other before Q's on s-pub, whose ids run the other way.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('O','alice','Song O','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES
      ('q-a','alice','Q','s-pub','2026-09-01','Pub','video-pub',900,NULL,'approved'),
      ('q-b','alice','Q','s-other','2026-09-02','Other','video-other',300,NULL,'approved'),
      ('o-z','alice','O','s-other','2026-09-02','Other','video-other',500,NULL,'approved')`);
  assert.deepEqual(await apply(db, [ADD_Q, { op: 'relinkToSong', performanceId: 'p2', songId: 'O' }]), {
    ok: false, status: 409, error: 'would_publish_endless', performances: [
      { performanceId: 'o-z', streamId: 's-other', songId: 'O' },
      { performanceId: 'q-b', streamId: 's-other', songId: 'Q' },
      { performanceId: 'q-a', streamId: 's-pub', songId: 'Q' },
    ],
  });
  db.sqlite.close();

  // A row that is not approved stays out of the export whatever its song: p8 pending, Q's promotion goes through.
  const pending = fixture();
  pending.sqlite.exec(`${ENDLESS_P8}; UPDATE performances SET status = 'pending' WHERE id = 'p8'`);
  assert.deepEqual(await apply(pending, [ADD_Q]), { ok: true });
  assert.deepEqual([songStatusOf(pending, 'Q'), timesOf(pending, 'p8')], ['approved', { timestamp: 300, end_timestamp: null }]);
  pending.sqlite.close();
}

async function testAPromotionSparesTheRowsTheApplyEndsOrMoves() {
  // p9 is a row of the stream itself: promoting Q publishes it as it publishes p8 on another stream. A time edit that
  // gives it no end spares it from nothing: one that moves its start, or one that sends its empty end back empty.
  const refusal = { ok: false, status: 409, error: 'would_publish_endless', performances: [{ performanceId: 'p9', streamId: 's-pub', songId: 'Q' }] };
  const refused = fixture();
  refused.sqlite.exec(ENDLESS_P9);
  assert.deepEqual(await apply(refused, [ADD_Q]), refusal);
  assert.deepEqual(await apply(refused, [{ op: 'setTimes', performanceId: 'p9', timestamp: 901 }, ADD_Q]), refusal, 'after a new start');
  assert.deepEqual(await apply(refused, [{ op: 'setTimes', performanceId: 'p9', endTimestamp: null }, ADD_Q]), refusal, 'after an empty end');
  assert.equal(refused.batches.length, 0, 'nothing is written');
  refused.sqlite.close();

  // The apply goes through when it gives p9 an end or deletes it, whichever row of Q it adds.
  const ended = fixture();
  ended.sqlite.exec(ENDLESS_P9);
  assert.deepEqual(await apply(ended, [{ op: 'setTimes', performanceId: 'p9', endTimestamp: 950 }, ADD_Q]), { ok: true }, 'an end');
  assert.deepEqual([exportedOf(ended, 'p9'), count(ended, 'performances', "song_id = 'Q'")], [
    { status: 'approved', end_timestamp: 950, song_status: 'approved', title: 'Song Q' }, 2,
  ], 'p9 is on the site with its end, beside the added row');
  ended.sqlite.close();
  const deleted = fixture();
  deleted.sqlite.exec(ENDLESS_P9);
  assert.deepEqual(await apply(deleted, [{ op: 'deletePerformance', performanceId: 'p9' }, ADD_Q]), { ok: true }, 'a delete');
  assert.deepEqual([count(deleted, 'performances', "id = 'p9'"), songStatusOf(deleted, 'Q')], [0, 'approved']);
  deleted.sqlite.close();

  // A relink of p9 away from Q publishes p9 itself, so it needs an end of its own; given one, the apply goes through.
  const moved = fixture();
  moved.sqlite.exec(ENDLESS_P9);
  const relinkAway: CorrectionOperation = { op: 'relinkToSong', performanceId: 'p9', songId: 'A' };
  assert.deepEqual(await apply(moved, [relinkAway, ADD_Q]), publishesWithNoEnd(0), 'relinked away with no end');
  assert.deepEqual(await apply(moved, [relinkAway, { op: 'setTimes', performanceId: 'p9', endTimestamp: 950 }, ADD_Q]), { ok: true }, 'and with one');
  assert.deepEqual([exportedOf(moved, 'p9'), songStatusOf(moved, 'Q')], [
    { status: 'approved', end_timestamp: 950, song_status: 'approved', title: 'Song A' }, 'approved',
  ]);
  moved.sqlite.close();

  // A row relinked away is no row of Q's once the batch runs, so the check before it leaves the row out, as the one
  // inside it does. Seen only when Q's status moved after the review loaded: approved then, p9 was on the site and its
  // relink needed no end; pending now, Q is promoted again. The batch then answers that the review is stale.
  const raced = fixture();
  raced.sqlite.exec(`${ENDLESS_P9}; UPDATE songs SET status = 'approved' WHERE id = 'Q'`);
  const target = await targetOf(raced);
  raced.sqlite.exec("UPDATE songs SET status = 'pending' WHERE id = 'Q'");
  assert.deepEqual(await applyCorrection(raced.binding, target, [relinkAway, ADD_Q], CURATOR, recordFor()), { ok: false, status: 409, error: 'stale' });
  assert.deepEqual([songOf(raced, 'p9'), songStatusOf(raced, 'Q'), count(raced, 'merge_guards')], ['Q', 'pending', 0], 'nothing is written');
  raced.sqlite.close();
}

// The 2026-11-16 review's #13: p10, a row of approved B on s-pub that is not approved (so off the site), and p11, an
// approved row of pending Q with no end on approved s-other, which promoting Q would put in the export.
const hiddenP10 = (status: 'pending' | 'extracted') => `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
  VALUES ('p10','alice','B','s-pub','2026-09-01','Pub','video-pub',650,690,'${status}')`;
const ENDLESS_P11 = `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
  VALUES ('p11','alice','Q','s-other','2026-09-02','Other','video-other',500,NULL,'approved')`;

async function testARelinkOfAHiddenRowPromotesNothing() {
  // A relink keeps its row's status: p10 stays off the site whatever song it lands on, so the apply approves no song for
  // it (as ruled for #13: spec §6.4 promotes so that a relinked row does not vanish from the site, which p10 cannot).
  // Relinked to pending Q, by id or by identity, the apply goes through: p10 stays as it was but for its song, and Q
  // stays pending, so its p11 stays out of the export. Promoting Q would be refused over p11 (409 would_publish_endless,
  // as testAPromotionThatPublishesARowWithNoEndIsRefused pins for an approved row), and with no p11 it would approve Q.
  for (const status of ['pending', 'extracted'] as const) {
    for (const seed of [ENDLESS_P11, '']) {
      for (const relink of [
        { op: 'relinkToSong', performanceId: 'p10', songId: 'Q' },
        { op: 'relinkToNewSong', performanceId: 'p10', title: 'Song Q', originalArtist: 'Artist' },
      ] satisfies CorrectionOperation[]) {
        const what = `${status}, ${seed ? 'with p11' : 'Q sung nowhere'}: ${relink.op}`;
        const db = fixture();
        db.sqlite.exec(`${hiddenP10(status)}; ${seed}`);
        assert.deepEqual(await apply(db, [relink]), { ok: true }, what);
        assert.deepEqual(
          [songOf(db, 'p10'), exportedOf(db, 'p10'), songStatusOf(db, 'Q'), count(db, 'songs', "title = 'Song Q'")],
          ['Q', { status, end_timestamp: 690, song_status: 'pending', title: 'Song Q' }, 'pending', 1],
          `${what}: p10 lands on Q, and both stay pending`,
        );
        db.sqlite.close();
      }
    }
  }

  // Nor does p10's relink onto pending P publish P's approved p5 on s-hidden, which is in the pipeline: promoting P would
  // be refused over p5 (409 would_publish_hidden, as testWouldPublishHidden pins for an approved row).
  const db = fixture();
  db.sqlite.exec(hiddenP10('pending'));
  assert.deepEqual(await apply(db, [{ op: 'relinkToSong', performanceId: 'p10', songId: 'P' }]), { ok: true });
  assert.deepEqual(
    [songOf(db, 'p10'), exportedOf(db, 'p5')],
    ['P', { status: 'approved', end_timestamp: 200, song_status: 'pending', title: 'Song P' }],
    'p10 lands on P, and P stays pending: p5 stays out of the export',
  );
  db.sqlite.close();
}

async function testRejectsConflictingRenames() {
  const db = fixture();
  const conflicting = await apply(db, [
    { op: 'renameSong', songId: 'A', title: 'Song X' },
    { op: 'renameSong', songId: 'A', title: 'Song Y' },
  ]);
  assert.ok(!conflicting.ok && conflicting.status === 400, 'one song cannot take two names');
  assert.match(conflicting.details[0], /^operation 1: /);
  assert.equal(titleOf(db, 'A'), 'Song A');
  const batches = db.batches.length;
  assert.deepEqual(await apply(db, [
    { op: 'renameSong', songId: 'A', title: 'Song X' },
    { op: 'renameSong', songId: 'A', title: 'Song X' },
  ]), { ok: true });
  assert.equal(db.batches.length, batches + 1);
  assert.equal(db.batches.at(-1)!.length, 5, 'identical renames collapse into one: the guard, then ensure the work, update the song, relink, then the apply record');
  assert.equal(titleOf(db, 'A'), 'Song X');
  db.sqlite.close();
}

async function testRejectsForeignPerformance() {
  const db = fixture();
  const result = await apply(db, [{ op: 'setTimes', performanceId: 'p4', timestamp: 101 }]);
  assert.ok(!result.ok && result.status === 400, 'p4 belongs to s-other');
  assert.deepEqual(timesOf(db, 'p4'), { timestamp: 100, end_timestamp: 200 });
  db.sqlite.close();
}

async function testRejectsForeignRename() {
  const db = fixture();
  const result = await apply(db, [{ op: 'renameSong', songId: 'Q', title: 'Song Q2' }]);
  assert.ok(!result.ok && result.status === 400, 'Q is sung nowhere on s-pub');
  assert.equal(titleOf(db, 'Q'), 'Song Q');
  db.sqlite.close();
}

async function testRejectsBadTargetsAndConflicts() {
  const db = fixture();
  db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('R','alice','Song R','Artist','rejected'), ('bob-A','bob','Song A','Artist','approved')`);
  const batches = db.batches.length;
  const setTimes = (timestamp: number): CorrectionOperation => ({ op: 'setTimes', performanceId: 'p1', timestamp });
  const cases: Array<[CorrectionOperation[], RegExp]> = [
    [[{ op: 'relinkToSong', performanceId: 'p1', songId: 'bob-A' }], /^operation 0: song bob-A /],
    [[{ op: 'relinkToSong', performanceId: 'p1', songId: 'R' }], /^operation 0: song R /],
    [[{ op: 'relinkToSong', performanceId: 'p1', songId: 'missing' }], /^operation 0: song missing /],
    [[{ op: 'relinkToNewSong', performanceId: 'p4', title: 'Song N', originalArtist: 'Artist' }], /^operation 0: performance p4 /],
    [[{ op: 'deletePerformance', performanceId: 'p5' }], /^operation 0: performance p5 /],
    [[{ op: 'addPerformance', title: '  ', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 }], /^operation 0: title must not be empty/],
    [[{ op: 'relinkToNewSong', performanceId: 'p2', title: '', originalArtist: 'Artist' }], /^operation 0: title must not be empty/],
    [[{ op: 'renameSong', songId: 'A', title: ' ' }], /^operation 0: title must not be empty/],
    [[setTimes(101), setTimes(102)], /^operation 1: performance p1 /],
    [[{ op: 'relinkToSong', performanceId: 'p1', songId: 'B' }, { op: 'relinkToNewSong', performanceId: 'p1', title: 'Song N', originalArtist: 'Artist' }], /^operation 1: performance p1 /],
    [[setTimes(101), { op: 'deletePerformance', performanceId: 'p1' }], /^operation 1: performance p1 /],
    [[{ op: 'deletePerformance', performanceId: 'p1' }, { op: 'relinkToSong', performanceId: 'p1', songId: 'B' }], /^operation 1: performance p1 /],
    [[{ op: 'deletePerformance', performanceId: 'p1' }, { op: 'deletePerformance', performanceId: 'p1' }], /^operation 1: performance p1 /],
  ];
  for (const [operations, reason] of cases) {
    const result = await apply(db, operations);
    assert.ok(!result.ok && result.status === 400, JSON.stringify(operations));
    assert.equal(result.details.length, 1, JSON.stringify(result.details));
    assert.match(result.details[0], reason);
  }
  assert.equal(db.batches.length, batches, 'no refused apply writes anything');
  db.sqlite.close();
}

async function testEmptyArtistReadsUnknown() {
  const db = fixture();
  const artistOf = (songId: unknown) => db.sqlite.prepare('SELECT original_artist FROM songs WHERE id = ?').get(String(songId))?.original_artist;
  assert.deepEqual(await apply(db, [
    { op: 'renameSong', songId: 'A', originalArtist: '' },
    { op: 'renameSong', songId: 'A', originalArtist: 'Unknown' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: '' },
    { op: 'addPerformance', title: 'Song Z', originalArtist: '', timestamp: 700, endTimestamp: 800 },
  ]), { ok: true }, "'' and 'Unknown' are the same rename, so the two collapse");
  assert.equal(artistOf('A'), 'Unknown', 'a rename never stores an empty artist');
  assert.equal(artistOf(songOf(db, 'p2')), 'Unknown', 'nor does a new song');
  assert.equal(db.sqlite.prepare("SELECT original_artist FROM songs WHERE title = 'Song Z'").get()?.original_artist, 'Unknown', 'nor an add');
  db.sqlite.close();
}

async function testNoFieldOperationsWriteNothing() {
  const db = fixture();
  const batches = db.batches.length;
  assert.deepEqual(await apply(db, [{ op: 'setTimes', performanceId: 'p1' }, { op: 'renameSong', songId: 'A' }]), { ok: true });
  assert.equal(db.batches.length, batches, 'operations that change nothing send no batch');
  assert.deepEqual(timesOf(db, 'p1'), { timestamp: 100, end_timestamp: 200 });
  assert.equal(titleOf(db, 'A'), 'Song A');
  db.sqlite.close();
}

// Renames run first inside the batch, so every identity an apply resolves must be read as the
// catalog will stand after them, never as it stood before.
async function testResolutionSeesRenames() {
  const away = fixture();
  assert.deepEqual(await apply(away, [
    { op: 'renameSong', songId: 'A', title: 'Song A2' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song A', originalArtist: 'Artist' },
  ]), { ok: true });
  assert.equal(titleOf(away, 'A'), 'Song A2');
  assert.notEqual(songOf(away, 'p2'), 'A', 'A gave up the name p2 asked for');
  assert.equal(titleOf(away, songOf(away, 'p2')), 'Song A');
  away.sqlite.close();

  const into = fixture();
  assert.deepEqual(await apply(into, [
    { op: 'renameSong', songId: 'A', title: 'Song A2' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song A2', originalArtist: 'Artist' },
  ]), { ok: true });
  assert.equal(songOf(into, 'p2'), 'A', 'A takes the name p2 asked for, so p2 joins it');
  assert.equal(count(into, 'songs', "title = 'Song A2'"), 1, 'no twin is created');
  into.sqlite.close();
}

async function testGuardSeesRenames() {
  const hiddenP = { ok: false, status: 409, error: 'would_publish_hidden', performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'P' }] };
  for (const joining of [
    { op: 'addPerformance', title: 'Song T', originalArtist: 'Artist', timestamp: 900, endTimestamp: 1000 },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song T', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    // P is sung on s-pub, so it can be renamed there; once it is 'Song T' the joining row lands on it.
    const db = fixture();
    db.sqlite.exec("INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES ('p6','alice','P','s-pub','2026-09-01','Pub','video-pub',700,800,'approved')");
    const batches = db.batches.length;
    assert.deepEqual(await apply(db, [{ op: 'renameSong', songId: 'P', title: 'Song T' }, joining]), hiddenP, `${joining.op} onto a renamed pending song`);
    assert.equal(db.batches.length, batches, 'nothing is written');
    db.sqlite.close();
  }
  for (const joining of [
    { op: 'addPerformance', title: 'Song A', originalArtist: 'Artist', timestamp: 900, endTimestamp: 1000 },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song A', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    // Y is a pending twin of A with an approved row on s-hidden: once A is renamed away, 'Song A' means Y.
    const db = fixture();
    db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('Y','alice','Song A','Artist','pending');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES ('p7','alice','Y','s-hidden','2026-09-03','Hidden','video-hidden',300,400,'approved')`);
    assert.deepEqual(await apply(db, [{ op: 'renameSong', songId: 'A', title: 'Song A2' }, joining]), {
      ok: false, status: 409, error: 'would_publish_hidden', performances: [{ performanceId: 'p7', streamId: 's-hidden', songId: 'Y' }],
    }, `${joining.op} onto the twin a rename leaves behind`);
    assert.equal(titleOf(db, 'A'), 'Song A');
    db.sqlite.close();
  }
}

async function testOneBatch() {
  const db = fixture();
  const batches = db.batches.length;
  assert.deepEqual(await apply(db, [
    { op: 'setTimes', performanceId: 'p1', timestamp: 101 },
    { op: 'renameSong', songId: 'A', title: 'Song A2' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: 'Artist' },
    ADD_Z,
    { op: 'deletePerformance', performanceId: 'p3' },
  ]), { ok: true });
  assert.equal(db.batches.length, batches + 1, 'five operations, one batch');
  assert.deepEqual(timesOf(db, 'p1'), { timestamp: 101, end_timestamp: 200 });
  assert.equal(titleOf(db, 'A'), 'Song A2');
  assert.equal(titleOf(db, songOf(db, 'p2')), 'Song N');
  assert.equal(count(db, 'performances', "stream_id = 's-pub'"), 3, 'p1, p2 and the added Z; p3 is gone');
  assert.equal(count(db, 'songs', "id IN ('B', 'C')"), 0, 'both orphans are gone');
  db.sqlite.close();
}

async function test200SetTimesOneBatch() {
  const db = fixture();
  db.sqlite.exec(`
    INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status)
      VALUES ('s-big','alice','Big','2026-09-04','video-big','https://example.com/big','approved');
    WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 199)
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
      SELECT 'big-' || i, 'alice', 'A', 's-big', '2026-09-04', 'Big', 'video-big', i * 300, i * 300 + 200, 'approved' FROM n;
  `);
  const target = await targetOf(db, 'video-big');
  assert.equal(target.current.length, 200);
  const operations = target.current.map((row): CorrectionOperation => ({ op: 'setTimes', performanceId: row.performanceId, timestamp: row.timestamp + 1 }));
  const batches = db.batches.length;
  assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR, recordFor()), { ok: true });
  assert.equal(db.batches.length, batches + 1, '200 operations, one batch');
  assert.ok(db.batches.at(-1)!.every((s) => s.params.length <= 100), 'no statement binds more than 100 parameters');
  assert.equal(count(db, 'performances', "stream_id = 's-big' AND timestamp % 300 = 1"), 200);
  db.sqlite.close();
}

async function testBatchRefusesRowsThatMoved() {
  // An edit or another apply can commit between the load the operations were checked against and
  // the batch. The batch reads the rows again and writes nothing when any of them moved.
  const moves: Array<[string, string]> = [
    ['a time edit', "UPDATE performances SET end_timestamp = 250 WHERE id = 'p1'"],
    ['a rename', "UPDATE songs SET title = 'Song A!' WHERE id = 'A'"],
    ['a relink', "UPDATE performances SET song_id = 'C' WHERE id = 'p1'"],
    ['a new row', `INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
      VALUES ('p9','alice','C','s-pub','2026-09-01','Pub','video-pub',900,950,'approved')`],
    ['a removed row', "DELETE FROM performances WHERE id = 'p3'"],
    ["a row's status", "UPDATE performances SET status = 'pending' WHERE id = 'p1'"],
    ["a song's status", "UPDATE songs SET status = 'pending' WHERE id = 'B'"],
    ["the stream's status", "UPDATE streams SET status = 'pending' WHERE id = 's-pub'"],
    ["the stream's video", "UPDATE streams SET video_id = 'video-moved' WHERE id = 's-pub'"],
    ["the stream's title", "UPDATE streams SET title = 'Pub!' WHERE id = 's-pub'"],
    ["the stream's date", "UPDATE streams SET date = '2026-09-09' WHERE id = 's-pub'"],
  ];
  for (const [move, sql] of moves) {
    const db = fixture();
    const target = await targetOf(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec(sql);
    };
    const operations: CorrectionOperation[] = [{ op: 'setTimes', performanceId: 'p2', timestamp: 301 }, ADD_Z];
    assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR, recordFor()), { ok: false, status: 409, error: 'stale' }, move);
    assert.deepEqual(timesOf(db, 'p2'), { timestamp: 300, end_timestamp: 400 }, `${move}: the time edit is rolled back`);
    assert.equal(count(db, 'songs', "title = 'Song Z'"), 0, `${move}: so is the add`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: the guard leaves no row behind`);
    db.sqlite.close();
  }
}

async function testPromotionRecheckedInsideTheBatch() {
  // The hidden-row check reads the catalog before the batch. A row that turns hidden after it,
  // on another stream the target guard does not read, must still stop the promotion.
  const added = fixture();
  const addTarget = await targetOf(added);
  added.beforeBatch = async () => {
    added.beforeBatch = undefined;
    added.sqlite.exec(`INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
      VALUES ('p6','alice','Q','s-hidden','2026-09-03','Hidden','video-hidden',300,400,'approved')`);
  };
  const addQ: CorrectionOperation = { op: 'addPerformance', title: 'Song Q', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 };
  assert.deepEqual(await applyCorrection(added.binding, addTarget, [addQ], CURATOR, recordFor()), {
    ok: false, status: 409, error: 'would_publish_hidden',
    performances: [{ performanceId: 'p6', streamId: 's-hidden', songId: 'Q' }],
  }, 'Q gained an approved row on a hidden stream after the check');
  assert.equal(count(added, 'performances', "stream_id = 's-pub'"), 3, 'the add is rolled back');
  assert.equal(added.sqlite.prepare("SELECT status FROM songs WHERE id = 'Q'").get()?.status, 'pending', 'Q is not promoted');
  assert.equal(count(added, 'merge_guards'), 0);
  added.sqlite.close();

  const relinked = fixture();
  relinked.sqlite.exec("UPDATE performances SET status = 'pending' WHERE id = 'p5'");
  const relinkTarget = await targetOf(relinked);
  relinked.beforeBatch = async () => {
    relinked.beforeBatch = undefined;
    relinked.sqlite.exec("UPDATE performances SET status = 'approved' WHERE id = 'p5'");
  };
  assert.deepEqual(await applyCorrection(relinked.binding, relinkTarget, [{ op: 'relinkToSong', performanceId: 'p3', songId: 'P' }], CURATOR, recordFor()), {
    ok: false, status: 409, error: 'would_publish_hidden',
    performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'P' }],
  }, "P's row on the hidden stream was approved after the check");
  assert.equal(songOf(relinked, 'p3'), 'C', 'the relink is rolled back');
  assert.equal(relinked.sqlite.prepare("SELECT status FROM songs WHERE id = 'P'").get()?.status, 'pending', 'P is not promoted');
  relinked.sqlite.close();
}

async function testPromotionRecheckedForEndsInsideTheBatch() {
  // The end check reads Q's rows before the batch too. A row of Q on another approved stream (the target guard reads
  // this one's) that loses its end after the check, or a row with no end that Q gains, must still stop the promotion,
  // and the answer must say why rather than fail as an error. So must one that comes while the batch relinks p1, on the
  // site with no end, onto Q: the check inside the batch leaves out p1 alone.
  const endlessP1 = "UPDATE performances SET end_timestamp = NULL WHERE id = 'p1'";
  // p8 as it was before it lost its end.
  const endedP8 = ENDLESS_P8.replace('300,NULL', '300,400');
  const cases: Array<[string, string, CorrectionOperation, string]> = [
    ['a row of Q loses its end', endedP8, ADD_Q, "UPDATE performances SET end_timestamp = NULL WHERE id = 'p8'"],
    ['Q gains a row with no end', '', ADD_Q, ENDLESS_P8],
    ['Q gains one while an on-site row with no end is relinked onto it', endlessP1, { op: 'relinkToSong', performanceId: 'p1', songId: 'Q' }, ENDLESS_P8],
  ];
  for (const [move, seed, operation, sql] of cases) {
    const db = fixture();
    if (seed) db.sqlite.exec(seed);
    const target = await targetOf(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec(sql);
    };
    assert.deepEqual(await applyCorrection(db.binding, target, [operation], CURATOR, recordFor()), {
      ok: false, status: 409, error: 'would_publish_endless', performances: [{ performanceId: 'p8', streamId: 's-other', songId: 'Q' }],
    }, move);
    assert.equal(db.batches.length, 1, `${move}: the check passed and the batch ran`);
    assert.deepEqual([count(db, 'performances', "stream_id = 's-pub'"), songOf(db, 'p1')], [3, 'A'], `${move}: the add or the relink is rolled back`);
    assert.equal(songStatusOf(db, 'Q'), 'pending', `${move}: Q is not promoted`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: no guard row is left behind`);
    db.sqlite.close();
  }
}

async function testADestinationThatTurnsPendingIsReadAgainForEnds() {
  // D is approved when the apply is checked, so the check has nothing to promote and nothing to refuse. Before the batch
  // runs it is set back to pending while it has an approved row with no end, pd, on approved s-other: the batch would
  // now promote D and put pd in the export, so its guard fails. A relink onto D, and a new song that matches D, pin the
  // status the plan read, so for them the batch stops at its first guard, as stale. An add that lands on D pins nothing:
  // the catch must read the catalog afresh, D pending included, to name pd (409), and not end in the batch's own error,
  // a 500.
  const stale = { ok: false, status: 409, error: 'stale' };
  const endless = { ok: false, status: 409, error: 'would_publish_endless', performances: [{ performanceId: 'pd', streamId: 's-other', songId: 'D' }] };
  const cases: Array<[string, CorrectionOperation, object]> = [
    ['relinkToSong onto D', { op: 'relinkToSong', performanceId: 'p3', songId: 'D' }, stale],
    ['relinkToNewSong that matches D', { op: 'relinkToNewSong', performanceId: 'p3', title: 'Song D', originalArtist: 'Artist' }, stale],
    ['addPerformance that lands on D', { op: 'addPerformance', title: 'Song D', originalArtist: 'Artist', timestamp: 700, endTimestamp: 800 }, endless],
  ];
  for (const [move, operation, answer] of cases) {
    const db = fixture();
    db.sqlite.exec(`
      INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','approved');
      INSERT INTO works (id,title,original_artist) VALUES ('w-d','Song D','Artist');
      INSERT INTO song_work_links (song_id,work_id,link_method,linked_by) VALUES ('D','w-d','import_exact','seed');
      INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
        VALUES ('pd','alice','D','s-other','2026-09-02','Other','video-other',300,NULL,'approved');
    `);
    const target = await targetOf(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec("UPDATE songs SET status = 'pending' WHERE id = 'D'");
    };
    assert.deepEqual(await applyCorrection(db.binding, target, [operation], CURATOR, recordFor()), answer, move);
    assert.equal(db.batches.length, 1, `${move}: the check passed and the batch ran`);
    assert.deepEqual([songOf(db, 'p3'), count(db, 'performances', "stream_id = 's-pub'")], ['C', 3], `${move}: the relink or the add is rolled back`);
    assert.equal(songStatusOf(db, 'D'), 'pending', `${move}: D is not promoted`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: no guard row is left behind`);
    db.sqlite.close();
  }
}

async function testRelinkDestinationsRecheckedInsideTheBatch() {
  // D is an approved song of alice's sung nowhere, so the target guard never reads it. A relink
  // onto it is planned before the batch; a rejection, or a rename of the song an identity relink
  // was matched to, landing in between must stop the batch.
  const cases: Array<[string, CorrectionOperation, string]> = [
    ['a relinkToSong destination is rejected', { op: 'relinkToSong', performanceId: 'p3', songId: 'D' }, "UPDATE songs SET status = 'rejected' WHERE id = 'D'"],
    ['a relinkToSong destination is deleted', { op: 'relinkToSong', performanceId: 'p3', songId: 'D' }, "DELETE FROM songs WHERE id = 'D'"],
    ['an identity match is renamed', { op: 'relinkToNewSong', performanceId: 'p3', title: 'Song D', originalArtist: 'Artist' }, "UPDATE songs SET title = 'Song D!' WHERE id = 'D'"],
    ['an identity match is rejected', { op: 'relinkToNewSong', performanceId: 'p3', title: 'Song D', originalArtist: 'Artist' }, "UPDATE songs SET status = 'rejected' WHERE id = 'D'"],
  ];
  for (const [move, operation, sql] of cases) {
    const db = fixture();
    db.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','approved')");
    const target = await targetOf(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec(sql);
    };
    assert.deepEqual(await applyCorrection(db.binding, target, [operation], CURATOR, recordFor()), { ok: false, status: 409, error: 'stale' }, move);
    assert.equal(songOf(db, 'p3'), 'C', `${move}: p3 stays on its song`);
    assert.equal(count(db, 'songs', "id = 'C'"), 1, `${move}: C is not dropped as an orphan`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: no guard row is left behind`);
    db.sqlite.close();
  }
}

async function testADestinationDemotedInsideTheBatchIsStale() {
  // The plan reads the status of each song a relink lands on, and the batch pins it. A destination demoted from approved
  // to pending between the plan and the batch must stop the batch: let through, the promotion would approve it again,
  // with every other row of it. D stays as the other curator left it. A pending destination approved meanwhile moved
  // as well: the review was of a song that is no longer the one it showed.
  const relinkD: CorrectionOperation = { op: 'relinkToSong', performanceId: 'p3', songId: 'D' };
  const newD: CorrectionOperation = { op: 'relinkToNewSong', performanceId: 'p3', title: 'Song D', originalArtist: 'Artist' };
  const cases: Array<[string, CorrectionOperation, Status, Status]> = [
    ['a relinkToSong destination is demoted', relinkD, 'approved', 'pending'],
    ['an identity match is demoted', newD, 'approved', 'pending'],
    ['a pending relinkToSong destination is approved', relinkD, 'pending', 'approved'],
    ['a pending identity match is approved', newD, 'pending', 'approved'],
  ];
  for (const [move, operation, before, after] of cases) {
    const db = fixture();
    db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','${before}')`);
    const target = await targetOf(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec(`UPDATE songs SET status = '${after}' WHERE id = 'D'`);
    };
    assert.deepEqual(await applyCorrection(db.binding, target, [operation], CURATOR, recordFor()), { ok: false, status: 409, error: 'stale' }, move);
    assert.equal(db.batches.length, 1, `${move}: the check passed and the batch ran`);
    assert.equal(songOf(db, 'p3'), 'C', `${move}: p3 stays on its song`);
    assert.equal(songStatusOf(db, 'D'), after, `${move}: D is left as it was set, not approved again`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: no guard row is left behind`);
    db.sqlite.close();
  }
}

async function testAnExpectedStatusThatDiffersIsStale() {
  // The page shows the status of the song a relink lands on and sends it back (`expectedSongStatus`), so that a song
  // demoted after the page loaded is refused as stale before the batch, not approved again by its promotion. For a
  // relinkToNewSong it is the status of the song the title and artist resolve to, and null is the page expecting a new
  // song. A relink that carries none checks nothing.
  const relinkD = (expectedSongStatus?: Status): CorrectionOperation =>
    ({ op: 'relinkToSong', performanceId: 'p3', songId: 'D', ...(expectedSongStatus === undefined ? {} : { expectedSongStatus }) });
  const newSong = (title: string, expectedSongStatus?: Status | null): CorrectionOperation =>
    ({ op: 'relinkToNewSong', performanceId: 'p3', title, originalArtist: 'Artist', ...(expectedSongStatus === undefined ? {} : { expectedSongStatus }) });
  // [what the page showed against what D is, D's status, the relink, whether the apply is refused]
  const cases: Array<[string, Status, CorrectionOperation, boolean]> = [
    ['relinkToSong: D was shown pending and is approved', 'approved', relinkD('pending'), true],
    ['relinkToSong: D was shown approved and is pending', 'pending', relinkD('approved'), true],
    ['relinkToSong: D is as it was shown, approved', 'approved', relinkD('approved'), false],
    ['relinkToSong: D is as it was shown, pending', 'pending', relinkD('pending'), false],
    ['relinkToSong: no status shown, nothing is checked', 'pending', relinkD(), false],
    ['relinkToNewSong: Song D was shown pending and is approved', 'approved', newSong('Song D', 'pending'), true],
    ['relinkToNewSong: Song D was shown approved and is pending', 'pending', newSong('Song D', 'approved'), true],
    ['relinkToNewSong: a new song was expected, and Song D exists', 'approved', newSong('Song D', null), true],
    ['relinkToNewSong: an existing song was expected, and none holds Song N', 'approved', newSong('Song N', 'approved'), true],
    ['relinkToNewSong: Song D is as it was shown', 'approved', newSong('Song D', 'approved'), false],
    ['relinkToNewSong: a new song was expected, and Song N is new', 'approved', newSong('Song N', null), false],
    ['relinkToNewSong: no status shown, nothing is checked', 'pending', newSong('Song D'), false],
  ];
  for (const [move, status, operation, refused] of cases) {
    const db = fixture();
    db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','${status}')`);
    const result = await apply(db, [operation]);
    if (refused) {
      assert.deepEqual(result, { ok: false, status: 409, error: 'stale' }, move);
      assert.equal(db.batches.length, 0, `${move}: it is refused before the batch`);
      assert.equal(songOf(db, 'p3'), 'C', `${move}: p3 stays on its song`);
      assert.equal(songStatusOf(db, 'D'), status, `${move}: D is untouched`);
    } else {
      assert.deepEqual(result, { ok: true }, move);
      assert.equal(titleOf(db, songOf(db, 'p3')), operation.op === 'relinkToNewSong' ? operation.title : 'Song D', `${move}: p3 is relinked`);
    }
    db.sqlite.close();
  }

  // The status the page showed is the first thing read: D, demoted, now has an approved row with no end, which the
  // promotion would publish (409 would_publish_endless). The review no longer shows D, so it is stale first.
  const demoted = fixture();
  demoted.sqlite.exec(`
    INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','pending');
    INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status)
      VALUES ('pd','alice','D','s-other','2026-09-02','Other','video-other',300,NULL,'approved');
  `);
  assert.deepEqual(await apply(demoted, [relinkD('approved')]), { ok: false, status: 409, error: 'stale' }, 'D was shown approved');
  assert.deepEqual(await apply(demoted, [relinkD()]), {
    ok: false, status: 409, error: 'would_publish_endless', performances: [{ performanceId: 'pd', streamId: 's-other', songId: 'D' }],
  }, 'with nothing shown, the apply is refused for the row it would publish');
  assert.equal(demoted.batches.length, 0, 'neither reached the batch');
  demoted.sqlite.close();
}

async function testNewSongIdentityRecheckedInsideTheBatch() {
  // The catalog has no 'Song N', so the plan creates it for p2's relink. Another apply (on any
  // stream) can create one first; the batch must then stop instead of minting a twin, and a reload
  // relinks to the song that now exists.
  const db = fixture();
  const target = await targetOf(db);
  db.beforeBatch = async () => {
    db.beforeBatch = undefined;
    db.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('N1','alice','Song N','Artist','approved')");
  };
  const relinkN: CorrectionOperation = { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: 'Artist' };
  assert.deepEqual(await applyCorrection(db.binding, target, [relinkN], CURATOR, recordFor()), { ok: false, status: 409, error: 'stale' });
  assert.equal(count(db, 'songs', "title = 'Song N'"), 1, 'no twin is created');
  assert.equal(songOf(db, 'p2'), 'B', 'p2 stays on its song');
  assert.equal(count(db, 'merge_guards'), 0);

  assert.deepEqual(await apply(db, [relinkN]), { ok: true }, 'the reload applies');
  assert.equal(songOf(db, 'p2'), 'N1', 'onto the song that now exists');
  db.sqlite.close();
}

async function testIdentityRelinkMustStillRankFirst() {
  // When the plan runs, approved N1 ranks first for 'Song N' (N0 is older but pending; R holds
  // another name). A rival that comes to outrank N1 before the batch must stop it: an add of the
  // same name inside the batch would pick the rival while the relink kept N1.
  const cases: Array<[string, CorrectionOperation[], string]> = [
    ['an older pending rival is approved', [], "UPDATE songs SET status = 'approved' WHERE id = 'N0'"],
    ['an older song is renamed into the name', [], "UPDATE songs SET title = 'Song N' WHERE id = 'R'"],
    [
      'the pick drops below a song this batch renames into the name',
      [{ op: 'renameSong', songId: 'A', title: 'Song N' }],
      // N0 goes too, so only A, approved and renamed into the name by this batch, can outrank N1.
      "DELETE FROM songs WHERE id = 'N0'; UPDATE songs SET status = 'pending' WHERE id = 'N1'",
    ],
  ];
  for (const [move, renames, sql] of cases) {
    const db = fixture();
    db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status,created_at) VALUES
      ('N0','alice','Song N','Artist','pending','2026-01-01 00:00:00'),
      ('N1','alice','Song N','Artist','approved','2026-02-01 00:00:00'),
      ('R','alice','Other','Artist','approved','2026-01-01 00:00:00')`);
    const target = await targetOf(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec(sql);
    };
    const operations: CorrectionOperation[] = [...renames, { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: 'Artist' }];
    assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR, recordFor()), { ok: false, status: 409, error: 'stale' }, move);
    assert.equal(songOf(db, 'p2'), 'B', `${move}: p2 stays on its song`);
    assert.equal(titleOf(db, 'A'), 'Song A', `${move}: nothing else is written`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: no guard row is left behind`);
    db.sqlite.close();
  }

  // Unmoved, the same relink lands on N1.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO songs (id,streamer_id,title,original_artist,status,created_at) VALUES
    ('N0','alice','Song N','Artist','pending','2026-01-01 00:00:00'),
    ('N1','alice','Song N','Artist','approved','2026-02-01 00:00:00')`);
  assert.deepEqual(await apply(db, [{ op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: 'Artist' }]), { ok: true });
  assert.equal(songOf(db, 'p2'), 'N1');
  db.sqlite.close();
}

async function testRelinkNeverPublishesOnAStreamThatIsNotApproved() {
  // s-hidden is not approved, and its p5 is an approved row of pending P, which the export leaves
  // out. Relinking p5 onto an approved song would publish it, whether by id or by identity.
  const refusal = { ok: false, status: 409, error: 'would_publish_hidden', performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'A' }] };
  for (const operation of [
    { op: 'relinkToSong', performanceId: 'p5', songId: 'A' },
    { op: 'relinkToNewSong', performanceId: 'p5', title: 'Song A', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    const db = fixture();
    const batches = db.batches.length;
    assert.deepEqual(await apply(db, [operation], 'video-hidden'), refusal, operation.op);
    assert.equal(songOf(db, 'p5'), 'P', `${operation.op}: p5 stays on P`);
    assert.equal(db.batches.length, batches, `${operation.op}: nothing is written`);
    db.sqlite.close();
  }

  // Onto pending Q it stays out of the export, so that relink applies.
  const pending = fixture();
  assert.deepEqual(await apply(pending, [{ op: 'relinkToSong', performanceId: 'p5', songId: 'Q' }], 'video-hidden'), { ok: true });
  assert.equal(songOf(pending, 'p5'), 'Q');
  pending.sqlite.close();

  // The batch opens by checking that Q still has the status the plan read, pending: approved after the check, it would
  // publish p5, and the batch stops as stale.
  const raced = fixture();
  const target = await targetOf(raced, 'video-hidden');
  raced.beforeBatch = async () => {
    raced.beforeBatch = undefined;
    raced.sqlite.exec("UPDATE songs SET status = 'approved' WHERE id = 'Q'");
  };
  assert.deepEqual(
    await applyCorrection(raced.binding, target, [{ op: 'relinkToSong', performanceId: 'p5', songId: 'Q' }], CURATOR, recordFor()),
    { ok: false, status: 409, error: 'stale' },
    'Q was approved between the check and the batch',
  );
  assert.equal(songOf(raced, 'p5'), 'P', 'the relink is rolled back');
  assert.equal(count(raced, 'merge_guards'), 0);
  raced.sqlite.close();
}

async function testRelinkNeverUnpublishesOnAStreamThatIsNotApproved() {
  // p6 is on the site (ON_SITE_P6). Nothing promotes a song off an approved stream, so a relink of p6 onto a song that
  // is not approved takes it off the site: onto pending Q, by id or by identity, or onto a song the apply creates,
  // which is born pending there.
  const refusal = { ok: false, status: 409, error: 'would_unpublish', performanceIds: ['p6'] };
  for (const operation of [
    { op: 'relinkToSong', performanceId: 'p6', songId: 'Q' },
    { op: 'relinkToNewSong', performanceId: 'p6', title: 'Song Q', originalArtist: 'Artist' },
    { op: 'relinkToNewSong', performanceId: 'p6', title: 'Song N', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    const db = fixture();
    db.sqlite.exec(ON_SITE_P6);
    const batches = db.batches.length;
    assert.deepEqual(await apply(db, [operation], 'video-hidden'), refusal, JSON.stringify(operation));
    assert.equal(songOf(db, 'p6'), 'B', `${JSON.stringify(operation)}: p6 stays on B`);
    assert.equal(db.batches.length, batches, `${JSON.stringify(operation)}: nothing is written`);
    db.sqlite.close();
  }

  // Onto approved C it stays on the site, so those relinks apply.
  for (const operation of [
    { op: 'relinkToSong', performanceId: 'p6', songId: 'C' },
    { op: 'relinkToNewSong', performanceId: 'p6', title: 'Song C', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    const db = fixture();
    db.sqlite.exec(ON_SITE_P6);
    assert.deepEqual(await apply(db, [operation], 'video-hidden'), { ok: true }, operation.op);
    assert.equal(songOf(db, 'p6'), 'C', `${operation.op} lands p6 on C`);
    db.sqlite.close();
  }

  // The batch opens by checking that D still has the status the plan read. D is an approved song sung nowhere, so the
  // target guard never reads it; turned pending after the check, it would take p6 off the site, and the batch stops as
  // stale.
  for (const operation of [
    { op: 'relinkToSong', performanceId: 'p6', songId: 'D' },
    { op: 'relinkToNewSong', performanceId: 'p6', title: 'Song D', originalArtist: 'Artist' },
  ] satisfies CorrectionOperation[]) {
    const db = fixture();
    db.sqlite.exec(ON_SITE_P6);
    db.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','approved')");
    const target = await targetOf(db, 'video-hidden');
    const batches = db.batches.length;
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.sqlite.exec("UPDATE songs SET status = 'pending' WHERE id = 'D'");
    };
    assert.deepEqual(
      await applyCorrection(db.binding, target, [operation], CURATOR, recordFor()),
      { ok: false, status: 409, error: 'stale' },
      `${operation.op}: D turned pending between the check and the batch`,
    );
    assert.equal(db.batches.length, batches + 1, `${operation.op}: the check passed and the batch ran`);
    assert.equal(songOf(db, 'p6'), 'B', `${operation.op}: the relink is rolled back`);
    assert.equal(count(db, 'merge_guards'), 0, `${operation.op}: no guard row is left behind`);
    db.sqlite.close();
  }
}

async function testWouldPublishHiddenWinsOverWouldUnpublish() {
  // On s-hidden, p5 (approved row of pending P) is hidden and p6 (ON_SITE_P6) is on the site. One apply that would
  // both publish p5 and take p6 off the site is refused as would_publish_hidden before the batch. Once the songs it
  // relinks to move inside the batch, it stops as stale.
  const checked = fixture();
  checked.sqlite.exec(ON_SITE_P6);
  const unpublishP6: CorrectionOperation = { op: 'relinkToSong', performanceId: 'p6', songId: 'Q' };
  assert.deepEqual(await apply(checked, [unpublishP6], 'video-hidden'), {
    ok: false, status: 409, error: 'would_unpublish', performanceIds: ['p6'],
  }, 'alone, the relink of p6 is refused as would_unpublish');
  const batches = checked.batches.length;
  assert.deepEqual(await apply(checked, [{ op: 'relinkToSong', performanceId: 'p5', songId: 'A' }, unpublishP6], 'video-hidden'), {
    ok: false, status: 409, error: 'would_publish_hidden', performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'A' }],
  }, 'before the batch');
  assert.equal(checked.batches.length, batches, 'nothing is written');
  checked.sqlite.close();

  // Both relinks pass the check (pending Q keeps p5 hidden, approved D keeps p6 on the site), then Q turns approved and
  // D pending before the batch: neither has the status the plan read, so the batch stops as stale, and the next check
  // answers as before.
  const raced = fixture();
  raced.sqlite.exec(ON_SITE_P6);
  raced.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('D','alice','Song D','Artist','approved')");
  const target = await targetOf(raced, 'video-hidden');
  raced.beforeBatch = async () => {
    raced.beforeBatch = undefined;
    raced.sqlite.exec("UPDATE songs SET status = 'approved' WHERE id = 'Q'; UPDATE songs SET status = 'pending' WHERE id = 'D'");
  };
  const operations: CorrectionOperation[] = [
    { op: 'relinkToSong', performanceId: 'p5', songId: 'Q' },
    { op: 'relinkToSong', performanceId: 'p6', songId: 'D' },
  ];
  assert.deepEqual(
    await applyCorrection(raced.binding, target, operations, CURATOR, recordFor()),
    { ok: false, status: 409, error: 'stale' },
    'inside the batch',
  );
  assert.equal(raced.batches.length, 1, 'the check passed and the batch ran');
  assert.deepEqual([songOf(raced, 'p5'), songOf(raced, 'p6')], ['P', 'B'], 'both relinks are rolled back');
  assert.equal(count(raced, 'merge_guards'), 0);
  assert.deepEqual(await apply(raced, [operations[1]], 'video-hidden'), {
    ok: false, status: 409, error: 'would_unpublish', performanceIds: ['p6'],
  }, 'alone, the relink of p6 is now refused as would_unpublish');
  raced.sqlite.close();
}

async function testRenamedApprovedSongOutranksPendingMatch() {
  // A takes pending P's title and artist in the apply that also relinks p2 to them. The batch ranks
  // A (approved) above P for an add of that identity, and the relink must rank them the same way:
  // landing on P would promote it and publish its hidden row p5, so the apply would be refused.
  const db = fixture();
  assert.deepEqual(await apply(db, [
    { op: 'renameSong', songId: 'A', title: 'Song P' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song P', originalArtist: 'Artist' },
  ]), { ok: true });
  assert.equal(songOf(db, 'p2'), 'A', 'p2 lands on the approved song renamed into the identity');
  assert.equal(db.sqlite.prepare("SELECT status FROM songs WHERE id = 'P'").get()?.status, 'pending', 'P is not promoted');
  db.sqlite.close();
}

async function testGuardPassesNullEndsAndEveryCurrentStatus() {
  // A NULL end and every status a review diffs must read back equal, or every apply would be stale.
  const db = fixture();
  db.sqlite.exec(`
    UPDATE performances SET end_timestamp = NULL WHERE id = 'p1';
    UPDATE performances SET status = 'extracted' WHERE id = 'p2';
    UPDATE performances SET status = 'pending' WHERE id = 'p3';
  `);
  assert.deepEqual(await apply(db, [{ op: 'setTimes', performanceId: 'p1', timestamp: 101 }]), { ok: true });
  assert.deepEqual(timesOf(db, 'p1'), { timestamp: 101, end_timestamp: null });
  assert.equal(count(db, 'merge_guards'), 0, 'a passing guard writes nothing');
  db.sqlite.close();
}

async function testBatchFailureOverUnmovedRowsIsRethrown() {
  const db = fixture();
  db.beforeBatch = async () => {
    db.beforeBatch = undefined;
    throw new Error('D1 is unavailable');
  };
  await assert.rejects(apply(db, [{ op: 'setTimes', performanceId: 'p1', timestamp: 101 }]), /D1 is unavailable/, 'not reported as stale');
  db.sqlite.close();
}

async function testCommittedBatchThatThrowsIsASuccess() {
  // D1 can commit a batch and still reject the call. Against the stream as it was loaded, the apply's own writes read
  // as rows that moved, so only the record the batch wrote tells a committed apply from a stale one.
  const db = fixture();
  db.afterBatch = async () => {
    db.afterBatch = undefined;
    throw new Error('D1 connection lost');
  };
  const record = recordFor();
  const warnings = await warningsDuring(async () => {
    assert.deepEqual(await apply(db, [{ op: 'setTimes', performanceId: 'p1', timestamp: 101 }], 'video-pub', record), { ok: true }, 'never stale');
  });
  assert.equal(warnings.length, 1, 'the rejected call is logged');
  assert.deepEqual(timesOf(db, 'p1'), { timestamp: 101, end_timestamp: 200 }, 'the batch had committed');
  assert.deepEqual(recordOf(db, record.token), {
    submission_id: 'vod-1', reviewer_note: `thanks\n${SUMMARY}`, summary: SUMMARY, actor: CURATOR, announced_at: null,
  }, 'with its record: the note the route writes to Nova and the summary it announces');
  db.sqlite.close();
}

async function testUncommittedBatchStillReportsStale() {
  // The read-back looks for this apply's token, never for its submission: another apply of vod-1 commits first, record
  // and all, and this apply's batch then fails on the rows that moved, writing nothing.
  const db = fixture();
  const target = await targetOf(db);
  const operations: CorrectionOperation[] = [{ op: 'setTimes', performanceId: 'p1', timestamp: 101 }, ADD_Z];
  const winner = recordFor();
  db.beforeBatch = async () => {
    db.beforeBatch = undefined;
    assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR, winner), { ok: true }, 'the other apply commits first');
  };
  const loser = recordFor();
  assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR, loser), { ok: false, status: 409, error: 'stale' });
  assert.equal(count(db, 'songs', "title = 'Song Z'"), 1, 'the add landed once');
  assert.equal(count(db, 'vod_correction_applies', `token = '${loser.token}'`), 0, 'the stale batch wrote no record');
  assert.equal(count(db, 'vod_correction_applies', `token = '${winner.token}'`), 1);
  db.sqlite.close();
}

async function testFailedReadBackKeepsTheBatchError() {
  // A record that cannot be read back leaves unknown whether the batch committed. The batch's own error stands: never
  // a success, nor the stale that the apply's own writes would read as. The read's own error is the one sign that the
  // outcome is unknown, rather than a batch that failed, so it is logged first, with the apply it was reading for.
  const db = fixture();
  db.afterBatch = async () => {
    db.afterBatch = undefined;
    throw new Error('D1 connection lost');
  };
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    if (sql.includes('FROM vod_correction_applies')) throw new Error('D1 read failed');
    return prepare(sql);
  };
  const record = recordFor();
  const errors = await errorsDuring(async () => {
    await assert.rejects(apply(db, [{ op: 'setTimes', performanceId: 'p1', timestamp: 101 }], 'video-pub', record), /D1 connection lost/);
  });
  assert.equal(errors.length, 1, 'the failed read is logged');
  const [message, readError] = errors[0]!;
  assert.ok(String(message).includes(record.submissionId) && String(message).includes(record.token), `naming the submission and the token (${String(message)})`);
  assert.match(String((readError as Error).message), /D1 read failed/, "with the read's own error");
  db.sqlite.close();
}

async function testAThrowingRecheckKeepsTheBatchError() {
  // The batch failed and left no record, so the apply reads the catalog again to say which guard moved. A read of that
  // re-check that throws must not take the batch's place: the apply rejects with the batch's own error, and the log
  // carries both errors, since only the log says that the re-check could not run. Each case fails one read, and only
  // once the batch has failed, so the checks before the batch and the read-back of the record are untouched; the
  // operations are the ones that make that read happen, since a read with nothing to look for is skipped.
  const relinkToB: CorrectionOperation = { op: 'relinkToSong', performanceId: 'p3', songId: 'B' };
  const cases: Array<{ read: string; sql: string; operations: CorrectionOperation[]; videoId?: string; seed?: string }> = [
    { read: 'the stream the opening guards reload', sql: 'FROM streams WHERE streamer_id', operations: [{ op: 'setTimes', performanceId: 'p1', timestamp: 101 }] },
    { read: 'a validity of the opening guards', sql: 'SELECT valid FROM merge_guard', operations: [relinkToB] },
    { read: 'the destinations of the relinks', sql: 'SELECT id, status FROM songs', operations: [relinkToB] },
    { read: 'the songs the adds land on', sql: 'WITH wanted AS', operations: [ADD_Z] },
    { read: 'the hidden rows a promotion would publish', sql: "stream.status IS NOT 'approved'", operations: [ADD_Q] },
    { read: 'the rows a relink would take off the site', sql: "SELECT id FROM songs WHERE status = 'approved'", operations: [{ op: 'relinkToSong', performanceId: 'p6', songId: 'A' }], videoId: 'video-hidden', seed: ON_SITE_P6 },
    { read: 'the endless rows a promotion would publish', sql: 'performance.end_timestamp IS NULL', operations: [ADD_Q] },
  ];
  for (const { read, sql, operations, videoId = 'video-pub', seed } of cases) {
    const db = fixture();
    if (seed) db.sqlite.exec(seed);
    const batchError = new Error('D1 is unavailable');
    const prepare = db.prepare.bind(db);
    db.beforeBatch = async () => {
      db.beforeBatch = undefined;
      db.prepare = (statement: string) => {
        if (statement.includes(sql)) throw new Error(`D1 read failed: ${read}`);
        return prepare(statement);
      };
      throw batchError;
    };
    const record = recordFor();
    const errors = await errorsDuring(async () => {
      await assert.rejects(apply(db, operations, videoId, record), (thrown: unknown) => {
        assert.equal(thrown, batchError, `${read}: the apply rejects with the batch's own error`);
        return true;
      });
    });
    assert.equal(errors.length, 1, `${read}: the failed read is logged once`);
    const [message, loggedBatchError, readError] = errors[0]!;
    assert.ok(String(message).includes(record.submissionId) && String(message).includes(record.token), `${read}: naming the submission and the token (${String(message)})`);
    assert.equal(loggedBatchError, batchError, `${read}: with the batch's own error`);
    assert.equal((readError as Error).message, `D1 read failed: ${read}`, `${read}: and the read's own`);
    assert.equal(count(db, 'vod_correction_applies'), 0, `${read}: the batch wrote no record`);
    db.sqlite.close();
  }
}

async function testNewestUnannouncedApply() {
  // The approval that recovers an apply reads the newest record of the submission that was never announced. Records of
  // one second keep the order they were written in, whatever their tokens; an older second, written last, still comes
  // after them.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO vod_correction_applies (token,submission_id,reviewer_note,summary,actor,applied_at) VALUES
    ('t-2','vod-1','note 2','summary 2','x','2026-11-15 10:00:00'),
    ('t-3','vod-1','note 3','summary 3','x','2026-11-15 10:00:00'),
    ('t-1','vod-1','note 1','summary 1','x','2026-11-15 10:00:00'),
    ('t-old','vod-1','old note','old summary','x','2026-11-14 10:00:00'),
    ('t-other','vod-2','other note','other summary','x','2026-11-16 10:00:00')`);
  const announce = (...tokens: string[]) => db.sqlite
    .prepare("UPDATE vod_correction_applies SET announced_at = '2026-11-16 12:00:00' WHERE token IN (SELECT value FROM json_each(?))")
    .run(JSON.stringify(tokens));
  assert.deepEqual(await findUnannouncedApply(db.binding, 'vod-1'), { token: 't-1', reviewerNote: 'note 1', summary: 'summary 1' });
  announce('t-1');
  assert.equal((await findUnannouncedApply(db.binding, 'vod-1'))?.token, 't-3', 'an announced record is not read again');
  announce('t-3', 't-2');
  assert.equal((await findUnannouncedApply(db.binding, 'vod-1'))?.token, 't-old');
  announce('t-old');
  assert.equal(await findUnannouncedApply(db.binding, 'vod-1'), null, 'every record of vod-1 is announced');
  assert.equal(await findUnannouncedApply(db.binding, 'vod-none'), null);
  db.sqlite.close();
}

async function testClaimClosesEveryOpenRecordOfTheSubmission() {
  // Every feedback embed for a submission first claims its open records: each one still unannounced is closed and named
  // in the answer, so no later recovery resurrects one, and a second claim finds nothing left. A record already
  // announced keeps its time; another submission's records are untouched.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO vod_correction_applies (token,submission_id,reviewer_note,summary,actor,announced_at) VALUES
    ('t-a','vod-1','note a','summary a','x',NULL),
    ('t-b','vod-1','note b','summary b','x','2026-11-01 00:00:00'),
    ('t-c','vod-1','note c','summary c','x',NULL),
    ('t-other','vod-2','other note','other summary','x',NULL)`);
  assert.deepEqual((await claimOpenApplies(db.binding, 'vod-1')).sort(), ['t-a', 't-c'], 'the claim names what it closed');
  assert.deepEqual(await claimOpenApplies(db.binding, 'vod-1'), [], 'a second claim finds nothing open');
  assert.equal(await findUnannouncedApply(db.binding, 'vod-1'), null, 'no record of vod-1 is left to recover');
  const announcedAt = (token: string) =>
    db.sqlite.prepare('SELECT announced_at FROM vod_correction_applies WHERE token = ?').get(token)?.announced_at;
  for (const token of ['t-a', 't-c']) {
    assert.match(String(announcedAt(token)), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, `${token} is marked with the time`);
  }
  assert.equal(announcedAt('t-b'), '2026-11-01 00:00:00', 'an announced record keeps its time');
  assert.equal((await findUnannouncedApply(db.binding, 'vod-2'))?.token, 't-other', "vod-2's record is untouched");
  db.sqlite.close();
}

async function testClaimApplyClosesItsOwnRecordOnly() {
  // An apply that met another review closes its own record and nothing else: another open record of the submission stays
  // open for the request that announces it. A second close finds it closed; a closed record keeps its time.
  const db = fixture();
  db.sqlite.exec(`INSERT INTO vod_correction_applies (token,submission_id,reviewer_note,summary,actor,announced_at) VALUES
    ('t-own','vod-1','own note','own summary','x',NULL),
    ('t-open','vod-1','open note','open summary','x',NULL),
    ('t-done','vod-1','done note','done summary','x','2026-11-01 00:00:00')`);
  const announcedAt = (token: string) =>
    db.sqlite.prepare('SELECT announced_at FROM vod_correction_applies WHERE token = ?').get(token)?.announced_at;
  assert.equal(await claimApply(db.binding, 't-own'), true, 'it closes its own record');
  assert.match(String(announcedAt('t-own')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'marked with the time');
  assert.equal(announcedAt('t-open'), null, 'another open record stays open');
  assert.equal((await findUnannouncedApply(db.binding, 'vod-1'))?.token, 't-open', 'for the request that announces it');
  assert.equal(await claimApply(db.binding, 't-own'), false, 'a second close finds it closed');
  assert.equal(await claimApply(db.binding, 't-done'), false);
  assert.equal(announcedAt('t-done'), '2026-11-01 00:00:00', 'a closed record keeps its time');
  db.sqlite.close();
}

async function testExportRevisionBumps() {
  const operations: CorrectionOperation[] = [
    { op: 'setTimes', performanceId: 'p1', timestamp: 101 },
    { op: 'renameSong', songId: 'A', title: 'Song A2' },
    { op: 'relinkToSong', performanceId: 'p3', songId: 'B' },
    { op: 'relinkToNewSong', performanceId: 'p2', title: 'Song N', originalArtist: 'Artist' },
    ADD_Z,
    { op: 'deletePerformance', performanceId: 'p3' },
  ];
  for (const operation of operations) {
    const db = fixture();
    const before = exportRevision(db);
    assert.deepEqual(await apply(db, [operation]), { ok: true });
    assert.ok(exportRevision(db) > before, `${operation.op} bumps alice's export revision`);
    db.sqlite.close();
  }
}

const tests = [
  testShimRunsEachSchemaInOrder, testLoadTarget, testOnSiteIsThePerformanceAndItsSong, testFindTargetStreams, testFindOpenApplies,
  testResolveExistingSongs,
  testResolveExistingSongsAnswersAsBefore, testALookupWithNoRenameSeeksTheIdentityIndex,
  testFingerprintTracksRows, testSetTimesKeepsId, testRenameReachesEveryStream,
  testRelinkToExistingKeepsIdAndDropsOrphan, testRelinkToNewSongCreatesApproved, testRelinkToNewSongReusesExactMatch,
  testAddOnApprovedStreamIsApproved, testAddOnPendingStreamIsPending, testAddPromotesPendingSong, testRelinksPromotePendingSong,
  testWouldPublishHidden, testDeleteDropsOrphan, testRejectsInvertedTimes,
  testAddWithoutEndIsRefusedOnAnApprovedStream, testAddWithoutEndOnAStreamThatIsNotApprovedIsCreatedPending,
  testClearingAnEndIsRefused, testNullEndStaysNullOnPipelineRow,
  testARelinkThatPublishesARowWithNoEndIsRefused, testARelinkWithAnEndFromTheSameApplyGoesThrough,
  testARelinkOfAnOnSiteRowWithNoEndGoesThrough, testTheRelinkEndRuleHoldsOnlyOnAnApprovedStream,
  testAPromotionThatPublishesARowWithNoEndIsRefused, testAPromotionSparesTheRowsTheApplyEndsOrMoves,
  testARelinkOfAHiddenRowPromotesNothing,
  testRejectsConflictingRenames,
  testRejectsForeignPerformance, testRejectsForeignRename, testRejectsBadTargetsAndConflicts,
  testEmptyArtistReadsUnknown, testNoFieldOperationsWriteNothing, testResolutionSeesRenames, testGuardSeesRenames, testOneBatch, test200SetTimesOneBatch,
  testBatchRefusesRowsThatMoved, testPromotionRecheckedInsideTheBatch, testPromotionRecheckedForEndsInsideTheBatch,
  testADestinationThatTurnsPendingIsReadAgainForEnds, testRelinkDestinationsRecheckedInsideTheBatch,
  testADestinationDemotedInsideTheBatchIsStale, testAnExpectedStatusThatDiffersIsStale,
  testNewSongIdentityRecheckedInsideTheBatch, testIdentityRelinkMustStillRankFirst,
  testRelinkNeverPublishesOnAStreamThatIsNotApproved, testRelinkNeverUnpublishesOnAStreamThatIsNotApproved,
  testWouldPublishHiddenWinsOverWouldUnpublish, testRenamedApprovedSongOutranksPendingMatch,
  testGuardPassesNullEndsAndEveryCurrentStatus,
  testBatchFailureOverUnmovedRowsIsRethrown, testCommittedBatchThatThrowsIsASuccess, testUncommittedBatchStillReportsStale,
  testFailedReadBackKeepsTheBatchError, testAThrowingRecheckKeepsTheBatchError, testNewestUnannouncedApply,
  testClaimClosesEveryOpenRecordOfTheSubmission,
  testClaimApplyClosesItsOwnRecordOnly, testExportRevisionBumps,
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
  console.log(`✓ real SQLite: VOD corrections load, fingerprint and apply in one batch (${tests.length} tests: ids kept, renames, relinks, adds, deletes, hidden-row and end guards, validation, 200-row budget, in-batch stale, destination, hidden-row and end guards, apply records)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
