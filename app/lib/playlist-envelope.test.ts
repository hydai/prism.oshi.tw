import assert from 'node:assert/strict';
import { buildEnvelope, parsePlaylists, validateImport, type Playlist } from './playlist-envelope';

const liveRef = {
  performanceId: 'perf-1',
  songId: 'song-1',
  workId: 'work-1',
  songTitle: 'Song',
  originalArtist: 'Artist',
  videoId: 'vid1',
  timestamp: 12,
  endTimestamp: 40,
  streamerSlug: 'gabu',
};

// v1 (MizukiPrism era): entries lack songId/streamerSlug/endTimestamp and the
// file has no slug — everything belongs to mizuki.
const v1 = {
  source: 'MizukiPrism',
  version: 1,
  exportedAt: '2025-01-01T00:00:00.000Z',
  playlists: [{
    id: 'playlist-legacy',
    name: 'Legacy',
    createdAt: 1700000000000,
    updatedAt: 1700000000001,
    versions: [{ performanceId: 'perf-old', songTitle: 'Old', originalArtist: 'A', videoId: 'v', timestamp: 3 }],
  }],
};
assert.deepEqual(validateImport(v1, 'gabu'), {
  valid: true,
  playlists: [{
    id: 'playlist-legacy',
    name: 'Legacy',
    createdAt: 1700000000000,
    updatedAt: 1700000000001,
    versions: [{
      performanceId: 'perf-old',
      songId: 'perf-old',
      songTitle: 'Old',
      originalArtist: 'A',
      videoId: 'v',
      timestamp: 3,
      endTimestamp: null,
      streamerSlug: 'mizuki',
    }],
  }],
});

// v2: the current format; workId is kept, entries without performanceId are
// dropped, duplicates collapse to the first occurrence.
const v2 = {
  source: 'Prism',
  version: 2,
  exportedAt: '2026-09-14T00:00:00.000Z',
  playlists: [{
    id: 'playlist-2',
    name: 'Two',
    createdAt: 1,
    updatedAt: 2,
    versions: [liveRef, { songTitle: 'no id', videoId: 'v', timestamp: 1 }, { ...liveRef, songTitle: 'dupe' }],
  }],
};
const v2Result = validateImport(v2, 'gabu');
assert.ok(v2Result.valid);
assert.deepEqual(v2Result.playlists[0]?.versions, [liveRef]);

// Rejections keep their user-facing reasons.
assert.deepEqual(validateImport(null, 'gabu'), { valid: false, error: '檔案格式無效' });
assert.deepEqual(validateImport({ ...v2, source: 'Other' }, 'gabu'), { valid: false, error: '非 Prism 匯出檔案' });
assert.deepEqual(validateImport({ ...v2, version: 3 }, 'gabu'), { valid: false, error: '檔案版本不支援' });
assert.deepEqual(validateImport({ ...v2, playlists: [] }, 'gabu'), { valid: false, error: '檔案不含播放清單' });
assert.deepEqual(
  validateImport({ ...v2, playlists: [{ id: 1, name: 'bad' }] }, 'gabu'),
  { valid: false, error: '檔案不含有效的播放清單' },
);

// buildEnvelope: version 2, deterministic timestamp, entries carried verbatim.
const playlists: Playlist[] = [{ id: 'p', name: 'P', createdAt: 1, updatedAt: 2, versions: [liveRef] }];
assert.deepEqual(buildEnvelope(playlists, new Date('2026-09-14T00:00:00Z')), {
  version: 2,
  exportedAt: '2026-09-14T00:00:00.000Z',
  source: 'Prism',
  playlists,
});

// parsePlaylists (localStorage): garbage → [], entries without id/name dropped,
// timestamps fall back to a shared createdAt when missing.
assert.deepEqual(parsePlaylists('nope', 'gabu'), []);
assert.deepEqual(parsePlaylists([{ name: 'no id' }, null], 'gabu'), []);
const [parsed] = parsePlaylists([{ id: 'p', name: 'P', versions: [liveRef, liveRef] }], 'gabu');
assert.deepEqual(parsed?.versions, [liveRef]);
assert.equal(typeof parsed?.createdAt, 'number');
assert.equal(parsed?.updatedAt, parsed?.createdAt);

console.log('✓ playlist envelope helpers');
