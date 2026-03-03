import fs from 'fs';
import path from 'path';
import { Song, Stream, SongMetadata, ArtistInfo } from './types';
export {
  validateYoutubeUrl,
  validateTimestamp,
  timestampToSeconds,
  secondsToTimestamp,
  extractVideoId,
} from './utils';

function dataPath(slug: string, ...segments: string[]): string {
  return path.join(process.cwd(), 'data', slug, ...segments);
}

export function readSongs(slug: string): Song[] {
  const raw = fs.readFileSync(dataPath(slug, 'songs.json'), 'utf-8');
  return JSON.parse(raw) as Song[];
}

export function writeSongs(slug: string, songs: Song[]): void {
  fs.writeFileSync(dataPath(slug, 'songs.json'), JSON.stringify(songs, null, 2), 'utf-8');
}

export function readStreams(slug: string): Stream[] {
  const raw = fs.readFileSync(dataPath(slug, 'streams.json'), 'utf-8');
  return JSON.parse(raw) as Stream[];
}

export function writeStreams(slug: string, streams: Stream[]): void {
  fs.writeFileSync(dataPath(slug, 'streams.json'), JSON.stringify(streams, null, 2), 'utf-8');
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

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
