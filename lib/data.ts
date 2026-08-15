import fs from 'fs';
import path from 'path';
import { Song, Stream, SongMetadata, ArtistInfo } from './types';

function dataPath(slug: string, ...segments: string[]): string {
  return path.join(process.cwd(), 'data', slug, ...segments);
}

export function readSongs(slug: string): Song[] {
  const raw = fs.readFileSync(dataPath(slug, 'songs.json'), 'utf-8');
  return JSON.parse(raw) as Song[];
}

export function readStreams(slug: string): Stream[] {
  const raw = fs.readFileSync(dataPath(slug, 'streams.json'), 'utf-8');
  return JSON.parse(raw) as Stream[];
}

export function readSongMetadata(slug: string): SongMetadata[] {
  try {
    const raw = fs.readFileSync(dataPath(slug, 'metadata', 'song-metadata.json'), 'utf-8');
    return JSON.parse(raw) as SongMetadata[];
  } catch {
    return [];
  }
}

export function readArtistInfo(slug: string): ArtistInfo[] {
  try {
    const raw = fs.readFileSync(dataPath(slug, 'metadata', 'artist-info.json'), 'utf-8');
    return JSON.parse(raw) as ArtistInfo[];
  } catch {
    return [];
  }
}
