import * as assert from 'node:assert/strict';

import { diffStreamers, registryAnnouncementBatches, type StreamerDiff } from './sync.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

function cfg(slug: string, displayName: string, subscriberCount: string) {
  return {
    slug,
    displayName,
    description: '',
    avatarUrl: '',
    brandName: '',
    subscriberCount,
    group: '',
    socialLinks: {},
    theme: {} as Record<string, string>,
    enabled: true,
  };
}

test('diffStreamers finds brand-new slugs', () => {
  const diff = diffStreamers([cfg('a', 'A', '1萬')], [cfg('a', 'A', '1萬'), cfg('b', 'B', '2萬')]);
  assert.equal(diff.newStreamers.length, 1);
  assert.equal(diff.newStreamers[0].slug, 'b');
  assert.equal(diff.subscriberChanges.length, 0);
});

test('diffStreamers detects subscriber count changes', () => {
  const diff = diffStreamers([cfg('a', 'A', '1萬')], [cfg('a', 'A', '1.2萬')]);
  assert.equal(diff.newStreamers.length, 0);
  assert.deepEqual(diff.subscriberChanges, [{ displayName: 'A', from: '1萬', to: '1.2萬' }]);
});

test('diffStreamers ignores unchanged subscriber counts', () => {
  const diff = diffStreamers([cfg('a', 'A', '1萬')], [cfg('a', 'A', '1萬')]);
  assert.equal(diff.subscriberChanges.length, 0);
});

test('diffStreamers ignores changes when a count is empty', () => {
  const diff = diffStreamers([cfg('a', 'A', '')], [cfg('a', 'A', '1萬')]);
  assert.equal(diff.subscriberChanges.length, 0);
});

// --- registryAnnouncementBatches: registry.json hashed, scaffolded data files presence-only (#15) ---

// Inject a fake hasher so the test stays disk-free and can assert WHICH sources each batch hashes
// (registry.json only for a streamer batch; the data files are presence-only, not hashed).
const joinHash = (sources: string[]): string => sources.join('|');

test('registryAnnouncementBatches: each new streamer hashes registry.json; its data files are presence-only', () => {
  const diff: StreamerDiff = { newStreamers: [cfg('aiko', 'Aiko', '1萬')], subscriberChanges: [] };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].sources, ['data/registry.json']);
  assert.deepEqual(batches[0].presenceSources, ['data/aiko/songs.json', 'data/aiko/streams.json']);
  assert.equal(batches[0].embeds.length, 1);
  // Hash is over registry.json ONLY (stable) — the scaffolded data files are presence-only, so a
  // later sync:data populating them can't break a no-link streamer's tokenless hash at flush.
  assert.equal(batches[0].hash, 'data/registry.json');
});

test('registryAnnouncementBatches: subscriber digest is its own registry.json-only batch', () => {
  const diff: StreamerDiff = { newStreamers: [], subscriberChanges: [{ displayName: 'Aiko', from: '1萬', to: '1.1萬' }] };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].sources, ['data/registry.json']);
  assert.equal(batches[0].presenceSources, undefined); // digest data lives in registry.json; no presence files
  assert.equal(batches[0].embeds.length, 1);
  assert.equal(batches[0].hash, 'data/registry.json');
});

test('registryAnnouncementBatches: new streamers first, then the digest; presenceSources isolate each slug', () => {
  const diff: StreamerDiff = {
    newStreamers: [cfg('aiko', 'Aiko', '1萬'), cfg('mei', 'Mei', '2萬')],
    subscriberChanges: [{ displayName: 'Existing', from: '3萬', to: '3.1萬' }],
  };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].presenceSources, ['data/aiko/songs.json', 'data/aiko/streams.json']);
  assert.deepEqual(batches[1].presenceSources, ['data/mei/songs.json', 'data/mei/streams.json']);
  assert.deepEqual(batches[0].sources, ['data/registry.json']);
  assert.deepEqual(batches[2].sources, ['data/registry.json']);
  assert.equal(batches[2].presenceSources, undefined); // digest batch: no presence sources
});

test('registryAnnouncementBatches: nothing to announce → no batches, and no hash/disk read', () => {
  // An empty diff must not hash registry.json (a disk read in production) — return [] before hashing.
  const throwingHash = (): string => {
    throw new Error('computeHash must not run on an empty diff');
  };
  assert.deepEqual(registryAnnouncementBatches({ newStreamers: [], subscriberChanges: [] }, throwingHash), []);
});

console.log('sync-registry.test: all passed');
