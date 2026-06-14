# Announce Liveness Precision (#16) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten `announce:flush` per-embed liveness so every subject is verified against the *record* that authoritatively holds it — fixing a stream-record false-positive (part 1) and the tokenless-aggregate false-negative for the flood summary, no-link streamer, and subscriber digest (parts 2 & 3).

**Architecture:** Unify all three parts on one idea — **`sources` is the authoritative record** (read → `content`, hashed, token/liveKey searched); **`presenceSources`** (from #15) is "must exist but not the record"; and a new **`liveKeys?: string[]`** carries a tokenless aggregate's subject tokens, verified *all-present* in the record content. Part 1 then falls out for free: make `streams.json` the record (`sources`) and move `songs.json` to `presenceSources`, so a stream's `videoId` is checked against `streams.json` only and can no longer leak via `songs.json` performances.

**Tech Stack:** TypeScript run via `tsx` (no type-check at runtime), Node `assert/strict` test harness, the existing `tools/shared/announce.ts` liveness core.

---

## Background — why each part is what it is

`partitionByLiveness` (post-#15) decides each embed's liveness in this order: `presenceOk` gate → `sourceless` → `content === null` → **token-bearing** (`deriveLiveKey(embed) != null` → `content.includes(key)`) → **tokenless** (`sha256(content) === hash`). `content` is the concatenated `sources`.

- **Part 1 (stream-record):** A stream embed's `deriveLiveKey` is its `videoId`. Today `sources = [songs.json, streams.json]`, so `content.includes(videoId)` matches a `videoId` that lingers in `songs.json` performances even after the stream is unapproved (removed from `streams.json`) → false-positive. Fix: `sources = [streams.json]` (the record), `presenceSources = [songs.json]`.
- **Parts 2 & 3 (tokenless aggregates):** `newStreamsSummaryEmbed` (flood), `newStreamerEmbed` with no link, and `subscriberDigestEmbed` have no `url` → `deriveLiveKey` is `null` → they fall back to the whole-file `hash`, which any unrelated quiet resync invalidates → false-negative (the live aggregate is dropped). Fix: store the subjects' tokens in `liveKeys` and verify them present in the record content. `liveKeys` are videoIds (flood summary) and **displayNames** (no-link streamer + digest — both present in `registry.json`, per the issue's part-3 note).

**Aggregate rule (decided):** an aggregate with `liveKeys` is live iff **all** of them appear in the record content. Rationale: a flood summary says "added N streams" — if any subject was reverted post-push, the count is wrong, so dropping it is correct. An aggregate *without* `liveKeys` keeps today's `hash` fallback (defensive; e.g. an old-format batch).

**No data-model leakage:** `remainingBatchesAfter` already reconstructs the unposted remainder with `{ ...current, embeds }` (spread), so it preserves `liveKeys` for free. `readPendingBatches`/`writePendingBatches` round-trip it via JSON. `flush.ts` needs **no** change.

---

## File Structure

- `tools/shared/announce.ts` — add `liveKeys?: string[]` to `PendingBatch`; add the all-present liveKey rule to `partitionByLiveness`; refresh the queue-model + function doc comments. **(Task 1)**
- `tools/shared/announce.test.ts` — liveKey rule tests + the part-1 "token verified against the record, not presenceSources" regression. **(Task 1)**
- `tools/sync-data/sync.ts` — extract a pure `dataAnnouncementBatch(...)` helper that emits `sources:[streams.json]`, `presenceSources:[songs.json]`, and `liveKeys` (flood videoIds); `announceData` calls it. **(Task 2)**
- `tools/sync-data/sync.test.ts` — `dataAnnouncementBatch` shape tests (per-stream vs. flood). **(Task 2)**
- `tools/sync-registry/sync.ts` — `registryAnnouncementBatches` attaches `liveKeys:[displayName]` per new streamer and `liveKeys: displayNames` to the digest batch. **(Task 3)**
- `tools/sync-registry/sync.test.ts` — update batch-shape assertions to include `liveKeys`. **(Task 3)**

No `flush.ts` change. No `admin/shared/discord.ts` change (embeds are unchanged; liveKeys live on the batch).

---

## Task 1: `liveKeys` mechanism in `announce.ts`

**Files:**
- Modify: `tools/shared/announce.ts` (`PendingBatch` interface; `partitionByLiveness`; two doc comments)
- Test: `tools/shared/announce.test.ts`

- [ ] **Step 1: Write the failing tests**

Add before `console.log('announce.test: all passed');`:

```ts
test('partitionByLiveness: a tokenless aggregate with liveKeys posts iff ALL liveKeys are in the record', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'Vid_A Vid_B Vid_C' };
  const readLive = (s: string): string => {
    if (!(s in live)) throw new Error('gone');
    return live[s];
  };
  // hash is deliberately stale to prove liveKeys (not the hash) decide a tokenless aggregate.
  const allLive = { embeds: [{ title: '🎵 summary' }], sources: ['data/x/streams.json'], liveKeys: ['Vid_A', 'Vid_B'], hash: 'stale' };
  const oneGone = { embeds: [{ title: '🎵 summary2' }], sources: ['data/x/streams.json'], liveKeys: ['Vid_A', 'Vid_GONE'], hash: 'stale' };
  const r1 = partitionByLiveness([allLive], readLive);
  const r2 = partitionByLiveness([oneGone], readLive);
  assert.deepEqual(r1.verified.flatMap((b) => b.embeds.map((e) => e.title)), ['🎵 summary']); // all present → posts
  assert.deepEqual(r2.verified, []); // one liveKey missing → dropped (wrong-count summary suppressed)
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:announce`
Expected: the first test FAILS (liveKeys not consulted → tokenless aggregate falls to the stale hash → both drop, so `r1.verified` is `[]` not `['🎵 summary']`). The other two pass already (they assert existing behavior / part-1 already holds once `sources` excludes songs.json — included as regression guards).

- [ ] **Step 3: Add `liveKeys` to `PendingBatch`**

In `tools/shared/announce.ts`, extend the interface (after `presenceSources`):

```ts
  presenceSources?: string[];
  /**
   * Subject tokens for a TOKENLESS aggregate embed (flood summary's videoIds, a no-link streamer's
   * or the subscriber digest's displayNames). The aggregate is live iff every liveKey appears in the
   * record content (`sources`). Absent ⇒ the aggregate keeps the whole-file `hash` fallback.
   */
  liveKeys?: string[];
  hash?: string;
```

- [ ] **Step 4: Add the all-present liveKey rule to `partitionByLiveness`**

Replace the tokenless branch. From:

```ts
      else if (key !== null) live = content.includes(key);
      else live = sha256(content) === batch.hash;
```

to:

```ts
      else if (key !== null) live = content.includes(key);
      else if (batch.liveKeys && batch.liveKeys.length > 0) live = batch.liveKeys.every((k) => content!.includes(k));
      else live = sha256(content) === batch.hash;
```

(`content` is non-null at this point — the preceding `else if (content === null) live = false` guards it; `!` matches the existing `batch.sources!` style and satisfies the closure.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:announce`
Expected: PASS (all, including the existing aggregate-hash, collab-VOD, #14, and #15 presence tests — unchanged because `liveKeys` defaults to absent).

- [ ] **Step 6: Refresh the doc comments**

In the queue-model header comment, replace the "fall back to the recorded whole-file `hash`" sentence with:

```ts
// the recorded whole-file `hash` — or, when the batch carries `liveKeys`, by checking those subject
// tokens are all present in the record content (so a quiet resync that changes the hash but not the
// subjects no longer drops a live aggregate). A batch may also list `presenceSources` — files that
// must exist on origin/master but are excluded from the hash/liveKey search...
```

In the `partitionByLiveness` doc comment, replace the aggregate bullet:

```ts
 *  - aggregate embed (`deriveLiveKey == null`) → if the batch has `liveKeys`, every one must be present
 *    in the record content; else the whole-file hash must still match (fallback).
```

- [ ] **Step 7: Run `lineguard` + commit**

```bash
lineguard tools/shared/announce.ts tools/shared/announce.test.ts
git add tools/shared/announce.ts tools/shared/announce.test.ts
git commit -m "feat(announce): liveKeys — verify a tokenless aggregate by its subject tokens (#16)" \
  -m "..." -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `sync-data` — stream record + flood liveKeys (parts 1 & 2)

**Files:**
- Modify: `tools/sync-data/sync.ts` (extract `dataAnnouncementBatch`; `announceData` calls it)
- Test: `tools/sync-data/sync.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tools/sync-data/sync.test.ts` (import `dataAnnouncementBatch` + `type FanSiteStream` if needed; inject a `joinHash`):

```ts
const joinHash = (sources: string[]): string => sources.join('|');
const mkStream = (id: string, videoId: string) => ({ id, videoId, title: `t-${id}` }) as FanSiteStream;

test('dataAnnouncementBatch: per-stream embeds, streams.json is the record, songs.json presence-only', () => {
  const streams = [mkStream('s1', 'Vid1'), mkStream('s2', 'Vid2')];
  const batch = dataAnnouncementBatch('mizuki', streams, new Map([['s1', 3]]), 'Mizuki', joinHash);
  assert.deepEqual(batch.sources, ['data/mizuki/streams.json']);
  assert.deepEqual(batch.presenceSources, ['data/mizuki/songs.json']);
  assert.equal(batch.liveKeys, undefined); // per-stream embeds self-verify by their own videoId
  assert.equal(batch.embeds.length, 2);
  assert.equal(batch.hash, 'data/mizuki/streams.json');
});

test('dataAnnouncementBatch: flood (> cap) → one summary embed with liveKeys = all videoIds', () => {
  const streams = Array.from({ length: 11 }, (_, i) => mkStream(`s${i}`, `Vid${i}`));
  const batch = dataAnnouncementBatch('mizuki', streams, new Map(), 'Mizuki', joinHash);
  assert.equal(batch.embeds.length, 1); // summary
  assert.deepEqual(batch.sources, ['data/mizuki/streams.json']);
  assert.deepEqual(batch.presenceSources, ['data/mizuki/songs.json']);
  assert.deepEqual(batch.liveKeys, streams.map((s) => s.videoId)); // verified against streams.json at flush
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run sync:data:test`
Expected: FAIL — `dataAnnouncementBatch is not a function`.

- [ ] **Step 3: Extract the pure helper**

In `tools/sync-data/sync.ts`, add `type PendingBatch` to the announce import, and add above `announceData`:

```ts
/**
 * Build the fan-announcement batch for a streamer's newly-published streams (pure; `computeHash`
 * injectable for tests). streams.json is the record (`sources`) so a stream's videoId is verified
 * against the stream record, not its lingering songs.json performances (#16 part 1). songs.json is a
 * presence-only source. When the run floods (> ANNOUNCE_FLOOD_CAP), the single summary embed is
 * tokenless, so its subjects' videoIds ride along as `liveKeys` (#16 part 2).
 */
export function dataAnnouncementBatch(
  slug: string,
  newStreams: FanSiteStream[],
  songCounts: Map<string, number>,
  displayName: string,
  computeHash: (sources: string[]) => string = hashSources,
): PendingBatch {
  const sources = [`data/${slug}/streams.json`];
  const presenceSources = [`data/${slug}/songs.json`];
  const flood = newStreams.length > ANNOUNCE_FLOOD_CAP;
  const embeds: DiscordEmbed[] = flood
    ? [newStreamsSummaryEmbed(displayName, newStreams.length)]
    : newStreams.map((s) =>
        newStreamEmbed({
          displayName,
          streamTitle: s.title,
          videoId: s.videoId,
          songCount: songCounts.get(s.id) ?? 0,
          thumbnailUrl: `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`,
        }),
      );
  const batch: PendingBatch = { embeds, sources, presenceSources, hash: computeHash(sources) };
  if (flood) batch.liveKeys = newStreams.map((s) => s.videoId);
  return batch;
}
```

- [ ] **Step 4: Rewrite `announceData` to use it**

```ts
function announceData(slug: string, newStreams: FanSiteStream[], songCounts: Map<string, number>): void {
  if (newStreams.length === 0 || !loadAnnounceWebhook()) return;
  enqueueAnnouncements(dataAnnouncementBatch(slug, newStreams, songCounts, streamerDisplayName(slug)));
  console.log(`  📥 queued ${newStreams.length} new-stream announcement(s) — posted after push (npm run announce:flush)`);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run sync:data:test` → PASS. Also `npm run test:announce` → still PASS.

- [ ] **Step 6: `lineguard` + commit** (`tools/sync-data/sync.ts`, `tools/sync-data/sync.test.ts`)

```
feat(announce): verify streams against streams.json + flood-summary liveKeys (#16)
```

---

## Task 3: `sync-registry` — no-link streamer + digest liveKeys (parts 2 & 3)

**Files:**
- Modify: `tools/sync-registry/sync.ts` (`registryAnnouncementBatches`)
- Test: `tools/sync-registry/sync.test.ts`

- [ ] **Step 1: Update/extend the tests**

Adjust the per-streamer and digest assertions, and add a no-link case. In `tools/sync-registry/sync.test.ts`:

```ts
test('registryAnnouncementBatches: each new streamer carries liveKeys=[displayName] (no-link fallback)', () => {
  const diff: StreamerDiff = { newStreamers: [cfg('aiko', 'Aiko', '1萬')], subscriberChanges: [] };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.deepEqual(batches[0].sources, ['data/registry.json']);
  assert.deepEqual(batches[0].presenceSources, ['data/aiko/songs.json', 'data/aiko/streams.json']);
  assert.deepEqual(batches[0].liveKeys, ['Aiko']); // displayName, present in registry.json → verifies a no-link streamer
});

test('registryAnnouncementBatches: subscriber digest carries liveKeys = changed displayNames', () => {
  const diff: StreamerDiff = {
    newStreamers: [],
    subscriberChanges: [{ displayName: 'Aiko', from: '1萬', to: '1.1萬' }, { displayName: 'Mei', from: '2萬', to: '2.2萬' }],
  };
  const batches = registryAnnouncementBatches(diff, joinHash);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].sources, ['data/registry.json']);
  assert.equal(batches[0].presenceSources, undefined);
  assert.deepEqual(batches[0].liveKeys, ['Aiko', 'Mei']);
});
```

(The existing "each new streamer hashes registry.json; its data files are presence-only" and "new streamers first…" tests keep their `sources`/`presenceSources`/`hash` assertions; add `liveKeys` to them or leave them — they don't assert `liveKeys` absence.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run sync:registry:test`
Expected: FAIL — `batches[0].liveKeys` is `undefined`.

- [ ] **Step 3: Attach `liveKeys` in `registryAnnouncementBatches`**

```ts
  for (const s of diff.newStreamers) {
    const presenceSources = [`data/${s.slug}/songs.json`, `data/${s.slug}/streams.json`];
    const embed = newStreamerEmbed({ displayName: s.displayName, group: s.group, link: s.socialLinks.youtube ?? s.externalUrl ?? '' });
    batches.push({ embeds: [embed], sources, presenceSources, liveKeys: [s.displayName], hash });
  }
  if (diff.subscriberChanges.length > 0) {
    const liveKeys = diff.subscriberChanges.map((c) => c.displayName);
    batches.push({ embeds: [subscriberDigestEmbed(diff.subscriberChanges)], sources, liveKeys, hash });
  }
```

Update the function doc comment to note: each streamer batch carries `liveKeys:[displayName]` (so a no-link streamer verifies by displayName presence in registry.json instead of the hash); the digest carries the changed displayNames.

- [ ] **Step 4: Run to verify pass**

Run: `npm run sync:registry:test` → PASS. Also `npm run test:announce` → PASS.

- [ ] **Step 5: `lineguard` + commit** (`tools/sync-registry/sync.ts`, `tools/sync-registry/sync.test.ts`)

```
feat(announce): no-link streamer + subscriber-digest liveKeys (#16)
```

---

## Verification (whole feature)

- `npm run test:announce && npm run sync:registry:test && npm run sync:data:test` — all green (CI does not run these; run locally).
- `lineguard` clean on all touched files.
- Manual trace: a flood summary whose streams are all live in `origin/master:streams.json` posts even after a quiet `songs.json` resync (false-negative fixed); a no-link streamer posts when its `displayName` is in `registry.json`; a stream removed from `streams.json` but lingering in `songs.json` is dropped (false-positive fixed).
- **Then** drive `/copilot-iterate` on the PR to convergence (same as #15), and confirm `data/.pending-announce.json` is absent before any flush smoke test (the live ANNOUNCE webhook).

## Self-Review

- **Spec coverage:** Part 1 → Task 2 (`sources:[streams.json]`) + Task 1 part-1 regression test. Part 2 flood → Task 2 (`liveKeys` videoIds). Part 2 digest + Part 3 no-link → Task 3 (`liveKeys` displayNames). The `liveKeys` rule itself → Task 1.
- **Type consistency:** `liveKeys?: string[]` used identically in `announce.ts`, `dataAnnouncementBatch`, `registryAnnouncementBatches`. `dataAnnouncementBatch(slug, newStreams, songCounts, displayName, computeHash?)` and the existing `registryAnnouncementBatches(diff, computeHash?)` share the injectable-hasher shape. `remainingBatchesAfter`'s `{ ...current, embeds }` already preserves `liveKeys` — no change.
- **No placeholders:** every step has the real code. Commit-message bodies are the only `...` (fill at commit time).
- **Risk:** `liveKeys.every(includes)` is substring matching like the token path — a videoId (11 chars) / displayName is very unlikely to false-match; consistent with the documented #14 heuristic. The digest's displayName liveKey verifies existence, not the exact new count (low-stakes, matches Option A's "slightly-old numbers are fine").
