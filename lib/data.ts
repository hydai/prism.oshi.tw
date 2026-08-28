import fs from 'fs';
import path from 'path';
import { Song, Stream } from './types';

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
