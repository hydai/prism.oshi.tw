/**
 * announce.ts — resolve the fan-announcement Discord webhook URL for sync scripts.
 *
 * process.env.DISCORD_WEBHOOK_ANNOUNCE wins; otherwise read admin/.dev.vars
 * (gitignored), mirroring how fetch-channel-info reads YOUTUBE_API_KEY. Returns
 * undefined when unset so callers skip announcing.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DiscordEmbed } from '../../admin/shared/discord.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_VARS_PATH = path.resolve(__dirname, '../../admin/.dev.vars');
const PENDING_PATH = path.resolve(__dirname, '../../data/.pending-announce.json');

/** Extract a KEY=value entry from .dev.vars content; null if absent or empty. */
export function parseDevVar(content: string, key: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value || null;
  }
  return null;
}

/** Resolve the announce webhook URL: process.env wins, else admin/.dev.vars. */
export function loadAnnounceWebhook(): string | undefined {
  const fromEnv = process.env.DISCORD_WEBHOOK_ANNOUNCE?.trim();
  if (fromEnv) return fromEnv;
  try {
    const content = fs.readFileSync(DEV_VARS_PATH, 'utf-8');
    return parseDevVar(content, 'DISCORD_WEBHOOK_ANNOUNCE') ?? undefined;
  } catch {
    return undefined;
  }
}

// --- Pending fan-announcement queue ---
//
// Announcements are computed during sync but only POSTED after the data is committed + pushed (via
// `npm run announce:flush`), so fans never get a ping for data that never went live. Each queued
// batch records the data file(s) it describes (`sources`); at flush we verify PER EMBED against the
// live origin/master content — a stream/streamer embed posts iff its liveKey (videoId / link, see
// `deriveLiveKey`) is present there, so an unrelated same-file change neither blesses a removed embed
// nor drops a live one. Tokenless aggregate embeds (flood summary, subscriber digest) fall back to
// the recorded whole-file `hash` (taken after the new files are written). A batch with empty/absent
// `sources` posts unconditionally — old-format migration / already-verified partial-flush remainder.
// Enqueue is a plain append; flush dedupes by liveKey. The path is injectable for unit tests.

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

const YOUTU_BE = 'https://youtu.be/';

/**
 * The token whose presence in the live source content proves this embed's data went live: the
 * videoId for a stream embed (`youtu.be/<id>`), else the embed's url for a streamer embed, else
 * null for an aggregate embed (flood summary / subscriber digest) that has no single live subject.
 */
export function deriveLiveKey(embed: DiscordEmbed): string | null {
  if (!embed.url) return null;
  if (embed.url.startsWith(YOUTU_BE)) return embed.url.slice(YOUTU_BE.length);
  return embed.url;
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

/**
 * Append a batch to the queue. Verification and de-duplication both happen at flush (per-embed
 * liveness, then dedupe by liveKey), so enqueue stays a simple append: re-running a sync just adds
 * batches that the flush collapses against the live data. Empty-embed batches are dropped.
 */
export function enqueueAnnouncements(batch: PendingBatch, pendingPath: string = PENDING_PATH): void {
  if (batch.embeds.length === 0) return;
  writePendingBatches([...readPendingBatches(pendingPath), batch], pendingPath);
}

function liveContentOf(sources: string[], readLive: (source: string) => string): string | null {
  try {
    return sources.map(readLive).join('\0');
  } catch {
    return null; // a source missing from origin/master ⇒ its data never went live
  }
}

/**
 * Decide which queued embeds to post by PER-EMBED liveness against the live content from `readLive`
 * (origin/master). For each batch, in queue order, each embed is kept iff:
 *  - sourceless batch → unconditional (old-format migration / already-verified remainder);
 *  - token-bearing embed (`deriveLiveKey != null`) → its token is present in the batch's live source
 *    content, so an unrelated same-file change never blesses a removed embed nor drops a live one;
 *  - aggregate embed (`deriveLiveKey == null`) → the whole-file hash still matches (fallback for the
 *    flood summary / subscriber digest, which have no single live subject).
 * Cross-batch duplicates (same token, or identical aggregate) are dropped after the first. Returns
 * source-grouped verified batches (so flush can checkpoint with `remainingBatchesAfter`) plus the
 * dropped tokens (for logging).
 */
export function partitionByLiveness(
  batches: PendingBatch[],
  readLive: (source: string) => string,
): { verified: PendingBatch[]; droppedKeys: string[] } {
  const seen = new Set<string>();
  const verified: PendingBatch[] = [];
  const droppedKeys: string[] = [];
  for (const batch of batches) {
    const sourceless = !batch.sources || batch.sources.length === 0;
    const content = sourceless ? '' : liveContentOf(batch.sources!, readLive);
    const liveEmbeds: DiscordEmbed[] = [];
    for (const embed of batch.embeds) {
      const key = deriveLiveKey(embed);
      const dedupeKey = key ?? JSON.stringify(embed);
      let live: boolean;
      if (sourceless) live = true;
      else if (content === null) live = false;
      else if (key !== null) live = content.includes(key);
      else live = sha256(content) === batch.hash;
      if (!live) {
        if (key) droppedKeys.push(key);
        continue;
      }
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      liveEmbeds.push(embed);
    }
    if (liveEmbeds.length > 0) verified.push({ ...batch, embeds: liveEmbeds });
  }
  return { verified, droppedKeys };
}

/**
 * The batches still to post after `postedInCurrent` embeds of `verified[currentIndex]` have been
 * sent: the current batch's unposted remainder (retaining its `sources`+`hash` so a retry
 * re-verifies it against origin/master) followed by every later batch untouched. Returns [] once
 * the final batch is fully posted. announce-flush checkpoints with this after each Discord message
 * so a mid-flush failure never strips the revision metadata off the unposted remainder.
 */
export function remainingBatchesAfter(
  verified: PendingBatch[],
  currentIndex: number,
  postedInCurrent: number,
): PendingBatch[] {
  const current = verified[currentIndex];
  const remainingEmbeds = current ? current.embeds.slice(postedInCurrent) : [];
  const head: PendingBatch[] =
    remainingEmbeds.length > 0 ? [{ embeds: remainingEmbeds, sources: current.sources, hash: current.hash }] : [];
  return [...head, ...verified.slice(currentIndex + 1)];
}

export function clearPendingAnnouncements(pendingPath: string = PENDING_PATH): void {
  fs.rmSync(pendingPath, { force: true });
}
