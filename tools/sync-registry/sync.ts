#!/usr/bin/env npx tsx
/**
 * sync-registry: Dump approved Nova DB submissions → data/registry.json + lib/streamer-slugs.ts
 *
 * Usage: npx tsx tools/sync-registry/sync.ts
 *
 * Follows the same "source → static JSON" pattern as prismlens.
 * Runs wrangler from tools/nova/ where wrangler.toml binds oshi-prism-nova.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeExternalUrl } from '../../lib/safe-links.ts';
import { sanitizeNovaUrl, type NovaUrlProvider } from '../../admin/shared/nova-url-safety.ts';
import { assertValidSlug } from '../shared/slug.ts';
import { seedIfMissing } from '../shared/sync-state.ts';

import { newStreamerEmbed, subscriberDigestEmbed } from '../../admin/shared/discord.ts';
import { enqueueAnnouncements, hashSources, loadAnnounceWebhook, type PendingBatch } from '../shared/announce.ts';

// --- Paths ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const NOVA_DIR = path.resolve(ROOT, 'tools/nova');
const REGISTRY_PATH = path.resolve(ROOT, 'data/registry.json');
const SLUGS_PATH = path.resolve(ROOT, 'lib/streamer-slugs.ts');

// --- DB row type (matches Nova schema) ---

export interface SubmissionRow {
  slug: string;
  display_name: string;
  description: string;
  avatar_url: string;
  brand_name: string;
  subscriber_count: string;
  group: string;
  enabled: number;
  display_order: number;
  theme_json: string;
  link_youtube: string;
  link_twitter: string;
  link_facebook: string;
  link_instagram: string;
  link_twitch: string;
  external_url: string;
}

// --- Registry types (match data/registry.json) ---

interface SocialLinks {
  youtube?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  twitch?: string;
}

interface ThemeColors {
  accentPrimary: string;
  accentPrimaryDark: string;
  accentPrimaryLight: string;
  accentSecondary: string;
  accentSecondaryLight: string;
  bgPageStart: string;
  bgPageMid: string;
  bgPageEnd: string;
  bgAccentPrimary: string;
  bgAccentPrimaryMuted: string;
  borderAccentPrimary: string;
  borderAccentSecondary: string;
}

interface StreamerConfig {
  slug: string;
  displayName: string;
  description: string;
  avatarUrl: string;
  brandName: string;
  subscriberCount: string;
  group: string;
  socialLinks: SocialLinks;
  theme: ThemeColors;
  externalUrl?: string;
  enabled: boolean;
}

// --- Query Nova D1 ---

function queryNovaDb(): SubmissionRow[] {
  const sql = [
    'SELECT slug, display_name, description, avatar_url, brand_name,',
    'subscriber_count, "group", enabled, display_order, theme_json,',
    'link_youtube, link_twitter, link_facebook, link_instagram, link_twitch, external_url',
    "FROM submissions WHERE status = 'approved' AND enabled = 1 ORDER BY display_order, slug",
  ].join(' ');

  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'oshi-prism-nova', '--remote', '--json', `--command=${sql}`],
    { cwd: NOVA_DIR, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );

  const parsed = JSON.parse(raw);
  // wrangler d1 --json returns an array; the first element has .results
  const results: SubmissionRow[] = parsed[0]?.results ?? [];
  return results;
}

// --- Transform DB row → registry config ---

type SocialLinkKey = keyof SocialLinks;

const SOCIAL_LINK_FIELDS = [
  ['youtube', 'link_youtube', 'youtube'],
  ['twitter', 'link_twitter', 'twitter'],
  ['facebook', 'link_facebook', 'facebook'],
  ['instagram', 'link_instagram', 'instagram'],
  ['twitch', 'link_twitch', 'twitch'],
] as const satisfies ReadonlyArray<readonly [SocialLinkKey, keyof SubmissionRow, NovaUrlProvider]>;

const THEME_COLOR_KEYS = [
  'accentPrimary',
  'accentPrimaryDark',
  'accentPrimaryLight',
  'accentSecondary',
  'accentSecondaryLight',
  'bgPageStart',
  'bgPageMid',
  'bgPageEnd',
  'bgAccentPrimary',
  'bgAccentPrimaryMuted',
  'borderAccentPrimary',
  'borderAccentSecondary',
] as const satisfies ReadonlyArray<keyof ThemeColors>;

const THEME_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function safeNovaUrl(value: string, provider: NovaUrlProvider, context: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const safeUrl = sanitizeNovaUrl(trimmed, provider);
  if (!safeUrl) {
    throw new Error(`Invalid ${context}: URL must use HTTPS and an allowed ${provider} host.`);
  }

  return safeUrl;
}

function safeExternalUrl(value: string, context: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const safeUrl = sanitizeExternalUrl(trimmed);
  if (!safeUrl) {
    throw new Error(`Invalid ${context}: URL must use HTTP(S) and cannot include credentials.`);
  }

  return safeUrl;
}

function buildSocialLinks(row: SubmissionRow): SocialLinks {
  const links: SocialLinks = {};
  for (const [key, field, provider] of SOCIAL_LINK_FIELDS) {
    const safeUrl = safeNovaUrl(row[field], provider, `${row.slug}.${field}`);
    if (safeUrl) links[key] = safeUrl;
  }
  return links;
}

function isAllBlackTheme(theme: ThemeColors): boolean {
  return Object.values(theme).every((v) => v === '#000000');
}

function parseTheme(row: SubmissionRow): ThemeColors {
  if (!row.theme_json) {
    throw new Error(`Streamer "${row.slug}" has empty theme_json — curator must set theme colors before sync.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.theme_json);
  } catch {
    throw new Error(`Streamer "${row.slug}" has invalid theme_json: ${row.theme_json}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Streamer "${row.slug}" has invalid theme_json: expected an object.`);
  }

  const theme = parsed as Partial<Record<keyof ThemeColors, unknown>>;
  const sanitized: Partial<ThemeColors> = {};
  for (const key of THEME_COLOR_KEYS) {
    const value = theme[key];
    if (typeof value !== 'string' || !THEME_COLOR_RE.test(value)) {
      throw new Error(`Streamer "${row.slug}" has invalid theme color ${key}: ${JSON.stringify(value)}`);
    }
    sanitized[key] = value;
  }

  return sanitized as ThemeColors;
}

export function rowToConfig(row: SubmissionRow): StreamerConfig {
  assertValidSlug(row.slug, 'Nova submissions.slug');

  const config: StreamerConfig = {
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    avatarUrl: safeNovaUrl(row.avatar_url, 'image', `${row.slug}.avatar_url`) ?? '',
    brandName: row.brand_name,
    subscriberCount: row.subscriber_count,
    group: row.group,
    socialLinks: buildSocialLinks(row),
    theme: parseTheme(row),
    enabled: true, // only enabled rows are queried
  };
  if (row.external_url) {
    config.externalUrl = safeExternalUrl(row.external_url, `${row.slug}.external_url`);
  }
  return config;
}

// --- Announce diff (publish-time, fan channel) ---

interface SubscriberChange {
  displayName: string;
  from: string;
  to: string;
}

export interface StreamerDiff {
  newStreamers: StreamerConfig[];
  subscriberChanges: SubscriberChange[];
}

/** Diff previously-published streamers vs the freshly-built list. */
export function diffStreamers(oldStreamers: StreamerConfig[], newStreamers: StreamerConfig[]): StreamerDiff {
  const oldBySlug = new Map(oldStreamers.map((s) => [s.slug, s]));
  const result: StreamerDiff = { newStreamers: [], subscriberChanges: [] };
  for (const s of newStreamers) {
    const prev = oldBySlug.get(s.slug);
    if (!prev) {
      result.newStreamers.push(s);
    } else if (s.subscriberCount && prev.subscriberCount && s.subscriberCount !== prev.subscriberCount) {
      result.subscriberChanges.push({ displayName: s.displayName, from: prev.subscriberCount, to: s.subscriberCount });
    }
  }
  return result;
}

function readExistingStreamers(): StreamerConfig[] {
  let raw: string;
  try {
    raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err; // a present-but-unreadable registry is an operator problem — fail loud, don't announce from a bogus baseline
  }
  const parsed = JSON.parse(raw) as { streamers?: StreamerConfig[] };
  return parsed.streamers ?? [];
}

/**
 * Build the fan-announcement batches for a registry diff. The batch shape is a deterministic function
 * of `diff`; the only I/O is `computeHash`, which defaults to `hashSources` (reads the source files)
 * but is injectable so tests run disk-free.
 * Each new streamer gets its OWN batch: registry.json is the hashed `sources` (the streamer's link &
 * slug live there); the data files scaffolded for it are `presenceSources` (must be live on
 * origin/master, so a partial push that omits the streamer's data dir drops the 🎉 instead of posting
 * to a page that 404s, but excluded from the hash/liveKey search); and `liveKeys:[slug]` (the unique
 * registry key) lets a no-link (tokenless) streamer verify by slug presence in registry.json instead
 * of the brittle hash (#16). The subscriber digest is a plain registry.json batch carrying the new
 * count values as `liveKeys`, so it verifies the announced counts are live — not merely that the
 * streamers still exist.
 */
export function registryAnnouncementBatches(
  diff: StreamerDiff,
  computeHash: (sources: string[]) => string = hashSources,
): PendingBatch[] {
  if (diff.newStreamers.length === 0 && diff.subscriberChanges.length === 0) return []; // nothing to hash
  // Every registry announcement is hashed over registry.json (streamer links, slugs, and subscriber
  // counts all live there); a new streamer's scaffolded data files ride along as presence-only.
  const sources = ['data/registry.json'];
  const hash = computeHash(sources);
  const batches: PendingBatch[] = [];
  for (const s of diff.newStreamers) {
    const presenceSources = [`data/${s.slug}/songs.json`, `data/${s.slug}/streams.json`];
    const embed = newStreamerEmbed({ displayName: s.displayName, group: s.group, link: s.socialLinks.youtube ?? s.externalUrl ?? '' });
    // liveKeys=[slug] (the unique registry key — display_name is not unique) verifies a no-link
    // streamer, whose embed is tokenless; a token-bearing streamer ignores it (its link wins).
    batches.push({ embeds: [embed], sources, presenceSources, liveKeys: [s.slug], hash });
  }
  if (diff.subscriberChanges.length > 0) {
    // The digest announces the new counts, so it verifies those are live in registry.json (not merely
    // that the streamer still exists) — a reverted count drops it.
    const liveKeys = diff.subscriberChanges.map((c) => c.to);
    batches.push({ embeds: [subscriberDigestEmbed(diff.subscriberChanges)], sources, liveKeys, hash });
  }
  return batches;
}

// Queue fan announcements for posting after registry.json is committed + pushed
// (via `npm run announce:flush`). Gated on the webhook so the feature is dormant
// when unset.
function announceRegistry(diff: StreamerDiff): void {
  if (!loadAnnounceWebhook()) return;

  const batches = registryAnnouncementBatches(diff);
  if (batches.length === 0) return;

  for (const batch of batches) enqueueAnnouncements(batch);
  console.log(`  📥 queued ${diff.newStreamers.length} new streamer(s) + ${diff.subscriberChanges.length} subscriber change(s) — posted after push (npm run announce:flush)`);
}

// --- Write output files ---

function writeRegistry(streamers: StreamerConfig[]): void {
  const registry = { version: 1, streamers };
  const json = JSON.stringify(registry, null, 2) + '\n';
  fs.writeFileSync(REGISTRY_PATH, json, 'utf-8');
  console.log(`  wrote ${REGISTRY_PATH} (${streamers.length} streamers)`);
}

function writeSlugs(streamers: StreamerConfig[]): void {
  const slugs = streamers.map((s) => s.slug);
  const content = [
    '// Auto-generated by tools/sync-registry/sync.ts — do not edit manually.',
    '// Must stay in sync with data/registry.json.',
    `export const ALL_STREAMER_SLUGS: string[] = ${JSON.stringify(slugs)};`,
    '',
  ].join('\n');
  fs.writeFileSync(SLUGS_PATH, content, 'utf-8');
  console.log(`  wrote ${SLUGS_PATH}`);
}

function scaffoldDataDirs(streamers: StreamerConfig[]): void {
  for (const s of streamers) {
    assertValidSlug(s.slug, 'registry streamers');
    const dir = path.resolve(ROOT, 'data', s.slug);
    if (!fs.existsSync(dir)) {
      console.log(`  scaffolding data/${s.slug}/`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'songs.json'), '[]\n', 'utf-8');
      fs.writeFileSync(path.join(dir, 'streams.json'), '[]\n', 'utf-8');
      fs.mkdirSync(path.join(dir, 'metadata'), { recursive: true });
    }
    if (seedIfMissing(ROOT, s.slug)) {
      console.log(`  seeded sync-state entry for ${s.slug}`);
    }
  }
}

// --- Main ---

async function main(): Promise<void> {
  console.log('sync-registry: querying Nova DB for approved submissions...');
  const rows = queryNovaDb();

  if (rows.length === 0) {
    console.error('ERROR: No approved+enabled submissions found in Nova DB.');
    process.exit(1);
  }

  console.log(`  found ${rows.length} approved streamer(s): ${rows.map((r) => r.slug).join(', ')}`);

  // Read the previously-published registry before writeRegistry overwrites it.
  const oldStreamers = readExistingStreamers();
  const streamers = rows.map(rowToConfig);

  // Fall back to mizuki's theme for streamers with all-#000000 placeholder themes
  const mizuki = streamers.find((s) => s.slug === 'mizuki');
  if (mizuki) {
    for (const s of streamers) {
      if (s.slug !== 'mizuki' && isAllBlackTheme(s.theme)) {
        console.log(`  ⚠ ${s.slug} has placeholder theme (all #000000), using mizuki theme as default`);
        s.theme = { ...mizuki.theme };
      }
    }
  }

  writeRegistry(streamers);
  writeSlugs(streamers);
  scaffoldDataDirs(streamers);

  announceRegistry(diffStreamers(oldStreamers, streamers));

  console.log('sync-registry: done.');
}

function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/sync-registry/sync.ts') || entry.endsWith('tools/sync-registry/sync.js');
}

if (isMainScript()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
