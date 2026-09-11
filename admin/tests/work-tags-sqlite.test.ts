import assert from 'node:assert/strict';
import { SQLiteD1 } from './sqlite-d1';
import {
  exportSongs,
  insertSong,
  updateSong,
  updateWorkTags,
  bulkUpdateWorkTags,
  listGlobalWorksPaginated,
} from '../src/db';

const workOfSong = (sql: SQLiteD1['sqlite'], songId: string) =>
  sql.prepare(
    `SELECT work.id, work.tags FROM works AS work
     JOIN song_work_links AS link ON link.work_id = work.id
     WHERE link.song_id = ?`,
  ).get(songId)!;

async function main(): Promise<void> {
  const db = new SQLiteD1();
  const sql = db.sqlite;

  // insertSong: the retired songs.tags column and the fresh work both start empty.
  await insertSong(db.binding, 'alice', 'song-1', 'Song', 'Artist', 'curator@example.com');
  assert.equal(sql.prepare('SELECT tags FROM songs WHERE id = ?').get('song-1')!.tags, '[]', 'songs.tags is always []');
  const original = workOfSong(sql, 'song-1');
  assert.equal(original.tags, '[]', 'a new work starts untagged');

  // A curated work tag survives a retitle that creates a fresh work.
  sql.prepare(`UPDATE works SET tags = '["language:ja","source:vocaloid"]' WHERE id = ?`).run(original.id);
  await updateSong(db.binding, 'song-1', { title: 'Renamed' }, 'curator@example.com');
  const renamed = workOfSong(sql, 'song-1');
  assert.notEqual(renamed.id, original.id, 'a retitle links the song to a fresh work');
  assert.equal(renamed.tags, '["language:ja","source:vocaloid"]', 'the fresh work carries the previous work tags');

  // exportSongs reads the work, not the song row.
  sql.prepare(`UPDATE songs SET status = 'approved' WHERE id = ?`).run('song-1');
  const exported = await exportSongs(db.binding, 'alice');
  assert.deepEqual(exported.map((song) => song.tags), [['language:ja', 'source:vocaloid']]);

  // PUT and bulk delta against real SQL.
  sql.exec(`INSERT INTO works (id,title,original_artist,tags) VALUES ('w-a','A','X','[]'), ('w-b','B','X','["language:ja"]')`);
  assert.deepEqual(await updateWorkTags(db.binding, 'w-a', ['source:anime', 'language:zh']), { status: 'updated' });
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-a')!.tags, '["language:zh","source:anime"]', 'PUT stores the normalized set');
  assert.deepEqual(await updateWorkTags(db.binding, 'missing', ['language:zh']), { status: 'missing' }, 'PUT on a missing work changes nothing');

  const bulk = await bulkUpdateWorkTags(db.binding, ['w-a', 'w-b'], ['source:vocaloid'], ['language:zh']);
  assert.deepEqual(bulk, {
    updated: [
      { id: 'w-a', tags: ['source:vocaloid', 'source:anime'] },
      { id: 'w-b', tags: ['language:ja', 'source:vocaloid'] },
    ],
    skipped: [],
  }, 'bulk returns every requested work in request order');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-b')!.tags, '["language:ja","source:vocaloid"]');
  assert.equal(await bulkUpdateWorkTags(db.binding, ['w-a', 'missing'], ['language:ko'], []), null, 'a missing ID fails the whole batch');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-a')!.tags, '["source:vocaloid","source:anime"]', 'nothing is written when one ID is missing');
  const batchesBefore = db.batches.length;
  const noop = await bulkUpdateWorkTags(db.binding, ['w-b'], ['language:ja'], []);
  assert.equal(db.batches.length, batchesBefore + 1, 'a no-op delta still runs its verification batch');
  assert.ok(db.batches.at(-1)!.every((statement) => statement.sql.startsWith('SELECT 1 AS ok')), 'a no-op row is verified, never written');
  assert.deepEqual(noop, { updated: [{ id: 'w-b', tags: ['language:ja', 'source:vocaloid'] }], skipped: [] });

  // The list filters run real SQL through the rollup: `tag` matches one JSON array
  // element, `untaggedOnly` means "no language tag", both combine with search, and the
  // count statement agrees with the page.
  sql.exec(`
    INSERT INTO songs (id, streamer_id, title, original_artist, status) VALUES
      ('song-a', 'alice', 'A', 'X', 'approved'),
      ('song-b', 'bob', 'B', 'X', 'approved');
    INSERT INTO song_work_links (song_id, work_id, link_method, linked_by) VALUES
      ('song-a', 'w-a', 'import_exact', 'curator@example.com'),
      ('song-b', 'w-b', 'import_exact', 'curator@example.com');
  `);
  const renamedId = String(renamed.id);
  const idsFor = async (opts: Parameters<typeof listGlobalWorksPaginated>[1]): Promise<string[]> => {
    const page = await listGlobalWorksPaginated(db.binding, opts);
    assert.equal(page.total, page.works.length, 'the count statement agrees with the page');
    return page.works.map((work) => work.id).sort();
  };
  assert.deepEqual(await idsFor({ tag: 'source:vocaloid' }), [renamedId, 'w-a', 'w-b'].sort(), 'tag filter matches a JSON array element');
  assert.deepEqual(await idsFor({ tag: 'language:ja' }), [renamedId, 'w-b'].sort(), 'a language tag filter');
  assert.deepEqual(await idsFor({ untaggedOnly: true }), ['w-a'], 'untagged means no language tag');
  assert.deepEqual(await idsFor({ tag: 'source:vocaloid', untaggedOnly: true }), ['w-a'], 'both filters combine');
  assert.deepEqual(await idsFor({ search: 'Renamed', tag: 'source:vocaloid' }), [renamedId], 'search combines with the tag filter');

  // Optimistic guards: a save whose revision token is stale is refused with the current
  // value, and a bulk delta skips (and reports) rows that changed between its read and its
  // write instead of overwriting them — whether the delta would have written them or not.
  const updatedAtOf = (id: string) => String(sql.prepare('SELECT updated_at FROM works WHERE id = ?').get(id)!.updated_at);
  assert.deepEqual(
    await updateWorkTags(db.binding, 'w-a', ['language:ko'], '2000-01-01 00:00:00'),
    { status: 'conflict', currentTags: ['source:vocaloid', 'source:anime'] },
    'a PUT with a stale revision token is refused',
  );
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-a')!.tags, '["source:vocaloid","source:anime"]', 'a refused PUT writes nothing');
  assert.deepEqual(
    await updateWorkTags(db.binding, 'w-a', ['language:ko', 'source:anime'], updatedAtOf('w-a')),
    { status: 'updated' },
    'a PUT with the current revision token succeeds',
  );
  assert.deepEqual(await updateWorkTags(db.binding, 'missing', ['language:zh'], '2000-01-01 00:00:00'), { status: 'missing' }, 'a missing work is still reported as missing');
  // The token is the timestamp, not the tags, so a row that still carries a legacy ID can be
  // cleaned up by a curator instead of being stuck.
  sql.prepare(`UPDATE works SET tags = '["legacy:free-text","language:ja"]', updated_at = '2001-01-01 00:00:00' WHERE id = 'w-b'`).run();
  assert.deepEqual(await updateWorkTags(db.binding, 'w-b', ['language:ja'], '2001-01-01 00:00:00'), { status: 'updated' }, 'a legacy row is saveable with a matching token');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-b')!.tags, '["language:ja"]', 'the legacy ID is gone after the save');

  db.beforeBatch = async () => {
    sql.prepare(`UPDATE works SET tags = '["language:en"]' WHERE id = 'w-b'`).run();
  };
  const raced = await bulkUpdateWorkTags(db.binding, ['w-a', 'w-b'], ['source:game'], []);
  db.beforeBatch = undefined;
  assert.deepEqual(raced?.skipped, ['w-b'], 'a row changed between the read and the write is skipped');
  assert.deepEqual(raced?.updated.map((entry) => entry.id), ['w-a'], 'skipped rows are not reported as updated');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-b')!.tags, '["language:en"]', 'the intervening edit survives');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-a')!.tags, '["language:ko","source:anime","source:game"]', 'the row that did not change is written');

  // A row whose delta looked like a no-op when read is verified too: if someone removed the
  // tag the curator was adding, the request no longer holds for that row and it is skipped.
  db.beforeBatch = async () => {
    sql.prepare(`UPDATE works SET tags = '[]' WHERE id = 'w-b'`).run();
  };
  const flipped = await bulkUpdateWorkTags(db.binding, ['w-b'], ['language:en'], []);
  db.beforeBatch = undefined;
  assert.deepEqual(flipped, { updated: [], skipped: ['w-b'] }, 'a no-op row that was flipped in between is skipped, not reported as updated');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-b')!.tags, '[]', 'the verification never writes');

  // Two curators open a row within the second of its last (second-precision) write. The
  // first save must move the token to a sub-second stamp so the second, stale save is
  // refused even though both happen inside that same second.
  sql.prepare(`UPDATE works SET tags = '[]', updated_at = datetime('now') WHERE id = 'w-a'`).run();
  const sharedBaseline = updatedAtOf('w-a');
  assert.deepEqual(await updateWorkTags(db.binding, 'w-a', ['language:ja'], sharedBaseline), { status: 'updated' }, 'the first save with the shared baseline succeeds');
  assert.match(updatedAtOf('w-a'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/, 'tag writes stamp updated_at with millisecond precision');
  assert.equal((await updateWorkTags(db.binding, 'w-a', ['language:ko'], sharedBaseline)).status, 'conflict', 'the second save with the same baseline is refused within the same second');
  assert.equal(sql.prepare('SELECT tags FROM works WHERE id = ?').get('w-a')!.tags, '["language:ja"]', 'the first save survives');

  sql.close();
  console.log('✓ work tags: songs.tags retired, retitle keeps work tags, export reads the work, stale writes are refused');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
