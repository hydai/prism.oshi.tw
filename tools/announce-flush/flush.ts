#!/usr/bin/env npx tsx
/**
 * announce-flush: post the queued fan-channel announcements after data is pushed.
 *
 * Run by the sync slash-commands as the final step (after git push). The queue is
 * filled during sync (before files are overwritten) and posted here, so fans never
 * get a "new stream / new streamer" ping for data that never went live. A failed
 * post leaves the queue intact for the next flush — no announcement is lost.
 *
 * Usage: npx tsx tools/announce-flush/flush.ts
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { batchEmbeds, postDiscord } from '../../admin/shared/discord.ts';
import { loadAnnounceWebhook, partitionByLiveHash, readPendingBatches, remainingBatchesAfter, writePendingBatches } from '../shared/announce.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Read a file as it exists on origin/master (post-push). Throws when absent ⇒ treated as not-live.
 *  stderr is silenced: a missing path is an expected, handled case (the throw is the signal). */
function readLiveFromOriginMaster(source: string): string {
  return execFileSync('git', ['show', `origin/master:${source}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    // Raise execFileSync's 1MB default: a large streams.json/songs.json would otherwise overflow the
    // buffer and throw, which partitionByLiveHash would misread as "not live" — silently dropping a
    // valid announcement. 64MB is comfortably above any realistic data file.
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Update the local origin/master ref to the remote tip so verification reflects concurrent pushes
 *  (e.g. another operator reverting our data after our own push). Returns false instead of throwing
 *  when the fetch fails, so the caller can leave the queue intact and retry on the next flush. */
function refreshOriginMaster(): boolean {
  try {
    execFileSync('git', ['fetch', 'origin', 'master'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const batches = readPendingBatches();
  if (batches.length === 0) {
    console.log('announce-flush: nothing queued.');
    return;
  }

  // Refresh origin/master so verification compares against the remote's CURRENT tip rather than a
  // stale local cache — a concurrent push could have reverted our data after our own push. If the
  // refresh fails (e.g. offline), leave the queue intact and bail rather than risk posting against
  // a stale baseline; the next flush retries.
  if (!refreshOriginMaster()) {
    console.warn('announce-flush: could not refresh origin/master; leaving the queue intact for the next flush.');
    process.exitCode = 1;
    return;
  }

  // Verify each batch against the data actually live on origin/master; drop the rest.
  const { verified, stale } = partitionByLiveHash(batches, readLiveFromOriginMaster);
  if (stale.length > 0) {
    const dropped = stale.flatMap((b) => b.sources ?? ['(no sources)']);
    console.warn(`announce-flush: dropped ${stale.length} stale batch(es) whose data is not live on origin/master: ${dropped.join(', ')}`);
  }
  writePendingBatches(verified); // persist the drop immediately

  const totalEmbeds = verified.reduce((n, b) => n + b.embeds.length, 0);
  if (totalEmbeds === 0) {
    console.log('announce-flush: nothing to post after revision check.');
    return;
  }

  const webhook = loadAnnounceWebhook();
  if (!webhook) {
    console.log(`announce-flush: ${totalEmbeds} verified embed(s) queued but DISCORD_WEBHOOK_ANNOUNCE is unset; leaving them queued.`);
    return;
  }

  // Post one verified batch at a time, split into Discord-sized messages. After every message
  // rewrite the queue with the still-unposted remainder — each batch keeping its own sources+hash
  // (via remainingBatchesAfter) — so a failure OR crash mid-flush neither re-sends a delivered
  // batch nor lets the remainder post unconditionally if its data is reverted before the retry.
  let posted = 0;
  for (let bi = 0; bi < verified.length; bi++) {
    const messages = batchEmbeds(verified[bi].embeds);
    let postedInBatch = 0;
    for (const message of messages) {
      try {
        await postDiscord(webhook, message);
      } catch (err) {
        writePendingBatches(remainingBatchesAfter(verified, bi, postedInBatch));
        console.warn(
          `announce-flush: posted ${posted}/${totalEmbeds} embed(s), then a message FAILED (${(err as Error).message}); ${totalEmbeds - posted} embed(s) remain queued (revision-tagged) for the next flush.`,
        );
        process.exitCode = 1;
        return;
      }
      postedInBatch += message.length;
      posted += message.length;
      writePendingBatches(remainingBatchesAfter(verified, bi, postedInBatch)); // checkpoint after each success
    }
  }
  console.log(`announce-flush: posted ${posted} announcement embed(s) to the fan channel.`);
}

function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/announce-flush/flush.ts') || entry.endsWith('tools/announce-flush/flush.js');
}

if (isMainScript()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
