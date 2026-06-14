import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { clearPendingAnnouncements, enqueueAnnouncements, hashSources, parseDevVar, partitionByLiveHash, readPendingBatches, remainingBatchesAfter, writePendingBatches } from './announce.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test('parseDevVar extracts the value', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE=https://x/y\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar returns null when the key is absent', () => {
  assert.equal(parseDevVar('OTHER=1\n', 'DISCORD_WEBHOOK_ANNOUNCE'), null);
});

test('parseDevVar ignores commented lines', () => {
  assert.equal(parseDevVar('# DISCORD_WEBHOOK_ANNOUNCE=nope\nDISCORD_WEBHOOK_ANNOUNCE=real\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'real');
});

test('parseDevVar strips surrounding quotes', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE="https://x/y"\n', 'DISCORD_WEBHOOK_ANNOUNCE'), 'https://x/y');
});

test('parseDevVar treats an empty value as null', () => {
  assert.equal(parseDevVar('DISCORD_WEBHOOK_ANNOUNCE=\n', 'DISCORD_WEBHOOK_ANNOUNCE'), null);
});

test('pending queue: missing file reads as empty; enqueue accumulates batches; clear removes', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  assert.deepEqual(readPendingBatches(tmp), []); // ENOENT → []
  enqueueAnnouncements({ embeds: [{ title: 'a' }], sources: ['data/x/streams.json'], hash: 'h1' }, tmp);
  enqueueAnnouncements({ embeds: [{ title: 'b' }], sources: ['data/y/streams.json'], hash: 'h2' }, tmp);
  assert.deepEqual(readPendingBatches(tmp), [
    { embeds: [{ title: 'a' }], sources: ['data/x/streams.json'], hash: 'h1' },
    { embeds: [{ title: 'b' }], sources: ['data/y/streams.json'], hash: 'h2' },
  ]);
  clearPendingAnnouncements(tmp);
  assert.deepEqual(readPendingBatches(tmp), []);
});

test('pending queue: same-source enqueue merges so an earlier sync is not dropped', () => {
  // Codex-P2: a second `sync:data <slug>` before push announces only the new stream, but
  // must NOT drop the first sync's still-pending announcement for the same files. The merged
  // batch adopts the latest hash so flush verifies it against the newest revision of the files.
  const tmp = path.join(os.tmpdir(), `pending-announce-merge-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA' }, tmp);
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/B', title: 'B' }], sources: ['data/x/streams.json'], hash: 'hAB' }, tmp);
  assert.deepEqual(readPendingBatches(tmp), [
    {
      embeds: [{ url: 'https://youtu.be/A', title: 'A' }, { url: 'https://youtu.be/B', title: 'B' }],
      sources: ['data/x/streams.json'],
      hash: 'hAB',
    },
  ]);
  clearPendingAnnouncements(tmp);
});

test('pending queue: same-source enqueue dedupes a re-announced url, keeping the latest', () => {
  // The revert-then-resync case (announce A, `git checkout` the data, sync again) must collapse
  // the duplicate A to a single, latest announcement rather than posting it to fans twice.
  const tmp = path.join(os.tmpdir(), `pending-announce-dedup-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A v1' }], sources: ['data/x/streams.json'], hash: 'h1' }, tmp);
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A v2' }], sources: ['data/x/streams.json'], hash: 'h2' }, tmp);
  assert.deepEqual(readPendingBatches(tmp), [
    { embeds: [{ url: 'https://youtu.be/A', title: 'A v2' }], sources: ['data/x/streams.json'], hash: 'h2' },
  ]);
  clearPendingAnnouncements(tmp);
});

test('pending queue: merge keeps each subject first-seen position with its latest value', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-order-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A v1' }, { url: 'https://youtu.be/B', title: 'B' }], sources: ['data/x/streams.json'], hash: 'h1' }, tmp);
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A v2' }], sources: ['data/x/streams.json'], hash: 'h2' }, tmp);
  // A keeps its first-seen slot (index 0) but takes the latest value (A v2); B stays after it.
  assert.deepEqual(readPendingBatches(tmp), [
    {
      embeds: [{ url: 'https://youtu.be/A', title: 'A v2' }, { url: 'https://youtu.be/B', title: 'B' }],
      sources: ['data/x/streams.json'],
      hash: 'h2',
    },
  ]);
  clearPendingAnnouncements(tmp);
});

test('pending queue: enqueue of empty embeds is a no-op (no file created)', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-empty-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [], sources: ['data/x/streams.json'], hash: 'h' }, tmp);
  assert.equal(fs.existsSync(tmp), false);
});

test('pending queue: old {embeds} format reads as one unconditional batch', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-legacy-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ embeds: [{ title: 'legacy' }] }) + '\n', 'utf-8');
  assert.deepEqual(readPendingBatches(tmp), [{ embeds: [{ title: 'legacy' }] }]);
  clearPendingAnnouncements(tmp);
});

test('writePendingBatches removes the file when only empty-embed batches remain', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-write-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  writePendingBatches([{ embeds: [] }], tmp);
  assert.equal(fs.existsSync(tmp), false);
});

test('hashSources is stable and order-sensitive over its sources', () => {
  const read = (s: string) => ({ a: 'AAA', b: 'BBB' } as Record<string, string>)[s] ?? '';
  assert.equal(hashSources(['a', 'b'], read), hashSources(['a', 'b'], read));
  assert.notEqual(hashSources(['a', 'b'], read), hashSources(['b', 'a'], read));
});

test('partitionByLiveHash: match→verified, reverted/missing→stale, empty sources→unconditional', () => {
  const live: Record<string, string> = { 'data/live.json': 'NEW' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('not on origin/master');
    return live[s];
  };
  const matching = { embeds: [{ title: 'ok' }], sources: ['data/live.json'], hash: hashSources(['data/live.json'], readLive) };
  const reverted = { embeds: [{ title: 'reverted' }], sources: ['data/live.json'], hash: 'stale-hash' };
  const missing = { embeds: [{ title: 'missing' }], sources: ['data/gone.json'], hash: 'whatever' };
  const unconditional = { embeds: [{ title: 'remainder' }] };
  const { verified, stale } = partitionByLiveHash([matching, reverted, missing, unconditional], readLive);
  assert.deepEqual(verified, [matching, unconditional]);
  assert.deepEqual(stale, [reverted, missing]);
});

test('remainingBatchesAfter keeps each unposted batch sources+hash for retry re-verification', () => {
  // Codex-P2: a mid-flush failure must NOT strip the revision metadata, or the remainder posts
  // unconditionally on the next flush even if the pushed data was reverted in the meantime.
  const verified = [
    { embeds: [{ title: 'e1' }, { title: 'e2' }, { title: 'e3' }], sources: ['data/x/streams.json'], hash: 'hx' },
    { embeds: [{ title: 'e4' }], sources: ['data/registry.json'], hash: 'hr' },
  ];
  assert.deepEqual(remainingBatchesAfter(verified, 0, 0), verified); // nothing posted → all remain, intact
  assert.deepEqual(remainingBatchesAfter(verified, 0, 1), [
    { embeds: [{ title: 'e2' }, { title: 'e3' }], sources: ['data/x/streams.json'], hash: 'hx' },
    { embeds: [{ title: 'e4' }], sources: ['data/registry.json'], hash: 'hr' },
  ]);
  assert.deepEqual(remainingBatchesAfter(verified, 0, 3), [ // first batch fully posted → dropped
    { embeds: [{ title: 'e4' }], sources: ['data/registry.json'], hash: 'hr' },
  ]);
});

test('remainingBatchesAfter returns empty once the final batch is fully posted', () => {
  const verified = [{ embeds: [{ title: 'only' }], sources: ['data/x/streams.json'], hash: 'h' }];
  assert.deepEqual(remainingBatchesAfter(verified, 0, 1), []);
});

console.log('announce.test: all passed');
