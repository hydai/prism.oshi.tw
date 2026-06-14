import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { clearPendingAnnouncements, deriveLiveKey, enqueueAnnouncements, hashSources, parseDevVar, partitionByLiveness, readPendingBatches, remainingBatchesAfter, writePendingBatches } from './announce.ts';

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

test('deriveLiveKey: stream embed → videoId; streamer embed → link; aggregate → null', () => {
  assert.equal(deriveLiveKey({ title: 's', url: 'https://youtu.be/KfadSsRBCi8' }), 'KfadSsRBCi8');
  assert.equal(deriveLiveKey({ title: 'r', url: 'https://www.youtube.com/c/Foo' }), 'https://www.youtube.com/c/Foo');
  assert.equal(deriveLiveKey({ title: '📈 訂閱數更新' }), null);
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

test('pending queue: enqueue appends batches (dedupe deferred to flush by liveKey)', () => {
  const tmp = path.join(os.tmpdir(), `pending-append-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA' }, tmp);
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA2' }, tmp);
  // Both kept on disk; partitionByLiveness dedupes by videoId at flush.
  assert.deepEqual(readPendingBatches(tmp), [
    { embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA' },
    { embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA2' },
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

test('partitionByLiveness: token present→post, absent→drop, dedupe, aggregate hash, sourceless', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'KfadSsRBCi8 OtherVid', 'data/registry.json': 'REG' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const streamLive = { embeds: [{ title: 'A', url: 'https://youtu.be/KfadSsRBCi8' }], sources: ['data/x/streams.json'], hash: 'ignored' };
  const streamDead = { embeds: [{ title: 'Z', url: 'https://youtu.be/ZZZdeadZZZ0' }], sources: ['data/x/streams.json'], hash: 'ignored' };
  const dupOfA = { embeds: [{ title: 'A again', url: 'https://youtu.be/KfadSsRBCi8' }], sources: ['data/x/streams.json'], hash: 'ignored' };
  const digestMatch = { embeds: [{ title: '📈' }], sources: ['data/registry.json'], hash: hashSources(['data/registry.json'], readLive) };
  const digestStale = { embeds: [{ title: '📈 old' }], sources: ['data/registry.json'], hash: 'stale' };
  const unconditional = { embeds: [{ title: 'remainder' }] };
  const { verified, droppedKeys } = partitionByLiveness(
    [streamLive, streamDead, dupOfA, digestMatch, digestStale, unconditional],
    readLive,
  );
  assert.deepEqual(verified, [
    { embeds: [{ title: 'A', url: 'https://youtu.be/KfadSsRBCi8' }], sources: ['data/x/streams.json'], hash: 'ignored' },
    { embeds: [{ title: '📈' }], sources: ['data/registry.json'], hash: digestMatch.hash },
    { embeds: [{ title: 'remainder' }] },
  ]);
  assert.deepEqual(droppedKeys, ['ZZZdeadZZZ0']); // dead stream logged; dupOfA deduped silently
});

test('partitionByLiveness: same videoId under different streamers (collab VOD) is not cross-deduped', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'COLLABvid11', 'data/y/streams.json': 'COLLABvid11' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const onX = { embeds: [{ title: 'X', url: 'https://youtu.be/COLLABvid11' }], sources: ['data/x/streams.json'], hash: 'h' };
  const onY = { embeds: [{ title: 'Y', url: 'https://youtu.be/COLLABvid11' }], sources: ['data/y/streams.json'], hash: 'h' };
  const { verified } = partitionByLiveness([onX, onY], readLive);
  assert.deepEqual(verified.flatMap((b) => b.embeds.map((e) => e.title)), ['X', 'Y']); // both kept — distinct streamers
});

test('partitionByLiveness #14 false-positive: a removed stream is dropped (not blessed)', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'Bvid_live' }; // A removed, only B live
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const queued = [
    { embeds: [{ title: 'A', url: 'https://youtu.be/Avid_gone' }], sources: ['data/x/streams.json'], hash: 'h' },
    { embeds: [{ title: 'B', url: 'https://youtu.be/Bvid_live' }], sources: ['data/x/streams.json'], hash: 'h' },
  ];
  const { verified } = partitionByLiveness(queued, readLive);
  assert.deepEqual(verified.flatMap((b) => b.embeds.map((e) => e.title)), ['B']);
});

test('partitionByLiveness #14 false-negative: a live stream still posts after a quiet resync', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'Avid_live and a new song that changed the file hash' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  // A's whole-file hash is now stale; per-embed liveness ignores the hash for token-bearing embeds.
  const queued = [{ embeds: [{ title: 'A', url: 'https://youtu.be/Avid_live' }], sources: ['data/x/streams.json'], hash: 'stale-whole-file-hash' }];
  const { verified } = partitionByLiveness(queued, readLive);
  assert.deepEqual(verified.flatMap((b) => b.embeds.map((e) => e.title)), ['A']);
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

test('partitionByLiveness: presence-only sources gate liveness but are excluded from the tokenless hash', () => {
  // songs.json was '[]' at enqueue but a later sync:data populated it before flush. Because it is a
  // presence-only source (not in `sources`/hash), the tokenless embed still posts — only registry.json
  // (stable) is hashed. This is the #15 no-link-streamer regression fix.
  const live: Record<string, string> = {
    'data/registry.json': 'REGISTRY',
    'data/x/songs.json': 'populated-after-enqueue',
    'data/x/streams.json': '[]',
  };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const batch = {
    embeds: [{ title: '🎉 new streamer' }], // tokenless (no url)
    sources: ['data/registry.json'],
    presenceSources: ['data/x/songs.json', 'data/x/streams.json'],
    hash: hashSources(['data/registry.json'], readLive), // hash over registry.json only
  };
  const { verified } = partitionByLiveness([batch], readLive);
  assert.deepEqual(verified.flatMap((b) => b.embeds.map((e) => e.title)), ['🎉 new streamer']);
});

test('partitionByLiveness: a missing presence-only source drops the batch', () => {
  // Partial push: registry.json is live but the streamer's data dir was not pushed → its page 404s.
  const live: Record<string, string> = { 'data/registry.json': 'REGISTRY' }; // songs/streams absent
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const batch = {
    embeds: [{ title: '🎉 new streamer' }],
    sources: ['data/registry.json'],
    presenceSources: ['data/x/songs.json', 'data/x/streams.json'],
    hash: hashSources(['data/registry.json'], readLive),
  };
  const { verified } = partitionByLiveness([batch], readLive);
  assert.deepEqual(verified, []);
});

test('partitionByLiveness: presence-only sources also guard token-bearing embeds', () => {
  // The token IS live in registry content, but a missing presence source still drops the embed.
  const live: Record<string, string> = { 'data/registry.json': 'REGISTRY https://www.youtube.com/c/Foo' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const batch = {
    embeds: [{ title: 'has link', url: 'https://www.youtube.com/c/Foo' }],
    sources: ['data/registry.json'],
    presenceSources: ['data/x/songs.json'], // missing
    hash: 'ignored',
  };
  const { verified } = partitionByLiveness([batch], readLive);
  assert.deepEqual(verified, []);
});

test('partitionByLiveness: a missing presence source short-circuits before reading content sources', () => {
  // Presence is checked first; a missing presence source drops the batch without the wasted `git show`
  // of the content sources.
  const reads: string[] = [];
  const readLive = (s: string): string => {
    reads.push(s);
    if (s === 'data/x/songs.json') throw new Error('gone'); // missing presence source
    return 'CONTENT';
  };
  const batch = { embeds: [{ title: 't' }], sources: ['data/registry.json'], presenceSources: ['data/x/songs.json'], hash: 'h' };
  const { verified } = partitionByLiveness([batch], readLive);
  assert.deepEqual(verified, []);
  assert.equal(reads.includes('data/registry.json'), false); // content source never read — presence gate failed first
});

test('remainingBatchesAfter preserves presenceSources on the unposted remainder', () => {
  const verified = [
    { embeds: [{ title: 'e1' }, { title: 'e2' }], sources: ['data/registry.json'], presenceSources: ['data/x/songs.json'], hash: 'h' },
  ];
  assert.deepEqual(remainingBatchesAfter(verified, 0, 1), [
    { embeds: [{ title: 'e2' }], sources: ['data/registry.json'], presenceSources: ['data/x/songs.json'], hash: 'h' },
  ]);
});

test('partitionByLiveness: a tokenless aggregate with liveKeys posts iff ALL liveKeys are in the record', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'Vid_A Vid_B Vid_C' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  // hash is deliberately stale to prove liveKeys (not the hash) decide a tokenless aggregate.
  const allLive = { embeds: [{ title: '🎵 summary' }], sources: ['data/x/streams.json'], liveKeys: ['Vid_A', 'Vid_B'], hash: 'stale' };
  const oneGone = { embeds: [{ title: '🎵 summary2' }], sources: ['data/x/streams.json'], liveKeys: ['Vid_A', 'Vid_GONE'], hash: 'stale' };
  assert.deepEqual(partitionByLiveness([allLive], readLive).verified.flatMap((b) => b.embeds.map((e) => e.title)), ['🎵 summary']); // all present → posts
  assert.deepEqual(partitionByLiveness([oneGone], readLive).verified, []); // one liveKey missing → dropped (wrong-count summary suppressed)
});

test('partitionByLiveness: a tokenless aggregate WITHOUT liveKeys still uses the hash fallback', () => {
  const live: Record<string, string> = { 'data/registry.json': 'REG' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const match = { embeds: [{ title: '📈' }], sources: ['data/registry.json'], hash: hashSources(['data/registry.json'], readLive) };
  const stale = { embeds: [{ title: '📈 old' }], sources: ['data/registry.json'], hash: 'stale' };
  assert.deepEqual(partitionByLiveness([match], readLive).verified.flatMap((b) => b.embeds.map((e) => e.title)), ['📈']);
  assert.deepEqual(partitionByLiveness([stale], readLive).verified, []);
});

test('partitionByLiveness: a stream token is verified against sources (the record), not presenceSources', () => {
  // #16 part 1: videoId lingers in songs.json (presence) but was removed from streams.json (record) → dropped.
  const live: Record<string, string> = { 'data/x/streams.json': 'OtherVid', 'data/x/songs.json': 'RemovedVid appears here' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  const batch = { embeds: [{ title: 'r', url: 'https://youtu.be/RemovedVid' }], sources: ['data/x/streams.json'], presenceSources: ['data/x/songs.json'], hash: 'h' };
  assert.deepEqual(partitionByLiveness([batch], readLive).verified, []); // not in streams.json content → dropped
});

console.log('announce.test: all passed');
