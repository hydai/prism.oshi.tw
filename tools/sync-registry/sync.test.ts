import * as assert from 'node:assert/strict';

import { diffStreamers, registryAnnouncementBatches, rowToConfig, type StreamerDiff, type SubmissionRow } from './sync.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const validTheme = JSON.stringify({
  accentPrimary: '#111111',
  accentPrimaryDark: '#222222',
  accentPrimaryLight: '#333333',
  accentSecondary: '#444444',
  accentSecondaryLight: '#555555',
  bgPageStart: '#666666',
  bgPageMid: '#777777',
  bgPageEnd: '#888888',
  bgAccentPrimary: '#999999',
  bgAccentPrimaryMuted: '#aaaaaa',
  borderAccentPrimary: '#bbbbbb',
  borderAccentSecondary: '#cccccc',
});
const validThemeConfig = JSON.parse(validTheme) as ReturnType<typeof rowToConfig>['theme'];

function row(overrides: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    slug: 'aiko',
    display_name: 'Aiko',
    description: '',
    avatar_url: 'https://yt3.ggpht.com/avatar=s240',
    brand_name: '',
    subscriber_count: '',
    group: '',
    enabled: 1,
    display_order: 1,
    theme_json: validTheme,
    link_youtube: 'https://www.youtube.com/@aiko',
    link_twitter: 'https://x.com/aiko',
    link_facebook: 'https://www.facebook.com/aiko',
    link_instagram: 'https://www.instagram.com/aiko',
    link_twitch: 'https://www.twitch.tv/aiko',
    external_url: 'https://example.com/aiko',
    ...overrides,
  };
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
    theme: validThemeConfig,
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

test('registryAnnouncementBatches: each new streamer carries liveKeys=[slug] (unique no-link fallback)', () => {
  const diff: StreamerDiff = { newStreamers: [cfg('aiko', 'Aiko', '1萬')], subscriberChanges: [] };
  const batches = registryAnnouncementBatches(diff, joinHash);
  // slug is the unique registry key (display_name is not), so a no-link streamer verifies by slug.
  assert.deepEqual(batches[0].liveKeys, ['aiko']);
});

test('registryAnnouncementBatches: subscriber digest carries liveKeys = the new counts', () => {
  const diff: StreamerDiff = {
    newStreamers: [],
    subscriberChanges: [
      { displayName: 'Aiko', from: '1萬', to: '1.1萬' },
      { displayName: 'Mei', from: '2萬', to: '2.2萬' },
    ],
  };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 1);
  // the digest announces the NEW counts, so it verifies those are live in registry.json (not merely
  // that the streamer still exists) — a reverted count drops it.
  assert.deepEqual(batches[0].liveKeys, ['1.1萬', '2.2萬']);
});

test('rowToConfig sanitizes valid Nova URL fields before writing registry data', () => {
  const config = rowToConfig(row({
    link_twitch: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.twitch.tv%2Faiko',
  }));

  assert.equal(config.avatarUrl, 'https://yt3.ggpht.com/avatar=s240');
  assert.deepEqual(config.socialLinks, {
    youtube: 'https://www.youtube.com/@aiko',
    twitter: 'https://x.com/aiko',
    facebook: 'https://www.facebook.com/aiko',
    instagram: 'https://www.instagram.com/aiko',
    twitch: 'https://www.twitch.tv/aiko',
  });
});

test('rowToConfig rejects path-traversal slugs before writing registry data', () => {
  assert.throws(() => rowToConfig(row({ slug: '../escape' })), /Invalid streamer slug/);
});

test('rowToConfig rejects unsafe social URL protocols', () => {
  assert.throws(() => rowToConfig(row({ link_youtube: 'javascript:alert(1)' })), /Invalid aiko\.link_youtube/);
});

test('rowToConfig rejects social URLs on unexpected hosts', () => {
  assert.throws(() => rowToConfig(row({ link_twitter: 'https://evil.example/phish' })), /Invalid aiko\.link_twitter/);
});

test('rowToConfig rejects unsafe avatar URLs', () => {
  assert.throws(() => rowToConfig(row({ avatar_url: 'data:text/html,<script>alert(1)</script>' })), /Invalid aiko\.avatar_url/);
});

test('rowToConfig rejects null URL fields with a clear validation error', () => {
  assert.throws(() => rowToConfig(row({ link_twitch: null })), /Invalid aiko\.link_twitch: expected a string, got null/);
});

test('rowToConfig rejects non-string URL fields with a clear validation error', () => {
  assert.throws(() => rowToConfig(row({ external_url: 123 })), /Invalid aiko\.external_url: expected a string, got number/);
});

test('rowToConfig rejects unsafe external URLs', () => {
  assert.throws(() => rowToConfig(row({ external_url: 'javascript:alert(1)' })), /Invalid aiko\.external_url/);
});

test('rowToConfig rejects malformed theme colors', () => {
  const theme = JSON.stringify({ ...JSON.parse(validTheme), accentPrimary: 'url(javascript:alert(1))' });
  assert.throws(() => rowToConfig(row({ theme_json: theme })), /invalid theme color accentPrimary/);
});

console.log('sync-registry.test: all passed');
