#!/usr/bin/env npx tsx
/**
 * sync-data: Export approved songs, performances, and streams from D1 → data/{slug}/
 *
 * Usage: npx tsx tools/sync-data/sync.ts <streamer-slug>
 *
 * Queries oshi-prism-db via wrangler d1 execute (same pattern as sync-registry).
 * Writes songs.json and streams.json in the fan-site format.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { isMain, readJsonOr, repoRoot } from '../shared/cli.ts';
import { queryD1 } from '../shared/d1.ts';
import { syncStatePath, upsertEntry, type SyncStateEntry } from '../shared/sync-state.ts';
import { assertValidSlug } from '../shared/slug.ts';
import { LATEST_UPDATED_AT_SQL } from '../shared/sync-sql.ts';

import { newStreamEmbed, newStreamsSummaryEmbed, type DiscordEmbed } from '../../admin/shared/discord.ts';
import { enqueueAnnouncements, hashSources, loadAnnounceWebhook, type PendingBatch } from '../shared/announce.ts';

// --- Paths ---

const ROOT = repoRoot();

// --- DB row types ---

interface SongRow {
  id: string;
  work_id: string | null;
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

// Slim performance format (Stage 1 de-dup): `date` and `streamTitle` are NOT
// exported — the fan site derives both from streams.json via streamId at load
// time. Empty notes are omitted. This halves songs.json for large streamers.
interface FanSitePerformance {
  id: string;
  streamId: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note?: string;
}

interface FanSiteSong {
  id: string;
  workId?: string;
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

// --- Build fan-site songs.json ---

export function assembleFanSiteSongs(
  songRows: SongRow[],
  perfRows: PerformanceRow[],
): FanSiteSong[] {
  const perfsBySong = new Map<string, PerformanceRow[]>();
  for (const p of perfRows) {
    const list = perfsBySong.get(p.song_id) || [];
    list.push(p);
    perfsBySong.set(p.song_id, list);
  }

  return songRows
    .map((row) => ({
      id: row.id,
      ...(row.work_id ? { workId: row.work_id } : {}),
      title: row.title,
      originalArtist: row.original_artist,
      tags: JSON.parse(row.tags) as string[],
      performances: (perfsBySong.get(row.id) || [])
        // Newest first — the canonical order the timeline consumes (dates come
        // from the DB rows; the slim output no longer carries them)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((p) => ({
          id: p.id,
          streamId: p.stream_id,
          videoId: p.video_id,
          timestamp: p.timestamp,
          endTimestamp: p.end_timestamp,
          ...(p.note ? { note: p.note } : {}),
        })),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-TW'));
}

// --- Build fan-site streams.json ---

function assembleFanSiteStreams(rows: StreamRow[]): FanSiteStream[] {
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

// One SELECT is one SQLite read snapshot. UNION ALL streams one small JSON
// record per row (not a multi-megabyte json_group_array cell), and includes the
// exact freshness metadata for those rows before any local file is written.
export interface ExportRow { kind: string; payload: string }
interface SnapshotRow { max_ts: string | null; cnt: number }

export function buildExportSql(streamerId: string): string {
  assertValidSlug(streamerId);
  return `
    SELECT 'song' AS kind, json_object(
      'id', song.id, 'work_id', link.work_id, 'title', song.title,
      'original_artist', song.original_artist, 'tags', song.tags
    ) AS payload
    FROM songs AS song LEFT JOIN song_work_links AS link ON link.song_id = song.id
    WHERE song.streamer_id = '${streamerId}' AND song.status = 'approved'
    UNION ALL
    SELECT 'performance', json_object(
      'id', id, 'song_id', song_id, 'stream_id', stream_id, 'date', date,
      'stream_title', stream_title, 'video_id', video_id, 'timestamp', timestamp,
      'end_timestamp', end_timestamp, 'note', note
    ) FROM performances WHERE streamer_id = '${streamerId}' AND status = 'approved'
    UNION ALL
    SELECT 'stream', json_object(
      'id', id, 'title', title, 'date', date, 'video_id', video_id,
      'youtube_url', youtube_url, 'credit', credit
    ) FROM streams WHERE streamer_id = '${streamerId}' AND status = 'approved'
    UNION ALL
    SELECT 'songs-snapshot', json_object('max_ts', max_ts, 'cnt', cnt) FROM (
      SELECT ${LATEST_UPDATED_AT_SQL}, COUNT(*) AS cnt
      FROM songs AS song LEFT JOIN song_work_links AS link ON link.song_id = song.id
      WHERE song.streamer_id = '${streamerId}' AND song.status = 'approved'
    )
    UNION ALL
    SELECT 'performances-snapshot', json_object('max_ts', MAX(updated_at), 'cnt', COUNT(*))
      FROM performances WHERE streamer_id = '${streamerId}' AND status = 'approved'
    UNION ALL
    SELECT 'streams-snapshot', json_object('max_ts', MAX(updated_at), 'cnt', COUNT(*))
      FROM streams WHERE streamer_id = '${streamerId}' AND status = 'approved'
    UNION ALL
    SELECT 'revision-snapshot', json_object('cnt', COALESCE((
      SELECT revision FROM fan_export_revisions WHERE streamer_id = '${streamerId}'
    ), 0), 'max_ts', NULL)`;
}

export function readFanSiteExport(
  streamerId: string,
  query: (sql: string) => ExportRow[] = sql => queryD1<ExportRow>('admin', sql),
) {
  const rows = query(buildExportSql(streamerId));
  const songRows: SongRow[] = [];
  const perfRows: PerformanceRow[] = [];
  const streamRows: StreamRow[] = [];
  const snapshots = new Map<string, SnapshotRow>();
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    switch (row.kind) {
      case 'song': songRows.push(payload as SongRow); break;
      case 'performance': perfRows.push(payload as PerformanceRow); break;
      case 'stream': streamRows.push(payload as StreamRow); break;
      case 'songs-snapshot':
      case 'performances-snapshot':
      case 'revision-snapshot':
      case 'streams-snapshot': snapshots.set(row.kind, payload as SnapshotRow); break;
      default: throw new Error(`Unknown export record: ${row.kind}`);
    }
  }
  const snapshot = (kind: string): SnapshotRow => {
    const row = snapshots.get(kind);
    if (!row) throw new Error(`Export missing ${kind}`);
    return row;
  };
  // Stable ordering across SQLite query plans, including equal-date rows.
  songRows.sort((a, b) => a.id.localeCompare(b.id));
  perfRows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  streamRows.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    songs: assembleFanSiteSongs(songRows, perfRows),
    streams: assembleFanSiteStreams(streamRows),
    songsSnap: snapshot('songs-snapshot'),
    perfsSnap: snapshot('performances-snapshot'),
    streamsSnap: snapshot('streams-snapshot'),
    exportRevision: snapshot('revision-snapshot').cnt,
  };
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
  // corrupt/unreadable songs.json is an operator problem — readJsonOr rethrows on
  // anything but ENOENT, so we fail loud rather than announce from a bogus baseline
  return readJsonOr<FanSiteSong[]>(songsPath, []);
}

function readExistingStreams(streamsPath: string): FanSiteStream[] {
  // corrupt/unreadable streams.json is an operator problem — readJsonOr rethrows on
  // anything but ENOENT, so we fail loud rather than announce from a bogus baseline
  return readJsonOr<FanSiteStream[]>(streamsPath, []);
}

function streamerDisplayName(slug: string): string {
  // Unlike readExistingSongs/readExistingStreams above, this is a best-effort lookup
  // for a Discord embed's display text only — any failure (missing/corrupt registry,
  // unknown slug) falls back to the slug itself rather than aborting the sync, so it
  // keeps its own catch-all instead of readJsonOr's ENOENT-only fallback.
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'data/registry.json'), 'utf-8')) as {
      streamers?: Array<{ slug: string; displayName: string }>;
    };
    return parsed.streamers?.find((s) => s.slug === slug)?.displayName ?? slug;
  } catch {
    return slug;
  }
}

/**
 * Build the fan-announcement batch for a streamer's newly-published streams (pure; `computeHash`
 * injectable for tests). streams.json is the record (`sources`), so a stream's videoId is verified
 * against the stream record — not its lingering songs.json performances (#16 part 1) — while
 * songs.json is a presence-only source (must exist, but excluded from the hash/liveKey search). When
 * the run floods (> ANNOUNCE_FLOOD_CAP), the single summary embed is tokenless, so its subjects'
 * videoIds ride along as `liveKeys` and verify against streams.json at flush (#16 part 2).
 */
export function dataAnnouncementBatch(
  slug: string,
  newStreams: FanSiteStream[],
  songCounts: Map<string, number>,
  displayName: string,
  computeHash: (sources: string[]) => string = hashSources,
): PendingBatch {
  const sources = [`data/${slug}/streams.json`];
  const presenceSources = [`data/${slug}/songs.json`];
  const flood = newStreams.length > ANNOUNCE_FLOOD_CAP;
  const embeds: DiscordEmbed[] = flood
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
  const batch: PendingBatch = { embeds, sources, presenceSources, hash: computeHash(sources) };
  if (flood) batch.liveKeys = newStreams.map((s) => s.videoId);
  return batch;
}

// Queue fan announcements for posting after the data is committed + pushed (via
// `npm run announce:flush`), so fans never get a ping for data that never went live.
// Gated on the webhook being configured so the feature stays dormant when unset.
function announceData(slug: string, newStreams: FanSiteStream[], songCounts: Map<string, number>): void {
  if (newStreams.length === 0 || !loadAnnounceWebhook()) return;
  enqueueAnnouncements(dataAnnouncementBatch(slug, newStreams, songCounts, streamerDisplayName(slug)));
  console.log(`  📥 queued ${newStreams.length} new-stream announcement(s) — posted after push (npm run announce:flush)`);
}

// --- Main ---

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx tools/sync-data/sync.ts <streamer-slug>');
    process.exit(1);
  }

  // Trust boundary for the SQL/path sinks below: the slug is interpolated raw into
  // D1 SQL (wrangler has no bind-param flag) and into path.resolve(ROOT,'data',slug).
  // Reject anything that isn't a safe slug here, so neither sink can be abused — this
  // also guards the direct `sync:data <slug>` path, which never passes through readRegistry.
  assertValidSlug(slug);

  const dataDir = path.resolve(ROOT, 'data', slug);
  if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: data/${slug}/ does not exist. Run sync:registry first.`);
    process.exit(1);
  }

  console.log(`sync-data: exporting approved data for "${slug}"...`);

  const { songs, streams, songsSnap, perfsSnap, streamsSnap, exportRevision } = readFanSiteExport(slug);

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

  if (perfsSnap.cnt !== totalPerfs) {
    console.log(
      `  ⚠ ${perfsSnap.cnt - totalPerfs} approved performance(s) reference a non-approved song (orphan); excluded from songs.json`,
    );
  }

  const entry: SyncStateEntry = {
    exportRevision,
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

if (isMain(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
