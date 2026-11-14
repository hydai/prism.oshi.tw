import assert from 'node:assert/strict';
import {
  appendStreamPerformances, createSongAndPerformance, insertSong, replaceStreamPerformances, listGlobalWorksPaginated,
  prepareCatalogWrites, prepareEnsureExactWork, prepareLinkSongToExactWork, prepareSongInsert, prepareSongRename,
  prepareTimestampUpdate, updatePerformanceTimestamps, updateSong,
} from '../src/db';
import { SQLiteD1 } from './sqlite-d1';

const submission = {
  streamerId: 'alice', streamId: 'stream-a', date: '2026-09-01',
  streamTitle: 'Stream A', videoId: 'video-a', submittedBy: 'curator',
  title: 'Song', originalArtist: 'Artist', timestamp: 10, endTimestamp: 70, note: 'note',
};
const songs = [{ songName: 'Song', artist: 'Artist', startSeconds: 10, endSeconds: 70 }];
function fixture() {
  const db = new SQLiteD1();
  db.sqlite.exec("INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url) VALUES ('stream-a','alice','Stream A','2026-09-01','video-a','https://example.com')");
  return db;
}
function count(db: SQLiteD1, table: string) {
  return db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
}
// node:sqlite rows have a null prototype, which strict deepEqual never matches against a plain object.
const plain = (row: object | undefined) => ({ ...row });

async function main() {
  const db = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let arrivals = 0;
  db.beforeBatch = async () => { if (++arrivals === 2) release(); await gate; };
  const [a, b] = await Promise.all([
    createSongAndPerformance(db.binding, submission),
    createSongAndPerformance(db.binding, submission),
  ]);
  assert.equal(a.songId, b.songId, 'two prepared requests resolve the same identity at commit time');
  assert.notEqual(a.performanceId, b.performanceId);
  assert.equal(count(db, 'songs'), 1);
  assert.equal(count(db, 'performances'), 2);
  assert.equal(count(db, 'works'), 1);
  assert.equal(count(db, 'song_work_links'), 1);
  assert.deepEqual(db.batches.map(batch => batch.length), [4, 4]);
  db.beforeBatch = undefined;
  // Approve a second duplicate: approved beats pending, even if newer.
  db.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('approved','alice','Song','Artist','approved')");
  assert.equal((await createSongAndPerformance(db.binding, submission)).songId, 'approved');
  const other = await createSongAndPerformance(db.binding, { ...submission, streamerId: 'bob' });
  assert.notEqual(other.songId, 'approved', 'local identity never crosses tenants');
  assert.equal(count(db, 'works'), 1, 'global work is shared across tenants');

  const batchDb = fixture();
  await appendStreamPerformances(batchDb.binding, { ...submission, songs: Array.from({ length: 200 }, (_, i) => ({ ...songs[0], songName: `Song ${i}` })) });
  assert.equal(batchDb.batches.length, 1);
  assert.equal(batchDb.batches[0].length, 4, '200 songs use four SQL statements, not 1000');
  assert.equal(count(batchDb, 'songs'), 200);
  assert.equal(count(batchDb, 'performances'), 200);
  assert.equal(batchDb.sqlite.prepare("SELECT COUNT(*) AS n FROM songs WHERE status = 'pending' AND reviewed_by IS NULL").get()!.n, 200, 'an import without review leaves every song pending and unreviewed');
  assert.equal(batchDb.sqlite.prepare("SELECT COUNT(*) AS n FROM performances WHERE status = 'pending'").get()!.n, 200, 'and every performance pending');
  const stats = await listGlobalWorksPaginated(batchDb.binding, { search: 'Song 1', pageSize: 10 });
  assert.equal(stats.total, 111);
  assert.equal(stats.works.length, 10);
  assert.equal(stats.stats.linkedPerformances, 200);
  const shared = await listGlobalWorksPaginated(batchDb.binding, { sharedOnly: true });
  assert.equal(shared.total, 0);
  assert.deepEqual(shared.stats, stats.stats, 'pagination keeps revision-validated global stats');
  const cachedStatement = batchDb.batches.at(-1)![2];
  assert.deepEqual(cachedStatement.execute().results, [], 'unchanged catalog skips aggregate evaluation');
  await appendStreamPerformances(batchDb.binding, { ...submission, songs });
  const changed = await listGlobalWorksPaginated(batchDb.binding);
  assert.equal(changed.stats.linkedPerformances, 201, 'a catalog write invalidates the derived cache');
  batchDb.sqlite.exec('DELETE FROM work_match_state');
  await assert.rejects(listGlobalWorksPaginated(batchDb.binding), /revision is missing/, 'a lost revision row cannot silently reuse cached stats');

  const aliasDb = fixture();
  aliasDb.sqlite.exec("INSERT INTO works (id,title,original_artist) VALUES ('canonical','Canonical','Artist'); INSERT INTO work_aliases (source_work_id,canonical_work_id,source_title,source_original_artist,source_tags,merged_by) VALUES ('retired','canonical','Song','Artist','[]','curator')");
  await appendStreamPerformances(aliasDb.binding, { ...submission, songs: [songs[0], songs[0]] });
  assert.equal(count(aliasDb, 'songs'), 1, 'repeated identities within an import share a song');
  assert.equal(count(aliasDb, 'works'), 1, 'retired aliases are not recreated');
  assert.equal(aliasDb.sqlite.prepare('SELECT work_id FROM song_work_links').get()!.work_id, 'canonical');

  const replaceDb = fixture();
  const original = await createSongAndPerformance(replaceDb.binding, submission);
  await replaceStreamPerformances(replaceDb.binding, { ...submission, songs });
  assert.equal(count(replaceDb, 'songs'), 1);
  assert.equal(count(replaceDb, 'performances'), 1);
  assert.notEqual(replaceDb.sqlite.prepare('SELECT id FROM songs').get()!.id, original.songId, 'replace does not reuse the just-deleted orphan');
  // A database failure after the leading deletes rolls back the whole import.
  replaceDb.sqlite.exec("CREATE TRIGGER fail_import BEFORE INSERT ON performances BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  await assert.rejects(replaceStreamPerformances(replaceDb.binding, { ...submission, songs }), /test rollback/);
  assert.equal(count(replaceDb, 'songs'), 1);
  assert.equal(count(replaceDb, 'performances'), 1);

  // Without a review a write waits for approval, and the song and time edits keep their contracts.
  const pendingDb = fixture();
  const pendingCreated = await createSongAndPerformance(pendingDb.binding, submission);
  assert.deepEqual(plain(pendingDb.sqlite.prepare('SELECT status, reviewed_by FROM songs WHERE id = ?').get(pendingCreated.songId)), { status: 'pending', reviewed_by: null }, 'a new song waits for approval');
  assert.equal(pendingDb.sqlite.prepare('SELECT status FROM performances WHERE id = ?').get(pendingCreated.performanceId)!.status, 'pending', 'and so does its performance');
  await insertSong(pendingDb.binding, 'alice', 'standalone', 'Other', 'Artist', 'curator');
  assert.deepEqual(plain(pendingDb.sqlite.prepare("SELECT status, reviewed_by FROM songs WHERE id = 'standalone'").get()), { status: 'pending', reviewed_by: null }, 'a standalone song insert is pending too');
  const batchesBeforeRename = pendingDb.batches.length;
  await updateSong(pendingDb.binding, 'standalone', {}, 'curator');
  assert.equal(pendingDb.batches.length, batchesBeforeRename, 'an empty song edit sends no batch');
  await updateSong(pendingDb.binding, 'standalone', { title: 'Renamed' }, 'curator');
  assert.equal(pendingDb.batches.length, batchesBeforeRename + 1, 'a song edit is one batch');
  assert.equal(pendingDb.batches.at(-1)!.length, 3, 'of three statements: ensure the work, update the song, relink');
  assert.deepEqual(plain(pendingDb.sqlite.prepare("SELECT title, original_artist FROM songs WHERE id = 'standalone'").get()), { title: 'Renamed', original_artist: 'Artist' });

  const stampDb = fixture();
  stampDb.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('s','alice','S','A','approved'); INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,end_timestamp,status) VALUES ('p','alice','s','stream-a','2026-09-01','Stream A','video-a',100,200,'approved')");
  const stamps = () => plain(stampDb.sqlite.prepare("SELECT timestamp, end_timestamp FROM performances WHERE id = 'p'").get());
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', { timestamp: 110 }), true);
  assert.deepEqual(stamps(), { timestamp: 110, end_timestamp: 200 }, 'a one-sided edit keeps the stored counterpart');
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', { endTimestamp: null }), true);
  assert.deepEqual(stamps(), { timestamp: 110, end_timestamp: null }, 'null clears the end');
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', { endTimestamp: 150 }), true);
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', { endTimestamp: 110 }), false, 'an end at the stored start is refused');
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', { timestamp: 150 }), false, 'a start at the stored end is refused');
  assert.deepEqual(stamps(), { timestamp: 110, end_timestamp: 150 }, 'a refused edit writes nothing');
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', { timestamp: 120, endTimestamp: 130 }), true);
  assert.deepEqual(stamps(), { timestamp: 120, end_timestamp: 130 }, 'both bounds can move together');
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'p', {}), false, 'no fields change nothing');
  assert.equal(await updatePerformanceTimestamps(stampDb.binding, 'missing', { timestamp: 1 }), false, 'a missing row reports false');

  // A curator-approved write is the same set of statements with the rows born approved.
  const reviewed = fixture();
  const { statements, performanceIds } = prepareCatalogWrites(reviewed.binding, {
    streamerId: 'alice', streamId: 'stream-a', date: '2026-09-01', streamTitle: 'Stream A', videoId: 'video-a',
    songs: [{ title: 'Fresh', originalArtist: 'Artist', timestamp: 5, endTimestamp: 9, note: '' }],
    submittedBy: 'curator', review: { status: 'approved', reviewedBy: 'curator' },
  });
  await reviewed.binding.batch(statements);
  assert.equal(performanceIds.length, 1);
  assert.deepEqual(plain(reviewed.sqlite.prepare('SELECT status, reviewed_by FROM songs').get()), { status: 'approved', reviewed_by: 'curator' });
  assert.equal(reviewed.sqlite.prepare('SELECT status FROM performances WHERE id = ?').get(performanceIds[0])!.status, 'approved');
  assert.deepEqual(reviewed.batches[0].map((statement) => statement.sql), pendingDb.batches[0].map((statement) => statement.sql), 'a review changes the bound data, never the INSERT text');

  // performanceIds holds one id per input row, in input order, even when rows share a song.
  const ordered = fixture();
  const orderedWrite = prepareCatalogWrites(ordered.binding, {
    ...submission,
    songs: [
      { title: 'One', originalArtist: 'Artist', timestamp: 10, endTimestamp: 20, note: '' },
      { title: 'Two', originalArtist: 'Artist', timestamp: 30, endTimestamp: null, note: '' },
      { title: 'One', originalArtist: 'Artist', timestamp: 50, endTimestamp: 60, note: '' },
    ],
  });
  await ordered.binding.batch(orderedWrite.statements);
  assert.equal(new Set(orderedWrite.performanceIds).size, 3, 'every input row gets its own performance id');
  assert.deepEqual(
    orderedWrite.performanceIds.map((id) => ordered.sqlite.prepare('SELECT timestamp FROM performances WHERE id = ?').get(id)!.timestamp),
    [10, 30, 50],
    'the ids follow the input order',
  );
  assert.equal(count(ordered, 'songs'), 2, 'a repeated identity within one write shares its song');
  assert.deepEqual(prepareCatalogWrites(ordered.binding, { ...submission, songs: [] }), { statements: [], performanceIds: [] }, 'nothing to write builds nothing');

  // A song that already exists is reused as it is: promoting a pending one is the caller's job.
  const reuse = fixture();
  reuse.sqlite.exec("INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('waiting','alice','Fresh','Artist','pending')");
  const reuseWrite = prepareCatalogWrites(reuse.binding, {
    ...submission,
    songs: [{ title: 'Fresh', originalArtist: 'Artist', timestamp: 5, endTimestamp: 9, note: '' }],
    review: { status: 'approved', reviewedBy: 'curator' },
  });
  await reuse.binding.batch(reuseWrite.statements);
  assert.deepEqual(plain(reuse.sqlite.prepare('SELECT id, status, reviewed_by FROM songs').get()), { id: 'waiting', status: 'pending', reviewed_by: null });
  assert.equal(reuse.sqlite.prepare('SELECT song_id FROM performances WHERE id = ?').get(reuseWrite.performanceIds[0])!.song_id, 'waiting');

  // The exported builders compose into one batch: an approved new song, linked to its exact work.
  const composed = fixture();
  await composed.binding.batch([
    prepareEnsureExactWork(composed.binding, 'work-new', 'Fresh', 'Artist'),
    prepareSongInsert(composed.binding, 'alice', 'song-new', 'Fresh', 'Artist', 'curator', { status: 'approved', reviewedBy: 'curator' }),
    prepareLinkSongToExactWork(composed.binding, 'song-new', 'Fresh', 'Artist', 'import_exact', 'curator'),
  ]);
  assert.deepEqual(plain(composed.sqlite.prepare("SELECT status, reviewed_by FROM songs WHERE id = 'song-new'").get()), { status: 'approved', reviewed_by: 'curator' });
  assert.equal(composed.sqlite.prepare("SELECT work_id FROM song_work_links WHERE song_id = 'song-new'").get()!.work_id, 'work-new');
  assert.equal(prepareSongRename(composed.binding, 'song-new', { title: 'Renamed' }, 'curator').length, 3, 'a rename is the three statements updateSong batches');
  assert.deepEqual(prepareSongRename(composed.binding, 'song-new', {}, 'curator'), [], 'an empty rename builds nothing');
  assert.equal(prepareTimestampUpdate(composed.binding, 'p', {}), null, 'an empty time edit builds nothing');
  assert.ok(prepareTimestampUpdate(composed.binding, 'p', { endTimestamp: null }), 'clearing an end is an edit');

  for (const fixtureDb of [db, batchDb, aliasDb, replaceDb, pendingDb, stampDb, reviewed, ordered, reuse, composed]) fixtureDb.sqlite.close();
  console.log('✓ real SQLite: concurrent catalog imports, alias reuse, tenant isolation, 200-song statement budget, rollback, approved writes and composable builders');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
