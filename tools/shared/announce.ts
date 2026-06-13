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
