import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AGG_SQL, readRegistry, type StreamerRegistryEntry } from './detect.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

/** Write a throwaway registry.json under a temp root and return that root. */
function tmpRegistry(streamers: StreamerRegistryEntry[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-detect-'));
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'data', 'registry.json'),
    JSON.stringify({ version: 1, streamers }),
    'utf-8',
  );
  return root;
}

test('readRegistry returns the enabled streamers for a valid registry', () => {
  const root = tmpRegistry([{ slug: 'mizuki', enabled: true }, { slug: 'aurora-2' }]);
  const result = readRegistry(root);
  assert.deepEqual(result.map((s) => s.slug), ['mizuki', 'aurora-2']);
});

test('song freshness includes global work-link updates', () => {
  assert.match(AGG_SQL, /LEFT JOIN song_work_links AS link ON link\.song_id = song\.id/);
  assert.match(AGG_SQL, /link\.updated_at > song\.updated_at/);
});

test('readRegistry throws (fail-closed) on an enabled malicious slug, naming it and the source', () => {
  const root = tmpRegistry([{ slug: "attacker' OR 1=1 -- ", enabled: true }]);
  assert.throws(
    () => readRegistry(root),
    (err: Error) =>
      err.message.includes("attacker' OR 1=1 -- ") && err.message.includes('registry.json'),
  );
});

test('readRegistry throws on a path-traversal slug', () => {
  const root = tmpRegistry([{ slug: '../../evil', enabled: true }]);
  assert.throws(() => readRegistry(root), /Invalid streamer slug/);
});

test('readRegistry ignores a disabled malicious slug (filtered before it can reach a sink)', () => {
  // A disabled streamer is never synced, so a junk slug there must not block the valid ones.
  const root = tmpRegistry([{ slug: "bad'slug", enabled: false }, { slug: 'mizuki', enabled: true }]);
  const result = readRegistry(root);
  assert.deepEqual(result.map((s) => s.slug), ['mizuki']);
});

test('readRegistry throws on a non-string slug in a tampered registry instead of coercing it', () => {
  // registry.json is untrusted JSON: a numeric slug like 123 must fail closed, not be
  // coerced to "123" by RegExp.test and accepted (Codex PR #31 finding).
  const root = tmpRegistry([{ slug: 123 as unknown as string, enabled: true }]);
  assert.throws(() => readRegistry(root), /Invalid streamer slug/);
});

console.log('detect.test: all passed');
