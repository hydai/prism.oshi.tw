import fs from 'fs';
import path from 'path';
import { Song, Stream } from './types';
export {
  validateYoutubeUrl,
  validateTimestamp,
  timestampToSeconds,
  secondsToTimestamp,
  extractVideoId,
} from './utils';

const songsPath = path.join(process.cwd(), 'data', 'songs.json');
const streamsPath = path.join(process.cwd(), 'data', 'streams.json');

export function readSongs(): Song[] {
  const raw = fs.readFileSync(songsPath, 'utf-8');
  return JSON.parse(raw) as Song[];
}

export function writeSongs(songs: Song[]): void {
  fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2), 'utf-8');
}

export function readStreams(): Stream[] {
  const raw = fs.readFileSync(streamsPath, 'utf-8');
  return JSON.parse(raw) as Stream[];
}

export function writeStreams(streams: Stream[]): void {
  fs.writeFileSync(streamsPath, JSON.stringify(streams, null, 2), 'utf-8');
}

export function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
