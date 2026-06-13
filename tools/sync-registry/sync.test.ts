import * as assert from 'node:assert/strict';

import { diffStreamers } from './sync.ts';

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

console.log('sync-registry.test: all passed');
