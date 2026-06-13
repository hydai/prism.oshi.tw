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
import { loadAnnounceWebhook, partitionByLiveHash, readPendingBatches, writePendingBatches } from '../shared/announce.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Read a file as it exists on origin/master (post-push). Throws when absent ⇒ treated as not-live.
 *  stderr is silenced: a missing path is an expected, handled case (the throw is the signal). */
function readLiveFromOriginMaster(source: string): string {
  return execFileSync('git', ['show', `origin/master:${source}`], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

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
