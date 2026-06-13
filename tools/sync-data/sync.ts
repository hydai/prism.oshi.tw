#!/usr/bin/env npx tsx
/**
 * sync-data: Export approved songs, performances, and streams from D1 → data/{slug}/
 *
 * Usage: npx tsx tools/sync-data/sync.ts <streamer-slug>
 *
 * Queries oshi-prism-db via wrangler d1 execute (same pattern as sync-registry).
 * Writes songs.json and streams.json in the fan-site format.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncStatePath, upsertEntry, type SyncStateEntry } from '../shared/sync-state.ts';

import { newStreamEmbed, newStreamsSummaryEmbed, type DiscordEmbed } from '../../admin/shared/discord.ts';
import { enqueueAnnouncements, loadAnnounceWebhook } from '../shared/announce.ts';

// --- Paths ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ADMIN_DIR = path.resolve(ROOT, 'admin');

// --- DB row types ---

interface SongRow {
  id: string;
  title: string;
  original_artist: string;
  tags: string; // JSON array
}

interface PerformanceRow {
  id: string;
  song_id: string;
  stream_id: string;
  date: string;
  stream_title: string;
  video_id: string;
  timestamp: number;
  end_timestamp: number | null;
  note: string;
}

interface StreamRow {
  id: string;
  title: string;
  date: string;
  video_id: string;
  youtube_url: string;
  credit: string; // JSON object
}

// --- Fan-site output types ---

interface FanSitePerformance {
  id: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
}

interface FanSiteSong {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: FanSitePerformance[];
}

interface FanSiteStream {
  id: string;
  title: string;
  date: string;
  videoId: string;
  youtubeUrl: string;
  credit?: Record<string, unknown>;
}

// --- Query D1 ---

function queryD1<T>(sql: string): T[] {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'oshi-prism-db', '--remote', '--json', `--command=${sql}`],
    { cwd: ADMIN_DIR, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );

  const parsed = JSON.parse(raw);
  return (parsed[0]?.results ?? []) as T[];
}

// --- Build fan-site songs.json ---

function buildSongs(streamerId: string): FanSiteSong[] {
  const songRows = queryD1<SongRow>(
    `SELECT id, title, original_artist, tags FROM songs WHERE streamer_id = '${streamerId}' AND status = 'approved' ORDER BY id`,
  );
  const perfRows = queryD1<PerformanceRow>(
    `SELECT id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note FROM performances WHERE streamer_id = '${streamerId}' AND status = 'approved' ORDER BY date`,
  );

  const perfsBySong = new Map<string, PerformanceRow[]>();
  for (const p of perfRows) {
    const list = perfsBySong.get(p.song_id) || [];
    list.push(p);
    perfsBySong.set(p.song_id, list);
  }

  return songRows.map((row) => ({
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    tags: JSON.parse(row.tags) as string[],
    performances: (perfsBySong.get(row.id) || []).map((p) => ({
      id: p.id,
      streamId: p.stream_id,
      date: p.date,
      streamTitle: p.stream_title,
      videoId: p.video_id,
      timestamp: p.timestamp,
      endTimestamp: p.end_timestamp,
      note: p.note,
    })),
  }));
}

// --- Build fan-site streams.json ---

function buildStreams(streamerId: string): FanSiteStream[] {
  const rows = queryD1<StreamRow>(
    `SELECT id, title, date, video_id, youtube_url, credit FROM streams WHERE streamer_id = '${streamerId}' AND status = 'approved' ORDER BY date DESC`,
  );

  return rows.map((row) => {
    const credit = JSON.parse(row.credit);
    const stream: FanSiteStream = {
      id: row.id,
      title: row.title,
      date: row.date,
      videoId: row.video_id,
      youtubeUrl: row.youtube_url,
    };
    if (credit && Object.keys(credit).length > 0) {
      stream.credit = credit;
    }
    return stream;
  });
}

// --- Query snapshot per table (max updated_at + count of approved rows) ---
//
// Counts come from the DB directly, not from the in-memory buildSongs/buildStreams
// output, so they always match what sync-status compares against. Orphan rows
// (approved performance pointing at a non-approved song) are counted in the DB
// but dropped by buildSongs — storing the DB count keeps detection consistent.

interface SnapshotRow {
  max_ts: string | null;
  cnt: number;
}

function querySnapshot(table: 'songs' | 'performances' | 'streams', streamerId: string): SnapshotRow {
  const rows = queryD1<SnapshotRow>(
    `SELECT MAX(updated_at) AS max_ts, COUNT(*) AS cnt FROM ${table} WHERE streamer_id = '${streamerId}' AND status = 'approved'`,
  );
  return rows[0] ?? { max_ts: null, cnt: 0 };
}

// --- Announce diff (publish-time, fan channel) ---

const ANNOUNCE_FLOOD_CAP = 10;

/** Map of stream id → number of distinct songs published in that stream. */
export function songCountsByStream(songs: FanSiteSong[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const song of songs) {
    for (const streamId of new Set(song.performances.map((p) => p.streamId))) {
      counts.set(streamId, (counts.get(streamId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Streams to announce: those becoming "published with songs" for the first time —
 * present in streams.json AND having ≥1 song — that were not already published with
 * songs last sync. Firing on this combined transition handles both approval orders:
 *   • stream approved before its songs → deferred until the songs land;
 *   • songs approved before the stream → fires when the stream is finally published
 *     (its songs were already in songs.json, but the stream wasn't yet in streams.json).
 */
export function streamsToAnnounce(
  newStreams: FanSiteStream[],
  oldStreamIds: Set<string>,
  oldSongCounts: Map<string, number>,
  newSongCounts: Map<string, number>,
): FanSiteStream[] {
  return newStreams.filter((s) => {
    const hasSongsNow = (newSongCounts.get(s.id) ?? 0) >= 1;
    const wasPublishedWithSongs = oldStreamIds.has(s.id) && (oldSongCounts.get(s.id) ?? 0) >= 1;
    return hasSongsNow && !wasPublishedWithSongs;
  });
}

function readExistingSongs(songsPath: string): FanSiteSong[] {
  let raw: string;
  try {
    raw = fs.readFileSync(songsPath, 'utf-8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err; // corrupt/unreadable songs.json is an operator problem — fail loud rather than announce from a bogus baseline
  }
  return JSON.parse(raw) as FanSiteSong[];
}

function readExistingStreams(streamsPath: string): FanSiteStream[] {
  let raw: string;
  try {
    raw = fs.readFileSync(streamsPath, 'utf-8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err; // corrupt/unreadable streams.json is an operator problem — fail loud rather than announce from a bogus baseline
  }
  return JSON.parse(raw) as FanSiteStream[];
}

function streamerDisplayName(slug: string): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'data/registry.json'), 'utf-8')) as {
      streamers?: Array<{ slug: string; displayName: string }>;
    };
    return parsed.streamers?.find((s) => s.slug === slug)?.displayName ?? slug;
  } catch {
    return slug;
  }
}

// Queue fan announcements for posting after the data is committed + pushed (via
// `npm run announce:flush`), so fans never get a ping for data that never went live.
// Gated on the webhook being configured so the feature stays dormant when unset.
function announceData(slug: string, newStreams: FanSiteStream[], songCounts: Map<string, number>): void {
  if (newStreams.length === 0 || !loadAnnounceWebhook()) return;

  const displayName = streamerDisplayName(slug);
  const embeds: DiscordEmbed[] =
    newStreams.length > ANNOUNCE_FLOOD_CAP
      ? [newStreamsSummaryEmbed(displayName, newStreams.length)]
      : newStreams.map((s) =>
          newStreamEmbed({
            displayName,
            streamTitle: s.title,
            videoId: s.videoId,
            songCount: songCounts.get(s.id) ?? 0,
            thumbnailUrl: `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`,
          }),
        );

  enqueueAnnouncements(embeds);
  console.log(`  📥 queued ${newStreams.length} new-stream announcement(s) — posted after push (npm run announce:flush)`);
}

// --- Main ---

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx tools/sync-data/sync.ts <streamer-slug>');
    process.exit(1);
  }

  const dataDir = path.resolve(ROOT, 'data', slug);
  if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: data/${slug}/ does not exist. Run sync:registry first.`);
    process.exit(1);
  }

  console.log(`sync-data: exporting approved data for "${slug}"...`);

  const songs = buildSongs(slug);
  const streams = buildStreams(slug);

  const songsPath = path.join(dataDir, 'songs.json');
  const streamsPath = path.join(dataDir, 'streams.json');

  // Read the previously-published songs + streams before overwriting, to detect
  // streams becoming "published with songs" for the first time (the announce trigger).
  const oldSongs = readExistingSongs(songsPath);
  const oldStreams = readExistingStreams(streamsPath);

  fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(streamsPath, JSON.stringify(streams, null, 2) + '\n', 'utf-8');

  console.log(`  wrote ${songsPath} (${songs.length} songs)`);
  console.log(`  wrote ${streamsPath} (${streams.length} streams)`);

  const totalPerfs = songs.reduce((sum, s) => sum + s.performances.length, 0);
  console.log(`  total: ${songs.length} songs, ${totalPerfs} performances, ${streams.length} streams`);

  const songsSnap = querySnapshot('songs', slug);
  const perfsSnap = querySnapshot('performances', slug);
  const streamsSnap = querySnapshot('streams', slug);

  if (perfsSnap.cnt !== totalPerfs) {
    console.log(
      `  ⚠ ${perfsSnap.cnt - totalPerfs} approved performance(s) reference a non-approved song (orphan); excluded from songs.json`,
    );
  }

  const entry: SyncStateEntry = {
    lastSyncedAt: new Date().toISOString(),
    maxSongUpdatedAt: songsSnap.max_ts,
    maxPerfUpdatedAt: perfsSnap.max_ts,
    maxStreamUpdatedAt: streamsSnap.max_ts,
    songsCount: songsSnap.cnt,
    performancesCount: perfsSnap.cnt,
    streamsCount: streamsSnap.cnt,
  };
  upsertEntry(ROOT, slug, entry);
  console.log(`  stamped ${syncStatePath(ROOT)}`);

  const newSongCounts = songCountsByStream(songs);
  const toAnnounce = streamsToAnnounce(streams, new Set(oldStreams.map((s) => s.id)), songCountsByStream(oldSongs), newSongCounts);
  announceData(slug, toAnnounce, newSongCounts);

  console.log('sync-data: done.');
}

function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/sync-data/sync.ts') || entry.endsWith('tools/sync-data/sync.js');
}

if (isMainScript()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
