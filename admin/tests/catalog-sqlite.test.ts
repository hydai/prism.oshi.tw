import assert from 'node:assert/strict';
import { appendStreamPerformances, createSongAndPerformance, replaceStreamPerformances, listGlobalWorksPaginated } from '../src/db';
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
  for (const fixtureDb of [db, batchDb, aliasDb, replaceDb]) fixtureDb.sqlite.close();
  console.log('✓ real SQLite: concurrent catalog imports, alias reuse, tenant isolation, 200-song statement budget and rollback');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
