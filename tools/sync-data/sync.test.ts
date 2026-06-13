import * as assert from 'node:assert/strict';

import { diffStreams, songCountForStream } from './sync.ts';

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
const streamB = { id: 's2', title: 'B', date: '2024-02-01', videoId: 'v2', youtubeUrl: 'u2' };

test('diffStreams returns streams whose id is new', () => {
  assert.deepEqual(diffStreams([streamA], [streamA, streamB]), [streamB]);
});

test('diffStreams returns empty when nothing is new', () => {
  assert.deepEqual(diffStreams([streamA, streamB], [streamA, streamB]), []);
});

test('diffStreams treats an empty old list as all-new', () => {
  assert.deepEqual(diffStreams([], [streamA]), [streamA]);
});

test('songCountForStream counts distinct songs performed in the stream', () => {
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
  const songs = [
    { id: 'song1', title: 'X', originalArtist: '', tags: [], performances: [perf('p1', 's1')] },
    { id: 'song2', title: 'Y', originalArtist: '', tags: [], performances: [perf('p2', 's2')] },
    { id: 'song3', title: 'Z', originalArtist: '', tags: [], performances: [perf('p3', 's1')] },
  ];
  assert.equal(songCountForStream(songs, 's1'), 2);
  assert.equal(songCountForStream(songs, 's2'), 1);
});

console.log('sync-data.test: all passed');
