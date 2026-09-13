import assert from 'node:assert/strict';
import { normalizeStoredRef } from './normalize-performance-ref';

// A legacy liked-song entry: no songId, no streamerSlug, endTimestamp omitted.
const legacyLiked = {
  performanceId: 'p-1',
  songTitle: 'Song',
  originalArtist: 'Artist',
  videoId: 'vid',
  timestamp: 12,
  likedAt: 1700000000000,
};
assert.deepEqual(normalizeStoredRef(legacyLiked, 'mizuki'), {
  performanceId: 'p-1',
  songId: 'p-1', // placeholder until the entry is re-saved from a real track
  songTitle: 'Song',
  originalArtist: 'Artist',
  videoId: 'vid',
  timestamp: 12,
  endTimestamp: null,
  streamerSlug: 'mizuki',
});

// A current entry keeps every field, including a real songId and a stored slug.
const current = {
  performanceId: 'p-2',
  songId: 'song-2',
  songTitle: 'Two',
  originalArtist: 'B',
  videoId: 'vid2',
  timestamp: 3,
  endTimestamp: 40,
  streamerSlug: 'gabu',
};
assert.deepEqual(normalizeStoredRef(current, 'mizuki'), { ...current });

// workId is optional metadata: kept when present, never required, never a
// substitute for performanceId.
assert.deepEqual(normalizeStoredRef({ ...current, workId: 'work-2' }, 'mizuki'), { ...current, workId: 'work-2' });
assert.equal('workId' in normalizeStoredRef(current, 'mizuki')!, false, 'no workId key when the entry has none');
assert.equal(
  normalizeStoredRef({ workId: 'work-2', songTitle: 'S', videoId: 'v', timestamp: 1 }, 'mizuki'),
  null,
  'an entry with workId but no performanceId is still rejected',
);

// Garbage is rejected rather than turned into a broken track.
assert.equal(normalizeStoredRef(null, 'mizuki'), null);
assert.equal(normalizeStoredRef({ songTitle: 'no id' }, 'mizuki'), null);
assert.equal(normalizeStoredRef({ performanceId: 'p', videoId: 'v', timestamp: 'nan' }, 'mizuki'), null);

console.log('✓ stored performance refs normalise to PerformanceRef');
