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

import { postDiscord } from '../../admin/shared/discord.ts';
import { clearPendingAnnouncements, loadAnnounceWebhook, readPendingAnnouncements } from '../shared/announce.ts';

async function main(): Promise<void> {
  const embeds = readPendingAnnouncements();
  if (embeds.length === 0) {
    console.log('announce-flush: nothing queued.');
    return;
  }

  const webhook = loadAnnounceWebhook();
  if (!webhook) {
    console.log(`announce-flush: ${embeds.length} embed(s) queued but DISCORD_WEBHOOK_ANNOUNCE is unset; leaving them queued.`);
    return;
  }

  try {
    await postDiscord(webhook, embeds);
    clearPendingAnnouncements();
    console.log(`announce-flush: posted ${embeds.length} announcement embed(s) to the fan channel.`);
  } catch (err) {
    console.warn(`announce-flush: post FAILED (${(err as Error).message}); ${embeds.length} embed(s) remain queued for the next flush.`);
    process.exitCode = 1;
  }
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
