import * as assert from 'node:assert/strict';

import { songCountForStream, songCountsByStream, streamsToAnnounce } from './sync.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const streamA = { id: 's1', title: 'A', date: '2024-01-01', videoId: 'v1', youtubeUrl: 'u1' };

const perf = (id: string, streamId: string) => ({
  id,
  streamId,
  date: '',
  streamTitle: '',
  videoId: '',
  timestamp: 0,
  endTimestamp: null,
  note: '',
});
const song = (id: string, performances: ReturnType<typeof perf>[]) => ({
  id,
  title: id,
  originalArtist: '',
  tags: [] as string[],
  performances,
});

test('songCountForStream counts distinct songs performed in the stream', () => {
  const songs = [song('song1', [perf('p1', 's1')]), song('song2', [perf('p2', 's2')]), song('song3', [perf('p3', 's1')])];
  assert.equal(songCountForStream(songs, 's1'), 2);
  assert.equal(songCountForStream(songs, 's2'), 1);
});

test('songCountsByStream counts distinct songs per stream (two performances of one song in a stream count once)', () => {
  const songs = [song('song1', [perf('p1', 's1'), perf('p1b', 's1')]), song('song2', [perf('p2', 's2')]), song('song3', [perf('p3', 's1')])];
  const counts = songCountsByStream(songs);
  assert.equal(counts.get('s1'), 2);
  assert.equal(counts.get('s2'), 1);
});

test('streamsToAnnounce fires for a brand-new stream published with songs', () => {
  // not in old streams, no old songs; now in streams.json with 3 songs
  assert.deepEqual(
    streamsToAnnounce([streamA], new Set<string>(), new Map<string, number>(), new Map<string, number>([['s1', 3]])),
    [streamA],
  );
});

test('streamsToAnnounce defers a stream published before its songs, then fires when they land', () => {
  // stream already in streams.json but still 0 songs → not yet
  assert.deepEqual(
    streamsToAnnounce([streamA], new Set<string>(['s1']), new Map<string, number>(), new Map<string, number>()),
    [],
  );
  // songs land: old had the stream but 0 songs, now ≥1 → fires
  assert.deepEqual(
    streamsToAnnounce([streamA], new Set<string>(['s1']), new Map<string, number>(), new Map<string, number>([['s1', 2]])),
    [streamA],
  );
});

test('streamsToAnnounce fires when songs were approved before the stream', () => {
  // old: s1's songs already in songs.json (count 1) but s1 NOT yet in streams.json;
  // now s1 is published → must still announce
  assert.deepEqual(
    streamsToAnnounce([streamA], new Set<string>(), new Map<string, number>([['s1', 1]]), new Map<string, number>([['s1', 1]])),
    [streamA],
  );
});

test('streamsToAnnounce does not re-announce a stream already published with songs', () => {
  assert.deepEqual(
    streamsToAnnounce([streamA], new Set<string>(['s1']), new Map<string, number>([['s1', 2]]), new Map<string, number>([['s1', 5]])),
    [],
  );
});

console.log('sync-data.test: all passed');
