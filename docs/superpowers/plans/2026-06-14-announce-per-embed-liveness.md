# Announce Per-Embed Liveness Verification (Issue #14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle whole-file-hash announce verification with per-embed liveness — at flush, post an announcement embed iff its identifying token (a stream's `videoId`, a streamer's link) is actually present in the live `origin/master` source content — fixing both #14 symptoms.

**Architecture:** `enqueueAnnouncements` becomes **append-only** (no merge/replace/dedupe). `flush` verifies **per embed**: token-bearing embeds (stream/streamer) post iff their token is in the live source content; tokenless aggregate embeds (flood summary, subscriber digest) keep the whole-file-hash check as a fallback. Cross-batch duplicates are deduped at flush by token. This makes per-announcement liveness independent of unrelated same-file changes, so it neither blesses a removed embed (false-positive) nor drops a live one after a quiet resync (false-negative).

**Tech Stack:** TypeScript via `tsx`, Node `fs`/`crypto`/`child_process`, Discord webhook embeds. Tests are self-contained `tsx` scripts using `node:assert/strict` + a local `test()` wrapper. Run with `npm run test:announce`.

**Issue:** #14. **Branch:** `fix/announce-revision-binding` (PR #13). **Supersedes:** the whole-file-hash merge added earlier in PR #13 (removes the documented KNOWN LIMITATION).

---

## KEY DESIGN DECISION — tokenless aggregate embeds (please confirm)

Two embed types have no single live subject, so per-embed token liveness can't apply directly:
- `newStreamsSummaryEmbed(displayName, count)` — only when `newStreams > ANNOUNCE_FLOOD_CAP` (rare).
- `subscriberDigestEmbed(changes)` — registry subscriber-count changes (common-ish).

| Option | Behavior | Trade-off |
|:---|:---|:---|
| **A. Hash fallback (CHOSEN)** | Aggregates keep the whole-file-hash check (`hashSources(sources) === batch.hash`) | Fixes the high-stakes per-stream symptoms; aggregates keep today's (acceptable, low-stakes) brittleness. Minimal change. |
| B. Always post | Aggregates post unconditionally | Re-introduces "announce data that never went live" for aggregates if a sync is abandoned. |
| C. `liveKeys` per batch | Sync records the underlying videoIds/slugs; aggregate posts iff those are live | Most correct, but adds a `liveKeys` field + sync plumbing for a rare, low-stakes case. |

**This plan implements Option A.** A stale subscriber digest (slightly-old numbers) or a dropped one is low harm, and Option A keeps the change focused on the per-stream correctness that #14 is about. If you prefer B or C, say so and I'll adjust Tasks 2 & 4.

## Verification model (the new core)

```ts
// deriveLiveKey: the token whose presence in live source content proves this embed went live.
const YOUTU_BE = 'https://youtu.be/';
export function deriveLiveKey(embed: DiscordEmbed): string | null {
  if (!embed.url) return null;                                   // aggregate (summary/digest) → no token
  if (embed.url.startsWith(YOUTU_BE)) return embed.url.slice(YOUTU_BE.length); // stream → videoId
  return embed.url;                                              // streamer → its link
}
```

```ts
// partitionByLiveness: keep each batch's live, not-yet-seen embeds; drop not-live + cross-batch dups.
// Returns source-grouped verified batches (so flush can checkpoint with remainingBatchesAfter) + dropped tokens.
export function partitionByLiveness(
  batches: PendingBatch[],
  readLive: (source: string) => string,
): { verified: PendingBatch[]; droppedKeys: string[] } {
  const seen = new Set<string>();
  const verified: PendingBatch[] = [];
  const droppedKeys: string[] = [];
  for (const batch of batches) {
    const sourceless = !batch.sources || batch.sources.length === 0;
    const content = sourceless ? '' : liveContentOf(batch.sources!, readLive); // null if any source missing
    const liveEmbeds: DiscordEmbed[] = [];
    for (const embed of batch.embeds) {
      const key = deriveLiveKey(embed);
      const dedupeKey = key ?? JSON.stringify(embed);
      let live: boolean;
      if (sourceless) live = true;                               // old-format / verified remainder
      else if (content === null) live = false;                  // source gone from origin/master
      else if (key !== null) live = content.includes(key);      // token-bearing: per-embed presence
      else live = sha256(content) === batch.hash;               // aggregate: whole-file fallback
      if (!live) { if (key) droppedKeys.push(key); continue; }
      if (seen.has(dedupeKey)) continue;                        // already queued this subject
      seen.add(dedupeKey);
      liveEmbeds.push(embed);
    }
    if (liveEmbeds.length > 0) verified.push({ embeds: liveEmbeds, sources: batch.sources, hash: batch.hash });
  }
  return { verified, droppedKeys };
}

function liveContentOf(sources: string[], readLive: (s: string) => string): string | null {
  try { return sources.map(readLive).join('\0'); } catch { return null; }
}
```

Note `sha256(content) === batch.hash` is equivalent to the old `hashSources(sources, readLive) === batch.hash` because `hashSources` is `sha256(sources.map(read).join('\0'))` and `content` is exactly that join — so the aggregate fallback reuses the already-read content.

## How this fixes both #14 symptoms

- **False-positive (Bug 4):** approve A → abandon/un-approve A → approve B. A's `videoId` is no longer in live `streams.json` → `content.includes(videoId)` is false → **A dropped.** ✓
- **False-negative (thread 5):** queue A, then a quiet resync adds a song to another stream. A's `videoId` is still in live `streams.json` → **A posted**, regardless of the unrelated file change. ✓

## File Structure

- `tools/shared/announce.ts` — add `deriveLiveKey` + `partitionByLiveness` (+ private `liveContentOf`); simplify `enqueueAnnouncements` to append-only; remove `embedKey`, `dedupeEmbeds`, `partitionByLiveHash`, and the KNOWN LIMITATION comment; expose `sha256` to the new fn (already module-private). Keep `hashSources`, `readPendingBatches`, `writePendingBatches`, `remainingBatchesAfter`, `clearPendingAnnouncements`.
- `tools/shared/announce.test.ts` — replace the merge/dedupe tests and the `partitionByLiveHash` test with `deriveLiveKey`, `partitionByLiveness` (incl. both symptom cases), and append-only enqueue tests.
- `tools/announce-flush/flush.ts` — swap `partitionByLiveHash` → `partitionByLiveness`; log `droppedKeys`; the post/checkpoint loop (with `remainingBatchesAfter`) is unchanged.
- `tools/sync-data/sync.ts`, `tools/sync-registry/sync.ts` — **unchanged**; they still `enqueueAnnouncements({ embeds, sources, hash: hashSources(sources) })`. The `hash` now only feeds the aggregate fallback.
- `tools/shared/announce.ts` queue doc comment + `docs/superpowers/plans/2026-06-14-announce-revision-binding.md` callout — update to describe per-embed liveness.

---

## Task 1: `deriveLiveKey`

**Files:** Modify `tools/shared/announce.ts`; Test `tools/shared/announce.test.ts`

- [ ] **Step 1: Write the failing tests** (add near the existing queue tests)

```ts
import { deriveLiveKey } from './announce.ts'; // add to the existing import line
test('deriveLiveKey: stream embed → videoId; streamer embed → link; aggregate → null', () => {
  assert.equal(deriveLiveKey({ title: 's', url: 'https://youtu.be/KfadSsRBCi8' }), 'KfadSsRBCi8');
  assert.equal(deriveLiveKey({ title: 'r', url: 'https://www.youtube.com/c/Foo' }), 'https://www.youtube.com/c/Foo');
  assert.equal(deriveLiveKey({ title: '📈 訂閱數更新' }), null); // no url → aggregate
});
```

- [ ] **Step 2: Run, verify it fails.** `npm run test:announce` → FAIL (`deriveLiveKey is not a function`).
- [ ] **Step 3: Implement** `deriveLiveKey` + the `YOUTU_BE` const (see "Verification model" above) in `announce.ts`.
- [ ] **Step 4: Run, verify it passes.** `npm run test:announce` → the new test passes.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(announce): add deriveLiveKey for per-embed liveness (#14)"`

## Task 2: `partitionByLiveness` (replaces `partitionByLiveHash`)

**Files:** Modify `tools/shared/announce.ts`; Test `tools/shared/announce.test.ts`

- [ ] **Step 1: Write the failing tests.** Replace the `partitionByLiveHash` test with:

```ts
import { partitionByLiveness } from './announce.ts'; // swap the partitionByLiveHash import
test('partitionByLiveness: token present→post, absent→drop, dedupe, aggregate hash, sourceless', () => {
  const live: Record<string, string> = { 'data/x/streams.json': 'KfadSsRBCi8 OtherVid', 'data/registry.json': 'REG' };
  const readLive = (s: string): string => { if (!(s in live)) throw new Error('gone'); return live[s]; };
  const streamLive = { embeds: [{ title: 'A', url: 'https://youtu.be/KfadSsRBCi8' }], sources: ['data/x/streams.json'], hash: 'ignored' };
  const streamDead = { embeds: [{ title: 'Z', url: 'https://youtu.be/ZZZdeadZZZ0' }], sources: ['data/x/streams.json'], hash: 'ignored' };
  const dupOfA = { embeds: [{ title: 'A again', url: 'https://youtu.be/KfadSsRBCi8' }], sources: ['data/x/streams.json'], hash: 'ignored' };
  const digestMatch = { embeds: [{ title: '📈' }], sources: ['data/registry.json'], hash: hashSources(['data/registry.json'], readLive) };
  const digestStale = { embeds: [{ title: '📈 old' }], sources: ['data/registry.json'], hash: 'stale' };
  const unconditional = { embeds: [{ title: 'remainder' }] };
  const { verified, droppedKeys } = partitionByLiveness(
    [streamLive, streamDead, dupOfA, digestMatch, digestStale, unconditional], readLive);
  assert.deepEqual(verified, [
    { embeds: [{ title: 'A', url: 'https://youtu.be/KfadSsRBCi8' }], sources: ['data/x/streams.json'], hash: 'ignored' },
    { embeds: [{ title: '📈' }], sources: ['data/registry.json'], hash: digestMatch.hash },
    { embeds: [{ title: 'remainder' }] },
  ]);
  assert.deepEqual(droppedKeys, ['ZZZdeadZZZ0']); // dead stream logged; dupOfA deduped silently
});
```

- [ ] **Step 2: Run, verify it fails.** `npm run test:announce` → FAIL (`partitionByLiveness is not a function`).
- [ ] **Step 3: Implement** `partitionByLiveness` + private `liveContentOf` (see "Verification model"). Delete `partitionByLiveHash`.
- [ ] **Step 4: Run, verify it passes.** `npm run test:announce` → passes.
- [ ] **Step 5: Commit.** `git commit -am "feat(announce): per-embed partitionByLiveness replaces whole-file partitionByLiveHash (#14)"`

## Task 3: Both #14 symptom regression tests

**Files:** Test `tools/shared/announce.test.ts`

- [ ] **Step 1: Write the tests** (these are the acceptance criteria for #14):

```ts
test('#14 false-positive: a removed stream is dropped (not blessed)', () => {
  const live = { 'data/x/streams.json': 'Bvid_live' }; // A removed, only B live
  const readLive = (s: string): string => live[s as keyof typeof live] ?? (() => { throw new Error('gone'); })();
  const queued = [
    { embeds: [{ title: 'A', url: 'https://youtu.be/Avid_gone' }], sources: ['data/x/streams.json'], hash: 'h' },
    { embeds: [{ title: 'B', url: 'https://youtu.be/Bvid_live' }], sources: ['data/x/streams.json'], hash: 'h' },
  ];
  const { verified } = partitionByLiveness(queued, readLive);
  assert.deepEqual(verified.flatMap((b) => b.embeds.map((e) => e.title)), ['B']); // A dropped, B posted
});

test('#14 false-negative: a live stream still posts after a quiet resync', () => {
  const live = { 'data/x/streams.json': 'Avid_live plus a new song hash-changing the file' };
  const readLive = (s: string): string => live[s as keyof typeof live] ?? (() => { throw new Error('gone'); })();
  // A queued with a now-stale whole-file hash; per-embed liveness ignores the hash for token embeds.
  const queued = [{ embeds: [{ title: 'A', url: 'https://youtu.be/Avid_live' }], sources: ['data/x/streams.json'], hash: 'stale-whole-file-hash' }];
  const { verified } = partitionByLiveness(queued, readLive);
  assert.deepEqual(verified.flatMap((b) => b.embeds.map((e) => e.title)), ['A']); // posted despite stale hash
});
```

- [ ] **Step 2: Run, verify they pass** (Task 2 already implements the behavior). `npm run test:announce` → both pass.
- [ ] **Step 3: Commit.** `git commit -am "test(announce): lock both #14 symptoms (removal dropped, quiet-resync kept) (#14)"`

## Task 4: Simplify `enqueueAnnouncements` to append-only

**Files:** Modify `tools/shared/announce.ts`; Test `tools/shared/announce.test.ts`

- [ ] **Step 1: Rewrite the enqueue tests.** Delete the three merge/dedupe tests ("merges so an earlier sync is not dropped", "dedupes a re-announced url", "merge keeps each subject first-seen position"). Replace with:

```ts
test('pending queue: enqueue appends batches (dedupe deferred to flush by liveKey)', () => {
  const tmp = path.join(os.tmpdir(), `pending-append-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA' }, tmp);
  enqueueAnnouncements({ embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA2' }, tmp);
  assert.deepEqual(readPendingBatches(tmp), [
    { embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA' },
    { embeds: [{ url: 'https://youtu.be/A', title: 'A' }], sources: ['data/x/streams.json'], hash: 'hA2' },
  ]); // both kept on disk; partitionByLiveness dedupes by videoId at flush
  clearPendingAnnouncements(tmp);
});
```

- [ ] **Step 2: Run, verify it fails.** `npm run test:announce` → FAIL (current merge collapses the two).
- [ ] **Step 3: Implement append-only** + delete `embedKey`, `dedupeEmbeds`, and the KNOWN LIMITATION comment:

```ts
/** Append a batch to the queue; flush dedupes by liveKey and verifies per-embed. Empty-embed batches are dropped. */
export function enqueueAnnouncements(batch: PendingBatch, pendingPath: string = PENDING_PATH): void {
  if (batch.embeds.length === 0) return;
  writePendingBatches([...readPendingBatches(pendingPath), batch], pendingPath);
}
```

- [ ] **Step 4: Run, verify it passes.** `npm run test:announce` → all pass.
- [ ] **Step 5: Commit.** `git commit -am "refactor(announce): enqueue append-only; drop hash-merge, dedupe at flush (#14)"`

## Task 5: Wire `flush.ts` to `partitionByLiveness`

**Files:** Modify `tools/announce-flush/flush.ts`

- [ ] **Step 1: Swap the verification call + log.** Replace the `partitionByLiveHash` block (lines ~40-45):

```ts
import { loadAnnounceWebhook, partitionByLiveness, readPendingBatches, remainingBatchesAfter, writePendingBatches } from '../shared/announce.ts';
// ...
const { verified, droppedKeys } = partitionByLiveness(batches, readLiveFromOriginMaster);
if (droppedKeys.length > 0) {
  console.warn(`announce-flush: dropped ${droppedKeys.length} announcement(s) not live on origin/master: ${droppedKeys.join(', ')}`);
}
writePendingBatches(verified); // persist the drop immediately
```

The rest of `main()` (totalEmbeds guard, webhook guard, the per-batch post loop with `remainingBatchesAfter`) is unchanged.

- [ ] **Step 2: Verify transpile + no-queue smoke.** `npx tsx tools/announce-flush/flush.ts` → `announce-flush: nothing queued.` (Confirm `data/.pending-announce.json` is absent first; never run with a verified batch — the webhook is live.)
- [ ] **Step 3: Lint.** `lineguard tools/announce-flush/flush.ts` → passes.
- [ ] **Step 4: Commit.** `git commit -am "feat(announce-flush): verify per-embed liveness instead of whole-file hash (#14)"`

## Task 6: Update docs

**Files:** Modify `tools/shared/announce.ts` (queue comment), `docs/superpowers/plans/2026-06-14-announce-revision-binding.md`

- [ ] **Step 1: Rewrite the queue doc comment** in `announce.ts` to describe per-embed liveness (token presence; aggregate hash fallback; append-only enqueue with flush-time dedupe). Remove any "merge"/"KNOWN LIMITATION" wording.
- [ ] **Step 2: Update the revision-binding plan callout** to point to this plan: verification is now per-embed liveness (#14 resolved), not whole-file hash.
- [ ] **Step 3: Lint + commit.** `lineguard ...` then `git commit -am "docs(announce): document per-embed liveness verification (#14)"`

## Task 7: Full suite + close out

- [ ] **Step 1: Run all touched tool suites.** `npm run test:announce && npm run sync:data:test && npm run sync:registry:test` → all green.
- [ ] **Step 2: Push.** Branch-guard, then `git push origin fix/announce-revision-binding`.
- [ ] **Step 3: Reply + resolve Codex thread 5** (commentDbId 3408944086) and the Copilot/Codex #14 threads — now actually fixed (not deferred). Close issue #14.
- [ ] **Step 4: Final Copilot pass.** Re-add `copilot-pull-request-reviewer`, poll, classify; iterate if needed, else CONVERGED.
- [ ] **Step 5: Merge PR #13** (squash, closes #11; no deploy — tools-only).

---

## Self-Review

**Spec coverage:** Both #14 symptoms have explicit regression tests (Task 3). Aggregate policy (Option A) is implemented in `partitionByLiveness` (Task 2) and exercised by the digest cases. Append-only enqueue removes the merge that caused Bug 4 (Task 4). Flush wiring keeps the retry-metadata fix via `remainingBatchesAfter` (Task 5).

**Placeholder scan:** No TBDs; every code step shows full code.

**Type consistency:** `partitionByLiveness` returns `{ verified: PendingBatch[]; droppedKeys: string[] }` — consumed exactly that way in Task 5. `deriveLiveKey(embed): string | null` used consistently. `PendingBatch` shape unchanged (`{ embeds, sources?, hash? }`); `hash` retained for the aggregate fallback.

**Risks:** (1) Token substring match is heuristic — a videoId (11 unique chars) or a full link is very unlikely to false-match; documented. (2) A streamer with no link → null token → aggregate hash fallback (rare; acceptable). (3) Aggregates retain today's hash brittleness by design (Option A) — low-stakes; revisit if it bites.

## Out of scope

- Wiring the `tools/` test suites into CI (separate pre-existing gap; worth a follow-up).
- Changing the Discord embed builders or the flood-cap behavior.
