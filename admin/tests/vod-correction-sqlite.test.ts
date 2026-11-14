import assert from 'node:assert/strict';
import { URL } from 'node:url';
import type { CorrectionOperation } from '../shared/vod-correction';
import {
  applyCorrection, correctionFingerprint, findTargetStreams, loadCorrectionTarget, resolveExistingSongs, streamKey,
} from '../src/vod-correction-db';
import type { CorrectionTarget } from '../src/vod-correction-db';
import { SQLiteD1 } from './sqlite-d1';

const CURATOR = 'curator@example.com';
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
async function apply(db: SQLiteD1, operations: CorrectionOperation[], videoId = 'video-pub') {
  return applyCorrection(db.binding, await targetOf(db, videoId), operations, CURATOR);
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
    status: 'approved', songStatus: 'approved', songPerformanceCount: 2,
  });
  db.sqlite.exec(`INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,status) VALUES
    ('p0','alice','B','s-pub','2026-09-01','Pub','video-pub',50,'rejected'),
    ('p6','alice','B','s-pub','2026-09-01','Pub','video-pub',300,'extracted')`);
  assert.deepEqual((await targetOf(db)).current.map((row) => row.performanceId), ['p1', 'p2', 'p6', 'p3'], 'rejected rows stay out; ties sort by id');
  assert.equal(await loadCorrectionTarget(db.binding, 'bob', 'video-pub'), null, 'the stream is looked up per streamer');
  assert.equal(await loadCorrectionTarget(db.binding, 'alice', 'video-none'), null);
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
  assert.equal(db.batches.at(-1)!.length, 4, 'identical renames collapse into one: the guard, then ensure the work, update the song, relink');
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
    [[{ op: 'addPerformance', title: '  ', originalArtist: 'Artist', timestamp: 700, endTimestamp: null }], /^operation 0: title must not be empty/],
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
  assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR), { ok: true });
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
    assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR), { ok: false, status: 409, error: 'stale' }, move);
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
  assert.deepEqual(await applyCorrection(added.binding, addTarget, [addQ], CURATOR), {
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
  assert.deepEqual(await applyCorrection(relinked.binding, relinkTarget, [{ op: 'relinkToSong', performanceId: 'p3', songId: 'P' }], CURATOR), {
    ok: false, status: 409, error: 'would_publish_hidden',
    performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'P' }],
  }, "P's row on the hidden stream was approved after the check");
  assert.equal(songOf(relinked, 'p3'), 'C', 'the relink is rolled back');
  assert.equal(relinked.sqlite.prepare("SELECT status FROM songs WHERE id = 'P'").get()?.status, 'pending', 'P is not promoted');
  relinked.sqlite.close();
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
    assert.deepEqual(await applyCorrection(db.binding, target, [operation], CURATOR), { ok: false, status: 409, error: 'stale' }, move);
    assert.equal(songOf(db, 'p3'), 'C', `${move}: p3 stays on its song`);
    assert.equal(count(db, 'songs', "id = 'C'"), 1, `${move}: C is not dropped as an orphan`);
    assert.equal(count(db, 'merge_guards'), 0, `${move}: no guard row is left behind`);
    db.sqlite.close();
  }
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
  assert.deepEqual(await applyCorrection(db.binding, target, [relinkN], CURATOR), { ok: false, status: 409, error: 'stale' });
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
    assert.deepEqual(await applyCorrection(db.binding, target, operations, CURATOR), { ok: false, status: 409, error: 'stale' }, move);
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

  // The batch checks again after its relinks: Q approved after the check would publish p5.
  const raced = fixture();
  const target = await targetOf(raced, 'video-hidden');
  raced.beforeBatch = async () => {
    raced.beforeBatch = undefined;
    raced.sqlite.exec("UPDATE songs SET status = 'approved' WHERE id = 'Q'");
  };
  assert.deepEqual(await applyCorrection(raced.binding, target, [{ op: 'relinkToSong', performanceId: 'p5', songId: 'Q' }], CURATOR), {
    ok: false, status: 409, error: 'would_publish_hidden', performances: [{ performanceId: 'p5', streamId: 's-hidden', songId: 'Q' }],
  }, 'Q was approved between the check and the batch');
  assert.equal(songOf(raced, 'p5'), 'P', 'the relink is rolled back');
  assert.equal(count(raced, 'merge_guards'), 0);
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
  testShimRunsEachSchemaInOrder, testLoadTarget, testFindTargetStreams, testResolveExistingSongs,
  testFingerprintTracksRows, testSetTimesKeepsId, testRenameReachesEveryStream,
  testRelinkToExistingKeepsIdAndDropsOrphan, testRelinkToNewSongCreatesApproved, testRelinkToNewSongReusesExactMatch,
  testAddOnApprovedStreamIsApproved, testAddOnPendingStreamIsPending, testAddPromotesPendingSong, testRelinksPromotePendingSong,
  testWouldPublishHidden, testDeleteDropsOrphan, testRejectsInvertedTimes, testRejectsConflictingRenames,
  testRejectsForeignPerformance, testRejectsForeignRename, testRejectsBadTargetsAndConflicts,
  testEmptyArtistReadsUnknown, testNoFieldOperationsWriteNothing, testResolutionSeesRenames, testGuardSeesRenames, testOneBatch, test200SetTimesOneBatch,
  testBatchRefusesRowsThatMoved, testPromotionRecheckedInsideTheBatch, testRelinkDestinationsRecheckedInsideTheBatch,
  testNewSongIdentityRecheckedInsideTheBatch, testIdentityRelinkMustStillRankFirst,
  testRelinkNeverPublishesOnAStreamThatIsNotApproved, testRenamedApprovedSongOutranksPendingMatch,
  testGuardPassesNullEndsAndEveryCurrentStatus,
  testBatchFailureOverUnmovedRowsIsRethrown, testExportRevisionBumps,
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
  console.log(`✓ real SQLite: VOD corrections load, fingerprint and apply in one batch (${tests.length} tests: ids kept, renames, relinks, adds, deletes, hidden-row guard, validation, 200-row budget, in-batch stale, destination and hidden-row guards)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
