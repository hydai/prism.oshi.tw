#!/usr/bin/env npx tsx

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

interface StoredSong {
  workId?: string;
  originalArtist: string;
}

interface ItunesTrack {
  artistId?: number;
  artistName?: string;
  trackId?: number;
  trackName?: string;
  primaryGenreName?: string;
}

interface ArtistLookup {
  artist: string;
  workCount: number;
  fetchedAt: string;
  results: Array<{
    artistId: number | null;
    artistName: string;
    trackId: number | null;
    trackName: string;
    primaryGenreName: string;
  }>;
}

interface ArtistMetadataFile {
  schemaVersion: 1;
  provider: 'Apple iTunes Search API';
  source: 'https://itunes.apple.com/search';
  fetchedAt: string;
  lookups: ArtistLookup[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.resolve(__dirname, 'apple-artist-metadata.json');
const USER_AGENT = 'PrismTagCatalog/1.0 (https://prism.oshi.tw)';
const REQUESTS_PER_BATCH = 18;
const BATCH_INTERVAL_MS = 58_000;

function parseMinWorks(): number {
  const value = process.argv.find((arg) => arg.startsWith('--min-works='))?.split('=')[1];
  if (!value) return 5;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--min-works must be a positive integer');
  return parsed;
}

function loadArtistCounts(): Map<string, Set<string>> {
  const counts = new Map<string, Set<string>>();
  for (const entry of fs.readdirSync(path.resolve(ROOT, 'data'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const songsPath = path.resolve(ROOT, 'data', entry.name, 'songs.json');
    if (!fs.existsSync(songsPath)) continue;
    const songs = JSON.parse(fs.readFileSync(songsPath, 'utf8')) as StoredSong[];
    for (const song of songs) {
      const identity = song.workId ?? `${entry.name}:${song.originalArtist}`;
      const works = counts.get(song.originalArtist) ?? new Set<string>();
      works.add(identity);
      counts.set(song.originalArtist, works);
    }
  }
  return counts;
}

function loadExisting(): ArtistMetadataFile {
  if (!fs.existsSync(OUTPUT)) {
    return {
      schemaVersion: 1,
      provider: 'Apple iTunes Search API',
      source: 'https://itunes.apple.com/search',
      fetchedAt: new Date(0).toISOString(),
      lookups: [],
    };
  }
  return JSON.parse(fs.readFileSync(OUTPUT, 'utf8')) as ArtistMetadataFile;
}

function save(file: ArtistMetadataFile): void {
  file.fetchedAt = new Date().toISOString();
  file.lookups.sort((left, right) => left.artist.localeCompare(right.artist, 'zh-TW'));
  fs.writeFileSync(OUTPUT, `${JSON.stringify(file, null, 2)}\n`);
}

async function fetchArtist(artist: string, workCount: number): Promise<ArtistLookup> {
  const params = new URLSearchParams({
    term: artist,
    media: 'music',
    entity: 'song',
    attribute: 'artistTerm',
    country: 'US',
    limit: '5',
  });
  const response = await fetch(`https://itunes.apple.com/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Apple returned HTTP ${response.status}`);
  const body = await response.json() as { results?: ItunesTrack[] };
  return {
    artist,
    workCount,
    fetchedAt: new Date().toISOString(),
    results: (body.results ?? []).map((track) => ({
      artistId: track.artistId ?? null,
      artistName: track.artistName ?? '',
      trackId: track.trackId ?? null,
      trackName: track.trackName ?? '',
      primaryGenreName: track.primaryGenreName ?? '',
    })),
  };
}

async function main(): Promise<void> {
  const minWorks = parseMinWorks();
  const counts = loadArtistCounts();
  const file = loadExisting();
  const completed = new Set(file.lookups.map((lookup) => lookup.artist));
  const pending = [...counts]
    .filter(([artist, works]) => works.size >= minWorks && artist !== 'Unknown' && !completed.has(artist))
    .map(([artist, works]) => ({ artist, workCount: works.size }))
    .sort((left, right) => right.workCount - left.workCount || left.artist.localeCompare(right.artist, 'zh-TW'));

  console.log(`Apple artist metadata: ${pending.length} pending, ${completed.size} cached (min ${minWorks} works)`);
  for (let offset = 0; offset < pending.length; offset += REQUESTS_PER_BATCH) {
    const batch = pending.slice(offset, offset + REQUESTS_PER_BATCH);
    const results = await Promise.allSettled(batch.map(({ artist, workCount }) => fetchArtist(artist, workCount)));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        file.lookups.push(result.value);
      } else {
        console.warn(`  ${batch[index].artist}: ${String(result.reason)}`);
      }
    });
    save(file);
    console.log(`  fetched ${Math.min(offset + batch.length, pending.length)}/${pending.length}; cache saved`);
    if (offset + batch.length < pending.length) {
      console.log(`  respecting Apple's documented rate limit; next batch in ${BATCH_INTERVAL_MS / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, BATCH_INTERVAL_MS));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
