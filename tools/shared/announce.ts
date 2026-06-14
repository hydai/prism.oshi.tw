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
// An announcement's CONTENT is decided during sync from the old-vs-new data diff, but each batch is
// ENQUEUED after the new files are written (so its `hash` fingerprints the new on-disk contents) and
// only POSTED after the data is committed + pushed (via `npm run announce:flush`). The
// write-before-enqueue order is load-bearing: enqueuing before the write would hash the old files and
// break revision binding. Each queued batch records the data file(s) it describes (`sources`) and
// that content hash; at flush time we re-hash those files as they exist
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

const embedKey = (e: DiscordEmbed): string => e.url ?? JSON.stringify(e);

/** Collapse embeds describing the same subject (same `url`, else identical content): each subject
 *  keeps its FIRST-SEEN position but its LATEST value, so a re-announced item carries its freshest
 *  data and is never posted twice. */
function dedupeEmbeds(embeds: DiscordEmbed[]): DiscordEmbed[] {
  const byKey = new Map<string, DiscordEmbed>();
  for (const e of embeds) byKey.set(embedKey(e), e); // Map keeps an existing key's slot, updates its value
  return [...byKey.values()];
}

/**
 * Append a batch. For a non-empty `sources` set, MERGE into any existing same-source batch rather
 * than replacing it: concatenate both embed lists (so an earlier sync's still-pending announcements
 * survive a later same-file sync), dedupe by subject, and adopt the incoming (latest) hash so flush
 * verifies against the newest revision of those files. A sourceless batch is appended as-is (never
 * merged — it is already unconditional). Empty-embed batches are dropped.
 *
 * KNOWN LIMITATION (#14): adopting the latest hash for the merged batch can "bless" a carried-
 * forward embed whose data was abandoned/un-approved before push (approve A → abandon A → approve B
 * for the same slug → A is posted though it never went live). A whole-file hash can't tell "A kept"
 * from "A removed"; the proper fix is per-embed liveness verification at flush, tracked in #14.
 */
export function enqueueAnnouncements(batch: PendingBatch, pendingPath: string = PENDING_PATH): void {
  if (batch.embeds.length === 0) return;
  const existing = readPendingBatches(pendingPath);
  const key = JSON.stringify(batch.sources ?? []);
  if (key === '[]') {
    writePendingBatches([...existing, batch], pendingPath);
    return;
  }
  const others = existing.filter((b) => JSON.stringify(b.sources ?? []) !== key);
  const sameSource = existing.filter((b) => JSON.stringify(b.sources ?? []) === key);
  const mergedEmbeds = dedupeEmbeds([...sameSource.flatMap((b) => b.embeds), ...batch.embeds]);
  writePendingBatches([...others, { embeds: mergedEmbeds, sources: batch.sources, hash: batch.hash }], pendingPath);
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
