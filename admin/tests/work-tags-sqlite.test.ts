import assert from 'node:assert/strict';
import { SQLiteD1 } from './sqlite-d1';
import { exportSongs, insertSong, updateSong } from '../src/db';

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

  sql.close();
  console.log('✓ work tags: songs.tags retired, retitle keeps work tags, export reads the work');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
