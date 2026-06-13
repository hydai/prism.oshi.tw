# Announce Revision-Binding (Issue #11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each queued fan announcement to the data it describes so `announce:flush` only posts announcements whose data actually went live on `origin/master`; abandoned/never-pushed syncs are dropped.

**Architecture:** The queue (`data/.pending-announce.json`) becomes a list of `PendingBatch { embeds, sources?, hash? }`. At enqueue time (during sync, after files are written) each batch records the data file(s) it describes and a sha256 of their new contents. `flush` re-hashes those files as they exist on `origin/master` (`git show origin/master:<src>`) and posts only batches whose hash still matches; non-matching/missing ones are dropped. A batch with empty `sources` posts unconditionally (old-format migration + already-verified partial-flush remainder).

**Tech Stack:** TypeScript run via `tsx`, Node `fs`/`crypto`/`child_process`, Discord webhook embeds. Tests are self-contained `tsx` scripts using `node:assert/strict` + a local `test()` wrapper.

**Spec:** `docs/superpowers/specs/2026-06-14-pr9-followups-design.md` §3.

**Branch:** `fix/announce-revision-binding` (off `master`; independent of PR #12 which only touches `admin/`).

---

## Invariant to preserve

`hashSources` reads the **new** file contents, so every sync script MUST call its `announce*()` function **after** it writes the data files. Verified today: `sync-data` writes at sync.ts:299–300 then announces at :332; `sync-registry` `writeRegistry` at :282 then `announceRegistry` at :286. Do not reorder.

## File Structure

- `tools/shared/announce.ts` — replace the embed-level queue section with the batch API: `PendingBatch`, `hashSources`, `readPendingBatches` (old-format compat), `writePendingBatches`, `enqueueAnnouncements(batch)` (replace-by-sources), `partitionByLiveHash`. Removes `readPendingAnnouncements`/`setPendingAnnouncements`.
- `tools/shared/announce.test.ts` — update the queue tests to the batch API; add dedup, old-format, `hashSources`, `partitionByLiveHash` tests.
- `tools/announce-flush/flush.ts` — verify against `origin/master`, drop stale, post verified, checkpoint remainder.
- `tools/sync-data/sync.ts` — pass `{ embeds, sources, hash }` (`data/<slug>/songs.json` + `streams.json`).
- `tools/sync-registry/sync.ts` — pass `{ embeds, sources, hash }` (`data/registry.json`).

Only `flush.ts` and `announce.test.ts` import the removed functions (verified by grep), so the API change is self-contained.

All commands run from the **repo root**.

---

## Task 1: Batch queue format + accessors (TDD)

**Files:**
- Modify: `tools/shared/announce.ts`
- Test: `tools/shared/announce.test.ts`

- [ ] **Step 1: Rewrite the queue tests for the batch API**

In `tools/shared/announce.test.ts`, replace the import on line 6:

```ts
import { clearPendingAnnouncements, enqueueAnnouncements, hashSources, parseDevVar, partitionByLiveHash, readPendingBatches, writePendingBatches } from './announce.ts';
```

Then replace the three `pending queue:` / `setPendingAnnouncements` tests (the current lines 38–64) with:

```ts
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

test('pending queue: enqueue with identical sources replaces the prior batch (re-run dedup)', () => {
  const tmp = path.join(os.tmpdir(), `pending-announce-dedup-${process.pid}.json`);
  fs.rmSync(tmp, { force: true });
  enqueueAnnouncements({ embeds: [{ title: 'old' }], sources: ['data/x/streams.json'], hash: 'h1' }, tmp);
  enqueueAnnouncements({ embeds: [{ title: 'new' }], sources: ['data/x/streams.json'], hash: 'h2' }, tmp);
  assert.deepEqual(readPendingBatches(tmp), [
    { embeds: [{ title: 'new' }], sources: ['data/x/streams.json'], hash: 'h2' },
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
```

(The import line references `hashSources`/`partitionByLiveHash` too — both are implemented in Step 3 of this task, so the import resolves after Step 3. Their dedicated test cases are added in Task 2.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:announce`
Expected: FAIL — `readPendingBatches`/`writePendingBatches`/`partitionByLiveHash`/`hashSources` are not exported yet (import error).

- [ ] **Step 3: Replace the queue section in `announce.ts`**

In `tools/shared/announce.ts`, add `createHash` to the imports (after the existing `node:url` import line):

```ts
import { createHash } from 'node:crypto';
```

Then replace everything from `// --- Pending fan-announcement queue ---` (currently line 49) through the end of the file with:

```ts
// --- Pending fan-announcement queue ---
//
// Announcements are computed during sync (before files are overwritten) but only
// POSTED after the data is committed + pushed (via `npm run announce:flush`). Each
// queued batch records the data file(s) it describes (`sources`) and a content hash
// of their new contents (`hash`); at flush time we re-hash those files as they exist
// on origin/master and drop any batch whose data never went live (sync abandoned,
// diff rejected, or push failed). A batch with empty/absent `sources` is posted
// unconditionally — used for old-format migration and for the already-verified
// remainder written back after a partial-flush failure. The path is injectable so it
// can be unit-tested against a temp file.

const REPO_ROOT = path.resolve(__dirname, '../..');

export interface PendingBatch {
  embeds: DiscordEmbed[];
  sources?: string[];
  hash?: string;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const readFromRepoRoot = (source: string): string => fs.readFileSync(path.join(REPO_ROOT, source), 'utf-8');

/** sha256 over the concatenated contents of `sources`, read via `read` (defaults to repo-root disk). */
export function hashSources(sources: string[], read: (source: string) => string = readFromRepoRoot): string {
  return sha256(sources.map(read).join('\0'));
}

export function readPendingBatches(pendingPath: string = PENDING_PATH): PendingBatch[] {
  let parsed: { batches?: PendingBatch[]; embeds?: DiscordEmbed[] };
  try {
    parsed = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
  if (Array.isArray(parsed.batches)) return parsed.batches;
  if (Array.isArray(parsed.embeds)) return [{ embeds: parsed.embeds }]; // old {embeds} format → one unconditional batch
  return [];
}

/** Overwrite the queue with these batches (drops empty-embed batches; removes the file when nothing remains). */
export function writePendingBatches(batches: PendingBatch[], pendingPath: string = PENDING_PATH): void {
  const nonEmpty = batches.filter((b) => b.embeds.length > 0);
  if (nonEmpty.length === 0) {
    fs.rmSync(pendingPath, { force: true });
    return;
  }
  fs.writeFileSync(pendingPath, JSON.stringify({ batches: nonEmpty }, null, 2) + '\n', 'utf-8');
}

/** Append a batch, replacing any existing batch with identical non-empty `sources` (dedups re-runs of the same slug). */
export function enqueueAnnouncements(batch: PendingBatch, pendingPath: string = PENDING_PATH): void {
  if (batch.embeds.length === 0) return;
  const key = JSON.stringify(batch.sources ?? []);
  const existing = readPendingBatches(pendingPath);
  const kept = key === '[]' ? existing : existing.filter((b) => JSON.stringify(b.sources ?? []) !== key);
  writePendingBatches([...kept, batch], pendingPath);
}

/** Split batches by whether their recorded hash still matches the live content from `readLive`. */
export function partitionByLiveHash(
  batches: PendingBatch[],
  readLive: (source: string) => string,
): { verified: PendingBatch[]; stale: PendingBatch[] } {
  const verified: PendingBatch[] = [];
  const stale: PendingBatch[] = [];
  for (const batch of batches) {
    if (!batch.sources || batch.sources.length === 0) {
      verified.push(batch);
      continue;
    }
    let liveHash: string;
    try {
      liveHash = hashSources(batch.sources, readLive);
    } catch {
      stale.push(batch); // a source missing from origin/master ⇒ never went live
      continue;
    }
    (liveHash === batch.hash ? verified : stale).push(batch);
  }
  return { verified, stale };
}

export function clearPendingAnnouncements(pendingPath: string = PENDING_PATH): void {
  fs.rmSync(pendingPath, { force: true });
}
```

- [ ] **Step 4: Run the tests to verify the Task-1 queue tests pass**

Run: `npm run test:announce`
Expected: PASS — including the dedup and old-format tests. (`hashSources`/`partitionByLiveHash` are now exported too; their dedicated tests come in Task 2.)

- [ ] **Step 5: Commit**

```bash
lineguard tools/shared/announce.ts tools/shared/announce.test.ts
git add tools/shared/announce.ts tools/shared/announce.test.ts
git commit -m "feat(announce): fingerprinted batch queue with old-format compat

Replace the {embeds} queue with {batches:[{embeds,sources,hash}]}. enqueue
replaces a batch with identical sources (re-run dedup); readPendingBatches
still reads the legacy {embeds} shape as one unconditional batch."
```

---

## Task 2: `hashSources` + `partitionByLiveHash` tests

**Files:**
- Test: `tools/shared/announce.test.ts`

(The implementations already landed in Task 1 Step 3; this task adds their dedicated tests.)

- [ ] **Step 1: Add the hashing/verification tests**

Append to `tools/shared/announce.test.ts`, immediately before the final `console.log('announce.test: all passed');`:

```ts
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
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:announce`
Expected: PASS — all queue + hashSources + partitionByLiveHash tests, ending with `announce.test: all passed`.

- [ ] **Step 3: Commit**

```bash
lineguard tools/shared/announce.test.ts
git add tools/shared/announce.test.ts
git commit -m "test(announce): cover hashSources and partitionByLiveHash"
```

---

## Task 3: Verify against origin/master in `flush.ts`

**Files:**
- Modify: `tools/announce-flush/flush.ts`

> No new unit test: the verification logic is `partitionByLiveHash` (tested in Task 2); `flush` only wires it to `git show origin/master:<src>`. Verified by typecheck + the manual flush walkthrough in Task 5.

- [ ] **Step 1: Replace imports**

In `tools/announce-flush/flush.ts`, replace the two import lines (currently lines 13–14):

```ts
import { batchEmbeds, postDiscord } from '../../admin/shared/discord.ts';
import { loadAnnounceWebhook, readPendingAnnouncements, setPendingAnnouncements } from '../shared/announce.ts';
```

with:

```ts
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { batchEmbeds, postDiscord } from '../../admin/shared/discord.ts';
import { loadAnnounceWebhook, partitionByLiveHash, readPendingBatches, writePendingBatches } from '../shared/announce.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Read a file as it exists on origin/master (post-push). Throws when absent ⇒ treated as not-live. */
function readLiveFromOriginMaster(source: string): string {
  return execFileSync('git', ['show', `origin/master:${source}`], { cwd: REPO_ROOT, encoding: 'utf-8' });
}
```

- [ ] **Step 2: Replace `main()`**

Replace the whole `async function main(): Promise<void> { ... }` (currently lines 16–50) with:

```ts
async function main(): Promise<void> {
  const batches = readPendingBatches();
  if (batches.length === 0) {
    console.log('announce-flush: nothing queued.');
    return;
  }

  // Verify each batch against the data actually live on origin/master; drop the rest.
  const { verified, stale } = partitionByLiveHash(batches, readLiveFromOriginMaster);
  if (stale.length > 0) {
    const dropped = stale.flatMap((b) => b.sources ?? ['(no sources)']);
    console.warn(`announce-flush: dropped ${stale.length} stale batch(es) whose data is not live on origin/master: ${dropped.join(', ')}`);
  }
  writePendingBatches(verified); // persist the drop immediately

  const embeds = verified.flatMap((b) => b.embeds);
  if (embeds.length === 0) {
    console.log('announce-flush: nothing to post after revision check.');
    return;
  }

  const webhook = loadAnnounceWebhook();
  if (!webhook) {
    console.log(`announce-flush: ${embeds.length} verified embed(s) queued but DISCORD_WEBHOOK_ANNOUNCE is unset; leaving them queued.`);
    return;
  }

  // Post one message-batch at a time; after each success rewrite the queue with only the
  // remaining (already-verified) embeds as one unconditional batch, so a failure OR crash
  // mid-flush never re-sends a delivered batch.
  const messageBatches = batchEmbeds(embeds);
  let posted = 0;
  for (let i = 0; i < messageBatches.length; i++) {
    try {
      await postDiscord(webhook, messageBatches[i]);
    } catch (err) {
      const remaining = messageBatches.slice(i).flat();
      writePendingBatches([{ embeds: remaining }]);
      console.warn(
        `announce-flush: posted ${posted} embed(s), then batch ${i + 1}/${messageBatches.length} FAILED (${(err as Error).message}); ${remaining.length} embed(s) remain queued for the next flush.`,
      );
      process.exitCode = 1;
      return;
    }
    posted += messageBatches[i].length;
    writePendingBatches([{ embeds: messageBatches.slice(i + 1).flat() }]); // checkpoint after each success
  }
  console.log(`announce-flush: posted ${posted} announcement embed(s) to the fan channel.`);
}
```

(The `isMainScript()` guard and the `if (isMainScript())` block below `main()` are unchanged.)

- [ ] **Step 3: Dry-run the flush with no queue (loads flush.ts end-to-end; no network/webhook needed)**

`tools/` runs via `tsx` and isn't covered by a tsconfig, so there's no standalone typecheck; this dry-run is the smoke test — it resolves the new imports, constructs `REPO_ROOT`, and runs `main()` down the empty-queue path.

Run: `rm -f data/.pending-announce.json && npm run announce:flush`
Expected: prints `announce-flush: nothing queued.` and exits 0.

- [ ] **Step 4: Commit**

```bash
lineguard tools/announce-flush/flush.ts
git add tools/announce-flush/flush.ts
git commit -m "fix(announce): flush verifies queued batches against origin/master (#11)

Drop any queued announcement whose data is not live on origin/master (sync
abandoned, diff rejected, or push failed), so a later flush never posts
reverted/never-pushed data. Posting keeps the per-message checkpoint."
```

---

## Task 4: Pass `sources` + `hash` from the sync call sites

**Files:**
- Modify: `tools/sync-data/sync.ts` (import line 19; `announceData`)
- Modify: `tools/sync-registry/sync.ts` (import line 19; `announceRegistry`)

- [ ] **Step 1: sync-data — import + enqueue**

In `tools/sync-data/sync.ts`, change line 19:

```ts
import { enqueueAnnouncements, hashSources, loadAnnounceWebhook } from '../shared/announce.ts';
```

In `announceData`, replace:

```ts
  enqueueAnnouncements(embeds);
  console.log(`  📥 queued ${newStreams.length} new-stream announcement(s) — posted after push (npm run announce:flush)`);
```

with:

```ts
  const sources = [`data/${slug}/songs.json`, `data/${slug}/streams.json`];
  enqueueAnnouncements({ embeds, sources, hash: hashSources(sources) });
  console.log(`  📥 queued ${newStreams.length} new-stream announcement(s) — posted after push (npm run announce:flush)`);
```

- [ ] **Step 2: sync-registry — import + enqueue**

In `tools/sync-registry/sync.ts`, change line 19:

```ts
import { enqueueAnnouncements, hashSources, loadAnnounceWebhook } from '../shared/announce.ts';
```

In `announceRegistry`, replace:

```ts
  enqueueAnnouncements(embeds);
  console.log(`  📥 queued ${diff.newStreamers.length} new streamer(s) + ${diff.subscriberChanges.length} subscriber change(s) — posted after push (npm run announce:flush)`);
```

with:

```ts
  const sources = ['data/registry.json'];
  enqueueAnnouncements({ embeds, sources, hash: hashSources(sources) });
  console.log(`  📥 queued ${diff.newStreamers.length} new streamer(s) + ${diff.subscriberChanges.length} subscriber change(s) — posted after push (npm run announce:flush)`);
```

- [ ] **Step 3: Run the sync unit tests + announce tests**

Run: `npm run sync:data:test && npm run sync:registry:test && npm run test:announce`
Expected: all PASS. (These import the sync diff pure-functions; the `isMainScript()` guard keeps them from hitting production Nova DB on import.)

- [ ] **Step 4: Commit**

```bash
lineguard tools/sync-data/sync.ts tools/sync-registry/sync.ts
git add tools/sync-data/sync.ts tools/sync-registry/sync.ts
git commit -m "feat(sync): tag fan announcements with their data files + hash (#11)

sync-data fingerprints data/<slug>/songs.json+streams.json; sync-registry
fingerprints data/registry.json. flush verifies these against origin/master."
```

---

## Task 5: Full verification, push, PR

- [ ] **Step 1: Run the full tools test set + lint**

Run: `npm run test:announce && npm run sync:registry:test && npm run sync:data:test && npm run lint`
Expected: all PASS, lint 0 errors.

- [ ] **Step 2: Manual flush walkthrough (no webhook needed — exercises the verify path)**

```bash
# 1. A batch whose source is NOT live on origin/master must be dropped:
printf '%s\n' '{"batches":[{"embeds":[{"title":"stale"}],"sources":["data/registry.json"],"hash":"deadbeef"}]}' > data/.pending-announce.json
npm run announce:flush
# Expected: warns it dropped 1 stale batch (hash != origin/master), then "nothing to post after revision check." Queue file removed.
test ! -f data/.pending-announce.json && echo "OK: stale batch dropped"

# 2. A batch whose hash MATCHES origin/master:data/registry.json is kept (then "unset webhook" leaves it queued):
HASH=$(git show origin/master:data/registry.json | shasum -a 256 | cut -d' ' -f1)
printf '%s\n' "{\"batches\":[{\"embeds\":[{\"title\":\"live\"}],\"sources\":[\"data/registry.json\"],\"hash\":\"$HASH\"}]}" > data/.pending-announce.json
npm run announce:flush
# Expected (webhook unset): "1 verified embed(s) queued but DISCORD_WEBHOOK_ANNOUNCE is unset; leaving them queued." Queue file still present.
rm -f data/.pending-announce.json
```

> Note: `hashSources` joins sources with `\0`; for a single source the hash equals the plain sha256 of that file's bytes, so `shasum` matches. (Multi-source batches can't be reproduced with a one-liner — single-source is enough to prove the path.)

- [ ] **Step 3: Push**

```bash
git push -u origin fix/announce-revision-binding
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "fix(announce): bind queued fan announcements to the pushed revision (#11)" --body "$(cat <<'EOF'
## Summary

Follow-up from PR #9 review (Codex). The fan-announcement queue
(`data/.pending-announce.json`) was not tied to the commit that gets pushed, so
abandoning a sync (reject diff / failed push) left stale entries that a later
flush would announce — data that never went live.

Now each queued batch records the data file(s) it describes (`sources`) and a
sha256 of their new contents (`hash`). `announce:flush` re-hashes those files as
they exist on `origin/master` and posts only batches that still match; the rest
are dropped. Empty-`sources` batches post unconditionally (old-format migration +
already-verified partial-flush remainder). Enqueue replaces a batch with identical
`sources`, deduping same-slug re-runs.

No slash-command/doc changes — verification is built into flush.

Design: `docs/superpowers/specs/2026-06-14-pr9-followups-design.md` §3.
Plan: `docs/superpowers/plans/2026-06-14-announce-revision-binding.md`.

## Test Plan

- [x] `npm run test:announce` (queue/dedup/old-format/hashSources/partitionByLiveHash)
- [x] `npm run sync:registry:test && npm run sync:data:test && npm run lint`
- [x] Manual flush walkthrough: stale batch dropped; matching-hash batch kept.

Closes #11

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

- **Spec coverage (§3):** queue format `{batches:[{embeds,sources,hash}]}` (Task 1) ✓; empty-sources unconditional rule (Task 1 `readPendingBatches`/`partitionByLiveHash`) ✓; `readPendingBatches`/`writePendingBatches`/`enqueueAnnouncements` replace-by-sources/`hashSources`/`partitionByLiveHash` (Tasks 1–2) ✓; flush verifies via `git show origin/master:<src>`, logs + drops stale, posts verified with checkpoint remainder (Task 3) ✓; sources for sync-data (`songs.json`+`streams.json`) and sync-registry (`registry.json`) (Task 4) ✓; tests injectable, no git/network (Tasks 1–2) ✓; verification matrix (match→send, revert→drop, push-fail→drop) covered by `partitionByLiveHash` tests + manual walkthrough.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `PendingBatch { embeds: DiscordEmbed[]; sources?: string[]; hash?: string }` defined Task 1, used identically in `enqueueAnnouncements`/`readPendingBatches`/`writePendingBatches`/`partitionByLiveHash` and in flush. `hashSources(sources: string[], read?: (s) => string)` and `partitionByLiveHash(batches, readLive: (s) => string)` signatures match their call sites in flush (`readLiveFromOriginMaster`) and the call sites (`hashSources(sources)`). `enqueueAnnouncements({ embeds, sources, hash })` matches the new single-object signature at both sync call sites and all tests.
- **Invariant:** write-before-announce ordering documented at top; call sites unchanged in ordering.
