import assert from 'node:assert/strict';
import {
  buildPerformanceIndex,
  playableQueue,
  resolveSavedRef,
  resolveSavedRefs,
  toTrack,
} from './saved-refs';
import type { ArchiveSong, PerformanceRef } from '../types/archive';

const perf = (id: string, videoId: string, timestamp: number, endTimestamp: number | null) => ({
  id,
  streamId: 'stream-1',
  date: '2026-09-01',
  streamTitle: 'Stream 1',
  videoId,
  timestamp,
  endTimestamp,
  note: '',
});

const catalog: ArchiveSong[] = [
  {
    id: 'song-a',
    workId: 'work-1',
    title: 'Live Title',
    originalArtist: 'Live Artist',
    tags: [],
    performances: [perf('p1', 'v1', 10, 20), perf('p2', 'v2', 100, 130)],
  },
  { id: 'song-b', title: 'No Work', originalArtist: 'B', tags: [], performances: [perf('p3', 'v3', 0, null)] },
  // A second song claiming p1: the first owner wins, deterministically.
  { id: 'song-dupe', title: 'Dupe', originalArtist: 'D', tags: [], performances: [perf('p1', 'vX', 0, null)] },
];

const index = buildPerformanceIndex(catalog);
assert.equal(index.size, 3);
assert.equal(index.get('p1')?.song.id, 'song-a', 'the first owner of a performance id wins');
assert.equal(index.get('p3')?.performance.videoId, 'v3');

// A stale snapshot: every non-identity field is wrong, including workId.
const snapshot: PerformanceRef = {
  performanceId: 'p1',
  songId: 'stale-song',
  workId: 'wrong-work',
  songTitle: 'Old Title',
  originalArtist: 'Old Artist',
  videoId: 'old-video',
  timestamp: 1,
  endTimestamp: null,
  streamerSlug: 'mizuki',
};

// live: everything but performanceId/streamerSlug comes from the catalog.
assert.deepEqual(resolveSavedRef(snapshot, index), {
  status: 'live',
  ref: {
    performanceId: 'p1',
    songId: 'song-a',
    workId: 'work-1',
    songTitle: 'Live Title',
    originalArtist: 'Live Artist',
    videoId: 'v1',
    timestamp: 10,
    endTimestamp: 20,
    streamerSlug: 'mizuki',
  },
});
const liveNoWork = resolveSavedRef({ ...snapshot, performanceId: 'p3' }, index);
assert.equal(liveNoWork.status, 'live');
assert.equal('workId' in liveNoWork.ref, false, 'no workId key when the owning song has none');

// missing: the snapshot object itself comes back, untouched.
const gone: PerformanceRef = { ...snapshot, performanceId: 'p-gone', workId: 'work-1' };
const missing = resolveSavedRef(gone, index);
assert.equal(missing.status, 'missing');
assert.equal(missing.ref, gone, 'workId matching a live work does not resurrect an absent performance');

// unknown: no catalog yet — snapshot, no verdict.
const unknown = resolveSavedRef(snapshot, null);
assert.equal(unknown.status, 'unknown');
assert.equal(unknown.ref, snapshot);

// workId is never identity: two saved performances of one work resolve on
// their own ids, and a wrong workId next to a live performanceId is ignored.
const [first, second] = resolveSavedRefs([snapshot, { ...snapshot, performanceId: 'p2' }], index);
assert.equal(first?.ref.videoId, 'v1');
assert.equal(second?.ref.videoId, 'v2');
assert.equal(second?.ref.timestamp, 100);
assert.equal(resolveSavedRefs([], index).length, 0);
assert.deepEqual(resolveSavedRefs([gone, snapshot], index).map((r) => r.status), ['missing', 'live']);

// toTrack: only missing entries are flagged deleted.
assert.equal(toTrack(missing).deleted, true);
assert.equal(toTrack(resolveSavedRef(snapshot, index)).deleted, false);
assert.equal(toTrack(unknown).deleted, false);
assert.equal(toTrack(unknown).songTitle, 'Old Title', 'unknown plays the snapshot');

// playableQueue: skip leading missing entries, keep trailing ones flagged.
const resolved = resolveSavedRefs([gone, snapshot, gone, { ...snapshot, performanceId: 'p2' }], index);
const queue = playableQueue(resolved);
assert.ok(queue);
assert.equal(queue.first.performanceId, 'p1');
assert.equal(queue.first.deleted, false);
assert.deepEqual(queue.following.map((t) => [t.performanceId, t.deleted]), [['p-gone', true], ['p2', false]]);
assert.equal(playableQueue(resolved, 2)?.first.performanceId, 'p2', 'startIndex is honoured');
assert.equal(playableQueue([missing]), null);
assert.equal(playableQueue([]), null);

console.log('✓ saved refs resolve by performanceId only');
