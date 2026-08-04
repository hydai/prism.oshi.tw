import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCatalog, type AppleArtistLookup, type CatalogSong } from './classify';

function song(overrides: Partial<CatalogSong> = {}): CatalogSong {
  return {
    slug: 'tester',
    id: 'song-1',
    workId: 'work-1',
    title: '夜に駆ける',
    originalArtist: 'YOASOBI',
    performances: [],
    ...overrides,
  };
}

const apple: AppleArtistLookup[] = [{
  artist: 'Rock Band',
  results: [1, 2, 3, 4, 5].map((trackId) => ({
    artistId: 10,
    artistName: 'Rock Band',
    trackName: trackId === 1 ? 'Anime Theme' : `Track ${trackId}`,
    primaryGenreName: trackId === 5 ? 'Pop' : 'Rock',
  })),
}];

test('assigns language to the song scope and genre to the work scope', () => {
  const result = classifyCatalog([
    song({ id: 'song-ja', workId: 'work-ja' }),
    song({ id: 'song-rock', workId: 'work-rock', title: 'The Story', originalArtist: 'Rock Band' }),
  ], apple, new Map());

  assert.deepEqual(result.songAssignments.get('song-ja')?.map(({ tag }) => tag), ['language:ja']);
  assert.deepEqual(result.songAssignments.get('song-rock')?.map(({ tag }) => tag), ['language:en']);
  assert.deepEqual(result.workAssignments.get('work-rock')?.map(({ tag }) => tag), ['genre:pop', 'genre:rock']);
});

test('recognizes explicit rendition styles and Vocaloid evidence', () => {
  const result = classifyCatalog([
    song({
      id: 'song-style',
      workId: 'work-style',
      title: 'ロミオとシンデレラ（清唱）',
      originalArtist: 'doriko feat. 初音ミク',
    }),
  ], [], new Map());

  assert.deepEqual(result.songAssignments.get('song-style')?.map(({ tag }) => tag), [
    'language:ja',
    'style:a-cappella',
  ]);
  assert.deepEqual(result.workAssignments.get('work-style')?.map(({ tag }) => tag), ['source:vocaloid']);
});

test('marks a matching streamer artist as original and ignores ambiguous Apple genre matches', () => {
  const localApple: AppleArtistLookup[] = [{
    artist: '浠Mizuki',
    results: [1, 2, 3, 4, 5].map(() => ({
      artistId: 20,
      artistName: 'Mizuki',
      trackName: 'Other Song',
      primaryGenreName: 'Rock',
    })),
  }];
  const result = classifyCatalog([
    song({ slug: 'mizuki', id: 'song-original', workId: 'work-original', title: '潮汐', originalArtist: '浠Mizuki' }),
  ], localApple, new Map([['mizuki', '浠Mizuki']]));

  assert.deepEqual(result.workAssignments.get('work-original')?.map(({ tag }) => tag), ['source:original']);
});

test('assigns anime source only for an exact Apple track match', () => {
  const animeApple: AppleArtistLookup[] = [{
    artist: 'Anime Artist',
    results: [{
      artistId: 30,
      artistName: 'Anime Artist',
      trackName: 'Brave Shine',
      primaryGenreName: 'Anime',
    }],
  }];
  const result = classifyCatalog([
    song({ id: 'song-anime', workId: 'work-anime', title: 'Brave Shine (Acoustic ver.)', originalArtist: 'Anime Artist' }),
    song({ id: 'song-other', workId: 'work-other', title: 'Last Stardust', originalArtist: 'Anime Artist' }),
  ], animeApple, new Map());

  assert.equal(result.workAssignments.get('work-anime')?.some(({ tag }) => tag === 'source:anime'), true);
  assert.equal(result.workAssignments.get('work-other')?.some(({ tag }) => tag === 'source:anime') ?? false, false);
});

test('does not reinterpret Apple Anime as anime source for a Vocaloid work', () => {
  const vocaloidApple: AppleArtistLookup[] = [{
    artist: 'Kanaria',
    results: [{
      artistId: 31,
      artistName: 'Kanaria',
      trackName: 'KING',
      primaryGenreName: 'Anime',
    }],
  }];
  const result = classifyCatalog([
    song({ id: 'song-king', workId: 'work-king', title: 'KING', originalArtist: 'Kanaria' }),
  ], vocaloidApple, new Map());

  assert.deepEqual(result.workAssignments.get('work-king')?.map(({ tag }) => tag), ['source:vocaloid']);
});

test('does not propagate a language from generic unknown artists', () => {
  const result = classifyCatalog([
    song({ id: 'song-unknown-ja', workId: 'work-ja', title: '夜に駆ける', originalArtist: 'Unknown' }),
    song({ id: 'song-unknown-zh', workId: 'work-zh', title: '沒說歌名', originalArtist: 'Unknown' }),
  ], [], new Map());

  assert.deepEqual(result.songAssignments.get('song-unknown-ja')?.map(({ tag }) => tag), ['language:ja']);
  assert.deepEqual(result.songAssignments.get('song-unknown-zh')?.map(({ tag }) => tag), ['language:zh']);
});

test('requires standalone Latin voice-synth names', () => {
  const result = classifyCatalog([
    song({ id: 'song-sia', workId: 'work-sia', title: 'Chandelier', originalArtist: 'Sia' }),
    song({ id: 'song-flower', workId: 'work-flower', title: 'Dried flower', originalArtist: '優里' }),
    song({ id: 'song-ia', workId: 'work-ia', title: 'DAYBREAK FRONTLINE', originalArtist: 'Orangestar feat. IA' }),
  ], [], new Map());

  assert.equal(result.workAssignments.has('work-sia'), false);
  assert.equal(result.workAssignments.has('work-flower'), false);
  assert.deepEqual(result.workAssignments.get('work-ia')?.map(({ tag }) => tag), ['source:vocaloid']);
});

test('does not treat an original choir artist as a duet rendition', () => {
  const result = classifyCatalog([
    song({ id: 'song-choir', workId: 'work-choir', title: '飛龍在天', originalArtist: '大信兒童合唱團' }),
    song({ id: 'song-duet', workId: 'work-duet', title: 'Only', originalArtist: 'LeeHi (老師合唱版)' }),
  ], [], new Map());

  assert.equal(result.songAssignments.get('song-choir')?.some(({ tag }) => tag === 'style:duet') ?? false, false);
  assert.equal(result.songAssignments.get('song-duet')?.some(({ tag }) => tag === 'style:duet'), true);
});
