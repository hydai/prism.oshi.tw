/**
 * announce.ts — resolve the fan-announcement Discord webhook URL for sync scripts.
 *
 * process.env.DISCORD_WEBHOOK_ANNOUNCE wins; otherwise read admin/.dev.vars
 * (gitignored), mirroring how fetch-channel-info reads YOUTUBE_API_KEY. Returns
 * undefined when unset so callers skip announcing.
 */

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
// POSTED after the data is committed + pushed (via `npm run announce:flush`), so
// fans never get a "new stream" ping for data that never went live. The queue is a
// gitignored sidecar; a failed flush leaves entries queued for the next attempt.
// The path is injectable so it can be unit-tested against a temp file.

export function readPendingAnnouncements(pendingPath: string = PENDING_PATH): DiscordEmbed[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as { embeds?: DiscordEmbed[] };
    return parsed.embeds ?? [];
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
}

/** Overwrite the queue with exactly these embeds (removes the file when empty). */
export function setPendingAnnouncements(embeds: DiscordEmbed[], pendingPath: string = PENDING_PATH): void {
  if (embeds.length === 0) {
    fs.rmSync(pendingPath, { force: true });
    return;
  }
  fs.writeFileSync(pendingPath, JSON.stringify({ embeds }, null, 2) + '\n', 'utf-8');
}

export function enqueueAnnouncements(embeds: DiscordEmbed[], pendingPath: string = PENDING_PATH): void {
  if (embeds.length === 0) return;
  setPendingAnnouncements([...readPendingAnnouncements(pendingPath), ...embeds], pendingPath);
}

export function clearPendingAnnouncements(pendingPath: string = PENDING_PATH): void {
  fs.rmSync(pendingPath, { force: true });
}
