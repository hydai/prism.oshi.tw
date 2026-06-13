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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEV_VARS_PATH = path.resolve(__dirname, '../../admin/.dev.vars');

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
