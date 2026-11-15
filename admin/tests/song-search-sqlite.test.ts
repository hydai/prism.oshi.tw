import assert from 'node:assert/strict';
import { listSongsPaginated } from '../src/db';
import { D1_LIKE_PATTERN_LIMIT, SQLiteD1 } from './sqlite-d1';

// A real catalog title, 23 characters and 65 bytes. The search used to bind '%' + the title + '%' to LIKE: 67 bytes
// against the 50 D1 takes, so D1 answered 500 and the song could not be found by its full title.
const LONG_TITLE = '恋愛サーキュレーション（千石撫子[花澤香菜]）';
// Five songs of alice, and bob's with the same long title: a search never crosses streamers.
const SEED = `
  INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES
    ('long','alice','${LONG_TITLE}','花澤香菜','approved'),
    ('plain','alice','Song A','The Artist','approved'),
    ('percent','alice','100% Pure','Band','approved'),
    ('under','alice','a_b','Band','approved'),
    ('other','alice','axb','Band','approved'),
    ('theirs','bob','${LONG_TITLE}','花澤香菜','approved');
`;

function fixture() {
  const db = new SQLiteD1();
  db.enforceD1LikeLimit();
  db.sqlite.exec(SEED);
  return db;
}
/** The ids, in id order, and the total that alice's song list answers to `text`. */
async function search(db: SQLiteD1, text: string) {
  const { songs, total } = await listSongsPaginated(db.binding, 'alice', { search: text });
  return { ids: songs.map((song) => song.id).sort(), total };
}

function testTheShimRefusesLongLikePatternsOnRequest() {
  const db = new SQLiteD1();
  const like = (value: string | null, pattern: string, escape = false) =>
    db.sqlite.prepare(`SELECT ? LIKE ?${escape ? " ESCAPE '\\'" : ''} AS hit`).get(value, pattern)?.hit;
  const fiftyBytes = `%${'x'.repeat(48)}%`;
  const fiftyOneBytes = `%${'x'.repeat(49)}%`;
  assert.equal(like('y', fiftyOneBytes), 0, 'plain SQLite takes a 51-byte pattern');

  db.enforceD1LikeLimit();
  assert.equal(like('y', fiftyBytes), 0, '50 bytes is the longest that D1 takes');
  assert.throws(() => like('y', fiftyOneBytes), /LIKE or GLOB pattern too complex/, 'one more is refused');
  assert.throws(() => like('y', fiftyOneBytes, true), /LIKE or GLOB pattern too complex/, 'with ESCAPE too');
  assert.equal(like('y', `%${'あ'.repeat(16)}%`), 0, 'it counts bytes: 16 three-byte characters between the wildcards are 50');
  assert.throws(() => like('y', `%${'あ'.repeat(17)}%`), /LIKE or GLOB pattern too complex/, 'and 17 are 53');

  // Everything else is SQLite's own LIKE.
  assert.equal(like('Song A', '%song%'), 1, 'ASCII case does not matter');
  assert.equal(like('École', 'école'), 0, 'any other case does');
  assert.equal(like('axb', 'a_b'), 1, '_ is any one character');
  assert.equal(like('axb', 'a\\_b', true), 0, 'ESCAPE makes it itself');
  assert.equal(like('a_b', 'a\\_b', true), 1, 'which a_b still is');
  assert.equal(like('100% Pure', '100\\%%', true), 1, 'as it does for %');
  assert.equal(like('1000 Pure', '100\\%%', true), 0);
  assert.equal(like(null, '%'), null, 'NULL stays NULL');
  db.sqlite.close();
}

async function testLongSearchFindsTheSong() {
  const db = fixture();
  assert.ok(Buffer.byteLength(LONG_TITLE) > D1_LIKE_PATTERN_LIMIT, 'the title alone is longer than a pattern D1 takes');
  assert.deepEqual(await search(db, LONG_TITLE), { ids: ['long'], total: 1 }, "alice's song, not bob's of the same title");
  db.sqlite.close();
}

async function testSearchStillReadsTitleAndArtistWithoutCase() {
  const db = fixture();
  assert.deepEqual((await search(db, 'SONG a')).ids, ['plain'], 'a title, whatever the ASCII case');
  assert.deepEqual((await search(db, 'the ARTIST')).ids, ['plain'], 'an artist, whatever the ASCII case');
  assert.deepEqual((await search(db, '花澤')).ids, ['long'], "CJK text, and alice's songs only: bob's artist matches too");
  assert.deepEqual(await search(db, 'nothing is called this'), { ids: [], total: 0 });
  assert.equal((await search(db, '')).total, 5, 'an empty search filters nothing, and still only alice');
  db.sqlite.close();
}

async function testPercentAndUnderscoreMatchThemselves() {
  const db = fixture();
  assert.deepEqual((await search(db, '%')).ids, ['percent'], 'a percent sign is a character, not anything');
  assert.deepEqual((await search(db, '_')).ids, ['under'], 'an underscore is a character, not any one');
  assert.deepEqual((await search(db, 'a_b')).ids, ['under'], 'so a_b does not find axb');
  db.sqlite.close();
}

const tests = [
  testTheShimRefusesLongLikePatternsOnRequest, testLongSearchFindsTheSong,
  testSearchStillReadsTitleAndArtistWithoutCase, testPercentAndUnderscoreMatchThemselves,
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
  console.log(`✓ real SQLite with D1's LIKE pattern limit: the song search finds a 65-byte title, matches title and artist without ASCII case, and reads % and _ as themselves (${tests.length} tests)`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
