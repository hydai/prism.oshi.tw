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

// --- registryAnnouncementBatches: per-streamer batches sourced on the scaffolded data files (#15) ---

// Inject a fake hasher so the test stays disk-free and can assert each batch's hash is taken over
// THIS batch's own sources (not a shared registry-only hash).
const joinHash = (sources: string[]): string => sources.join('|');

test('registryAnnouncementBatches: one batch per new streamer, sourced on its scaffolded data files', () => {
  const diff: StreamerDiff = { newStreamers: [cfg('aiko', 'Aiko', '1萬')], subscriberChanges: [] };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].sources, ['data/registry.json', 'data/aiko/songs.json', 'data/aiko/streams.json']);
  assert.equal(batches[0].embeds.length, 1);
  // A no-link streamer's embed is tokenless, so at flush it's verified by this hash against the live
  // concatenated sources; the hash must cover all the batch's sources (registry + the slug's data
  // files), not registry.json alone, or it can't match the live content and the embed is dropped.
  assert.equal(batches[0].hash, 'data/registry.json|data/aiko/songs.json|data/aiko/streams.json');
});

test('registryAnnouncementBatches: subscriber digest is its own registry.json-only batch', () => {
  const diff: StreamerDiff = { newStreamers: [], subscriberChanges: [{ displayName: 'Aiko', from: '1萬', to: '1.1萬' }] };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].sources, ['data/registry.json']);
  assert.equal(batches[0].embeds.length, 1);
  assert.equal(batches[0].hash, 'data/registry.json');
});

test('registryAnnouncementBatches: new streamers first, then the digest; sources isolate each slug', () => {
  const diff: StreamerDiff = {
    newStreamers: [cfg('aiko', 'Aiko', '1萬'), cfg('mei', 'Mei', '2萬')],
    subscriberChanges: [{ displayName: 'Existing', from: '3萬', to: '3.1萬' }],
  };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].sources, ['data/registry.json', 'data/aiko/songs.json', 'data/aiko/streams.json']);
  assert.deepEqual(batches[1].sources, ['data/registry.json', 'data/mei/songs.json', 'data/mei/streams.json']);
  assert.deepEqual(batches[2].sources, ['data/registry.json']);
});

test('registryAnnouncementBatches: nothing to announce → no batches', () => {
  assert.deepEqual(registryAnnouncementBatches({ newStreamers: [], subscriberChanges: [] }, joinHash), []);
});

console.log('sync-registry.test: all passed');
