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

// Garbage is rejected rather than turned into a broken track.
assert.equal(normalizeStoredRef(null, 'mizuki'), null);
assert.equal(normalizeStoredRef({ songTitle: 'no id' }, 'mizuki'), null);
assert.equal(normalizeStoredRef({ performanceId: 'p', videoId: 'v', timestamp: 'nan' }, 'mizuki'), null);

console.log('✓ stored performance refs normalise to PerformanceRef');
